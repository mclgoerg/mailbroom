"""Cleanup stats: scan history, per-month action tallies, /api/stats."""

import time

from fastapi.testclient import TestClient

from backend import mailops
from backend import stats as statsmod
from backend.main import app
from conftest import wait_delete_done

client = TestClient(app)


def test_scan_and_actions_are_recorded(bridge):
    mailops.run_scan()
    data = statsmod.load()
    assert len(data["scans"]) == 1
    scan = data["scans"][0]
    assert scan["mails"] == 5 and scan["senders"] == 3
    assert scan["size"] == 5000 + 4000 + 2000 + 30000 + 6000

    # trash 3 dhl mails -> month tally + freed bytes
    mailops.delete_groups("sender", ["noreply@dhl.example"])
    wait_delete_done()
    month = time.strftime("%Y-%m")
    acts = statsmod.load()["actions"][month]
    assert acts["trash"] == 3
    # D10: a move to Trash frees nothing - only permanent deletes count
    assert acts["freed"] == 0

    # archive is tallied but does not count as freed either
    mailops.delete_groups("sender", ["news@shop.example"], "archive")
    wait_delete_done()
    acts = statsmod.load()["actions"][month]
    assert acts["archive"] == 1 and acts["freed"] == 0

    # a permanent delete (purge / Empty Trash) books the bytes really freed
    # under `purged_bytes`; the old move-based `freed` is never written again
    statsmod.record_action("purge", 4, 15000)
    acts = statsmod.load()["actions"][month]
    assert acts["purge"] == 4 and acts["purged_bytes"] == 15000
    assert acts["freed"] == 0
    assert acts["trash"] == 3             # moves keep counting as moves

    # mark_read tallied too
    mailops.run_scan()
    mailops.delete_groups("sender", ["alice@friends.example"], "mark_read")
    wait_delete_done()
    acts = statsmod.load()["actions"][month]
    assert acts["mark_read"] == 1


def test_stats_endpoint_shape(bridge):
    mailops.run_scan()
    st = client.get("/api/stats").json()
    assert st["mails"] == 5
    assert any(y["year"] == "2026" for y in st["years"])
    assert st["top_domains"][0]["domain"] == "shop.example"   # 30000 bytes
    assert len(st["scans"]) == 1
    assert isinstance(st["actions"], dict)

    # extended numbers (fixture: uids 1+4 unread; 1+4 have List-Unsubscribe)
    assert st["unread"] == 2
    assert st["bulk"] == 2
    assert st["senders"] == 3
    assert st["replied_senders"] == 1            # alice (Sent To/Cc)
    assert st["oldest"] == "2025-01-01"          # the Archive DHL mail
    assert st["months"] and st["months"][-1]["month"] == "2026-09"
    assert st["top_senders"][0]["key"] == "noreply@dhl.example"
    assert st["top_senders"][0]["count"] == 3
    cats = {c["tag"]: c for c in st["categories"]}
    assert cats["shipping"]["count"] == 3        # the DHL group
    assert cats["newsletter"]["count"] >= 1      # shop mail (List-Unsub)
    assert st["ai_groups"]["unrated"] == 3       # nothing rated yet
    assert st["rated_mails"] == {"delete_safe": 0, "review": 0, "keep": 0}


def test_record_action_ignores_noise():
    statsmod.record_action("trash", 0, 100)      # zero count
    statsmod.record_action("bogus", 5, 100)      # unknown action
    assert statsmod.load()["actions"] == {}


def test_stats_file_from_before_permanent_deletes_loads_and_counts_on():
    """Read-side tolerance: a month written by an earlier version has the
    old move-based `freed` and no `purge` / `purged_bytes` - it loads with
    zeros, `freed` stays untouched as history, and new permanent deletes
    book into `purged_bytes` only."""
    import json
    month = time.strftime("%Y-%m")
    statsmod.HISTORY_PATH.write_text(json.dumps({"accounts": {"default": {
        "scans": [], "actions": {
            "2026-01": {"trash": 3, "archive": 0, "move": 0, "mark_read": 0,
                        "freed": 9000},
            month: {"trash": 1, "archive": 0, "move": 0, "mark_read": 0,
                    "freed": 500}}}}}))
    acts = statsmod.load()["actions"]
    assert acts["2026-01"]["purged_bytes"] == 0 and acts["2026-01"]["purge"] == 0
    assert acts["2026-01"]["freed"] == 9000          # history, kept as is
    statsmod.record_action("purge", 2, 1234)
    acts = statsmod.load()["actions"][month]
    assert acts["purge"] == 2 and acts["purged_bytes"] == 1234
    assert acts["freed"] == 500 and acts["trash"] == 1
