"""Rules: DSL parity with frontend lib.ts, engine, safeguards, scheduling."""

import time

import pytest
from fastapi.testclient import TestClient

from backend import config as cfgmod
from backend import mailops
from backend import rules as rulesmod
from backend.main import app

from conftest import code_re, wait_delete_done

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
    assert client.get("/api/rules").json()["rules"] == []


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
    with pytest.raises(RuntimeError, match=code_re(mailops.UNKNOWN_TARGET,
                                                   folder="NoSuchFolder")):
        rulesmod.run_rule(rule["id"], rescan=False)
    saved = rulesmod.load_rules()[0]
    assert saved["last_run"]["error"]


def _armed_rule(**over):
    rule = rulesmod.create_rule({
        "name": "shipping", "grouping": "sender", "query": "tag:shipping",
        "action": "trash", **over})
    rulesmod.run_rule(rule["id"])
    return rulesmod.update_rule(rule["id"], {"mode": "execute"})


@pytest.mark.parametrize("edit", [
    {"query": ""}, {"query": "tag:shipping age:>2y"},
    {"grouping": "domain"}, {"action": "mark_read"},
    {"action": "move", "dest": "Archive"},
    {"keep_latest": 2}, {"older_than_days": 30}])
def test_editing_a_definition_field_sends_armed_mail_rule_back(bridge, edit):
    rule = _armed_rule()
    assert rule["mode"] == "execute"
    edited = rulesmod.update_rule(rule["id"], edit)
    assert edited["mode"] == "report"
    assert edited["report_runs"] == 0 and edited["reset_reason"] == "edited"
    with pytest.raises(ValueError, match=mailops.RULE_REPORT_FIRST):
        rulesmod.update_rule(rule["id"], {"mode": "execute"})
    # a report run of the NEW definition arms it again
    rulesmod.run_rule(rule["id"], rescan=False)
    again = rulesmod.update_rule(rule["id"], {"mode": "execute"})
    assert again["mode"] == "execute" and again["reset_reason"] == ""


def test_editing_the_account_sends_armed_mail_rule_back(bridge):
    rule = _armed_rule()
    stored = rulesmod.load_rules()
    stored[0]["report_box"] = "someotherbox"      # another mailbox behind it
    rulesmod._save(stored)
    again = rulesmod.load_rules()[0]
    assert again["mode"] == "report" and again["reset_reason"] == "account"
    assert rule["id"] == again["id"]


@pytest.mark.parametrize("edit", [
    {"name": "renamed"}, {"schedule": "daily"}, {"query": "tag:shipping"}])
def test_non_definition_edits_keep_a_mail_rule_armed(bridge, edit):
    rule = _armed_rule()
    edited = rulesmod.update_rule(rule["id"], edit)
    assert edited["mode"] == "execute" and edited["report_runs"] == 1


def test_execute_refused_without_a_report_of_the_current_definition(
        bridge, monkeypatch):
    rule = _armed_rule()
    monkeypatch.setattr(rulesmod, "_normalise", lambda r: None)
    stored = rulesmod.load_rules()
    stored[0]["query"] = ""                 # edited behind the API's back
    rulesmod._save(stored)
    assert rulesmod.load_rules()[0]["mode"] == "execute"
    with pytest.raises(RuntimeError, match=mailops.RULE_REPORT_FIRST):
        rulesmod.run_rule(rule["id"], rescan=False)
    assert "alice@friends.example" in mailops.STATE["groups"]["sender"]
    assert not mailops.UNDO_LOG


def _v111_file(bridge):
    """A v1.11-shaped rules.json: report_sig "" on every rule, armed mail
    rule plus a Block-sender rule."""
    import json
    base = {"scope": "mail", "grouping": "sender", "action": "trash",
            "dest": "", "schedule": "daily", "mode": "execute",
            "report_runs": 1, "created": 1, "last_run": None,
            "report_sig": "", "report_box": "", "report_at": None,
            "reset_reason": "", "keep_latest": None,
            "older_than_days": None}
    rules = [{**base, "id": "m1", "name": "shipping",
              "query": "tag:shipping", "origin": "manual"},
             {**base, "id": "b1", "name": "blocked",
              "query": "from:news@shop.example", "origin": "block"}]
    rulesmod._path().parent.mkdir(parents=True, exist_ok=True)
    rulesmod._path().write_text(json.dumps({"rules": rules}))


