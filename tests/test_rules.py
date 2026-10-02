"""Rules: DSL parity with frontend lib.ts, engine, safeguards, scheduling."""

import time

import pytest
from fastapi.testclient import TestClient

from backend import config as cfgmod
from backend import mailops
from backend import rules as rulesmod
from backend.main import app

from conftest import wait_delete_done

client = TestClient(app)

NOW = time.mktime(time.strptime("2026-01-01", "%Y-%m-%d"))


def g(**over):
    """Group record shaped like public_state() output (mirrors lib.test.ts)."""
    base = {"key": "noreply@dhl.example", "label": "DHL Paket",
            "sub": "noreply@dhl.example", "count": 100, "size": 5000,
            "unread": 90, "first": "2024-01-01", "last": "2024-06-01",
            "tags": ["shipping", "newsletter"], "samples": [], "bulk": True,
            "unsub": True, "ai": {"verdict": "delete_safe", "reason": "x"},
            "ratings": None, "protected": False, "replied": False,
            "unsubscribed": None}
    base.update(over)
    return base


# ------------------------------------------- DSL parity (mirror lib.test.ts)

def test_parse_filter_splits_qualifiers_and_text():
    f = rulesmod.parse_filter(
        "tag:ship ai:safe age:>1y unread:>80 is:unsub dhl")
    assert f["tags"] == ["ship"]
    assert f["ai"] == "delete_safe"
    assert f["age_months"] == 12
    assert f["unread_min"] == 80
    assert f["unsub"] is True
    assert f["text"] == ["dhl"]

    assert rulesmod.parse_filter("hello world")["text"] == ["hello", "world"]
    assert rulesmod.parse_filter("age:>6m")["age_months"] == 6
    assert rulesmod.parse_filter("age:bogus")["age_months"] is None
    assert rulesmod.parse_filter("is:protected")["protected_only"] is True
    assert rulesmod.parse_filter("is:replied")["replied"] is True
    assert rulesmod.parse_filter("is:noreply-ever")["replied"] is False
    assert rulesmod.parse_filter("dhl")["replied"] is None
    assert rulesmod.parse_filter("is:unsubscribed")["unsubscribed"] is True
    assert rulesmod.parse_filter(
        "is:not-unsubscribed")["unsubscribed"] is False
    assert rulesmod.parse_filter("dhl")["unsubscribed"] is None

    assert rulesmod.parse_filter(
        "from:noreply@dhl.example")["from_addr"] == "noreply@dhl.example"
    assert rulesmod.parse_filter("dhl")["from_addr"] is None
    assert rulesmod.parse_filter("domain:dhl.example")["domain"] == \
        "dhl.example"
    assert rulesmod.parse_filter("dhl")["domain"] is None

    assert rulesmod.parse_filter("is:new")["new_only"] is True
    assert rulesmod.parse_filter("dhl")["new_only"] is False


def test_match_group_is_new():
    f = rulesmod.parse_filter("is:new")
    assert rulesmod.match_group(g(new=True), f, NOW)
    assert not rulesmod.match_group(g(new=False), f, NOW)
    assert not rulesmod.match_group(g(), f, NOW)   # missing key -> not new


def test_match_group_from_and_domain_are_exact_not_substring():
    f = rulesmod.parse_filter("from:noreply@dhl.example")
    assert rulesmod.match_group(g(key="noreply@dhl.example"), f, NOW)
    assert not rulesmod.match_group(
        g(key="other-noreply@dhl.example"), f, NOW)
    assert not rulesmod.match_group(g(key="dhl.example"), f, NOW)

    f = rulesmod.parse_filter("domain:dhl.example")
    assert rulesmod.match_group(g(key="dhl.example"), f, NOW)
    assert not rulesmod.match_group(g(key="sub.dhl.example"), f, NOW)
    assert not rulesmod.match_group(g(key="noreply@dhl.example"), f, NOW)


def test_match_group_combines_criteria_and():
    f = rulesmod.parse_filter("tag:shipping ai:safe unread:>80 is:unsub dhl")
    assert rulesmod.match_group(g(), f, NOW)
    assert not rulesmod.match_group(g(tags=["finance"]), f, NOW)
    assert not rulesmod.match_group(g(ai=None), f, NOW)
    assert not rulesmod.match_group(g(unread=10), f, NOW)
    assert not rulesmod.match_group(g(unsub=False), f, NOW)
    assert not rulesmod.match_group(
        g(label="UPS", key="a@ups.example", sub=""), f, NOW)


def test_match_group_age_and_flags():
    f = rulesmod.parse_filter("age:>1y")
    assert rulesmod.match_group(g(last="2024-06-01"), f, NOW)
    assert not rulesmod.match_group(g(last="2025-12-30"), f, NOW)
    assert not rulesmod.match_group(g(last=""), f, NOW)

    assert rulesmod.match_group(
        g(protected=True), rulesmod.parse_filter("is:protected"), NOW)
    assert not rulesmod.match_group(
        g(), rulesmod.parse_filter("is:protected"), NOW)
    assert rulesmod.match_group(
        g(replied=True), rulesmod.parse_filter("is:replied"), NOW)
    assert rulesmod.match_group(
        g(), rulesmod.parse_filter("is:noreply-ever"), NOW)
    assert not rulesmod.match_group(
        g(replied=True), rulesmod.parse_filter("is:noreply-ever"), NOW)

    done = {"n": 1, "of": 1, "status": "done", "link": "", "addr": ""}
    pending = {"n": 0, "of": 1, "status": "pending", "link": "", "addr": ""}
    assert rulesmod.match_group(
        g(unsubscribed=done), rulesmod.parse_filter("is:unsubscribed"), NOW)
    assert not rulesmod.match_group(
        g(unsubscribed=pending), rulesmod.parse_filter("is:unsubscribed"),
        NOW)
    assert not rulesmod.match_group(
        g(unsubscribed=None), rulesmod.parse_filter("is:unsubscribed"), NOW)
    assert rulesmod.match_group(
        g(unsubscribed=pending),
        rulesmod.parse_filter("is:not-unsubscribed"), NOW)
    assert rulesmod.match_group(
        g(unsubscribed=None),
        rulesmod.parse_filter("is:not-unsubscribed"), NOW)
    assert not rulesmod.match_group(
        g(unsubscribed=done),
        rulesmod.parse_filter("is:not-unsubscribed"), NOW)


