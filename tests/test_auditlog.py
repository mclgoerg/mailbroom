"""Persistent audit log: one entry per mailbox action at every hook point
(bulk/rule delete actions, rule runs, unsubscribe, undo, empty-trash),
rotation, atomicity, tenant separation, read tolerance, API paging."""

import json

from fastapi.testclient import TestClient

from backend import auditlog
from backend import mailops
from backend import rules as rulesmod
from backend import tenants
from backend import unsub
from backend.main import app

from conftest import wait_delete_done, wait_scan_done, wait_unsub_done

client = TestClient(app)


def scan(bridge):
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]


def entries(account="default"):
    return auditlog.load(account, 0, 10_000)["entries"]


# -------------------------------------------------------------- hook points

def test_trash_archive_mark_read_are_logged(bridge):
    scan(bridge)
    mailops.delete_groups("sender", ["noreply@dhl.example"])
    wait_delete_done()
    mailops.delete_groups("sender", ["news@shop.example"], "archive")
    wait_delete_done()
    scan(bridge)
    mailops.delete_groups("sender", ["alice@friends.example"], "mark_read")
    wait_delete_done()

    by_action = {e["action"]: e for e in entries()}
    assert by_action["trash"]["count"] == 3
    assert by_action["trash"]["actor"] == "user"
    assert by_action["trash"]["outcome"] == "ok"
    assert by_action["archive"]["count"] == 1
    assert by_action["mark_read"]["count"] == 1
    assert by_action["mark_read"]["bytes"] == 0


def test_failed_delete_is_logged_with_error(bridge, monkeypatch):
    scan(bridge)

    def boom(*a, **kw):
        raise RuntimeError("server exploded")
    monkeypatch.setattr(mailops, "_move_uids", boom)

    mailops.delete_groups("sender", ["noreply@dhl.example"])
    wait_delete_done()
    e = entries()[-1]
    assert e["action"] == "trash" and e["outcome"] == "error"
    assert "server exploded" in e["error"]


def test_rule_runs_are_logged_report_and_execute(bridge):
    rule = rulesmod.create_rule({
        "name": "shipping", "grouping": "sender", "query": "tag:shipping",
        "action": "trash"})
    rulesmod.run_rule(rule["id"])                       # report
    rulesmod.update_rule(rule["id"], {"mode": "execute"})
    rulesmod.run_rule(rule["id"], rescan=False)          # execute
    wait_delete_done()

    kinds = [e["action"] for e in entries()]
    assert "rule_report" in kinds and "rule_execute" in kinds
    # the underlying delete queued by the rule execution is also logged,
    # tagged with the rule as actor - not "user".
    trash = next(e for e in entries() if e["action"] == "trash")
    assert trash["actor"] == f"rule:{rule['id']}"
    rexec = next(e for e in entries() if e["action"] == "rule_execute")
    assert rexec["actor"] == f"rule:{rule['id']}" and rexec["label"] == "shipping"


def test_unsubscribe_single_and_bulk_outcomes_are_logged(bridge, monkeypatch):
    scan(bridge)
    monkeypatch.setattr(unsub, "_post_one_click", lambda url: None)
    monkeypatch.setattr(unsub, "_send_mailto", lambda im, uri, name=None: None)

    unsub.unsubscribe("sender", "news@shop.example")
    e = next(e for e in entries() if e["action"] == "unsubscribe")
    assert e["label"] == "news@shop.example" and e["outcome"] == "done"

    client.post("/api/unsubscribe_bulk", json={
        "grouping": "sender", "keys": ["noreply@dhl.example"]})
    wait_unsub_done()
    bulk = [e for e in entries() if e["action"] == "unsubscribe"]
    assert any(e["label"] == "noreply@dhl.example" for e in bulk)


