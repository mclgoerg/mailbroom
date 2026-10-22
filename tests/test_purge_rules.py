"""Purge rules (P8): scheduled PERMANENT deletion in Junk / Trash.

The irreversible kind of rule, so every guard has its own test: rules never
exist by default and always start in report mode (also through import /
restore), the execute gate is bound to the rule's current definition, the
action is named `purge` (an older release rejects it as unknown instead of
running it as an ordinary trash rule), report mode touches nothing, the run
is capped and deletes only through `mailops.purge_mails` with the exact UIDs
of the live listing, protected / pinned mail is skipped, an ambiguous role or
a changed UIDVALIDITY refuses, Junk goes via Trash, everything is audited and
booked, accounts stay separate, concurrent runs are refused."""

import json
import time

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import auditlog
from backend import config as cfgmod
from backend import digest as digestmod
from backend import mailops
from backend import pinstore
from backend import rules as rulesmod
from backend import stats as statsmod
from backend.main import app
from conftest import FakeIMAP, make_msg
from test_purge import OLD, Spy, _env, _mails, _recent, _uids, _uv_flips

client = TestClient(app)


def _rule(scope="trash", query="", days=30, **kw):
    return rulesmod.create_rule({
        "name": "purge old", "scope": scope, "query": query,
        "older_than_days": days, **kw})


def _armed(rule):
    """Report once, then switch the rule to execute (the user's two steps)."""
    rulesmod.run_rule(rule["id"])
    return rulesmod.update_rule(rule["id"], {"mode": "execute"})


def _run(rule):
    return rulesmod.run_rule(rule["id"])


def _stored(rule_id):
    return next(r for r in rulesmod.load_rules() if r["id"] == rule_id)


def _write(rules):
    rulesmod._path().write_text(json.dumps({"rules": rules}))


def _entries(action=None, account="default"):
    es = auditlog.load(account, 0, 200)["entries"]
    return [e for e in es if action is None or e["action"] == action]


# ======================================================= never by default

def test_no_rule_exists_by_default_and_nothing_creates_one():
    import pathlib
    assert rulesmod.load_rules() == []
    assert client.get("/api/rules").json() == {"rules": [],
                                              "cap": rulesmod.RULE_CAP}
    root = pathlib.Path(__file__).resolve().parent.parent
    demo = (root / "scripts" / "demo.py")
    if demo.exists():
        assert "scope" not in demo.read_text()
    assert not any("rule" in k for k in cfgmod.load_config())


def test_block_rules_stay_ordinary_mail_rules(bridge):
    r = client.post("/api/block", json={"key": "news@shop.example",
                                        "grouping": "sender"})
    assert r.status_code == 200
    rule = r.json()["rule"]
    assert rule["scope"] == "mail" and rule["action"] == "trash"


def test_an_old_rules_file_reads_as_mail_scope_and_stays_intact():
    """Read-side migration: no `scope` (pre-purge rules.json) = mail; no
    purge rule appears, the rule keeps its mode."""
    _write([{"id": "old1", "name": "old", "grouping": "sender",
             "query": "tag:x", "action": "archive", "dest": "",
             "account": "default", "schedule": "daily", "mode": "execute",
             "report_runs": 2, "created": 1, "last_run": None}])
    (rule,) = rulesmod.load_rules()
    assert rule["scope"] == "mail" and rule["mode"] == "execute" \
        and rule["report_runs"] == 2 and rule["action"] == "archive"
    assert rule["keep_latest"] is None and rule["origin"] == "manual"
    assert [r["scope"] for r in client.get("/api/rules").json()["rules"]] \
        == ["mail"]


@pytest.mark.parametrize("scope", ["junk", "trash"])
def test_a_purge_rule_always_starts_in_report_mode(scope):
    r = client.post("/api/rules", json={
        "name": "p", "scope": scope, "older_than_days": 45,
        "schedule": "weekly", "mode": "execute"})
    assert r.status_code == 200
    rule = r.json()
    assert rule["mode"] == "report" and rule["report_runs"] == 0
    assert rule["scope"] == scope and rule["action"] == "purge"
    assert rule["grouping"] == "sender" and rule["older_than_days"] == 45
    # created through the module as well: a forced mode never sticks
    via = rulesmod.create_rule({"name": "q", "scope": scope,
                                "mode": "execute", "report_runs": 9})
    assert via["mode"] == "report" and via["report_runs"] == 0
    assert via["older_than_days"] == rulesmod.PURGE_DEFAULT_DAYS == 30


def test_execute_is_refused_before_a_report_run():
    rule = _rule()
    with pytest.raises(ValueError, match="report mode first"):
        rulesmod.update_rule(rule["id"], {"mode": "execute"})
    assert client.post(f"/api/rules/{rule['id']}",
                       json={"mode": "execute"}).status_code == 400
    assert _stored(rule["id"])["mode"] == "report"


# ============================================== allowed actions per scope

def test_purge_is_not_an_action_an_older_release_knows():
    """ROLLBACK SAFETY. The previous release ignores `scope`; it would run a
    purge rule like any other rule on the main index - unless its action is
    one it rejects. `purge` must therefore never be one of the old actions,
    and the old action path must refuse it before anything is queued."""
    assert mailops.ACTIONS == ("trash", "archive", "move", "mark_read")
    assert rulesmod.PURGE_ACTION == "purge"
    assert rulesmod.PURGE_ACTION not in mailops.ACTIONS
    acc = accountsmod.get()
    with acc.lock, pytest.raises(ValueError, match="bad action"):
        mailops._start_delete({"INBOX": {1}}, "x", acc, action="purge")
    assert acc.delete_pending == []


def test_the_old_delete_path_rejects_a_purge_rule_action(bridge):
    """What the previous release's run_rule does with a purge rule's action:
    delete_groups(..., action) -> bad action, nothing queued or moved."""
    mailops.run_scan()
    before = {f: list(m) for f, m in bridge.mailbox.items()}
    acc = accountsmod.get()
    with pytest.raises(ValueError, match="bad action"):
        mailops.delete_groups("sender", ["noreply@dhl.example"], "purge")
    assert acc.delete_pending == [] and bridge.mailbox == before


@pytest.mark.parametrize("scope", ["junk", "trash"])
@pytest.mark.parametrize("action", mailops.ACTIONS)
def test_no_junk_or_trash_rule_can_carry_an_old_action(scope, action):
    with pytest.raises(ValueError, match="bad action"):
        rulesmod.create_rule({"name": "x", "scope": scope, "action": action,
                              "dest": "Archive"})
    assert client.post("/api/rules", json={
        "name": "x", "scope": scope, "action": action}).status_code == 400
    purge = _rule(scope)
    with pytest.raises(ValueError, match="bad action"):
        rulesmod.update_rule(purge["id"], {"action": action})
    mail = rulesmod.create_rule({"name": "m", "action": "mark_read"})
    # a mail rule moved into a purge scope cannot keep its old action either
    with pytest.raises(ValueError, match="bad action"):
        rulesmod.update_rule(mail["id"], {"scope": scope, "action": action})
    assert _stored(purge["id"])["action"] == "purge"
    assert _stored(mail["id"])["scope"] == "mail"


def test_a_mail_rule_cannot_use_the_purge_action():
    with pytest.raises(ValueError, match="bad action"):
        rulesmod.create_rule({"name": "m", "scope": "mail",
                              "action": "purge"})
    purge = _rule()
    with pytest.raises(ValueError, match="bad action"):
        rulesmod.update_rule(purge["id"], {"scope": "mail"})  # no action
    with pytest.raises(ValueError, match="bad action"):
        rulesmod.update_rule(purge["id"], {"scope": "mail",
                                           "action": "purge"})
    assert _stored(purge["id"])["scope"] == "trash"


