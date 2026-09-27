"""Multi-account: STRICT per-account separation of scans, deletes,
replied/verdict/stats persistence and rules, account-scoped API
validation, and migrations for every pre-multi-account file format."""

import json
import time

from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import config as cfgmod
from backend import mailops
from backend import rules as rulesmod
from backend import stats as statsmod
from backend import verdictstore
from backend.main import app
from conftest import FakeIMAP, make_msg, wait_delete_done

client = TestClient(app)


def _two_accounts(monkeypatch):
    """Two configured accounts, each backed by its own FakeIMAP."""
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "host-one", "user": "u1", "password": "pw"},
        "two": {"host": "host-two", "user": "u2", "password": "pw"},
    }}))
    fakes = {
        "host-one": FakeIMAP({
            "INBOX": [make_msg(1, frm="shop@a.example", subject="sale A"),
                      make_msg(2, frm="shop@a.example", subject="sale A2"),
                      make_msg(3, frm="both@x.example", subject="in one")],
            "Sent": [make_msg(20, frm="u1@self", subject="re",
                              to="pal-one@y.example")],
            "Trash": [],
        }),
        "host-two": FakeIMAP({
            "INBOX": [make_msg(1, frm="news@b.example", subject="letter B"),
                      make_msg(3, frm="both@x.example", subject="in two")],
            "Sent": [make_msg(20, frm="u2@self", subject="re",
                              to="pal-two@y.example")],
            "Trash": [],
        }),
    }
    monkeypatch.setattr(mailops, "connect", lambda im: fakes[im["host"]])
    return fakes


