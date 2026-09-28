"""Bulk unsubscribe: background job, per-sender outcomes, persistence
across rescans/renames, protected/already-done skipping, cap, cancel."""

import time

from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import config as cfgmod
from backend import mailops
from backend import unsub
from backend import unsubstore
from backend.main import app

from conftest import wait_unsub_done

client = TestClient(app)


def _scan():
    mailops.run_scan()
    assert mailops.STATE["status"] == "done"


def test_bulk_one_click_post_and_link(bridge, monkeypatch):
    _scan()
    posted, mailed = [], []
    monkeypatch.setattr(unsub, "_post_one_click", lambda url: posted.append(url))
    monkeypatch.setattr(unsub, "_send_mailto",
                        lambda im, uri, name=None: mailed.append(uri))

    r = client.post("/api/unsubscribe_bulk", json={
        "grouping": "sender",
        "keys": ["news@shop.example", "noreply@dhl.example"]})
    assert r.status_code == 200
    body = r.json()
    assert body == {"queued": 2, "skipped_protected": 0, "skipped_done": 0,
                    "capped": 0}

    st = wait_unsub_done()
    assert st["done"] == 1 and st["links"] == 1 and st["failed"] == 0

    # shop.example: one-click header -> automated POST, no mailto sent
    shop = unsubstore.load_account("default")["news@shop.example"]
    assert shop["status"] == "done" and posted and not mailed

    # dhl.example: plain https link, no one-click -> hand back the link
    dhl = unsubstore.load_account("default")["noreply@dhl.example"]
    assert dhl["status"] == "link"
    assert dhl["detail"].startswith("https://dhl.example/")

    groups = mailops.public_state()["groups"]["sender"]
    shop_g = groups["news@shop.example"]["unsubscribed"]
    assert shop_g == {"n": 1, "of": 1, "status": "done", "link": "",
                      "addr": ""}
    dhl_g = groups["noreply@dhl.example"]["unsubscribed"]
    assert dhl_g["status"] == "link" and dhl_g["addr"] == "noreply@dhl.example"
    assert dhl_g["link"].startswith("https://dhl.example/")


def test_bulk_failure_is_recorded_not_raised(bridge, monkeypatch):
    _scan()

    def boom(url):
        raise RuntimeError("endpoint down")
    monkeypatch.setattr(unsub, "_post_one_click", boom)

    r = client.post("/api/unsubscribe_bulk", json={
        "grouping": "sender", "keys": ["news@shop.example"]})
    assert r.json()["queued"] == 1
    st = wait_unsub_done()
    assert st["failed"] == 1 and st["status"] == "done"     # job itself ok

    entry = unsubstore.load_account("default")["news@shop.example"]
    assert entry["status"] == "failed" and "endpoint down" in entry["error"]

    group = mailops.public_state()["groups"]["sender"]["news@shop.example"]
    assert group["unsubscribed"]["status"] == "failed"


def test_bulk_skips_protected_and_already_done(bridge, monkeypatch):
    _scan()
    cfgmod.update_config({"protected": ["noreply@dhl.example"]})
    unsubstore.record("news@shop.example", "done", "one-click POST",
                      account="default")

    r = client.post("/api/unsubscribe_bulk", json={
        "grouping": "sender",
        "keys": ["news@shop.example", "noreply@dhl.example"]})
    body = r.json()
    assert body == {"queued": 0, "skipped_protected": 1, "skipped_done": 1,
                    "capped": 0}
    # nothing queued -> no worker started, state stays idle
    assert mailops.STATE["unsub"]["status"] == "idle"


def test_bulk_job_cap(bridge, monkeypatch):
    _scan()
    monkeypatch.setattr(unsub, "JOB_CAP", 1)
    monkeypatch.setattr(unsub, "_post_one_click", lambda url: None)

    r = client.post("/api/unsubscribe_bulk", json={
        "grouping": "sender",
        "keys": ["news@shop.example", "noreply@dhl.example"]})
    body = r.json()
    assert body["queued"] == 1 and body["capped"] == 1
    wait_unsub_done()

    entries = unsubstore.load_account("default")
    assert len(entries) == 1     # only the alphabetically-first sender ran
    assert "news@shop.example" in entries
    assert mailops.STATE["unsub"]["skipped"] == 1


