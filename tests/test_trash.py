"""Trash browser: live listing, restore with UIDVALIDITY guard."""

import pytest
from fastapi.testclient import TestClient

from backend import mailops
from backend.main import app
from conftest import make_msg, wait_scan_done

client = TestClient(app)


@pytest.fixture
def trashed(bridge):
    bridge.mailbox["Trash"] = [
        make_msg(30, frm="old@gone.example", subject="Deleted elsewhere",
                 size=700, date="02-Jan-2026 10:00:00 +0000"),
        make_msg(31, frm="old@gone.example", subject="Also deleted",
                 size=800, date="03-Jan-2026 10:00:00 +0000"),
    ]
    return bridge


def test_trash_list_and_restore(trashed):
    r = client.get("/api/trash").json()
    assert r["total"] == 2 and r["folder"] == "Trash" and r["uv"] == 1
    # newest first
    assert [m["uid"] for m in r["mails"]] == [31, 30]
    assert mailops.STATE["trash_count"] == 2

    # trash mails are readable even though they are not in INDEX
    msg = client.get("/api/message",
                     params={"folder": "Trash", "uid": 30}).json()
    assert "Deleted elsewhere" in msg["subject"]

    res = client.post("/api/trash/restore", json={
        "uids": [30], "dest": "INBOX", "uv": r["uv"]})
    assert res.json() == {"restored": 1, "rescan": True}
    assert len(trashed.mailbox["Trash"]) == 1
    assert any(m["uid"] == 30 for m in trashed.mailbox["INBOX"])
    assert mailops.STATE["trash_count"] == 1
    assert mailops.STATE["notice"]["key"] == "trash_restored"


def test_trash_restore_refreshes_views(trashed):
    mailops.run_scan()
    assert ("INBOX", 30) not in {(m["folder"], m["uid"])
                                 for m in mailops.INDEX.values()}
    r = client.get("/api/trash").json()
    res = client.post("/api/trash/restore", json={
        "uids": [30, 31], "dest": "INBOX", "uv": r["uv"]})
    assert res.json() == {"restored": 2, "rescan": True}
    wait_scan_done()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    assert mailops.STATE["groups"]["sender"]["old@gone.example"]["count"] == 2
    assert {m["uid"] for m in mailops.INDEX.values()
            if m["addr"] == "old@gone.example"} == {30, 31}
    # trash_count comes from the scan, notice survives it
    assert mailops.STATE["trash_count"] == 0
    assert mailops.STATE["notice"]["key"] == "trash_restored"


def test_trash_restore_while_busy_keeps_rescan_notice(trashed):
    mailops.run_scan()
    mailops.STATE["unsub"]["status"] = "running"   # start_scan refuses
    r = client.get("/api/trash").json()
    res = client.post("/api/trash/restore", json={
        "uids": [30], "dest": "INBOX", "uv": r["uv"]})
    assert res.status_code == 200
    assert res.json() == {"restored": 1, "rescan": False}
    assert any(m["uid"] == 30 for m in trashed.mailbox["INBOX"])
    assert mailops.STATE["status"] == "done"
    assert "old@gone.example" not in mailops.STATE["groups"]["sender"]
    assert mailops.STATE["notice"]["key"] == "trash_restored_rescan"


def test_restore_guards(trashed):
    r = client.get("/api/trash").json()
    # stale UIDVALIDITY -> refuse
    trashed.uv["Trash"] = 99
    res = client.post("/api/trash/restore", json={
        "uids": [30], "dest": "INBOX", "uv": r["uv"]})
    assert res.status_code == 409 and "reload" in res.json()["detail"]
    trashed.uv["Trash"] = 1

    # unknown folder / trash itself -> refuse
    assert client.post("/api/trash/restore", json={
        "uids": [30], "dest": "Nope", "uv": 0}).status_code == 409
    assert client.post("/api/trash/restore", json={
        "uids": [30], "dest": "Trash", "uv": 0}).status_code == 409
    assert client.post("/api/trash/restore", json={
        "uids": [], "dest": "INBOX", "uv": 0}).status_code == 422