def test_a_scope_change_converts_the_action_and_the_other_way_needs_one():
    _write([{"id": "m1", "name": "m", "scope": "mail", "grouping": "sender",
             "query": "", "action": "archive", "dest": "",
             "account": "default", "schedule": "daily", "mode": "execute",
             "keep_latest": None, "older_than_days": 90, "origin": "manual",
             "report_runs": 3, "created": 1, "last_run": None}])
    mail = rulesmod.load_rules()[0]
    assert mail["mode"] == "execute"          # an ordinary rule, armed
    moved = rulesmod.update_rule(mail["id"], {"scope": "junk"})
    assert moved["action"] == "purge" and moved["dest"] == ""
    # moving it into a purge scope sends it back to report: the old
    # report runs previewed something else
    assert moved["mode"] == "report" and moved["report_runs"] == 0
    back = rulesmod.update_rule(mail["id"], {"scope": "mail",
                                             "action": "trash"})
    assert back["action"] == "trash"


def test_the_rules_file_never_holds_a_junk_or_trash_rule_with_an_old_action():
    purge = _rule("junk")
    rulesmod.create_rule({"name": "m"})
    for rule in json.loads(rulesmod._path().read_text())["rules"]:
        assert (rule["scope"] == "mail") == (rule["action"] != "purge")
    rogue = dict(_stored(purge["id"]), action="trash")
    with pytest.raises(ValueError, match="can only purge"):
        rulesmod._save([rogue])
    assert _stored(purge["id"])["action"] == "purge"      # file untouched


def test_unknown_scope_and_unsupported_settings_are_refused():
    for bad in ({"scope": "sent"}, {"scope": ""}, {"grouping": "domain"},
                {"grouping": "thread"}, {"keep_latest": 3},
                {"origin": "block"}, {"schedule": "hourly"}):
        with pytest.raises(ValueError):
            rulesmod.create_rule({"name": "x", "scope": "trash",
                                  "older_than_days": 30, **bad})
    rule = _rule("trash")
    with pytest.raises(ValueError, match="older_than_days"):
        rulesmod.update_rule(rule["id"], {"older_than_days": None})
    with pytest.raises(ValueError, match="keep_latest"):
        rulesmod.update_rule(rule["id"], {"keep_latest": 2,
                                          "older_than_days": None})
    assert client.post("/api/rules", json={
        "name": "x", "scope": "attic"}).status_code == 400


@pytest.mark.parametrize("query", [
    "tag:shipping", "ai:safe", "is:unsub", "is:protected", "is:replied",
    "is:noreply-ever", "is:unsubscribed", "is:not-unsubscribed", "is:new",
    "has:pinned", "eng:low", "att:>1k", "age:>1y tag:x"])
def test_filter_qualifiers_the_role_index_cannot_answer_are_refused(query):
    """A qualifier answered from missing data would widen the match (`eng:low`
    would hit every sender); no new syntax, only a narrower set."""
    with pytest.raises(ValueError, match="filter not available"):
        _rule("trash", query=query)
    rule = _rule("trash")
    with pytest.raises(ValueError, match="filter not available"):
        rulesmod.update_rule(rule["id"], {"query": query})


# ==================================================== the execute gate

def test_editing_the_definition_of_an_execute_rule_resets_it_to_report(
        monkeypatch):
    _env(monkeypatch)
    rule = _armed(_rule("trash", query="gone", days=30))
    assert rule["mode"] == "execute"
    edits = ({"query": "other"}, {"older_than_days": 7}, {"scope": "junk"},
             {"account": "default", "older_than_days": 31})
    for body in edits:
        reset = rulesmod.update_rule(rule["id"], body)
        assert reset["mode"] == "report" and reset["report_runs"] == 0, body
        assert not rulesmod.purge_armed(reset)
        with pytest.raises(ValueError, match="report mode first"):
            rulesmod.update_rule(rule["id"], {"mode": "execute"})
        rule = _armed(_stored(rule["id"]))          # preview, execute again
        assert rule["mode"] == "execute"


def test_editing_something_else_keeps_an_execute_rule_executing(
        monkeypatch):
    _env(monkeypatch)
    rule = _armed(_rule("trash", query="gone"))
    kept = rulesmod.update_rule(rule["id"], {
        "name": "renamed", "schedule": "daily", "query": "gone",
        "older_than_days": 30, "scope": "trash", "action": "purge",
        "grouping": "sender"})
    assert kept["mode"] == "execute" and kept["report_runs"] == 1


def test_a_changed_definition_and_execute_in_one_update_is_refused(
        monkeypatch):
    _env(monkeypatch)
    rule = _armed(_rule("trash", query="gone"))
    with pytest.raises(ValueError, match="report mode first"):
        rulesmod.update_rule(rule["id"], {"query": "wider", "mode": "execute"})
    kept = _stored(rule["id"])               # the refused edit changed nothing
    assert kept["query"] == "gone" and kept["mode"] == "execute"


def test_a_report_run_that_started_before_an_edit_does_not_arm_the_edit(
        monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3], date=OLD))
    rule = _rule("trash", query="gone")
    orig = mailops.purge_preview

    def edit_meanwhile(*a, **k):
        out = orig(*a, **k)
        rulesmod.update_rule(rule["id"], {"query": "changed"})
        return out
    monkeypatch.setattr(mailops, "purge_preview", edit_meanwhile)
    _run(rule)
    monkeypatch.setattr(mailops, "purge_preview", orig)
    stored = _stored(rule["id"])
    assert stored["report_runs"] == 0 and not rulesmod.purge_armed(stored)
    with pytest.raises(ValueError, match="report mode first"):
        rulesmod.update_rule(rule["id"], {"mode": "execute"})
    assert _uids(fake, "Trash") == [3]


def test_a_rule_executing_without_a_report_of_its_definition_never_runs(
        monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3], date=OLD))
    rule = _armed(_rule("trash"))
    spy = Spy(fake)
    # tamper: the stored report belongs to another definition
    raw = json.loads(rulesmod._path().read_text())
    raw["rules"][0]["query"] = "gone"
    rulesmod._path().write_text(json.dumps(raw))
    stored = _stored(rule["id"])
    assert stored["mode"] == "report" and stored["report_runs"] == 0
    res = _run(rule)
    assert res["mode"] == "report" and res["acted"] == 0
    assert spy.destructive() == [] and _uids(fake, "Trash") == [3]


# ======================================= imported / restored / hand-edited

def test_an_imported_backup_cannot_smuggle_an_execute_purge_rule():
    body = {"rules": [
        {"id": "x", "name": "smuggled", "scope": "junk", "action": "purge",
         "older_than_days": 1, "mode": "execute", "report_runs": 50,
         "report_sig": "anything", "schedule": "daily"},
        {"name": "old style", "scope": "trash", "action": "trash",
         "mode": "execute"},                     # an old action: refused
        {"name": "mail", "action": "archive", "mode": "execute",
         "report_runs": 9}]}
    r = client.post("/api/import_config", json=body)
    assert r.status_code == 200 and r.json()["rules"] == 2
    rules = {r_["name"]: r_ for r_ in rulesmod.load_rules()}
    assert set(rules) == {"smuggled", "mail"}
    assert rules["smuggled"]["mode"] == "report" \
        and rules["smuggled"]["report_runs"] == 0
    assert rules["mail"]["mode"] == "report"
    with pytest.raises(ValueError, match="report mode first"):
        rulesmod.update_rule(rules["smuggled"]["id"], {"mode": "execute"})


