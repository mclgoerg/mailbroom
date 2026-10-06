"""Pinned mails ("Protect this mail"): per-account Message-ID store, the
/api/pin endpoint, and every enforcement point - group actions, retention,
rules (report AND execute), AI ratings and explicit single-mail actions -
plus the has:pinned filter and read-side tolerance of the pins file."""

import json
import time

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import aihelper
from backend import config as cfgmod
from backend import mailops
from backend import pinstore
from backend import rules as rulesmod
from backend import tenants
from backend.main import app

from conftest import FakeIMAP, make_msg, wait_delete_done
from test_ai_unsub import FakeClient

client = TestClient(app)

DHL = "noreply@dhl.example"
# bridge fixture: DHL = INBOX uid1 + uid2 (same ts) and Archive uid10
# (2025, the oldest); Message-IDs are <m{uid}@shop.example>.
M1, M2, M10 = "<m1@shop.example>", "<m2@shop.example>", "<m10@shop.example>"


def scan(bridge):
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]


def pin(folder, uid, pinned=True, account=None):
    q = f"?account={account}" if account else ""
    return client.post(f"/api/pin{q}", json={
        "folder": folder, "uid": uid, "pinned": pinned})


def trash_uids(bridge):
    return {m["uid"] for m in bridge.mailbox["Trash"]}


# ----------------------------------------------------------------- pinstore

def test_pinstore_roundtrip_and_atomic_file(tmp_path):
    pinstore.set_pinned("<a@x>", True, "acc")
    pinstore.set_pinned("<b@x>", True, "acc")
    assert pinstore.load_account("acc") == {"<a@x>", "<b@x>"}
    assert pinstore.is_pinned("<a@x>", "acc")
    assert not pinstore.is_pinned("", "acc")

    path = tmp_path / "pinned_mails.json"
    assert json.loads(path.read_text()) == {
        "accounts": {"acc": ["<a@x>", "<b@x>"]}}
    assert oct(path.stat().st_mode & 0o777) == "0o600"
    assert not path.with_suffix(".tmp").exists()

    # survives a cold start (cache dropped -> re-read from disk)
    pinstore._cache.clear()
    assert pinstore.load_account("acc") == {"<a@x>", "<b@x>"}

    pinstore.set_pinned("<a@x>", False, "acc")
    pinstore.set_pinned("<ghost@x>", False, "acc")      # no-op
    assert pinstore.load_account("acc") == {"<b@x>"}


def test_pinstore_load_account_returns_a_copy():
    pinstore.set_pinned("<a@x>", True, "acc")
    pinstore.load_account("acc").add("<evil@x>")
    assert pinstore.load_account("acc") == {"<a@x>"}


def test_pinstore_accounts_are_strictly_separate():
    pinstore.set_pinned("<same@x>", True, "one")
    assert pinstore.is_pinned("<same@x>", "one")
    assert not pinstore.is_pinned("<same@x>", "two")
    pinstore.set_pinned("<same@x>", False, "two")        # other account
    assert pinstore.is_pinned("<same@x>", "one")


def test_pinstore_rename_and_drop_account():
    pinstore.set_pinned("<a@x>", True, "one")
    pinstore.set_pinned("<b@x>", True, "two")
    pinstore.rename_account("one", "uno")
    assert pinstore.load_account("one") == set()
    assert pinstore.load_account("uno") == {"<a@x>"}
    pinstore.rename_account("ghost", "x")                # unknown: no-op
    pinstore.drop_account("two")
    assert pinstore.load_account("two") == set()
    pinstore.drop_account("two")                         # idempotent
    pinstore._cache.clear()                              # persisted, too
    assert pinstore.load_account("uno") == {"<a@x>"}
    assert pinstore.load_account("two") == set()