def test_v111_rules_file_keeps_execute_mode(bridge):
    _v111_file(bridge)
    loaded = {r["id"]: r for r in rulesmod.load_rules()}
    assert loaded["m1"]["mode"] == "execute"
    assert loaded["b1"]["mode"] == "execute"
    assert rulesmod.purge_armed(loaded["b1"])
    res = rulesmod.run_rule("b1", rescan=False)
    assert res["mode"] == "execute" and res["acted"] == 1
    wait_delete_done()
    rulesmod.update_rule("m1", {"query": ""})     # a later edit re-arms
    assert rulesmod.load_rules()[0]["mode"] == "report"


def test_grandfathered_signatures_are_persisted_once(bridge, monkeypatch):
    import json
    _v111_file(bridge)
    rulesmod.publish()
    on_disk = json.loads(rulesmod._path().read_text())["rules"]
    assert all(r["report_sig"] and r["report_box"] for r in on_disk)
    # re-pointing the account afterwards is NOT adopted: the rule resets
    monkeypatch.setattr(rulesmod, "mailbox_id", lambda acct: "othermailbox")
    again = rulesmod.load_rules()
    assert [r["mode"] for r in again] == ["report", "report"]
    assert again[0]["reset_reason"] == "account"


def test_edit_during_a_report_run_does_not_arm_the_edit(bridge, monkeypatch):
    rule = rulesmod.create_rule({
        "name": "shipping", "grouping": "sender", "query": "tag:shipping",
        "action": "trash"})
    real = rulesmod._record_run

    def edit_then_record(rule_id, result):
        rulesmod.update_rule(rule_id, {"query": ""})     # mid-run edit
        real(rule_id, result)

    monkeypatch.setattr(rulesmod, "_record_run", edit_then_record)
    rulesmod.run_rule(rule["id"])
    saved = rulesmod.load_rules()[0]
    assert saved["report_runs"] == 1                 # a report is on record...
    with pytest.raises(ValueError, match=mailops.RULE_REPORT_FIRST):
        rulesmod.update_rule(rule["id"], {"mode": "execute"})  # ...not this one


# ------------------------------------------------------- filter validation

BAD_FILTERS = {
    "age": "age:>1yr", "unread": "unread:>150", "att": "att:>10x",
    "is": "is:unsubbed", "has": "has:pin", "eng": "eng:none",
    "ai": "ai:maybe", "unknown": "colour:red", "mangled": "-tag:x",
}


@pytest.mark.parametrize("kind", sorted(BAD_FILTERS))
def test_saving_a_mistyped_filter_is_refused_naming_it(bridge, kind):
    bad = BAD_FILTERS[kind]
    body = {"name": "x", "query": f"tag:shipping {bad}"}
    r = client.post("/api/rules", json=body)
    assert r.status_code == 400
    assert r.json()["detail"] == mailops.coded(
        mailops.RULE_FILTER_INVALID, names=bad)
    ok = rulesmod.create_rule({"name": "ok", "query": "tag:shipping"})
    r = client.post(f"/api/rules/{ok['id']}", json={"query": body["query"]})
    assert r.status_code == 400 and "rule_filter_invalid" in r.json()["detail"]
    assert rulesmod.load_rules()[0]["query"] == "tag:shipping"
    # import: the rule comes in flagged, in report mode (never dropped)
    r = client.post("/api/import_config", json={"rules": [body]})
    assert r.json()["rules"] == 1
    imported = rulesmod.load_rules()[0]
    assert imported["mode"] == "report" and imported["filter_invalid"] == [bad]


def test_over_long_filter_is_refused_not_cut(bridge):
    q = "tag:shipping " + "x " * 140 + "age:>1yr"
    assert len(q) > rulesmod.FILTER_MAX
    r = client.post("/api/rules", json={"name": "long", "query": q})
    assert r.status_code == 400
    assert r.json()["detail"] == mailops.coded(
        mailops.RULE_FILTER_TOO_LONG, max=rulesmod.FILTER_MAX)
    assert not rulesmod.load_rules()


def test_export_import_round_trip_keeps_a_flagged_rule(bridge):
    _legacy_rule(bridge)
    exported = client.get("/api/export_config").json()
    assert exported["rules"][0]["query"] == "tag:shipping age:>1yr"
    r = client.post("/api/import_config", json=exported)
    assert r.json()["rules"] == 1 and r.json()["skipped_rules"] == []
    rule = client.get("/api/rules").json()["rules"][0]
    assert rule["mode"] == "report" and rule["filter_invalid"] == ["age:>1yr"]
    with pytest.raises(ValueError, match=mailops.RULE_REPORT_FIRST):
        rulesmod.update_rule(rule["id"], {"mode": "execute"})