def test_a_restored_rules_file_cannot_carry_an_execute_purge_rule(
        monkeypatch):
    _env(monkeypatch)
    base = {"id": "r1", "name": "restored", "scope": "trash",
            "action": "purge", "grouping": "sender", "query": "",
            "dest": "", "account": "default", "schedule": "weekly",
            "keep_latest": None, "older_than_days": 30, "origin": "manual",
            "created": 1, "last_run": None}
    # execute with no / foreign report record
    for extra in ({"mode": "execute", "report_runs": 3},
                  {"mode": "execute", "report_runs": 3,
                   "report_sig": "0123456789abcdef"}):
        _write([base | extra])
        (rule,) = rulesmod.load_rules()
        assert rule["mode"] == "report" and rule["report_runs"] == 0
    # a rule that really was armed (this install's own state) loads as is
    armed = _armed(_rule("trash"))
    assert _stored(armed["id"])["mode"] == "execute"
    assert rulesmod.purge_armed(armed)
    # an old action in a Junk / Trash rule is never executable either
    _write([base | {"action": "trash", "mode": "execute", "report_runs": 3}])
    assert rulesmod.load_rules()[0]["mode"] == "report"
    assert rulesmod.load_rules()[0]["action"] == "purge"


def test_a_hand_edited_rule_with_an_old_action_loads_as_a_report_only_purge(
        monkeypatch):
    """The file claims an ordinary trash action in execute mode for a Junk /
    Trash rule: the loader makes it a purge rule in report mode, so neither
    this release nor the file's next save can ever execute it as a trash
    rule."""
    fake = _env(monkeypatch, trash=_mails([3], date=OLD))
    _write([{"id": "r1", "name": "x", "scope": "trash", "action": "trash",
             "grouping": "sender", "query": "", "dest": "",
             "account": "default", "schedule": "manual", "mode": "execute",
             "report_runs": 1, "older_than_days": 30, "origin": "manual",
             "created": 1, "last_run": None}])
    (rule,) = rulesmod.load_rules()
    assert rule["action"] == "purge" and rule["mode"] == "report" \
        and rule["report_runs"] == 0
    spy = Spy(fake)
    assert rulesmod.run_rule("r1")["mode"] == "report"
    assert spy.destructive() == [] and _uids(fake, "Trash") == [3]
    saved = json.loads(rulesmod._path().read_text())["rules"][0]
    assert saved["action"] == "purge" and saved["mode"] == "report"


# ============================================================ report mode

def test_report_mode_reports_counts_and_deletes_or_moves_nothing(monkeypatch):
    fake = _env(monkeypatch, junk=[
        make_msg(3, frm="a@gone.example", subject="Secret subject A",
                 date=OLD),
        make_msg(4, frm='"Shop Team" <b@gone.example>',
                 subject="Secret subject B", date=OLD),
        make_msg(5, frm="b@gone.example", subject="Secret subject C",
                 date=OLD),
        make_msg(6, frm="c@gone.example", date=_recent())], trash=_mails([8]))
    before = {f: list(m) for f, m in fake.mailbox.items()}
    spy = Spy(fake)
    rule = _rule("junk")
    res = _run(rule)
    assert res["mode"] == "report" and res["acted"] == 0
    assert res["mails"] == 3 and res["groups"] == 2     # c is too recent
    assert res["capped"] == 0 and res["error"] == ""
    assert res["preview"] == [{"key": "b@gone.example", "label": "Shop Team",
                               "count": 2},
                              {"key": "a@gone.example",
                               "label": "a@gone.example", "count": 1}]
    assert "Secret" not in json.dumps(res)             # sender level only
    assert spy.destructive() == [] and fake.mailbox == before
    stored = _stored(rule["id"])
    assert stored["report_runs"] == 1 and stored["mode"] == "report"
    assert stored["last_run"]["mails"] == 3
    (e,) = _entries("rule_report")
    assert e["actor"] == f"rule:{rule['id']}" and e["count"] == 3
    assert _entries("purge") == [] and _entries("trash") == []


def test_report_mode_leaves_the_role_index_and_main_index_alone(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4], date=OLD))
    acc = accountsmod.get()
    _run(_rule("trash"))
    assert acc.state["status"] == "idle" and acc.index == {}  # no main scan
    assert sorted(m["uid"] for m in mailops.role_mails("trash")) == [3, 4]
    assert _uids(fake, "Trash") == [3, 4]


def test_the_report_is_capped_and_says_how_many_are_beyond_the_cap(
        monkeypatch):
    monkeypatch.setattr(rulesmod, "RULE_CAP", 2)
    _env(monkeypatch, trash=_mails([3, 4, 5, 6, 7], date=OLD))
    res = _run(_rule("trash"))
    assert res["mails"] == 5 and res["capped"] == 3
    assert sum(p["count"] for p in res["preview"]) == 2


def test_the_preview_lists_at_most_ten_senders(monkeypatch):
    _env(monkeypatch, trash=_mails(range(3, 20), date=OLD))
    res = _run(_rule("trash"))
    assert res["mails"] == 17 and len(res["preview"]) == 10


# ======================================================= what a rule matches

def _mixed(monkeypatch, **kw):
    return _env(monkeypatch, **kw, trash=[
        make_msg(3, frm="a@gone.example", date=OLD),
        make_msg(4, frm="a@gone.example", date=_recent()),
        make_msg(5, frm="b@gone.example", date=OLD),
        make_msg(6, frm="b@other.example", date=OLD, seen=True)])


def test_the_filter_runs_on_sender_groups_and_age_on_mails(monkeypatch):
    _mixed(monkeypatch)
    got = lambda q: _run(_rule("trash", query=q))["mails"]
    assert got("") == 3                            # a:1 old, b:1, other:1
    assert got("gone.example") == 2                # text: key / label / sub
    assert got("from:b@gone.example") == 1
    assert got("from:nobody@gone.example") == 0
    assert got("unread:>50") == 2                  # other.example is read
    # group-level age: a@'s NEWEST mail is recent, so the group is not "old"
    assert got("age:>1m") == 2


def test_only_mails_received_more_than_n_days_ago_are_selected(monkeypatch):
    _mixed(monkeypatch)
    assert _run(_rule("trash", days=100000))["mails"] == 0
    assert _run(_rule("trash", days=1))["mails"] == 3


def test_the_group_filter_matches_the_same_way_as_for_mail_rules():
    """No new syntax: the role groups go through the same match_group."""
    mails = [{"addr": "a@gone.example", "name": "Anna Example", "seen": False,
              "ts": 1.7e9}, {"addr": "a@gone.example", "name": "Anna Example",
                             "seen": True, "ts": 1.6e9}]
    (g,) = mailops.role_sender_groups(mails)
    assert g["key"] == "a@gone.example" and g["label"] == "Anna Example"
    assert g["sub"] == "a@gone.example" and g["count"] == 2
    assert g["unread"] == 1 and g["last"] >= "2023-11-14"
    for q, want in (("anna", True), ("from:a@gone.example", True),
                    ("gone.example", True), ("zed", False),
                    ("unread:>40", True), ("unread:>60", False)):
        assert rulesmod.match_group(g, rulesmod.parse_filter(q)) is want, q


# ============================================================ execute mode

@pytest.mark.parametrize("scope,folder", [("trash", "Trash"),
                                          ("junk", "Spam")])