def test_pinstore_tenants_are_separate():
    pinstore.set_pinned("<a@x>", True, "default")
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        assert pinstore.load_account("default") == set()
        pinstore.set_pinned("<b@x>", True, "default")
        assert pinstore.load_account("default") == {"<b@x>"}
    assert pinstore.load_account("default") == {"<a@x>"}
    assert (alice.root / "pinned_mails.json").is_file()


@pytest.mark.parametrize("content", [
    "{not json", "", "[]", '"str"', "null", '{"accounts": []}',
    '{"accounts": {"acc": "nope"}}', '{"accounts": {"acc": {"a": 1}}}',
    b"\xff\xfe\x00garbage",
])
def test_pinstore_tolerates_corrupt_file(tmp_path, content):
    path = tmp_path / "pinned_mails.json"
    path.write_bytes(content if isinstance(content, bytes)
                     else content.encode())
    pinstore._cache.clear()
    assert pinstore.load_account("acc") == set()
    pinstore.set_pinned("<a@x>", True, "acc")            # and recovers
    pinstore._cache.clear()
    assert pinstore.load_account("acc") == {"<a@x>"}


def test_pinstore_ignores_junk_entries_but_keeps_good_ones(tmp_path):
    (tmp_path / "pinned_mails.json").write_text(json.dumps({"accounts": {
        "good": ["<a@x>", 7, None, "", ["nested"], "<b@x>"],
        "bad": "oops"}}))
    pinstore._cache.clear()
    assert pinstore.load_account("good") == {"<a@x>", "<b@x>"}
    assert pinstore.load_account("bad") == set()


def test_missing_file_is_empty(tmp_path):
    assert not (tmp_path / "pinned_mails.json").exists()
    assert pinstore.load_account("acc") == set()


# ---------------------------------------------------------------- /api/pin

def test_pin_endpoint_pins_and_unpins(bridge):
    scan(bridge)
    r = pin("INBOX", 1)
    assert r.status_code == 200 and r.json() == {"ok": True, "pinned": True}
    assert pinstore.load_account(accountsmod.default_name()) == {M1}

    rev = mailops.STATE["groups_rev"]
    st = client.get("/api/state").json()["groups"]
    assert st["sender"][DHL]["pinned"] == 1
    assert st["domain"]["dhl.example"]["pinned"] == 1
    assert st["sender"]["alice@friends.example"]["pinned"] == 0

    mails = client.get(f"/api/group?grouping=sender&key={DHL}").json()
    assert {m["uid"]: m["pinned"] for m in mails} == {
        1: True, 2: False, 10: False}

    r = pin("INBOX", 1, False)
    assert r.json()["pinned"] is False
    assert mailops.STATE["groups_rev"] > rev      # SSE clients refetch
    assert client.get("/api/state").json()[
        "groups"]["sender"][DHL]["pinned"] == 0


def test_pin_follows_message_id_across_rescan_and_move(bridge):
    scan(bridge)
    pin("INBOX", 1)
    # the mail moves to another folder (new UID) and the mailbox is rescanned
    msg = next(m for m in bridge.mailbox["INBOX"] if m["uid"] == 1)
    bridge.mailbox["INBOX"].remove(msg)
    bridge.mailbox["Archive"].append({**msg, "uid": 77})
    scan(bridge)
    mails = mailops.group_mails("sender", DHL)
    assert {m["uid"] for m in mails if m["pinned"]} == {77}


def test_pin_refuses_mail_without_message_id(bridge):
    scan(bridge)
    acc = accountsmod.get()
    acc.index[mailops.ikey("INBOX", 3)]["msgid"] = ""
    r = pin("INBOX", 3)
    assert r.status_code == 400
    assert r.json()["detail"] == mailops.NO_MESSAGE_ID
    assert pinstore.load_account(acc.name) == set()


def test_pin_refuses_unknown_mail(bridge):
    scan(bridge)
    assert pin("INBOX", 999).status_code == 400
    assert pin("Nope", 1).status_code == 400
    assert pinstore.load_account(accountsmod.default_name()) == set()