# ------------------------------------------------------------ CRUD + guards

def test_crud_and_execute_guard():
    r = client.post("/api/rules", json={
        "name": "Old shipping", "query": "tag:shipping age:>1y",
        "action": "trash", "schedule": "daily",
        "mode": "execute"})                       # mode ignored on create
    assert r.status_code == 200
    rule = r.json()
    assert rule["mode"] == "report" and rule["report_runs"] == 0

    # execute before any report run -> refused
    r = client.post(f"/api/rules/{rule['id']}", json={"mode": "execute"})
    assert r.status_code == 400 and "report" in r.json()["detail"]

    assert client.post("/api/rules", json={
        "name": "", "query": "x"}).status_code == 400
    assert client.post("/api/rules", json={
        "name": "m", "action": "move"}).status_code == 400
    assert client.post("/api/rules", json={
        "name": "b", "schedule": "hourly"}).status_code == 400
    assert client.post("/api/rules/nope", json={}).status_code == 404

    assert client.delete(f"/api/rules/{rule['id']}").json() == {"ok": True}
    assert client.delete(f"/api/rules/{rule['id']}").status_code == 404
    assert client.get("/api/rules").json() == {"rules": []}


# ----------------------------------------------------------------- engine

def test_report_then_execute(bridge):
    rule = rulesmod.create_rule({
        "name": "shipping", "grouping": "sender", "query": "tag:shipping",
        "action": "trash"})

    res = rulesmod.run_rule(rule["id"])           # report: nothing moves
    assert res["mode"] == "report"
    assert res["groups"] == 1 and res["mails"] == 3 and res["acted"] == 0
    assert res["preview"][0]["key"] == "noreply@dhl.example"
    assert "noreply@dhl.example" in mailops.STATE["groups"]["sender"]
    assert mailops.STATE["notice"]["key"] == "rule_report"

    rule = rulesmod.update_rule(rule["id"], {"mode": "execute"})
    assert rule["report_runs"] == 1

    res = rulesmod.run_rule(rule["id"], rescan=False)
    assert res["acted"] == 3
    wait_delete_done()
    assert "noreply@dhl.example" not in mailops.STATE["groups"]["sender"]
    assert len(mailops.UNDO_LOG) == 1             # reversible as always


def test_cap_and_protected_skip(bridge, monkeypatch):
    monkeypatch.setattr(rulesmod, "RULE_CAP", 2)
    cfgmod.update_config({"protected": ["alice@friends.example"]})
    rule = rulesmod.create_rule({
        "name": "everything", "grouping": "sender", "query": ""})

    res = rulesmod.run_rule(rule["id"])
    # alice is protected -> not part of the run at all
    assert res["skipped_protected"] == 1
    # dhl (3 mails) exceeds the cap of 2; shop (1) fits
    assert res["capped"] == 3
    assert [p["key"] for p in res["preview"]] == ["news@shop.example"]

    rulesmod.update_rule(rule["id"], {"mode": "execute"})
    res = rulesmod.run_rule(rule["id"], rescan=False)
    assert res["acted"] == 1
    wait_delete_done()
    senders = mailops.STATE["groups"]["sender"]
    assert "alice@friends.example" in senders       # protected survived
    assert "noreply@dhl.example" in senders         # capped out, survived
    assert "news@shop.example" not in senders


def test_run_errors_are_recorded(bridge):
    rule = rulesmod.create_rule({
        "name": "mover", "grouping": "sender", "query": "tag:shipping",
        "action": "move", "dest": "NoSuchFolder"})
    rulesmod.run_rule(rule["id"])                  # report mode: no move yet
    rulesmod.update_rule(rule["id"], {"mode": "execute"})
    with pytest.raises(RuntimeError, match="unknown target folder"):
        rulesmod.run_rule(rule["id"], rescan=False)
    saved = rulesmod.load_rules()[0]
    assert saved["last_run"]["error"]


# -------------------------------------------------------------- scheduling

def test_due_logic():
    now = time.time()
    mk = lambda sched, ts: {"schedule": sched,
                            "last_run": {"ts": ts} if ts else None}
    assert not rulesmod.due(mk("manual", 0), now)
    assert rulesmod.due(mk("daily", None), now)            # never ran
    assert rulesmod.due(mk("daily", now - 25 * 3600), now)
    assert not rulesmod.due(mk("daily", now - 3600), now)
    assert rulesmod.due(mk("weekly", now - 8 * 86400), now)
    assert not rulesmod.due(mk("weekly", now - 2 * 86400), now)


def test_tick_runs_due_rules(bridge):
    rule = rulesmod.create_rule({
        "name": "sched", "grouping": "sender", "query": "tag:shipping",
        "schedule": "daily"})
    rulesmod._tick()
    saved = rulesmod.load_rules()[0]
    assert saved["last_run"] and saved["last_run"]["groups"] == 1
    assert saved["report_runs"] == 1
    ts = saved["last_run"]["ts"]
    rulesmod._tick()                               # not due again
    assert rulesmod.load_rules()[0]["last_run"]["ts"] == ts
