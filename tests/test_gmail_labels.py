"""Gmail shows one message under every label folder. With X-GM-EXT-1
advertised, a scan keeps ONE copy per X-GM-MSGID (INBOX first, then a fixed
folder order) and actions act on that copy; other servers are untouched."""

import json

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import config as cfgmod
from backend import mailops
from backend.main import app
from conftest import FakeIMAP, gmail_copy, make_msg, wait_delete_done

client = TestClient(app)

SENDER = "a@x.example"
TRASH = "[Gmail]/Trash"
FLAGS = {TRASH: "\\Trash", "[Gmail]/All Mail": "\\All"}


def _gmail(monkeypatch, gmail=True, inbox=True) -> FakeIMAP:
    """One message (gmid 1001) under INBOX, two user labels and All Mail
    (a role folder, never scanned),
    plus an unrelated INBOX mail."""
    m = make_msg(1, frm=SENDER, subject="hello", msgid="<one@x.example>")
    other = make_msg(2, frm="b@x.example", subject="other",
                     msgid="<two@x.example>")
    other["gmid"] = "2002"
    fake = FakeIMAP(
        {"INBOX": ([gmail_copy(m, 1)] if inbox else []) + [other],
         "Receipts": [gmail_copy(m, 11)],
         "Projects": [gmail_copy(m, 21)],
         "[Gmail]/All Mail": [gmail_copy(m, 31)],
         TRASH: []},
        flags=FLAGS, gmail=gmail)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    return fake


def _scan():
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]


def _kept(sender=SENDER):
    return {k: v for k, v in mailops.INDEX.items() if v["addr"] == sender}


def test_several_labels_count_once_and_inbox_wins(monkeypatch):
    _gmail(monkeypatch)
    _scan()
    rec = mailops.STATE["groups"]["sender"][SENDER]
    assert rec["count"] == 1 and rec["folders"] == {"INBOX": [1]}
    assert [m["folder"] for m in _kept().values()] == ["INBOX"]
    # the label copies are remembered, not counted
    assert {m["folder"] for m in accountsmod.get().label_copies.values()} \
        == {"Receipts", "Projects"}
    assert mailops.index_stats()["mails"] == 2


def test_duplicates_panel_does_not_list_label_copies(monkeypatch):
    _gmail(monkeypatch)
    _scan()
    assert client.get("/api/duplicates").json() == []


def test_real_duplicates_still_listed(monkeypatch):
    """Two separate Gmail messages (different ids) with the same
    Message-ID are a genuine duplicate, label or not."""
    fake = _gmail(monkeypatch)
    twin = make_msg(3, frm=SENDER, subject="hello", msgid="<one@x.example>")
    fake.mailbox["INBOX"].append({**twin, "gmid": "3003"})
    _scan()
    sets = client.get("/api/duplicates").json()
    assert len(sets) == 1 and len(sets[0]["mails"]) == 2


def test_without_inbox_copy_the_first_label_by_name_is_kept(monkeypatch):
    _gmail(monkeypatch, inbox=False)
    _scan()
    kept = _kept()
    assert [m["folder"] for m in kept.values()] == ["Projects"]
    # stable: a second scan picks the same copy
    _scan()
    assert [m["folder"] for m in _kept().values()] == ["Projects"]


def test_trash_acts_on_the_kept_copy_and_clears_every_label(monkeypatch):
    fake = _gmail(monkeypatch)
    _scan()
    mailops.delete_groups("sender", [SENDER])
    wait_delete_done()
    assert [m["uid"] for m in fake.mailbox[TRASH]] == [1]
    for folder in ("Receipts", "Projects", "[Gmail]/All Mail"):
        assert not [m for m in fake.mailbox[folder] if m["gmid"] == "1001"]
    assert SENDER not in mailops.STATE["groups"]["sender"]
    assert not _kept()


def test_undo_restores_the_kept_copy_to_its_folder(monkeypatch):
    fake = _gmail(monkeypatch)
    _scan()
    mailops.delete_groups("sender", [SENDER])
    wait_delete_done()
    assert mailops.undo_last()["restored"] == 1
    assert [m["msgid"] for m in fake.mailbox["INBOX"]
            if m["msgid"] == "<one@x.example>"]
    # Gmail drops the other labels on trash; undo cannot bring them back
    assert not fake.mailbox["Receipts"]


def test_pin_on_the_kept_copy_protects_the_message(monkeypatch):
    fake = _gmail(monkeypatch)
    _scan()
    assert client.post("/api/pin", json={
        "folder": "INBOX", "uid": 1, "pinned": True}).status_code == 200
    with pytest.raises(ValueError, match="all_pinned"):
        mailops.delete_groups("sender", [SENDER])
    assert not fake.mailbox[TRASH]
    assert any(m.get("gmid") == "1001" for m in fake.mailbox["Receipts"])


def test_protected_sender_guard_applies_to_the_deduped_group(monkeypatch):
    fake = _gmail(monkeypatch)
    cfgmod.update_config({"protected": [SENDER]})
    _scan()
    with pytest.raises(ValueError, match="protected"):
        mailops.delete_groups("sender", [SENDER])
    assert not fake.mailbox[TRASH]