def test_pin_endpoint_validates_account(bridge):
    scan(bridge)
    assert pin("INBOX", 1, account="nope").status_code == 400


# ------------------------------------------------------------- whole group

def pin_group(key=DHL, pinned=True, grouping="sender", account=None):
    q = f"?account={account}" if account else ""
    return client.post(f"/api/pin_group{q}", json={
        "grouping": grouping, "key": key, "pinned": pinned})


def test_pin_group_pins_every_mail_in_it(bridge):
    scan(bridge)
    pin("INBOX", 1)                                    # already pinned
    rev = mailops.STATE["groups_rev"]
    r = pin_group()
    assert r.status_code == 200
    assert r.json() == {"ok": True, "pinned": True, "changed": 2,
                        "skipped": 0}
    assert pinstore.load_account(accountsmod.default_name()) == {
        M1, M2, M10}
    assert mailops.STATE["groups_rev"] > rev
    st = client.get("/api/state").json()["groups"]
    assert st["sender"][DHL]["pinned"] == 3
    assert st["sender"]["alice@friends.example"]["pinned"] == 0
    # nothing of it can be bulk-trashed any more
    with pytest.raises(ValueError, match=mailops.ALL_PINNED):
        mailops.delete_groups("sender", [DHL])

    # idempotent, and reversible
    assert pin_group().json()["changed"] == 0
    assert pin_group(pinned=False).json()["changed"] == 3
    assert pinstore.load_account(accountsmod.default_name()) == set()


def test_pin_group_on_domain_grouping_and_other_groups_untouched(bridge):
    scan(bridge)
    assert pin_group("dhl.example", grouping="domain").json()["changed"] == 3
    assert client.get("/api/state").json()["groups"]["sender"][
        "news@shop.example"]["pinned"] == 0


def test_pin_group_skips_mails_without_message_id(bridge):
    scan(bridge)
    acc = accountsmod.get()
    acc.index[mailops.ikey("INBOX", 2)]["msgid"] = ""
    r = pin_group().json()
    assert r["changed"] == 2 and r["skipped"] == 1


def test_pin_group_validates_input(bridge):
    scan(bridge)
    assert pin_group("nobody@x.example").status_code == 400
    assert pin_group(grouping="bogus").status_code == 400
    assert pin_group(account="nope").status_code == 400


def test_pin_group_is_per_account(monkeypatch):
    _two_accounts(monkeypatch)
    assert pin_group("both@x.example", account="one").json()["changed"] == 1
    assert pinstore.load_account("two") == set()


def test_set_many_single_write_and_counts(tmp_path):
    assert pinstore.set_many({"<a@x>", "<b@x>"}, True, "acc") == 2
    assert pinstore.set_many({"<a@x>", "<c@x>"}, True, "acc") == 1
    assert pinstore.set_many({"<a@x>", "<zz@x>"}, False, "acc") == 1
    assert pinstore.set_many(set(), True, "acc") == 0
    pinstore._cache.clear()
    assert pinstore.load_account("acc") == {"<b@x>", "<c@x>"}


# ------------------------------------------------------- group action sweeps

@pytest.mark.parametrize("action,dest", [
    ("trash", ""), ("archive", ""), ("move", "Spam")])
def test_group_action_skips_pinned_mails(bridge, action, dest):
    scan(bridge)
    pin("INBOX", 1)
    r = mailops.delete_groups("sender", [DHL], action, dest)
    assert r["queued"] == 2 and r["skipped_pinned"] == 1
    wait_delete_done()
    inbox = {m["uid"] for m in bridge.mailbox["INBOX"]}
    assert 1 in inbox and 2 not in inbox              # only uid2 moved out


