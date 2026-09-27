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
    assert acts["freed"] == 5000 + 4000 + 6000

    # archive is tallied but does not count as freed
    mailops.delete_groups("sender", ["news@shop.example"], "archive")
    wait_delete_done()
    acts = statsmod.load()["actions"][month]
    assert acts["archive"] == 1 and acts["freed"] == 15000

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


def test_record_action_ignores_noise():
    statsmod.record_action("trash", 0, 100)      # zero count
    statsmod.record_action("bogus", 5, 100)      # unknown action
    assert statsmod.load()["actions"] == {}