def test_undo_and_empty_trash_are_logged(bridge):
    scan(bridge)
    mailops.delete_groups("sender", ["noreply@dhl.example"])
    wait_delete_done()
    mailops.undo_last()
    wait_scan_done()                  # the undo's own refresh scan
    e = next(e for e in entries() if e["action"] == "undo")
    assert e["count"] == 3 and e["outcome"] == "ok"

    mailops.delete_messages([["INBOX", 4]])
    wait_delete_done()
    mailops.empty_trash()
    e = next(e for e in entries() if e["action"] == "empty_trash")
    assert e["count"] == 1


# ----------------------------------------------------------------- rotation

def test_rotation_keeps_only_newest_entries(monkeypatch):
    monkeypatch.setattr(auditlog, "MAX_ENTRIES", 5)
    for i in range(12):
        auditlog.record("trash", count=i, label=f"batch {i}")
    all_entries = entries()
    assert len(all_entries) == 5
    # newest-first; the last recorded batch (11) must have survived rotation
    assert all_entries[0]["label"] == "batch 11"
    assert all_entries[-1]["label"] == "batch 7"


def test_rotation_rewrite_is_atomic(monkeypatch, tmp_path):
    monkeypatch.setattr(auditlog, "MAX_ENTRIES", 3)
    for i in range(10):
        auditlog.record("trash", count=i)
    path = auditlog._path()
    assert path.exists()
    assert not path.with_suffix(".tmp").exists()     # tmp file never lingers
    assert len(path.read_text().splitlines()) == 3


# ------------------------------------------------------------ read-tolerance

def test_corrupt_trailing_line_is_tolerated():
    auditlog.record("trash", count=1, label="good-1")
    path = auditlog._path()
    with path.open("a") as f:
        f.write('{"account": "default", "action": "trash", "cou')  # truncated
    auditlog.record("trash", count=2, label="good-2")
    # the corrupt line is skipped, both good entries still load
    labels = [e["label"] for e in entries()]
    assert labels == ["good-2", "good-1"]


def test_entry_missing_newer_fields_gets_defaults():
    path = auditlog._path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"account": "default", "action": "trash"})
                    + "\n")
    e = entries()[0]
    assert e["count"] == 0 and e["outcome"] == "ok" and e["actor"] == "user"


# -------------------------------------------------------------- separation

def test_tenant_separation():
    t1 = tenants.for_subject("alice@x.example")
    t2 = tenants.for_subject("bob@y.example")
    with tenants.use(t1):
        auditlog.record("trash", count=5, label="alice's mail")
    with tenants.use(t2):
        assert entries() == []
        auditlog.record("trash", count=9, label="bob's mail")
    with tenants.use(t1):
        got = entries()
        assert len(got) == 1 and got[0]["label"] == "alice's mail"


def test_account_separation_within_one_tenant(bridge):
    scan(bridge)
    mailops.delete_groups("sender", ["noreply@dhl.example"])
    wait_delete_done()
    assert len(entries("default")) == 1
    assert entries("someone-else") == []


def test_rename_account_carries_entries(bridge):
    scan(bridge)
    mailops.delete_groups("sender", ["noreply@dhl.example"])
    wait_delete_done()
    assert len(entries("default")) == 1

    client.post("/api/config", json={
        "rename_account": {"from": "default", "to": "main"}})
    assert len(entries("main")) == 1
    assert entries("default") == []


# -------------------------------------------------------------------- API

def test_api_paging_newest_first(bridge):
    for i in range(5):
        auditlog.record("trash", count=i, label=f"e{i}")
    r = client.get("/api/audit", params={"offset": 0, "limit": 2}).json()
    assert r["total"] == 5
    assert [e["label"] for e in r["entries"]] == ["e4", "e3"]
    r = client.get("/api/audit", params={"offset": 2, "limit": 2}).json()
    assert [e["label"] for e in r["entries"]] == ["e2", "e1"]


def test_api_export_csv(bridge):
    auditlog.record("trash", count=3, label="dhl", account="default")
    r = client.get("/api/audit/export")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    body = r.text
    assert "label" in body.splitlines()[0]           # header row
    assert "dhl" in body