def test_group_trash_ignores_force_for_pinned_mails(bridge):
    """force confirms a protected GROUP - it never lifts a mail's pin."""
    scan(bridge)
    cfgmod.update_config({"protected": [DHL]})
    mailops.run_scan()
    pin("INBOX", 2)
    r = mailops.delete_groups("sender", [DHL], force=True)
    assert r["queued"] == 2 and r["skipped_pinned"] == 1
    wait_delete_done()
    assert trash_uids(bridge) == {1, 10}
    assert any(m["uid"] == 2 for m in bridge.mailbox["INBOX"])


def test_group_mark_read_may_proceed_on_pinned_mails(bridge):
    scan(bridge)
    pin("INBOX", 1)                                    # uid1 is unread
    r = mailops.delete_groups("sender", [DHL], "mark_read")
    assert r["queued"] == 3 and r["skipped_pinned"] == 0
    wait_delete_done()
    assert next(m for m in bridge.mailbox["INBOX"] if m["uid"] == 1)["seen"]


def test_group_action_with_only_pinned_mails_is_refused(bridge):
    scan(bridge)
    for folder, uid in (("INBOX", 1), ("INBOX", 2), ("Archive", 10)):
        pin(folder, uid)
    with pytest.raises(ValueError, match=mailops.ALL_PINNED):
        mailops.delete_groups("sender", [DHL])
    r = client.post("/api/delete", json={"grouping": "sender",
                                         "keys": [DHL]})
    assert r.status_code == 400 and r.json()["detail"] == mailops.ALL_PINNED
    assert not bridge.mailbox["Trash"]


def test_pinned_mail_in_other_group_is_untouched(bridge):
    scan(bridge)
    pin("INBOX", 4)                                    # shop newsletter
    r = mailops.delete_groups("sender", [DHL])
    assert r["queued"] == 3 and r["skipped_pinned"] == 0
    wait_delete_done()
    assert trash_uids(bridge) == {1, 2, 10}


def test_domain_group_action_skips_pinned_mails(bridge):
    scan(bridge)
    pin("Archive", 10)
    r = mailops.delete_groups("domain", ["dhl.example"])
    assert r["queued"] == 2 and r["skipped_pinned"] == 1
    wait_delete_done()
    assert trash_uids(bridge) == {1, 2}


# --------------------------------------------------------------- retention

def test_pinned_mail_is_always_in_the_keep_set(bridge):
    scan(bridge)
    acc = accountsmod.get()
    rec = acc.state["groups"]["sender"][DHL]
    # uid10 is the OLDEST mail - keep_latest=1 alone would act on it.
    assert mailops.retained_mails(rec, acc, keep_latest=1) == {"INBOX": {1}}
    assert mailops.retained_mails(
        rec, acc, keep_latest=1, pinned={M10}) == {
            "INBOX": {1}, "Archive": {10}}
    # pins alone (no retention setting) are a keep-set too
    assert mailops.retained_mails(rec, acc, pinned={M2}) == {"INBOX": {2}}
    assert mailops.retained_mails(rec, acc) == {}
    assert mailops.group_act_count(rec, acc, 1, None, {M10}) == 1


def test_keep_latest_with_pinned_old_mail(bridge):
    scan(bridge)
    pin("Archive", 10)
    r = mailops.delete_groups("sender", [DHL], keep_latest=1)
    # keep newest (uid1) + pinned (uid10) -> only uid2 is acted on
    assert r["queued"] == 1 and r["skipped_pinned"] == 1
    wait_delete_done()
    assert trash_uids(bridge) == {2}


def test_older_than_days_with_pinned_old_mail(bridge):
    scan(bridge)
    pin("Archive", 10)                                 # the only old mail
    # without the pin uid10 would be the single thing acted on; with it,
    # nothing is left - and the pin is what's reported as the reason.
    with pytest.raises(ValueError, match="pinned"):
        mailops.delete_groups("sender", [DHL], older_than_days=30)
    assert not bridge.mailbox["Trash"]