def test_import_names_the_rules_it_could_not_take(bridge):
    r = client.post("/api/import_config", json={"rules": [
        {"name": "fine", "query": "tag:shipping"},
        {"name": "bad action", "action": "explode"}]})
    assert r.json()["rules"] == 1 and r.json()["skipped_rules"] == [
        "bad action"]


def test_valid_filters_still_save():
    for q in ("", "newsletter weekly", "tag:ship from:a@b.example age:>1y "
              "unread:>80 att:>10m is:unsub has:pinned eng:low ai:safe"):
        assert rulesmod.create_rule({"name": "ok", "query": q})["query"] == q


def test_purge_rule_with_a_mistyped_filter_is_refused():
    with pytest.raises(ValueError, match="^rule_filter_invalid:"):
        rulesmod.create_rule({"name": "p", "scope": "trash",
                              "older_than_days": 30, "query": "age:>1yr"})


def _legacy_rule(bridge, **over):
    import json
    rule = {"id": "l1", "name": "legacy", "scope": "mail",
            "grouping": "sender", "query": "tag:shipping age:>1yr",
            "action": "trash", "dest": "", "schedule": "daily",
            "mode": "execute", "report_runs": 1, "created": 1,
            "last_run": None, "origin": "manual", "keep_latest": None,
            "older_than_days": None, **over}
    rulesmod._path().parent.mkdir(parents=True, exist_ok=True)
    rulesmod._path().write_text(json.dumps({"rules": [rule]}))
    return rule


def test_legacy_invalid_rule_is_flagged_and_skips_execute(bridge):
    import json
    _legacy_rule(bridge)
    listed = client.get("/api/rules").json()["rules"][0]
    assert listed["filter_invalid"] == ["age:>1yr"]
    with pytest.raises(RuntimeError, match=r"^rule_filter_invalid_run:"):
        rulesmod.run_rule("l1", rescan=False)
    saved = rulesmod.load_rules()[0]
    assert saved["last_run"]["error"].startswith("rule_filter_invalid_run:")
    assert not bridge.mailbox["Trash"] and not mailops.UNDO_LOG
    # the warning flag is derived, never written to the file
    assert "filter_invalid" not in json.loads(
        rulesmod._path().read_text())["rules"][0]


def test_legacy_invalid_rule_still_runs_reports(bridge):
    _legacy_rule(bridge, mode="report")
    res = rulesmod.run_rule("l1")
    assert res["mode"] == "report" and not res["error"]


def test_purge_execute_run_with_a_mistyped_filter_is_skipped(monkeypatch):
    monkeypatch.setattr(rulesmod, "purge_armed", lambda r: True)
    rule = {"id": "p1", "scope": "trash", "action": "purge", "mode": "execute",
            "older_than_days": 30, "keep_latest": None,
            "query": "age:>1yr", "account": None}
    result = {"error": ""}
    rulesmod._run_purge(rule, None, result)
    assert result["error"].startswith("rule_filter_invalid_run:")


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


# has:tracker (F3): mirrors frontend/src/lib.test.ts

def test_has_tracker_filter_parser_and_matching():
    f = rulesmod.parse_filter("has:tracker")
    assert f["tracker_only"] is True and f["text"] == []
    assert rulesmod.parse_filter("")["tracker_only"] is False
    other = rulesmod.parse_filter("has:other")
    assert other["tracker_only"] is False and other["text"] == ["has:other"]
    base = {"key": "a@b", "label": "A", "sub": "", "tags": [], "unread": 0,
            "count": 3}
    t = {"checked": 3, "pixel": 1, "click": 0, "hosts": ["t.example"]}
    assert rulesmod.match_group({**base, "trackers": t}, f)
    assert rulesmod.match_group(
        {**base, "trackers": {**t, "pixel": 0, "click": 2}}, f)
    assert not rulesmod.match_group(
        {**base, "trackers": {**t, "pixel": 0}}, f)
    assert not rulesmod.match_group(base, f)            # never checked
    assert rulesmod.match_group(base, rulesmod.parse_filter(""))


