"""Folders panel backend: Junk through its role index (listing, sender
grouping, count after a scan), reversible moves out of Junk (Not junk ->
Inbox, Move to Trash) with undo, UIDVALIDITY refusal, protected / pinned
guards, ambiguous Junk, and the main scan staying untouched."""

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import mailops
from backend.main import app
from conftest import FakeIMAP, make_msg, wait_scan_done

client = TestClient(app)


def _junk():
    return [
        make_msg(40, frm="Promo <win@lottery.example>", subject="You won",
                 size=500, date="02-Jan-2026 10:00:00 +0000"),
        make_msg(41, frm="Promo <win@lottery.example>", subject="Again",
                 size=600, seen=True, date="03-Jan-2026 10:00:00 +0000"),
        make_msg(42, frm="Bob <bob@friends.example>", subject="Wrongly caught",
                 size=700, date="04-Jan-2026 10:00:00 +0000"),
    ]


@pytest.fixture
def junked(bridge):
    bridge.mailbox["Spam"] = _junk()
    bridge.uv["Spam"] = 1
    return bridge


def _list(role="junk"):
    return client.get("/api/folders_panel", params={"role": role}).json()


def _move(action, uids, uv=1, **kw):
    return client.post("/api/folders_panel/move", json={
        "role": "junk", "action": action, "uids": uids, "uv": uv, **kw})


def test_junk_listing_and_sender_grouping(junked):
    r = _list()
    assert r["folder"] == "Spam" and r["uv"] == 1 and r["total"] == 3
    assert r["max_uid"] == 42
    assert [m["uid"] for m in r["mails"]] == [42, 41, 40]      # newest first
    assert r["senders"][0] == {
        "addr": "win@lottery.example", "count": 2, "size": 1100, "unread": 1,
        "ts": r["senders"][0]["ts"], "date": r["senders"][0]["date"],
        "uids": [40, 41]}
    assert [g["addr"] for g in r["senders"]] == [
        "win@lottery.example", "bob@friends.example"]
    assert mailops.STATE["junk_count"] == 3
    # the role index of Junk holds it; the main index and Trash do not
    assert {m["uid"] for m in mailops.role_mails("junk")} == {40, 41, 42}
    assert mailops.role_mails("trash") == []
    assert all(m["folder"] != "Spam" for m in mailops.INDEX.values())


def test_trash_listing_keeps_working_on_both_endpoints(trashed_pair):
    old = client.get("/api/trash").json()
    new = _list("trash")
    assert old["total"] == new["total"] == 2
    assert old["uv"] == new["uv"] and old["max_uid"] == new["max_uid"] == 31
    assert mailops.STATE["trash_count"] == 2


@pytest.fixture
def trashed_pair(bridge):
    bridge.mailbox["Trash"] = [make_msg(30), make_msg(31)]
    return bridge


def test_bad_role_refused(bridge):
    assert client.get("/api/folders_panel",
                      params={"role": "sent"}).status_code == 400


def test_junk_count_after_scan_and_main_scan_unchanged(junked):
    mailops.run_scan()
    assert mailops.STATE["junk_count"] == 3
    assert mailops.STATE["trash_count"] == 0
    # Junk mail never enters the cleanup groups / index
    assert all(m["folder"] != "Spam" for m in mailops.INDEX.values())
    assert "win@lottery.example" not in mailops.STATE["groups"]["sender"]
    assert mailops.STATE["groups"]["sender"]["noreply@dhl.example"]["count"] == 3
    assert mailops.role_mails("junk") == []          # scan fetched no Junk


def test_junk_count_survives_snapshot(junked):
    mailops.run_scan()
    mailops.save_snapshot(accountsmod.get())
    acc = accountsmod.get()
    acc.state["junk_count"] = None
    acc.state["status"] = "idle"
    acc.index.clear()
    assert mailops.load_snapshot(acc)
    assert acc.state["junk_count"] == 3