def test_pin_inside_retention_window_is_not_double_counted(bridge):
    scan(bridge)
    pin("INBOX", 1)                                    # already kept by window
    r = mailops.delete_groups("sender", [DHL], keep_latest=1)
    assert r["queued"] == 2 and r["skipped_pinned"] == 0
    wait_delete_done()
    assert trash_uids(bridge) == {2, 10}


def test_pinned_does_not_use_up_a_keep_latest_slot(bridge):
    scan(bridge)
    pin("Archive", 10)
    # newest two (uid1, uid2) kept by retention, uid10 by its pin: if the
    # pin took one of the two slots, uid2 would have been acted on.
    with pytest.raises(ValueError, match="pinned"):
        mailops.delete_groups("sender", [DHL], keep_latest=2)
    assert not bridge.mailbox["Trash"]


# ------------------------------------------------------------------- rules

def _rule(action="trash", **kw):
    return rulesmod.create_rule({
        "name": "dhl", "grouping": "sender", "query": "tag:shipping",
        "action": action, **kw})


def test_rule_report_excludes_pinned_mails(bridge):
    scan(bridge)
    pin("INBOX", 1)
    res = rulesmod.run_rule(_rule()["id"], rescan=False)
    assert res["mode"] == "report"
    assert res["mails"] == 2 and res["skipped_pinned"] == 1
    assert res["preview"][0]["count"] == 2
    assert not bridge.mailbox["Trash"]


def test_rule_execute_leaves_pinned_mails(bridge):
    scan(bridge)
    pin("INBOX", 1)
    rule = _rule()
    rulesmod.run_rule(rule["id"], rescan=False)        # required report run
    rulesmod.update_rule(rule["id"], {"mode": "execute"})
    res = rulesmod.run_rule(rule["id"], rescan=False)
    assert res["acted"] == 2 and res["mails"] == 2
    wait_delete_done()
    assert trash_uids(bridge) == {2, 10}
    assert any(m["uid"] == 1 for m in bridge.mailbox["INBOX"])


def test_rule_report_and_execute_agree_with_retention(bridge):
    scan(bridge)
    pin("Archive", 10)
    rule = _rule(keep_latest=1)
    report = rulesmod.run_rule(rule["id"], rescan=False)
    assert report["mails"] == 1 and report["skipped_pinned"] == 1
    rulesmod.update_rule(rule["id"], {"mode": "execute"})
    res = rulesmod.run_rule(rule["id"], rescan=False)
    assert res["acted"] == report["mails"] == 1
    wait_delete_done()
    assert trash_uids(bridge) == {2}


def test_rule_with_everything_pinned_acts_on_nothing(bridge):
    scan(bridge)
    for folder, uid in (("INBOX", 1), ("INBOX", 2), ("Archive", 10)):
        pin(folder, uid)
    rule = _rule()
    report = rulesmod.run_rule(rule["id"], rescan=False)
    assert report["mails"] == 0 and report["preview"] == []
    assert report["skipped_pinned"] == 3
    rulesmod.update_rule(rule["id"], {"mode": "execute"})
    res = rulesmod.run_rule(rule["id"], rescan=False)
    assert res["acted"] == 0 and not bridge.mailbox["Trash"]


def test_rule_mark_read_is_not_limited_by_pins(bridge):
    scan(bridge)
    pin("INBOX", 1)
    res = rulesmod.run_rule(_rule("mark_read")["id"], rescan=False)
    assert res["mails"] == 3 and res["skipped_pinned"] == 0


def test_rule_cap_counts_only_unpinned_mails(bridge, monkeypatch):
    scan(bridge)
    pin("INBOX", 1)
    monkeypatch.setattr(rulesmod, "RULE_CAP", 2)
    res = rulesmod.run_rule(_rule()["id"], rescan=False)
    assert res["mails"] == 2 and res["capped"] == 0     # 2 fit the cap of 2


