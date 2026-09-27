"""End-to-end scan / group / delete / undo tests on the fake IMAP server."""

from backend import config as cfgmod
from backend import mailops

from conftest import wait_delete_done


def scan(bridge):
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]


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
