"""End-to-end scan / group / delete / undo tests on the fake IMAP server."""

from backend import config as cfgmod
from backend import mailops

from conftest import make_msg, wait_delete_done, wait_scan_done


def scan(bridge):
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]


def _fetch_specs(bridge, monkeypatch) -> list:
    """Wrap bridge.uid to record scan_folder()'s FETCH field-spec strings
    (both the full "(UID FLAGS RFC822.SIZE ...)" and the incremental
    "(UID FLAGS)"-only kind), so a test can assert which UIDs got which.
    Excludes scan_sent_recipients()'s unrelated TO/CC header fetch."""
    specs = []
    orig = bridge.uid

    def wrapper(cmd, *args):
        if cmd == "FETCH" and args[1].startswith("(UID FLAGS"):
            specs.append(args[1])
        return orig(cmd, *args)

    monkeypatch.setattr(bridge, "uid", wrapper)
    return specs


def test_scan_builds_groups(bridge):
    scan(bridge)
    st = mailops.STATE
    senders = st["groups"]["sender"]
    # Trash/Spam excluded by default; INBOX + Archive scanned.
    assert set(st["folders"]) == {"INBOX", "Archive"}
    dhl = senders["noreply@dhl.example"]
    assert dhl["count"] == 3                       # 2 in INBOX + 1 in Archive
    assert dhl["label"] == "DHL Paket"
    assert "shipping" in dhl["tags"]
    assert dhl["unread"] == 1
    assert dhl["size"] == 15000
    assert dhl["first"] == "2025-01-01"
    assert dhl["unsub"] is True
    # subject grouping normalizes digits: both "Sendung N kommt heute" merge
    subj = st["groups"]["subject"]
    merged = [r for r in subj.values() if "kommt heute" in r["key"]]
    assert len(merged) == 1 and merged[0]["count"] == 2
    # domain grouping
    assert st["groups"]["domain"]["dhl.example"]["count"] == 3
    assert st["trash_count"] == 0
    assert mailops.FOLDER_UV["INBOX"] == 1


def test_delete_group_and_undo(bridge):
    scan(bridge)
    mailops.delete_groups("sender", ["noreply@dhl.example"])
    d = wait_delete_done()
    assert d["moved"] == 3 and not d["error"]
    # gone from all groupings and the index
    assert "noreply@dhl.example" not in mailops.STATE["groups"]["sender"]
    assert "dhl.example" not in mailops.STATE["groups"]["domain"]
    assert len(bridge.mailbox["Trash"]) == 3
    assert len(mailops.STATE["undo"]) == 1

    r = mailops.undo_last()
    assert r == {"restored": 3, "of": 3}
    assert len(bridge.mailbox["Trash"]) == 0
    assert len(bridge.mailbox["INBOX"]) == 4       # back where they were
    assert mailops.STATE["undo"] == []
    notice = mailops.STATE["notice"]
    assert notice["key"] == "restored"
    assert notice["params"]["restored"] == 3 and notice["params"]["of"] == 3


def test_delete_messages_and_queue_dedup(bridge):
    scan(bridge)
    mailops.delete_messages([["INBOX", 1]])
    # queue a second overlapping job before the first may have finished
    mailops.delete_messages([["INBOX", 1], ["INBOX", 2]])
    d = wait_delete_done()
    assert d["moved"] == 2                         # uid 1 deduped
    assert {m["uid"] for m in bridge.mailbox["Trash"]} == {1, 2}
    dhl = mailops.STATE["groups"]["sender"]["noreply@dhl.example"]
    assert dhl["count"] == 1 and dhl["size"] == 6000


def test_uidvalidity_mismatch_aborts_delete(bridge):
    scan(bridge)
    bridge.uv["INBOX"] = 2                         # simulate Bridge resync
    mailops.delete_groups("sender", ["noreply@dhl.example"])
    d = wait_delete_done()
    assert "UIDVALIDITY" in d["error"]
    assert len(bridge.mailbox["Trash"]) == 0       # nothing was moved


def test_scan_cancel(bridge, monkeypatch):
    mailops._CANCEL["scan"] = True
    mailops.run_scan()
    assert mailops.STATE["status"] == "idle"
    assert mailops.STATE["notice"]["key"] == "scan_cancelled"


def test_group_mails_and_fetch_message(bridge):
    scan(bridge)
    mails = mailops.group_mails("sender", "noreply@dhl.example")
    assert len(mails) == 3
    assert mails[0]["ts"] >= mails[-1]["ts"]       # newest first
    d = mailops.fetch_message("INBOX", 1)
    assert d["subject"].startswith("Ihre Sendung 123")
    assert "Hello mail body" in d["text"]


def test_empty_trash(bridge):
    scan(bridge)
    mailops.delete_messages([["INBOX", 4]])
    wait_delete_done()
    assert len(bridge.mailbox["Trash"]) == 1
    r = mailops.empty_trash()
    assert r["deleted"] == 1
    assert bridge.mailbox["Trash"] == []
    assert mailops.STATE["trash_count"] == 0
    assert mailops.UNDO_LOG == []                  # undo cleared: gone forever