def test_rule_has_pinned_query_matches_groups_with_pinned_mail(bridge):
    scan(bridge)
    pin("INBOX", 1)
    res = rulesmod.run_rule(
        _rule(query="has:pinned")["id"], rescan=False)
    assert res["groups"] == 1 and res["mails"] == 2
    res = rulesmod.run_rule(
        _rule(query="has:pinned tag:travel")["id"], rescan=False)
    assert res["groups"] == 0


# ------------------------------------------------------------------ filter

def test_has_pinned_filter_parser_and_matching():
    f = rulesmod.parse_filter("has:pinned")
    assert f["pinned_only"] and f["text"] == []
    assert not rulesmod.parse_filter("")["pinned_only"]
    # other has:* values stay plain text, like any unknown qualifier
    other = rulesmod.parse_filter("has:other")
    assert not other["pinned_only"] and other["text"] == ["has:other"]

    g = {"key": "a@b", "label": "A", "sub": "", "tags": [], "unread": 0,
         "count": 3, "pinned": 1}
    assert rulesmod.match_group(g, f)
    assert not rulesmod.match_group({**g, "pinned": 0}, f)
    assert not rulesmod.match_group({k: v for k, v in g.items()
                                     if k != "pinned"}, f)
    assert rulesmod.match_group({**g, "pinned": 0},
                                rulesmod.parse_filter("a@b"))


# --------------------------------------------------------------------- AI

@pytest.fixture
def ai_ready(bridge, monkeypatch):
    cfgmod.update_config({"ai": {"api_key": "test-key",
                                 "model": "claude-sonnet-5"}})
    mailops.run_scan()
    assert mailops.STATE["status"] == "done"
    return monkeypatch


def test_ai_verdict_of_pinned_mail_is_forced_to_keep(ai_ready):
    sent_payloads = []

    def payload(sent):
        sent_payloads.append(sent)
        return {"items": [{"uid": m["uid"], "folder_i": m["folder_i"],
                           "verdict": "delete_safe"} for m in sent["mails"]],
                "note": "n"}
    fake = FakeClient(payload)
    ai_ready.setattr(aihelper, "ai_client", lambda cfg: fake)
    pin("INBOX", 2)

    r = aihelper.ai_group("sender", DHL)
    assert r["reviewed"] == 3
    by_uid = {v[1]: v[2] for v in r["verdicts"]}
    assert by_uid == {1: "delete_safe", 2: "keep", 10: "delete_safe"}
    mails = mailops.group_mails("sender", DHL)
    assert {m["uid"]: m["ai"] for m in mails}[2] == "keep"

    # consent texts stay valid: pin data never enters the AI payload
    assert "pinned" not in json.dumps(sent_payloads)
    assert "pinned" not in fake.calls[0]["system"].lower()


# --------------------------------------------------- explicit single mails

def test_delete_messages_refuses_pinned_without_force(bridge):
    scan(bridge)
    pin("INBOX", 1)
    for action, dest in (("trash", ""), ("archive", ""), ("move", "Spam")):
        with pytest.raises(ValueError, match="pinned"):
            mailops.delete_messages(
                [["INBOX", 1], ["INBOX", 2]], action, dest)
    assert not bridge.mailbox["Trash"]
    assert len(bridge.mailbox["INBOX"]) == 4           # nothing moved at all

    r = client.post("/api/delete_messages", json={
        "items": [["INBOX", 1]], "action": "trash"})
    assert r.status_code == 400
    assert r.json()["detail"] == mailops.PINNED_MAILS


def test_delete_messages_force_acts_on_pinned_mail(bridge):
    scan(bridge)
    pin("INBOX", 1)
    r = client.post("/api/delete_messages", json={
        "items": [["INBOX", 1]], "action": "trash", "force": True})
    assert r.status_code == 200 and r.json()["queued"] == 1
    wait_delete_done()
    assert trash_uids(bridge) == {1}