def test_bulk_cancel_keeps_partial_results(bridge, monkeypatch):
    _scan()
    acc = accountsmod.get()
    calls = []

    def fake_addr(im, addr, header, one_click, account_name=None):
        calls.append(addr)
        if len(calls) == 1:
            mailops.request_cancel("unsub", acc)   # user cancels mid-job
        return {"status": "done", "method": "test", "detail": "",
                "error": ""}
    monkeypatch.setattr(unsub, "unsubscribe_addr", fake_addr)

    r = client.post("/api/unsubscribe_bulk", json={
        "grouping": "sender",
        "keys": ["news@shop.example", "noreply@dhl.example"]})
    assert r.json()["queued"] == 2
    st = wait_unsub_done()
    assert st["done"] == 1
    assert len(calls) == 1                          # second item never ran
    assert len(unsubstore.load_account("default")) == 1
    assert mailops.STATE["notice"]["key"] == "unsub_cancelled"


def test_unsub_state_survives_rescan(bridge, monkeypatch):
    _scan()
    monkeypatch.setattr(unsub, "_post_one_click", lambda url: None)
    client.post("/api/unsubscribe_bulk", json={
        "grouping": "sender", "keys": ["news@shop.example"]})
    wait_unsub_done()
    assert unsubstore.load_account("default")["news@shop.example"]["status"] \
        == "done"

    _scan()      # groups/index rebuilt from scratch
    group = mailops.public_state()["groups"]["sender"]["news@shop.example"]
    assert group["unsubscribed"]["status"] == "done"


def test_account_rename_carries_unsub_records(bridge):
    unsubstore.record("news@shop.example", "done", "one-click POST",
                      account="default")

    r = client.post("/api/config", json={
        "rename_account": {"from": "default", "to": "main"}})
    assert r.status_code == 200

    assert "news@shop.example" in unsubstore.load_account("main")
    assert unsubstore.load_account("default") == {}


def test_export_import_round_trip_merges(bridge):
    unsubstore.record("news@shop.example", "done", "one-click POST",
                      account="default")

    r = client.get("/api/export_config")
    backup = r.json()
    assert backup["unsub"]["accounts"]["default"]["news@shop.example"][
        "status"] == "done"

    # A record made AFTER the backup was taken must survive importing it.
    unsubstore.record("noreply@dhl.example", "link", "open link",
                      "https://dhl.example/unsub?u=1", account="default")

    r = client.post("/api/import_config", json={
        "config": {}, "unsub": backup["unsub"]})
    assert r.json()["ok"] and r.json()["unsub"] == 1

    entries = unsubstore.load_account("default")
    assert entries["news@shop.example"]["status"] == "done"
    assert entries["noreply@dhl.example"]["status"] == "link"   # not erased


def test_acknowledge_and_forget(bridge, monkeypatch):
    _scan()
    monkeypatch.setattr(unsub, "_post_one_click", lambda url: None)
    r = unsub.unsubscribe("sender", "noreply@dhl.example")
    assert r["action"] == "link"

    ack = client.post("/api/unsubscribe/ack", json={"addr": r["addr"]})
    assert ack.json()["status"] == "done"
    assert unsubstore.load_account("default")[r["addr"]]["status"] == "done"

    forgot = client.post("/api/unsubscribe/ack", json={
        "addr": r["addr"], "done": False})
    assert forgot.json() == {"ok": True}
    assert r["addr"] not in unsubstore.load_account("default")


def test_scan_refuses_while_unsub_running(bridge, monkeypatch):
    _scan()

    def slow(im, addr, header, one_click, account_name=None):
        time.sleep(0.3)
        return {"status": "done", "method": "test", "detail": "", "error": ""}
    monkeypatch.setattr(unsub, "unsubscribe_addr", slow)

    client.post("/api/unsubscribe_bulk", json={
        "grouping": "sender", "keys": ["news@shop.example"]})
    assert mailops.STATE["unsub"]["status"] == "running"
    r = client.post("/api/scan")
    assert r.status_code == 409
    wait_unsub_done()