def test_execute_deletes_exactly_the_matching_old_mails(monkeypatch, scope,
                                                        folder):
    boxes = {"trash": dict(trash=[
        make_msg(3, frm="a@gone.example", date=OLD),
        make_msg(4, frm="a@gone.example", date=_recent()),
        make_msg(5, frm="b@keep.example", date=OLD)]),
        "junk": dict(trash=_mails([8, 9], date=OLD), junk=[
            make_msg(3, frm="a@gone.example", date=OLD),
            make_msg(4, frm="a@gone.example", date=_recent()),
            make_msg(5, frm="b@keep.example", date=OLD)])}
    fake = _env(monkeypatch, **boxes[scope],
                **(dict(renumber=True, copyuid=True) if scope == "junk"
                   else {}))
    rule = _armed(_rule(scope, query="from:a@gone.example"))
    res = _run(rule)
    assert res["mode"] == "execute" and res["acted"] == 1 \
        and res["mails"] == 1
    assert _uids(fake, folder) == [4, 5]             # recent + other sender
    if scope == "junk":                              # the role's own mail
        assert _uids(fake, "Trash") == [8, 9]        # in Trash is not touched
    (e,) = _entries("purge")
    assert e["actor"] == f"rule:{rule['id']}" and e["count"] == 1
    assert e["label"].startswith(folder.replace("Spam", "Junk"))
    assert _stored(rule["id"])["last_run"]["acted"] == 1


def test_a_mail_arriving_after_the_listing_survives(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4], date=OLD))
    rule = _armed(_rule("trash"))
    orig = mailops.purge_preview

    def late(*a, **k):
        out = orig(*a, **k)
        # old enough and matching - but not in the run's listing
        fake.mailbox["Trash"].append(make_msg(99, frm="s99@gone.example",
                                              date=OLD))
        return out
    monkeypatch.setattr(mailops, "purge_preview", late)
    res = _run(rule)
    assert res["acted"] == 2 and _uids(fake, "Trash") == [99]


def test_the_run_deletes_through_purge_mails_with_exact_uids_and_the_cap(
        monkeypatch):
    monkeypatch.setattr(rulesmod, "RULE_CAP", 3)
    fake = _env(monkeypatch, trash=_mails([3, 4, 5, 6, 7], date=OLD))
    rule = _armed(_rule("trash"))
    calls = []
    orig = mailops.purge_mails

    def spy(role, uids, uv, acc=None, **kw):
        calls.append((role, list(uids), uv, kw))
        return orig(role, uids, uv, acc, **kw)
    monkeypatch.setattr(mailops, "purge_mails", spy)
    res = _run(rule)
    (role, uids, uv, kw), = calls
    assert role == "trash" and uids == [3, 4, 5] and uv == 1   # oldest first
    assert kw == {"folder": "Trash", "trash_folder": None,
                  "actor": f"rule:{rule['id']}", "cap": 3}
    assert res["acted"] == 3 and res["capped"] == 2 and res["mails"] == 5
    assert _uids(fake, "Trash") == [6, 7]               # next run's job
    assert res["error"] == ""


def test_delete_is_uid_store_plus_uid_expunge_never_a_range(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4, 5, 9], date=OLD)
                + [make_msg(10, date=_recent())])
    rule = _armed(_rule("trash", query="from:s4@gone.example"))
    spy = Spy(fake)
    _run(rule)
    assert ("uid", "STORE", "4", "+FLAGS", r"(\Deleted)") in spy.calls
    assert ("uid", "EXPUNGE", "4") in spy.calls
    assert not [c for c in spy.calls if c[0] in ("store", "expunge")]
    assert not any("*" in str(c) or ":" in str(c[2:]) for c in spy.calls
                   if c[0] == "uid" and c[1] in ("STORE", "EXPUNGE"))
    assert _uids(fake, "Trash") == [3, 5, 9, 10]


def test_junk_goes_via_trash_and_only_the_moved_copies_are_deleted(
        monkeypatch):
    fake = _env(monkeypatch, junk=_mails([3, 4], date=OLD),
                trash=_mails([8], date=OLD), renumber=True, copyuid=True)
    rule = _armed(_rule("junk"))
    spy = Spy(fake)
    res = _run(rule)
    assert res["acted"] == 2 and res["error"] == ""
    assert _uids(fake, "Spam") == [] and _uids(fake, "Trash") == [8]
    cmds = [c[1] for c in spy.calls if c[0] == "uid"]
    assert cmds.index("MOVE") < cmds.index("EXPUNGE")      # via Trash
    assert not any(c[0] in ("store", "expunge") for c in spy.calls)
    assert not any(c[0] == "uid" and c[1] == "EXPUNGE" and "8" in
                   c[2].split(",") for c in spy.calls)      # Trash's own 8


def test_junk_mails_that_cannot_be_identified_in_trash_stay_there(
        monkeypatch):
    """Without COPYUID or fresh UIDs the copies in Trash cannot be told
    apart with certainty: the move is kept (reversible), nothing is
    deleted permanently, the run says how many are left in Trash."""
    fake = _env(monkeypatch, junk=_mails([3, 4], date=OLD),
                trash=_mails([3, 4, 8], date=OLD))     # same UIDs as Junk's
    rule = _armed(_rule("junk"))
    res = _run(rule)
    assert res["acted"] == 0 and res["unverified"] == 2
    assert _uids(fake, "Spam") == []
    assert len(fake.mailbox["Trash"]) >= 3             # nothing destroyed
    (e,) = _entries("purge")                  # booked: nothing deleted
    assert e["count"] == 0 and e["outcome"] == "partial"
    assert _stored(rule["id"])["last_run"]["unverified"] == 2


def test_protected_senders_and_pinned_mail_are_always_skipped(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4, 5, 6], date=OLD))
    cfgmod.update_config({"protected": ["s4@gone.example"]})
    pinstore.set_pinned("<m5@shop.example>", True, "default")
    rule = _rule("trash")
    rep = _run(rule)
    assert rep["mails"] == 2 and rep["skipped_protected"] == 1 \
        and rep["skipped_pinned"] == 1
    _armed(rule)
    res = _run(rule)
    assert res["acted"] == 2 and res["skipped_protected"] == 1 \
        and res["skipped_pinned"] == 1
    assert _uids(fake, "Trash") == [4, 5]
    (e,) = _entries("purge")
    assert e["count"] == 2 and e["actor"] == f"rule:{rule['id']}"


def test_protect_or_pin_after_the_report_still_holds_at_execute(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4], date=OLD))
    rule = _armed(_rule("trash"))
    cfgmod.update_config({"protected": ["s3@gone.example"]})
    pinstore.set_pinned("<m4@shop.example>", True, "default")
    res = _run(rule)
    assert res["acted"] == 0 and _uids(fake, "Trash") == [3, 4]


def test_there_is_no_force_for_rules(monkeypatch):
    import inspect
    assert "force" not in inspect.signature(mailops.purge_mails).parameters
    assert "force" not in inspect.signature(rulesmod.run_rule).parameters
    fake = _env(monkeypatch, trash=_mails([3], date=OLD))
    cfgmod.update_config({"protected": ["s3@gone.example"]})
    rule = _armed(_rule("trash"))
    assert client.post(f"/api/rules/{rule['id']}/run?force=1"
                       ).json()["acted"] == 0
    assert _uids(fake, "Trash") == [3]


# ============================================================== refusals

def test_uidvalidity_change_after_the_listing_refuses_and_deletes_nothing(
        monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4], date=OLD))
    rule = _armed(_rule("trash"))
    orig = mailops.purge_preview

    def recreated(*a, **k):
        out = orig(*a, **k)
        fake.uv["Trash"] = 9
        return out
    monkeypatch.setattr(mailops, "purge_preview", recreated)
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="changed on the server"):
        _run(rule)
    assert spy.destructive() == [] and _uids(fake, "Trash") == [3, 4]
    assert "changed on the server" in _stored(rule["id"])["last_run"]["error"]
    assert _entries("purge") == []
    (e,) = _entries("rule_execute")
    assert e["outcome"] == "error"