def test_delete_messages_unpinned_needs_no_force(bridge):
    scan(bridge)
    pin("INBOX", 1)
    r = client.post("/api/delete_messages", json={
        "items": [["INBOX", 2]], "action": "trash"})
    assert r.status_code == 200
    wait_delete_done()
    assert trash_uids(bridge) == {2}


def test_delete_messages_mark_read_needs_no_force(bridge):
    scan(bridge)
    pin("INBOX", 1)
    r = mailops.delete_messages([["INBOX", 1]], "mark_read")
    assert r["queued"] == 1
    wait_delete_done()
    assert next(m for m in bridge.mailbox["INBOX"] if m["uid"] == 1)["seen"]


def test_undo_and_trash_browser_are_unaffected(bridge):
    scan(bridge)
    pin("INBOX", 1)
    client.post("/api/delete_messages", json={
        "items": [["INBOX", 1]], "action": "trash", "force": True})
    wait_delete_done()
    assert client.get("/api/trash").json()["mails"][0]["uid"] == 1
    assert client.post("/api/undo", json={}).status_code == 200
    assert any(m["uid"] == 1 for m in bridge.mailbox["INBOX"])
    # restoring leaves the pin in place (it keys off the Message-ID)
    assert pinstore.load_account(accountsmod.default_name()) == {M1}


# ------------------------------------------------- accounts / multi-account

def _two_accounts(monkeypatch):
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "host-one", "user": "u1", "password": "pw"},
        "two": {"host": "host-two", "user": "u2", "password": "pw"}}}))
    fakes = {h: FakeIMAP({
        "INBOX": [make_msg(1, frm="both@x.example", subject="same mail")],
        "Trash": []}) for h in ("host-one", "host-two")}
    monkeypatch.setattr(mailops, "connect",
                        lambda im, name=None: fakes[im["host"]])
    for name in ("one", "two"):
        acc = accountsmod.get(name)
        mailops.run_scan(acc)
        assert acc.state["status"] == "done"
    return fakes


def test_pin_in_one_account_never_protects_the_other(monkeypatch):
    fakes = _two_accounts(monkeypatch)
    # the very same Message-ID sits in both mailboxes
    assert pin("INBOX", 1, account="one").status_code == 200

    two = accountsmod.get("two")
    assert mailops.public_state(two)["groups"]["sender"][
        "both@x.example"]["pinned"] == 0
    r = mailops.delete_groups("sender", ["both@x.example"], acc=two)
    assert r["queued"] == 1 and r["skipped_pinned"] == 0
    time.sleep(0.01)
    wait_delete_done_for(two)
    assert len(fakes["host-two"].mailbox["Trash"]) == 1

    one = accountsmod.get("one")
    with pytest.raises(ValueError, match="pinned"):
        mailops.delete_groups("sender", ["both@x.example"], acc=one)
    assert not fakes["host-one"].mailbox["Trash"]


def wait_delete_done_for(acc, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        with acc.lock:
            if acc.state["delete"]["status"] != "running":
                return
        time.sleep(0.02)
    raise TimeoutError("delete worker did not finish")


def test_rename_and_delete_account_carry_pins(monkeypatch):
    _two_accounts(monkeypatch)
    pin("INBOX", 1, account="one")
    pin("INBOX", 1, account="two")

    r = client.post("/api/config", json={
        "rename_account": {"from": "one", "to": "uno"}})
    assert r.status_code == 200
    assert pinstore.load_account("uno") == {M1}
    assert pinstore.load_account("one") == set()
    assert pinstore.load_account("two") == {M1}
    # still enforced under the new name
    with pytest.raises(ValueError, match="pinned"):
        mailops.delete_groups("sender", ["both@x.example"],
                              acc=accountsmod.get("uno"))

    r = client.post("/api/config", json={"delete_account": "two"})
    assert r.status_code == 200
    assert pinstore.load_account("two") == set()
    assert pinstore.load_account("uno") == {M1}
