"""Retention restriction (keep_latest / older_than_days) for group actions
and saved rules: ordering, cutoffs, validation, report-preview accuracy,
cap interaction, and the rules.json read-side migration."""

import json
import time

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import mailops
from backend import rules as rulesmod
from backend.main import app

from conftest import wait_delete_done

client = TestClient(app)


def scan(bridge):
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]


# ------------------------------------------------------- mailops.delete_groups

def test_keep_latest_keeps_newest_n_acts_on_rest(bridge):
    scan(bridge)
    # dhl: uid1 + uid2 in INBOX (same ts, default date), uid10 in Archive
    # (older, 2025-01-01) - 3 mails total.
    mailops.delete_groups("sender", ["noreply@dhl.example"], keep_latest=1)
    d = wait_delete_done()
    assert d["moved"] == 2 and not d["error"]
    assert {m["uid"] for m in bridge.mailbox["Trash"]} == {2, 10}
    assert any(m["uid"] == 1 for m in bridge.mailbox["INBOX"])


def test_keep_latest_ties_break_by_folder_then_uid(bridge):
    scan(bridge)
    acc = accountsmod.get()
    # Force uid1 and uid2 to tie exactly (folder, uid) is the only
    # remaining tiebreak - uid1 sorts before uid2, so keep_latest=1 keeps 1.
    acc.index[mailops.ikey("INBOX", 1)]["ts"] = 500
    acc.index[mailops.ikey("INBOX", 2)]["ts"] = 500
    acc.index[mailops.ikey("Archive", 10)]["ts"] = 100
    rec = acc.state["groups"]["sender"]["noreply@dhl.example"]
    keep = mailops.retained_mails(rec, acc, keep_latest=1)
    assert keep == {"INBOX": {1}}


def test_ts_zero_sorts_as_oldest_for_keep_latest(bridge):
    scan(bridge)
    acc = accountsmod.get()
    acc.index[mailops.ikey("INBOX", 1)]["ts"] = 0       # unknown timestamp
    rec = acc.state["groups"]["sender"]["noreply@dhl.example"]
    # keep_latest=2 must keep the two mails with REAL (non-zero) timestamps,
    # not the one with ts == 0.
    keep = mailops.retained_mails(rec, acc, keep_latest=2)
    assert keep == {"INBOX": {2}, "Archive": {10}}


def test_older_than_days_cutoff(bridge):
    scan(bridge)
    # uid1/uid2 are a few days old (scan fixture date), uid10 is from
    # 2025-01-01 - over a year old. A 30-day cutoff only acts on uid10.
    mailops.delete_groups(
        "sender", ["noreply@dhl.example"], older_than_days=30)
    d = wait_delete_done()
    assert d["moved"] == 1 and not d["error"]
    assert [m["uid"] for m in bridge.mailbox["Trash"]] == [10]


def test_older_than_days_treats_ts_zero_as_old(bridge):
    scan(bridge)
    acc = accountsmod.get()
    acc.index[mailops.ikey("INBOX", 1)]["ts"] = 0
    acc.index[mailops.ikey("INBOX", 2)]["ts"] = int(time.time())  # now
    rec = acc.state["groups"]["sender"]["noreply@dhl.example"]
    keep = mailops.retained_mails(rec, acc, older_than_days=30)
    # uid2 (now) is exempt; uid1 (ts==0) and uid10 (old) are acted on.
    assert keep == {"INBOX": {2}}


def test_keep_latest_and_older_than_days_mutually_exclusive(bridge):
    scan(bridge)
    with pytest.raises(ValueError, match="mutually exclusive"):
        mailops.delete_groups("sender", ["noreply@dhl.example"],
                              keep_latest=1, older_than_days=1)


def test_no_retention_acts_on_everything_as_before(bridge):
    scan(bridge)
    r = mailops.delete_groups("sender", ["noreply@dhl.example"])
    assert r["queued"] == 3


# --------------------------------------------------------------- /api/delete

def test_api_delete_rejects_both_set(bridge):
    scan(bridge)
    r = client.post("/api/delete", json={
        "grouping": "sender", "keys": ["noreply@dhl.example"],
        "keep_latest": 1, "older_than_days": 1})
    assert r.status_code == 400
    assert "mutually exclusive" in r.json()["detail"]