def test_a_changed_junk_uidvalidity_refuses_and_deletes_nothing(
        monkeypatch):
    fake = _env(monkeypatch, junk=_mails([3, 4], date=OLD),
                trash=_mails([8]), renumber=True, copyuid=True)
    rule = _armed(_rule("junk"))
    orig = mailops.purge_preview

    def recreated(*a, **k):
        out = orig(*a, **k)
        fake.uv["Spam"] = 9
        return out
    monkeypatch.setattr(mailops, "purge_preview", recreated)
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="changed on the server"):
        _run(rule)
    assert spy.destructive() == []
    assert _uids(fake, "Spam") == [3, 4] and _uids(fake, "Trash") == [8]


def test_no_uidplus_refuses_a_partial_purge_and_junk_altogether(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4, 5], date=OLD)
                + [make_msg(6, date=_recent())], uidplus=False)
    rule = _armed(_rule("trash"))
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="cannot delete part of a folder"):
        _run(rule)
    assert spy.destructive() == [] and _uids(fake, "Trash") == [3, 4, 5, 6]
    fake = _env(monkeypatch, junk=_mails([3], date=OLD),
                trash=_mails([8]), uidplus=False)
    rule = _armed(_rule("junk"))
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="cannot delete part of a folder"):
        _run(rule)
    assert spy.destructive() == [] and _uids(fake, "Spam") == [3]


@pytest.mark.parametrize("which", ["trash", "junk-own", "junk-via-trash"])
def test_an_ambiguous_unconfirmed_role_refuses_and_deletes_nothing(
        monkeypatch, which):
    if which == "trash":
        fake = _env(monkeypatch, trash=_mails([3], date=OLD))
        extra, role = "Deleted Items", "trash"
    elif which == "junk-own":
        fake = _env(monkeypatch, junk=_mails([3], date=OLD),
                    trash=_mails([8]))
        extra, role = "Junk Email", "junk"
    else:
        fake = _env(monkeypatch, junk=_mails([3], date=OLD),
                    trash=_mails([8]))
        extra, role = "Deleted Items", "junk"
    rule = _armed(_rule(role))                      # armed while unambiguous
    fake.mailbox[extra] = _mails([4], date=OLD)
    fake.uv[extra] = 1
    before = {f: list(m) for f, m in fake.mailbox.items()}
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="ambiguous"):
        _run(rule)
    assert spy.destructive() == [] and fake.mailbox == before
    assert _entries("purge") == []
    # ... also in report mode: nothing to preview on a folder we may not pick
    rulesmod.update_rule(rule["id"], {"mode": "report"})
    with pytest.raises(RuntimeError, match="ambiguous"):
        _run(rule)
    assert fake.mailbox == before


def test_a_missing_role_folder_is_the_runs_error(monkeypatch):
    fake = FakeIMAP({"INBOX": [make_msg(1)]})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    rule = _rule("junk")
    with pytest.raises(RuntimeError, match="No Junk folder"):
        _run(rule)
    assert "No Junk folder" in _stored(rule["id"])["last_run"]["error"]
    assert _stored(rule["id"])["report_runs"] == 0      # no report happened


def test_a_confirmed_choice_lets_the_rule_run_on_the_chosen_folder(
        monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3], date=OLD))
    fake.mailbox["Deleted Items"] = _mails([4], date=OLD)
    fake.uv["Deleted Items"] = 1
    mailops.set_role_override("trash", "Deleted Items")
    rule = _armed(_rule("trash"))
    assert _run(rule)["acted"] == 1
    assert _uids(fake, "Deleted Items") == [] and _uids(fake, "Trash") == [3]


# ========================================================== audit and books

def test_audit_undo_stats_and_digest_count_a_rule_purge_as_a_purge(
        monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4], date=OLD)
                + [make_msg(5, date=_recent())])
    mailops.UNDO_LOG.append({
        "ts": 1, "label": "gone", "action": "trash", "count": 1,
        "items": [("INBOX", "<m3@shop.example>")], "in": "Trash"})
    mailops.UNDO_LOG.append({
        "ts": 2, "label": "kept", "action": "trash", "count": 1,
        "items": [("INBOX", "<m5@shop.example>")], "in": "Trash"})
    rule = _armed(_rule("trash"))
    assert _run(rule)["acted"] == 2
    (e,) = _entries("purge")
    assert e["actor"] == f"rule:{rule['id']}" and e["count"] == 2
    assert e["outcome"] == "ok" and e["label"] == "Trash"      # counts only
    assert "Subject" not in json.dumps(_entries())
    assert [x["label"] for x in mailops.UNDO_LOG] == ["kept"]  # pruned
    month = statsmod.load()["actions"][time.strftime("%Y-%m")]
    assert month["purge"] == 2 and month["purged_bytes"] == 103 + 104
    _, text, _ = digestmod.compose("default", 0)
    assert "Permanently deleted: 2" in text and "Space freed: 207 B" in text
    assert mailops.STATE["trash_count"] == 1
    assert _uids(fake, "Trash") == [5]


def test_the_run_records_last_run_and_a_notice(monkeypatch):
    _env(monkeypatch, trash=_mails([3], date=OLD))
    rule = _rule("trash")
    _run(rule)
    assert accountsmod.get().state["notice"]["key"] == "rule_report"
    rulesmod.update_rule(rule["id"], {"mode": "execute"})
    _run(rule)
    assert accountsmod.get().state["notice"]["key"] == "rule_executed"
    last = _stored(rule["id"])["last_run"]
    assert last["mode"] == "execute" and last["acted"] == 1
    assert accountsmod.get().state["rules"][0]["last_run"]["acted"] == 1


# ============================================================== accounts

def _two_accounts(monkeypatch):
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "host-one", "user": "u1", "password": "pw"},
        "two": {"host": "host-two", "user": "u2", "password": "pw"}}}))
    boxes = {"host-one": FakeIMAP({"INBOX": [], "Trash": _mails([3, 4],
                                                                date=OLD)}),
             "host-two": FakeIMAP({"INBOX": [], "Trash": _mails([3, 4],
                                                                date=OLD)})}
    seen = []

    def connect(cfg, name=None):
        seen.append(name)
        return boxes[cfg["host"]]
    monkeypatch.setattr(mailops, "connect", connect)
    return boxes, seen


def test_a_rule_acts_on_its_own_account_never_the_default_or_active_one(
        monkeypatch):
    boxes, seen = _two_accounts(monkeypatch)
    assert accountsmod.default_name() == "one"
    rule = _rule("trash", account="two")
    assert rule["account"] == "two"
    rule = _armed(rule)
    assert _run(rule)["acted"] == 2
    assert _uids(boxes["host-two"], "Trash") == []
    assert _uids(boxes["host-one"], "Trash") == [3, 4]          # untouched
    assert set(seen) == {"two"}
    assert [e["actor"] for e in _entries("purge", "two")] \
        == [f"rule:{rule['id']}"]
    assert _entries(None, "one") == []
    assert [r["id"] for r in accountsmod.get("two").state["rules"]] \
        == [rule["id"]]
    assert accountsmod.get("one").state["rules"] == []