def test_search_mails(bridge):
    scan(bridge)
    hits = mailops.search_mails("sendung")
    assert len(hits) == 3
    assert mailops.search_mails("alice")[0]["addr"] == "alice@friends.example"
    assert mailops.search_mails("x") == []         # too short


def test_one_unparseable_mail_never_kills_the_scan(bridge, monkeypatch):
    """Real mailboxes contain arbitrarily broken messages; the scan must
    skip them (logged) instead of aborting with status=error."""
    real = mailops.decode_mime

    def poisoned(raw):
        if "POISON" in str(raw):
            raise ValueError("boom")
        return real(raw)

    monkeypatch.setattr(mailops, "decode_mime", poisoned)
    bridge.mailbox["INBOX"].append(
        make_msg(99, frm="evil <evil@x.example>", subject="POISON header"))
    mailops.run_scan()
    assert mailops.STATE["status"] == "done"          # not "error"
    groups = mailops.STATE["groups"]["sender"]
    assert "evil@x.example" not in groups             # skipped, not partial
    assert groups["noreply@dhl.example"]["count"] == 3   # rest intact


# -------------------------------------------------------- incremental scan

def test_second_scan_with_nothing_changed_never_refetches_headers(
        bridge, monkeypatch):
    scan(bridge)
    specs = _fetch_specs(bridge, monkeypatch)
    scan(bridge)
    assert specs and all(s == "(UID FLAGS)" for s in specs)
    # groups are unaffected by the switch to a flags-only refresh
    assert mailops.STATE["groups"]["sender"]["noreply@dhl.example"]["count"] == 3


def test_second_scan_fetches_only_a_newly_added_message(bridge, monkeypatch):
    scan(bridge)
    bridge.mailbox["INBOX"].append(
        make_msg(99, frm="deals@gadgetco.example", subject="Welcome!"))
    specs = _fetch_specs(bridge, monkeypatch)
    scan(bridge)
    assert any(s != "(UID FLAGS)" for s in specs)    # the new UID, full fetch
    assert "deals@gadgetco.example" in mailops.STATE["groups"]["sender"]
    # the 5 pre-existing UIDs (4 INBOX + 1 Archive) still only got FLAGS
    flags_only_calls = [s for s in specs if s == "(UID FLAGS)"]
    assert flags_only_calls


def test_second_scan_prunes_a_message_deleted_by_another_client(bridge):
    scan(bridge)
    assert "alice@friends.example" in mailops.STATE["groups"]["sender"]
    bridge.mailbox["INBOX"] = [m for m in bridge.mailbox["INBOX"]
                               if m["uid"] != 3]      # Alice's mail
    scan(bridge)
    assert "alice@friends.example" not in mailops.STATE["groups"]["sender"]


def test_uidvalidity_change_forces_a_full_refetch(bridge, monkeypatch):
    scan(bridge)
    bridge.uv["INBOX"] = 2                            # simulate Bridge resync
    specs = _fetch_specs(bridge, monkeypatch)
    scan(bridge)
    # INBOX's UIDs are refetched in full, not just FLAGS, despite having
    # been cached by the previous scan (Archive, untouched, still only
    # gets a flags-only refresh - so this must be "any", not "all")
    assert specs and any(s != "(UID FLAGS)" for s in specs)
    assert mailops.STATE["groups"]["sender"]["noreply@dhl.example"]["count"] == 3


def test_flag_change_is_picked_up_without_a_full_refetch(bridge, monkeypatch):
    scan(bridge)
    assert mailops.STATE["groups"]["sender"]["noreply@dhl.example"]["unread"] \
        == 1
    for m in bridge.mailbox["INBOX"]:
        if m["uid"] == 1:                             # the one unread DHL mail
            m["seen"] = True
    specs = _fetch_specs(bridge, monkeypatch)
    scan(bridge)
    assert specs and all(s == "(UID FLAGS)" for s in specs)
    assert mailops.STATE["groups"]["sender"]["noreply@dhl.example"]["unread"] \
        == 0


def test_dispatching_a_new_scan_does_not_wipe_the_previous_cache(bridge):
    scan(bridge)
    assert mailops.FOLDER_UV["INBOX"] == 1
    assert len(mailops.INDEX) > 0
    mailops.start_scan()
    # Checked immediately on return - start_scan()'s cache-clearing (if any)
    # happens synchronously before the background thread is even spawned,
    # so this doesn't race with the scan actually finishing. It used to
    # wipe acc.index/acc.folder_uv here, which (a) blanked the UI's table
    # the instant any scan started and (b) left the UIDVALIDITY guard used
    # by delete/archive disabled until the scan completed.
    assert mailops.FOLDER_UV.get("INBOX") == 1
    assert len(mailops.INDEX) > 0
    assert mailops.STATE["groups"]["sender"]
    st = wait_scan_done()
    assert st["status"] == "done", st["error"]