def test_rescan_does_not_refetch_label_copies(monkeypatch):
    fake = _gmail(monkeypatch)
    _scan()
    fake.gm_fetches.clear()
    fetched: list[str] = []
    real_uid = fake.uid
    fake.uid = lambda cmd, *a: (fetched.append(a[1]) if cmd == "FETCH"
                                else None) or real_uid(cmd, *a)
    _scan()
    assert fetched and all(spec == "(UID FLAGS X-GM-MSGID)"
                           for spec in fetched)
    assert mailops.index_stats()["mails"] == 2
    assert len(accountsmod.get().label_copies) == 2


def test_label_copy_is_promoted_when_the_kept_copy_leaves(monkeypatch):
    fake = _gmail(monkeypatch)
    _scan()
    fake.mailbox["INBOX"] = [m for m in fake.mailbox["INBOX"]
                             if m["uid"] != 1]       # archived elsewhere
    _scan()
    assert [m["folder"] for m in _kept().values()] == ["Projects"]
    assert mailops.STATE["groups"]["sender"][SENDER]["count"] == 1


def test_snapshot_roundtrip_keeps_label_copies(monkeypatch):
    _gmail(monkeypatch)
    _scan()
    accountsmod.reset()
    acc = accountsmod.get()
    assert mailops.load_snapshot(acc)
    assert len(acc.label_copies) == 2 and len(acc.index) == 2


def test_old_snapshot_without_label_copies_migrates(monkeypatch):
    """A snapshot from before this change (no `label_copies`, no `gmid` on
    its records) loads, and the next Gmail scan fills the ids with a cheap
    flags-only FETCH - no header refetch."""
    fake = _gmail(monkeypatch, gmail=False)
    _scan()                                  # pre-change shape: 3 copies
    path = mailops._snap_path(accountsmod.get().name)
    data = json.loads(path.read_text())
    assert "label_copies" in data and data["label_copies"] == []
    del data["label_copies"]
    path.write_text(json.dumps(data))
    accountsmod.reset()
    acc = accountsmod.get()
    assert mailops.load_snapshot(acc) and not acc.label_copies
    assert len(acc.index) == 4               # the over-count being fixed

    fake.gmail = True
    fake.capabilities += ("X-GM-EXT-1",)
    for m in (x for f in fake.mailbox.values() for x in f):
        m.setdefault("gmid", "9")            # ids exist server-side anyway
    fetched: list[str] = []
    real_uid = fake.uid
    fake.uid = lambda cmd, *a: (fetched.append(a[1]) if cmd == "FETCH"
                                else None) or real_uid(cmd, *a)
    _scan()
    assert all(spec == "(UID FLAGS X-GM-MSGID)" for spec in fetched)
    assert mailops.STATE["groups"]["sender"][SENDER]["count"] == 1
    assert all(m.get("gmid") for m in accountsmod.get().index.values())


def test_non_gmail_server_is_unchanged(monkeypatch):
    """Without X-GM-EXT-1 the same layout counts every folder copy, asks no
    X-GM-MSGID, stores no ids and caches no label copies."""
    fake = _gmail(monkeypatch, gmail=False)
    _scan()
    rec = mailops.STATE["groups"]["sender"][SENDER]
    assert rec["count"] == 3
    assert set(rec["folders"]) == {"INBOX", "Receipts", "Projects"}
    assert not fake.gm_fetches
    assert not any("gmid" in m for m in mailops.INDEX.values())
    assert not accountsmod.get().label_copies
    assert len(client.get("/api/duplicates").json()) == 1


def test_inbox_beats_a_label_that_sorts_first(monkeypatch):
    m = make_msg(1, frm=SENDER, subject="hello", msgid="<one@x.example>")
    fake = FakeIMAP({"INBOX": [gmail_copy(m, 5)],
                     "Accounts": [gmail_copy(m, 6)], TRASH: []},
                    flags=FLAGS, gmail=True)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    _scan()
    assert [m["folder"] for m in _kept().values()] == ["INBOX"]
    assert {m["folder"] for m in accountsmod.get().label_copies.values()} \
        == {"Accounts"}


def test_mails_without_a_gmail_id_are_never_merged(monkeypatch):
    """On a Gmail server, a record the server gave no X-GM-MSGID for is
    never dropped and never treated as another mail's copy."""
    m = make_msg(1, frm=SENDER, subject="hello", msgid="<one@x.example>")
    fake = FakeIMAP({"INBOX": [{**m, "uid": 1}],
                     "Receipts": [{**m, "uid": 11}], TRASH: []},
                    flags=FLAGS, gmail=True)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    _scan()
    assert mailops.STATE["groups"]["sender"][SENDER]["count"] == 2
    assert not accountsmod.get().label_copies
    assert not any("gmid" in m for m in mailops.INDEX.values())


def test_label_copy_cache_follows_uidvalidity_and_trash(monkeypatch):
    fake = _gmail(monkeypatch)
    _scan()
    acc = accountsmod.get()
    old = {k for k, v in acc.label_copies.items() if v["folder"] == "Receipts"}
    assert old == {"Receipts\x0011"}
    # Receipts is renumbered (new UIDVALIDITY, new UID): no stale entry
    fake.uv["Receipts"] = 2
    fake.mailbox["Receipts"] = [gmail_copy(fake.mailbox["Receipts"][0], 12)]
    _scan()
    assert {k for k, v in acc.label_copies.items()
            if v["folder"] == "Receipts"} == {"Receipts\x0012"}
    # trashing the message removes it everywhere; nothing stays cached
    mailops.delete_groups("sender", [SENDER])
    wait_delete_done()
    _scan()
    assert not acc.label_copies