def test_a_rule_created_while_another_account_is_shown_belongs_to_it(
        monkeypatch):
    _two_accounts(monkeypatch)
    r = client.post("/api/rules?account=two", json={
        "name": "p", "scope": "trash"})
    assert r.status_code == 200 and r.json()["account"] == "two"
    r = client.post("/api/rules?account=two", json={
        "name": "p", "scope": "trash", "account": "one"})
    assert r.json()["account"] == "one"          # an explicit body account
    assert client.post("/api/rules?account=nope", json={
        "name": "p"}).status_code == 400
    assert client.post("/api/rules", json={
        "name": "p"}).json()["account"] == "one"


def test_a_rule_whose_account_was_deleted_is_not_run(monkeypatch):
    _two_accounts(monkeypatch)
    rule = _rule("trash", account="two")
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "host-one", "user": "u1", "password": "pw"}}}))
    with pytest.raises((RuntimeError, KeyError)):
        rulesmod.run_rule(rule["id"])


# ======================================================== busy / racing

def test_a_second_rule_run_is_refused_while_one_is_running(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3], date=OLD))
    rule = _armed(_rule("trash"))
    other = _rule("trash", query="s3")
    assert rulesmod._RUN_LOCK.acquire(blocking=False)
    spy = Spy(fake)
    try:
        for r in (rule, other):
            with pytest.raises(RuntimeError, match="busy"):
                _run(r)
        assert client.post(f"/api/rules/{rule['id']}/run").status_code == 409
    finally:
        rulesmod._RUN_LOCK.release()
    assert spy.calls == [] and _uids(fake, "Trash") == [3]


def test_a_manual_purge_in_progress_makes_the_rule_back_off(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3], date=OLD))
    rule = _armed(_rule("trash"))
    acc = accountsmod.get()
    assert acc.purge_lock.acquire(blocking=False)
    spy = Spy(fake)
    try:
        with pytest.raises(RuntimeError, match="busy"):
            _run(rule)
    finally:
        acc.purge_lock.release()
    assert spy.destructive() == [] and _uids(fake, "Trash") == [3]
    assert "busy" in _stored(rule["id"])["last_run"]["error"]
    assert _run(rule)["acted"] == 1                 # next run is fine


@pytest.mark.parametrize("key,val", [
    ("delete", {"status": "running", "progress": "", "error": "",
                "moved": 0}),
    ("status", "scanning")])
def test_a_running_scan_or_delete_job_makes_the_rule_back_off(
        monkeypatch, key, val):
    fake = _env(monkeypatch, trash=_mails([3], date=OLD))
    rule = _armed(_rule("trash"))
    acc = accountsmod.get()
    old = acc.state[key]
    acc.state[key] = val
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="busy"):
        _run(rule)
    acc.state[key] = old
    assert spy.destructive() == [] and _uids(fake, "Trash") == [3]


# ============================================================ scheduler

def _no_main_scan(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("a purge rule must not start a main scan")
    monkeypatch.setattr(mailops, "start_scan", boom)


def test_the_scheduler_reports_due_purge_rules_without_a_main_scan(
        monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4], date=OLD))
    _no_main_scan(monkeypatch)
    rule = _rule("trash", schedule="weekly")
    spy = Spy(fake)
    rulesmod._tick()
    stored = _stored(rule["id"])
    assert stored["last_run"]["mode"] == "report" \
        and stored["last_run"]["mails"] == 2 and stored["report_runs"] == 1
    assert spy.destructive() == [] and _uids(fake, "Trash") == [3, 4]
    ts = stored["last_run"]["ts"]
    rulesmod._tick()                                   # weekly: not due again
    assert _stored(rule["id"])["last_run"]["ts"] == ts


def test_the_scheduler_executes_only_an_armed_purge_rule(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4], date=OLD))
    _no_main_scan(monkeypatch)
    rule = _armed(_rule("trash", schedule="weekly", query="from:s3@gone"
                        ".example"))
    # an edit sends it back to report: the next tick only previews
    rule = rulesmod.update_rule(rule["id"], {"query": "gone.example"})
    assert rule["mode"] == "report"
    _write_last_run_old(rule["id"])
    rulesmod._tick()
    assert _stored(rule["id"])["last_run"]["mode"] == "report"
    assert _uids(fake, "Trash") == [3, 4]
    # armed again: the due tick deletes (capped, exact, audited)
    rulesmod.update_rule(rule["id"], {"mode": "execute"})
    _write_last_run_old(rule["id"])
    rulesmod._tick()
    last = _stored(rule["id"])["last_run"]
    assert last["mode"] == "execute" and last["acted"] == 2
    assert _uids(fake, "Trash") == []
    assert [e["actor"] for e in _entries("purge")] == [f"rule:{rule['id']}"]


def _write_last_run_old(rule_id):
    raw = json.loads(rulesmod._path().read_text())
    for r in raw["rules"]:
        if r["id"] == rule_id and r["last_run"]:
            r["last_run"]["ts"] = 1
    rulesmod._path().write_text(json.dumps(raw))


def test_the_scheduler_skips_a_busy_account(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3], date=OLD))
    _no_main_scan(monkeypatch)
    rule = _armed(_rule("trash", schedule="daily"))
    _write_last_run_old(rule["id"])
    acc = accountsmod.get()
    acc.state["delete"] = {**acc.state["delete"], "status": "running"}
    rulesmod._tick()
    assert _uids(fake, "Trash") == [3]
    assert _stored(rule["id"])["last_run"]["ts"] == 1      # not even tried
    acc.state["delete"] = {**acc.state["delete"], "status": "idle"}


def test_a_refusal_in_a_scheduled_run_is_recorded_and_deletes_nothing(
        monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3], date=OLD))
    _no_main_scan(monkeypatch)
    rule = _armed(_rule("trash", schedule="daily"))
    fake.mailbox["Deleted Items"] = _mails([4], date=OLD)
    fake.uv["Deleted Items"] = 1
    _write_last_run_old(rule["id"])
    rulesmod._tick()                                  # never raises
    assert "ambiguous" in _stored(rule["id"])["last_run"]["error"]
    assert _uids(fake, "Trash") == [3] and _uids(fake, "Deleted Items") == [4]


# ================================================================= API

def test_the_run_endpoint_reports_then_executes_a_purge_rule(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4], date=OLD))
    r = client.post("/api/rules", json={"name": "p", "scope": "trash",
                                        "mode": "execute"})
    rule = r.json()
    run = client.post(f"/api/rules/{rule['id']}/run").json()
    assert run["mode"] == "report" and run["mails"] == 2
    assert _uids(fake, "Trash") == [3, 4]
    assert client.post(f"/api/rules/{rule['id']}",
                       json={"mode": "execute"}).json()["mode"] == "execute"
    run = client.post(f"/api/rules/{rule['id']}/run").json()
    assert run["mode"] == "execute" and run["acted"] == 2
    assert _uids(fake, "Trash") == []
    shown = client.get("/api/rules").json()["rules"][0]
    assert shown["scope"] == "trash" and shown["action"] == "purge"


def test_the_run_endpoint_answers_409_with_the_refusal(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3], date=OLD))
    fake.mailbox["Deleted Items"] = _mails([4], date=OLD)
    fake.uv["Deleted Items"] = 1
    rule = client.post("/api/rules", json={"name": "p",
                                           "scope": "trash"}).json()
    r = client.post(f"/api/rules/{rule['id']}/run")
    assert r.status_code == 409 and "ambiguous" in r.json()["detail"]
    assert _uids(fake, "Trash") == [3]


# ================================== the folder the report was computed on

def _ambiguous_trash(monkeypatch, **kw):
    """Trash + Deleted Items, the user confirmed 'Trash' in Settings."""
    fake = _env(monkeypatch, trash=_mails([3, 4], date=OLD), **kw)
    fake.mailbox["Deleted Items"] = _mails([13, 14], date=OLD)
    fake.uv["Deleted Items"] = 1
    mailops.set_role_override("trash", "Trash")
    return fake