def _wait_done(acc, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        with acc.lock:
            if acc.state["status"] in ("done", "error"):
                return acc.state["status"]
        time.sleep(0.01)
    raise TimeoutError("scan did not finish")


def test_scan_isolation_groups_never_mix(monkeypatch):
    _two_accounts(monkeypatch)
    one, two = accountsmod.get("one"), accountsmod.get("two")
    mailops.run_scan(one)
    mailops.run_scan(two)
    g1 = mailops.public_state(one)["groups"]["sender"]
    g2 = mailops.public_state(two)["groups"]["sender"]
    assert set(g1) == {"shop@a.example", "both@x.example"}
    assert set(g2) == {"news@b.example", "both@x.example"}
    # the shared sender is counted separately per account — no aggregation
    assert g1["both@x.example"]["count"] == 1
    assert g2["both@x.example"]["count"] == 1
    assert mailops.public_state(one)["account"] == "one"
    assert mailops.public_state(two)["account"] == "two"


def test_parallel_scans_do_not_interfere(monkeypatch):
    _two_accounts(monkeypatch)
    one, two = accountsmod.get("one"), accountsmod.get("two")
    mailops.start_scan(one)
    mailops.start_scan(two)      # must NOT raise "busy" — separate accounts
    assert _wait_done(one) == "done"
    assert _wait_done(two) == "done"
    assert len(mailops.public_state(one)["groups"]["sender"]) == 2
    assert len(mailops.public_state(two)["groups"]["sender"]) == 2


def test_delete_only_touches_its_account(monkeypatch):
    fakes = _two_accounts(monkeypatch)
    one, two = accountsmod.get("one"), accountsmod.get("two")
    mailops.run_scan(one)
    mailops.run_scan(two)
    mailops.delete_groups("sender", ["both@x.example"], acc=one)
    wait_delete_done()  # default account is "one" (first configured)
    assert len(fakes["host-one"].mailbox["Trash"]) == 1
    assert len(fakes["host-two"].mailbox["Trash"]) == 0
    assert "both@x.example" not in \
        mailops.public_state(one)["groups"]["sender"]
    assert "both@x.example" in mailops.public_state(two)["groups"]["sender"]


def test_replied_is_per_account(monkeypatch):
    _two_accounts(monkeypatch)
    one, two = accountsmod.get("one"), accountsmod.get("two")
    mailops.run_scan(one)
    mailops.run_scan(two)
    assert one.replied == {"pal-one@y.example"}
    assert two.replied == {"pal-two@y.example"}
    data = json.loads(mailops.REPLIED_PATH.read_text())
    assert data["accounts"]["one"]["addrs"] == ["pal-one@y.example"]
    assert data["accounts"]["two"]["addrs"] == ["pal-two@y.example"]


def test_group_verdicts_are_per_account(monkeypatch):
    _two_accounts(monkeypatch)
    one, two = accountsmod.get("one"), accountsmod.get("two")
    verdictstore.save("sender", {"both@x.example":
                                 {"verdict": "keep", "reason": "one only"}},
                      "one")
    mailops.run_scan(one)
    mailops.run_scan(two)
    g1 = mailops.public_state(one)["groups"]["sender"]["both@x.example"]
    g2 = mailops.public_state(two)["groups"]["sender"]["both@x.example"]
    assert g1["ai"] and g1["ai"]["verdict"] == "keep"
    assert g2["ai"] is None


def test_stats_are_per_account(monkeypatch):
    fakes = _two_accounts(monkeypatch)
    one = accountsmod.get("one")
    mailops.run_scan(one)
    mailops.delete_groups("sender", ["shop@a.example"], acc=one)
    wait_delete_done()
    assert len(fakes["host-one"].mailbox["Trash"]) == 2
    month = time.strftime("%Y-%m")
    assert statsmod.load("one")["actions"][month]["trash"] == 2
    assert statsmod.load("two") == {"scans": [], "actions": {}}
    assert len(statsmod.load("one")["scans"]) == 1


def test_rules_carry_an_account(monkeypatch):
    fakes = _two_accounts(monkeypatch)
    rule = rulesmod.create_rule({"name": "b-cleanup", "query": "news",
                                 "account": "two"})
    assert rule["account"] == "two"
    res = rulesmod.run_rule(rule["id"])          # rescans account two
    assert res["groups"] == 1 and res["mails"] == 1
    # report mode: nothing moved anywhere
    assert len(fakes["host-two"].mailbox["Trash"]) == 0
    # unknown accounts are rejected
    try:
        rulesmod.create_rule({"name": "x", "query": "", "account": "nope"})
        assert False, "should have raised"
    except ValueError:
        pass


def test_api_account_validation(monkeypatch):
    _two_accounts(monkeypatch)
    assert client.get("/api/state?account=nope").status_code == 400
    assert client.get("/api/state?account=two").json()["account"] == "two"
    assert client.get("/api/state").json()["account"] == "one"   # default
    assert client.post("/api/scan?account=nope").status_code == 400
    assert client.get("/api/stats?account=nope").status_code == 400


def test_migration_old_verdicts_file():
    verdictstore.VERDICTS_PATH.write_text(json.dumps({
        "sender": {"a@b.c": {"verdict": "keep", "reason": "r"}},
        "_mails": {"<m1@x>": "delete_safe"}}))
    acct = verdictstore.load_account()           # default account
    assert acct["sender"]["a@b.c"]["verdict"] == "keep"
    assert verdictstore.load_mails() == {"<m1@x>": "delete_safe"}
    # saving keeps the migrated data and persists the new shape
    verdictstore.save("sender", {"n@e.w": {"verdict": "review",
                                           "reason": ""}})
    raw = json.loads(verdictstore.VERDICTS_PATH.read_text())
    assert set(raw["accounts"]["default"]["sender"]) == {"a@b.c", "n@e.w"}
    assert raw["_mails"] == {"<m1@x>": "delete_safe"}


def test_migration_old_stats_file():
    statsmod.HISTORY_PATH.write_text(json.dumps({
        "scans": [{"ts": 1, "mails": 5, "size": 100, "senders": 2}],
        "actions": {"2026-01": {"trash": 3, "archive": 0, "move": 0,
                                "mark_read": 0, "freed": 50}}}))
    data = statsmod.load()                       # default account
    assert data["scans"][0]["mails"] == 5
    assert data["actions"]["2026-01"]["trash"] == 3
    statsmod.record_action("trash", 1, 10)
    raw = json.loads(statsmod.HISTORY_PATH.read_text())
    assert "accounts" in raw and "default" in raw["accounts"]


def test_migration_old_replied_file():
    mailops.REPLIED_PATH.write_text(json.dumps(
        {"ts": 123, "addrs": ["old@pal.example"]}))
    assert "old@pal.example" in mailops.load_replied()
    acc = accountsmod.get()
    mailops.save_replied(acc)
    raw = json.loads(mailops.REPLIED_PATH.read_text())
    assert raw["accounts"]["default"]["addrs"] == ["old@pal.example"]


def test_migration_old_rules_get_default_account(monkeypatch):
    rulesmod.RULES_PATH.write_text(json.dumps({"rules": [{
        "id": "abc123", "name": "legacy", "grouping": "sender",
        "query": "", "action": "trash", "dest": "", "schedule": "manual",
        "mode": "report", "report_runs": 0, "created": 1,
        "last_run": None}]}))
    rules = rulesmod.load_rules()
    assert rules[0]["account"] == "default"