def test_api_delete_rejects_non_positive_ints(bridge):
    scan(bridge)
    r = client.post("/api/delete", json={
        "grouping": "sender", "keys": ["noreply@dhl.example"],
        "keep_latest": 0})
    assert r.status_code == 422                    # pydantic ge=1 violation


def test_api_delete_keep_latest_roundtrip(bridge):
    scan(bridge)
    r = client.post("/api/delete", json={
        "grouping": "sender", "keys": ["noreply@dhl.example"],
        "keep_latest": 1})
    assert r.status_code == 200
    d = wait_delete_done()
    assert d["moved"] == 2


# ------------------------------------------------------------------ rules.py

def test_rule_validate_retention_fields():
    rule = rulesmod.create_rule({
        "name": "old shop mail", "grouping": "sender", "query": "",
        "keep_latest": 2})
    assert rule["keep_latest"] == 2 and rule["older_than_days"] is None

    with pytest.raises(ValueError, match="mutually exclusive"):
        rulesmod.update_rule(rule["id"], {"older_than_days": 5})

    with pytest.raises(ValueError, match=">= 1"):
        rulesmod.update_rule(rule["id"], {"keep_latest": 0})

    with pytest.raises(ValueError, match="integer"):
        rulesmod.update_rule(rule["id"], {"keep_latest": "nope"})

    # clearing one field back to null, then setting the other, is allowed
    rule = rulesmod.update_rule(rule["id"], {"keep_latest": None})
    rule = rulesmod.update_rule(rule["id"], {"older_than_days": 10})
    assert rule["keep_latest"] is None and rule["older_than_days"] == 10


def test_rule_report_preview_reflects_retention(bridge):
    scan(bridge)
    rule = rulesmod.create_rule({
        "name": "dhl", "grouping": "sender", "query": "tag:shipping",
        "action": "trash", "keep_latest": 1})
    res = rulesmod.run_rule(rule["id"], rescan=False)
    assert res["mode"] == "report"
    assert res["groups"] == 1
    # report numbers reflect the retention restriction: 3 mails in the
    # group, but only 2 would actually be acted on.
    assert res["mails"] == 2
    assert res["preview"][0]["count"] == 2
    assert res["acted"] == 0                        # still report mode


def test_rule_execute_applies_retention(bridge):
    scan(bridge)
    rule = rulesmod.create_rule({
        "name": "dhl", "grouping": "sender", "query": "tag:shipping",
        "action": "trash", "keep_latest": 1})
    rulesmod.run_rule(rule["id"], rescan=False)        # required report run
    rulesmod.update_rule(rule["id"], {"mode": "execute"})
    res = rulesmod.run_rule(rule["id"], rescan=False)
    assert res["acted"] == 2
    wait_delete_done()
    dhl = mailops.STATE["groups"]["sender"]["noreply@dhl.example"]
    assert dhl["count"] == 1                          # the kept-latest mail


def test_rule_cap_applies_to_restricted_set(bridge, monkeypatch):
    monkeypatch.setattr(rulesmod, "RULE_CAP", 1)
    rule = rulesmod.create_rule({
        "name": "dhl", "grouping": "sender", "query": "tag:shipping",
        "action": "trash", "keep_latest": 1})
    res = rulesmod.run_rule(rule["id"], rescan=False)
    # Without retention the group has 3 mails (would exceed cap 1); with
    # keep_latest=1 only 2 would be acted on, still over the cap of 1, so
    # the whole group is capped out of this run.
    assert res["mails"] == 2
    assert res["capped"] == 2
    assert res["preview"] == []


# ------------------------------------------------------ rules.json migration

def test_load_rules_tolerates_pre_retention_file(tmp_path, monkeypatch):
    path = tmp_path / "rules.json"
    path.write_text(json.dumps({"rules": [{
        "id": "old1", "name": "legacy", "grouping": "sender", "query": "",
        "action": "trash", "dest": "", "account": "default",
        "schedule": "manual", "mode": "report", "report_runs": 0,
        "created": 0, "last_run": None,
    }]}))
    monkeypatch.setattr(rulesmod, "RULES_PATH", path)
    rules = rulesmod.load_rules()
    assert rules[0]["keep_latest"] is None
    assert rules[0]["older_than_days"] is None