def _refused_back_to_report(rule, fake, *untouched):
    before = {f: list(fake.mailbox[f]) for f in untouched}
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="folder changed since the last "
                                            "report"):
        _run(rule)
    assert spy.destructive() == []
    assert {f: list(fake.mailbox[f]) for f in untouched} == before
    stored = _stored(rule["id"])
    assert stored["mode"] == "report" and stored["report_runs"] == 0
    assert stored["reset_reason"] == "folder" and not rulesmod.purge_armed(
        stored)
    assert "folder changed" in stored["last_run"]["error"]
    assert _entries("purge") == []
    with pytest.raises(ValueError, match="report mode first"):
        rulesmod.update_rule(rule["id"], {"mode": "execute"})


def test_a_role_choice_changed_after_the_report_disarms_the_rule(monkeypatch):
    """The reviewer's repro: report on 'Trash', arm, then confirm the
    look-alike 'Deleted Items' - the armed rule must not delete there."""
    fake = _ambiguous_trash(monkeypatch)
    rule = _armed(_rule("trash"))
    mailops.set_role_override("trash", "Deleted Items")
    _refused_back_to_report(rule, fake, "Trash", "Deleted Items")
    # a fresh report shows the NEW folder; only then may it execute there
    assert _run(rule)["mails"] == 2
    assert _stored(rule["id"])["reset_reason"] == ""
    rulesmod.update_rule(rule["id"], {"mode": "execute"})
    assert _run(rule)["acted"] == 2
    assert _uids(fake, "Deleted Items") == [] and _uids(fake, "Trash") == [3, 4]


def test_a_server_side_role_change_after_the_report_disarms_the_rule(
        monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4], date=OLD),
                flags={"Trash": "\\Trash"})
    fake.mailbox["Bin"] = _mails([13, 14], date=OLD)
    fake.uv["Bin"] = 1
    rule = _armed(_rule("trash"))
    fake.flags = {"Bin": "\\Trash"}              # the server moved the role
    _refused_back_to_report(rule, fake, "Trash", "Bin")


def test_a_junk_purges_trash_folder_changed_after_the_report_disarms_it(
        monkeypatch):
    fake = _env(monkeypatch, junk=_mails([3, 4], date=OLD),
                trash=_mails([8], date=OLD), renumber=True, copyuid=True)
    fake.mailbox["Deleted Items"] = _mails([18], date=OLD)
    fake.uv["Deleted Items"] = 1
    mailops.set_role_override("trash", "Trash")
    rule = _armed(_rule("junk"))
    mailops.set_role_override("trash", "Deleted Items")
    _refused_back_to_report(rule, fake, "Spam", "Trash", "Deleted Items")


def test_a_junk_folder_change_after_the_report_disarms_the_rule(monkeypatch):
    fake = _env(monkeypatch, junk=_mails([3, 4], date=OLD),
                trash=_mails([8], date=OLD))
    fake.mailbox["Junk Email"] = _mails([14], date=OLD)
    fake.uv["Junk Email"] = 1
    mailops.set_role_override("junk", "Spam")
    rule = _armed(_rule("junk"))
    mailops.set_role_override("junk", "Junk Email")
    _refused_back_to_report(rule, fake, "Spam", "Junk Email", "Trash")


def test_a_report_without_a_recorded_folder_does_not_arm(monkeypatch):
    _env(monkeypatch, trash=_mails([3], date=OLD))
    rule = _armed(_rule("trash"))
    raw = json.loads(rulesmod._path().read_text())
    raw["rules"][0]["report_at"] = None
    rulesmod._path().write_text(json.dumps(raw))
    stored = _stored(rule["id"])
    assert stored["mode"] == "report" and stored["report_runs"] == 0


# ========================================================= mailbox identity

def _login(user="u1", host="host-one"):
    cfg = json.loads(cfgmod.CONFIG_PATH.read_text())
    cfg["accounts"]["one"].update(user=user, host=host)
    cfgmod.CONFIG_PATH.write_text(json.dumps(cfg))


def test_changing_the_server_or_login_of_an_account_disarms_its_rules(
        monkeypatch):
    boxes, _ = _two_accounts(monkeypatch)
    boxes["host-one2"] = boxes["host-one"]
    rule = _armed(_rule("trash", account="one"))
    assert _stored(rule["id"])["mode"] == "execute"
    for kw in ({"user": "someone-else"}, {"host": "host-one2"}):
        _login()                                    # back to the original
        rule = _armed(_rule("trash", account="one"))
        _login(**kw)
        stored = _stored(rule["id"])
        assert stored["mode"] == "report" and stored["report_runs"] == 0
        assert stored["reset_reason"] == "account"
        with pytest.raises(ValueError, match="report mode first"):
            rulesmod.update_rule(rule["id"], {"mode": "execute"})
    assert _uids(boxes["host-one"], "Trash") == [3, 4]


def test_the_mailbox_identity_is_a_hash_never_a_secret():
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "Host-One", "user": "U1", "password": "s3cret"}}}))
    a = rulesmod.mailbox_id("one")
    assert len(a) == 16 and "s3cret" not in a and "u1" not in a.lower()
    assert a == rulesmod.mailbox_id("one")
    assert rulesmod.mailbox_id("nope") == ""
    _armed_rule = _rule("trash", account="one")
    blob = json.dumps(_armed_rule)
    assert "s3cret" not in blob and "u1" not in blob.lower()


def test_an_account_rename_disarms_its_purge_rules_with_a_reason(monkeypatch):
    _two_accounts(monkeypatch)
    rule = _armed(_rule("trash", account="two"))
    other = _armed(_rule("trash", account="one"))
    # the config rename succeeded too: same host and login under a new name
    cfg = json.loads(cfgmod.CONFIG_PATH.read_text())
    cfg["accounts"]["renamed"] = cfg["accounts"].pop("two")
    cfgmod.CONFIG_PATH.write_text(json.dumps(cfg))
    rulesmod.rename_account("two", "renamed")
    stored = _stored(rule["id"])
    assert stored["account"] == "renamed" and stored["mode"] == "report"
    assert stored["report_runs"] == 0 and stored["reset_reason"] == "account"
    assert _stored(other["id"])["mode"] == "execute"      # others untouched


def test_deleting_an_account_removes_its_rules_so_a_new_one_starts_clean(
        monkeypatch):
    _two_accounts(monkeypatch)
    gone = _rule("trash", account="two")
    keep = _rule("trash", account="one")
    mail = rulesmod.create_rule({"name": "m", "account": "two"})
    r = client.post("/api/config", json={"delete_account": "two"})
    assert r.status_code == 200
    ids = [r_["id"] for r_ in rulesmod.load_rules()]
    assert ids == [keep["id"]] and gone["id"] not in ids \
        and mail["id"] not in ids


def test_a_report_for_another_mailbox_does_not_arm_a_rewritten_account(
        monkeypatch):
    _two_accounts(monkeypatch)
    rule = _armed(_rule("trash", account="one"))
    raw = json.loads(rulesmod._path().read_text())
    # identity of the report is stored as a hash, a stale one disarms
    raw["rules"][0]["report_box"] = "0123456789abcdef"
    rulesmod._path().write_text(json.dumps(raw))
    assert _stored(rule["id"])["mode"] == "report"


# ============================================================ partial failure