def test_not_junk_moves_to_inbox_with_undo_and_protect(junked):
    mailops.run_scan()
    r = _list()
    res = _move("not_junk", [42], r["uv"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["moved"] == 1 and body["senders"] == ["bob@friends.example"]
    wait_scan_done()
    assert [m["uid"] for m in junked.mailbox["Spam"]] == [40, 41]
    assert any(m["subject"] == "Wrongly caught"
               for m in junked.mailbox["INBOX"])
    # the Junk index and the count follow without a refetch
    assert {m["uid"] for m in mailops.role_mails("junk")} == {40, 41}
    assert mailops.STATE["junk_count"] == 2
    # quiet undo entry for the panel's own toast
    undo = mailops.STATE["undo"][-1]
    assert undo["count"] == 1 and undo["quiet"] is True
    # the rescued mail shows up in the cleanup views
    assert "bob@friends.example" in mailops.STATE["groups"]["sender"]
    # "Protect sender": the toast action is the ordinary protect call, and
    # nothing was protected silently by the move itself
    assert not mailops.cfgmod.load_config().get("protected")
    p = client.post("/api/protect", json={"entry": "bob@friends.example",
                                          "on": True})
    assert "bob@friends.example" in p.json()["protected"]
    # Undo puts it back into Junk
    out = client.post("/api/undo", json={"index": -1}).json()
    assert out["restored"] == 1
    wait_scan_done()
    assert {m["subject"] for m in junked.mailbox["Spam"]} == {
        "You won", "Again", "Wrongly caught"}
    assert mailops.STATE["junk_count"] == 3
    assert {m["uid"] for m in _list()["mails"]
            if m["subject"] == "Wrongly caught"}


def test_not_junk_ignores_protected_senders(junked):
    client.post("/api/protect", json={"entry": "bob@friends.example",
                                      "on": True})
    r = _list()
    res = _move("not_junk", [42], r["uv"])
    assert res.status_code == 200 and res.json()["moved"] == 1


def test_move_to_trash_from_junk_with_undo(junked):
    mailops.run_scan()
    r = _list()
    res = _move("trash", [40, 41], r["uv"])
    assert res.status_code == 200 and res.json()["moved"] == 2
    assert [m["uid"] for m in junked.mailbox["Spam"]] == [42]
    assert {m["subject"] for m in junked.mailbox["Trash"]} == {"You won",
                                                               "Again"}
    assert mailops.STATE["junk_count"] == 1
    assert mailops.STATE["trash_count"] == 2
    assert not res.json()["rescan"]
    assert client.post("/api/undo", json={"index": -1}).json()["restored"] == 2
    assert len(junked.mailbox["Spam"]) == 3 and junked.mailbox["Trash"] == []
    assert mailops.STATE["junk_count"] == 3 and mailops.STATE["trash_count"] == 0


def test_move_to_trash_respects_protected_and_pinned(junked):
    client.post("/api/protect", json={"entry": "bob@friends.example",
                                      "on": True})
    r = _list()
    res = _move("trash", [42], r["uv"])
    assert res.status_code == 400 and res.json()["detail"] == "protected_mails"
    assert len(junked.mailbox["Spam"]) == 3
    res = _move("trash", [42], r["uv"], force=True)
    assert res.status_code == 200 and res.json()["moved"] == 1
    # pinned mail: same guard
    # a pin by Message-ID (the mail was pinned while it lived elsewhere)
    mailops.pinstore.set_pinned("<m41@shop.example>", True,
                                accountsmod.get().name)
    res = _move("trash", [41], r["uv"])
    assert res.status_code == 400 and res.json()["detail"] == "pinned_mails"


def test_uidvalidity_mismatch_refuses(junked):
    r = _list()
    # the client's listing is older than the server's folder
    junked.uv["Spam"] = 9
    res = _move("not_junk", [42], r["uv"])
    assert res.status_code == 409 and "UIDVALIDITY" in res.json()["detail"]
    assert len(junked.mailbox["Spam"]) == 3 and junked.mailbox["Trash"] == []
    # and a listing older than the cached index is refused up front
    _list()                                       # rebuilds under uv 9
    res = _move("trash", [42], 1)
    assert res.status_code == 409 and "changed" in res.json()["detail"]
    assert len(junked.mailbox["Spam"]) == 3


def test_only_known_exact_uids_move(junked):
    r = _list()
    junked.mailbox["Spam"].append(make_msg(50, subject="Arrived later"))
    res = _move("trash", [42, 50], r["uv"])
    assert res.json()["moved"] == 1
    assert {m["uid"] for m in junked.mailbox["Spam"]} == {40, 41, 50}
    assert _move("trash", [99], r["uv"]).status_code == 409


def test_bad_action_refused(junked):
    _list()
    res = client.post("/api/folders_panel/move", json={
        "role": "junk", "action": "delete", "uids": [40], "uv": 1})
    assert res.status_code == 400


def test_ambiguous_junk_still_usable_for_moves(monkeypatch):
    fake = FakeIMAP({"INBOX": [make_msg(1)], "Junk": [make_msg(5)],
                     "Spam": [make_msg(6, frm="x@spam.example"),
                              make_msg(7, frm="y@spam.example")],
                     "Trash": []},
                    list_order=["Junk", "Spam"])
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    r = _list()
    assert r["folder"] in ("Junk", "Spam")
    folder = r["folder"]
    res = _move("trash", [r["mails"][0]["uid"]], r["uv"])
    assert res.status_code == 200 and res.json()["moved"] == 1
    assert len(fake.mailbox["Trash"]) == 1
    assert len(fake.mailbox[folder]) == (len(r["mails"]) - 1)


def test_busy_delete_refuses(junked):
    r = _list()
    mailops.STATE["delete"]["status"] = "running"
    assert _move("trash", [42], r["uv"]).status_code == 409
    mailops.STATE["delete"]["status"] = "idle"