def test_a_run_that_stops_part_way_books_what_was_really_deleted(
        monkeypatch):
    monkeypatch.setattr(rulesmod, "RULE_CAP", 1201)
    fake = _env(monkeypatch, trash=_mails(range(1, 1202), date=OLD))
    rule = _armed(_rule("trash"))
    orig = fake.uid
    stores = []

    def uid(cmd, *a):
        if cmd == "STORE" and a[1] == "+FLAGS":
            stores.append(1)
            if len(stores) == 2:
                return "NO", [b"denied"]
        return orig(cmd, *a)
    fake.uid = uid
    with pytest.raises(RuntimeError, match="500 mails were permanently "
                                           "deleted"):
        _run(rule)
    last = _stored(rule["id"])["last_run"]
    assert last["acted"] == 500 and "500 mails" in last["error"]
    (e,) = _entries("rule_execute")
    assert e["count"] == 500 and e["outcome"] == "error"
    (p,) = _entries("purge")
    assert p["count"] == 500 and p["outcome"] == "partial"
    assert len(fake.mailbox["Trash"]) == 701


def test_the_rule_audit_counts_what_was_deleted_not_what_matched(monkeypatch):
    monkeypatch.setattr(rulesmod, "RULE_CAP", 2)
    _env(monkeypatch, trash=_mails([3, 4, 5, 6, 7], date=OLD))
    rule = _armed(_rule("trash"))
    assert _run(rule)["acted"] == 2
    (e,) = _entries("rule_execute")
    assert e["count"] == 2                          # 5 matched, 2 deleted
    (r,) = _entries("rule_report")
    assert r["count"] == 5                          # a report counts matches


# ============================================================ filter / cap

def test_domain_is_refused_for_purge_rules_with_a_clear_message():
    with pytest.raises(ValueError, match=r"domain:.*never matches sender"):
        _rule("trash", query="domain:gone.example")
    rule = _rule("trash")
    with pytest.raises(ValueError, match="domain:"):
        rulesmod.update_rule(rule["id"], {"query": "age:>1m domain:x"})
    assert client.post("/api/rules", json={
        "name": "d", "scope": "junk",
        "query": "domain:x"}).status_code == 400


def test_an_empty_filter_is_every_sender_in_the_folder(monkeypatch):
    _mixed(monkeypatch)
    rule = _rule("trash", query="")
    assert _run(rule)["mails"] == 3 and rule["query"] == ""


def test_a_hand_edited_purge_rule_with_an_unsupported_filter_never_runs(
        monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4], date=OLD))
    spy = Spy(fake)
    for q in ("eng:low", "tag:x", "is:replied"):
        _write([{"id": "r1", "name": "x", "scope": "trash",
                 "action": "purge", "grouping": "sender", "query": q,
                 "dest": "", "account": "default", "schedule": "manual",
                 "mode": "report", "report_runs": 0, "older_than_days": 1,
                 "origin": "manual", "created": 1, "last_run": None}])
        with pytest.raises(RuntimeError, match="filter not available"):
            rulesmod.run_rule("r1")
    assert spy.calls == [] and _uids(fake, "Trash") == [3, 4]


def test_the_rules_api_returns_the_effective_cap(monkeypatch):
    monkeypatch.setattr(rulesmod, "RULE_CAP", 37)
    assert client.get("/api/rules").json()["cap"] == 37


# ================================================ the gate against forgeries

def test_requests_and_imports_cannot_forge_the_report_record(monkeypatch):
    _env(monkeypatch)
    forged = {"report_runs": 9, "report_sig": "x", "report_box": "y",
              "report_at": {"folder": "Trash", "trash_folder": None},
              "reset_reason": "", "mode": "execute"}
    rule = rulesmod.create_rule({"name": "f", "scope": "trash", **forged})
    assert rule["report_runs"] == 0 and rule["report_sig"] == "" \
        and rule["report_at"] is None and rule["mode"] == "report"
    rule = rulesmod.update_rule(rule["id"], {"name": "g", **forged}
                                | {"mode": "report"})
    assert rule["report_runs"] == 0 and rule["report_sig"] == ""
    with pytest.raises(ValueError, match="report mode first"):
        rulesmod.update_rule(rule["id"], {"mode": "execute", **forged})
    r = client.post(f"/api/rules/{rule['id']}", json=forged)
    assert r.status_code == 400
    imp = client.post("/api/import_config", json={"rules": [
        {"name": "i", "scope": "junk", **forged}]})
    assert imp.status_code == 200
    (i,) = [x for x in rulesmod.load_rules() if x["name"] == "i"]
    assert i["mode"] == "report" and i["report_runs"] == 0 \
        and i["report_at"] is None


def test_switching_an_armed_purge_rule_back_to_a_mail_rule_resets_it(
        monkeypatch):
    _env(monkeypatch)
    rule = _armed(_rule("trash"))
    assert rule["mode"] == "execute"
    back = rulesmod.update_rule(rule["id"], {"scope": "mail",
                                             "action": "trash"})
    assert back["mode"] == "report" and back["report_runs"] == 0
    assert _stored(rule["id"])["mode"] == "report"   # not an execute rule
    with pytest.raises(ValueError, match="report mode first"):
        rulesmod.update_rule(rule["id"], {"mode": "execute"})


# ======================================= UIDVALIDITY seen from the rule side

@pytest.mark.parametrize("scope,folder,kw", [
    ("trash", "Trash", {}),
    ("junk", "Spam", dict(renumber=True, copyuid=True))])
def test_a_folder_recreated_before_the_delete_step_is_refused_by_the_rule(
        monkeypatch, scope, folder, kw):
    """Only the read-write select (right before the destructive command)
    sees a new UIDVALIDITY: the rule's run must still refuse."""
    fake = _env(monkeypatch, trash=_mails([3, 4], date=OLD),
                junk=_mails([13, 14], date=OLD), **kw)
    rule = _armed(_rule(scope))
    _uv_flips(fake, folder, readonly_uv=1, rw_uv=9)
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="changed on the server"):
        _run(rule)
    assert spy.destructive() == []
    assert _uids(fake, folder) == ([3, 4] if scope == "trash" else [13, 14])


def test_moving_a_rule_to_another_account_disarms_it_with_that_reason(
        monkeypatch):
    _two_accounts(monkeypatch)
    rule = _armed(_rule("trash", account="two"))
    moved = rulesmod.update_rule(rule["id"], {"account": "one"})
    assert moved["mode"] == "report" and moved["report_runs"] == 0
    assert moved["reset_reason"] == "account"
    edited = _armed(_rule("trash", account="one", query="gone"))
    again = rulesmod.update_rule(edited["id"], {"query": "other"})
    assert again["reset_reason"] == "edited"


def test_the_account_name_is_part_of_the_fingerprint_even_for_one_mailbox(
        monkeypatch):
    """Two names for the SAME host and login: a rule armed on one is not
    armed on the other (the report ran under the first name)."""
    boxes, _ = _two_accounts(monkeypatch)
    cfg = json.loads(cfgmod.CONFIG_PATH.read_text())
    cfg["accounts"]["twin"] = dict(cfg["accounts"]["one"])
    cfgmod.CONFIG_PATH.write_text(json.dumps(cfg))
    assert rulesmod.mailbox_id("one") == rulesmod.mailbox_id("twin") != ""
    rule = _armed(_rule("trash", account="one"))
    moved = rulesmod.update_rule(rule["id"], {"account": "twin"})
    assert moved["mode"] == "report" and moved["reset_reason"] == "account"
    # and a file that says otherwise does not arm it either
    raw = json.loads(rulesmod._path().read_text())
    raw["rules"][0].update(mode="execute", report_runs=1)
    rulesmod._path().write_text(json.dumps(raw))
    assert _stored(rule["id"])["mode"] == "report"
