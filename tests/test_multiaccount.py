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


def test_rename_account_migrates_everything(monkeypatch):
    fakes = _two_accounts(monkeypatch)
    one = accountsmod.get("one")
    mailops.run_scan(one)                        # replied + stats + state
    verdictstore.save("sender", {"shop@a.example":
                                 {"verdict": "keep", "reason": "x"}}, "one")
    rule = rulesmod.create_rule({"name": "r", "query": "shop",
                                 "account": "one"})

    r = client.post("/api/config", json={
        "rename_account": {"from": "one", "to": "uno"}})
    assert r.status_code == 200
    body = r.json()
    assert list(body["accounts"]) == ["uno", "two"]
    assert body["default_account"] == "uno"      # first slot kept

    # runtime state carried over (scan results still there, no rescan)
    uno = accountsmod.get("uno")
    assert uno is one and uno.name == "uno"
    assert "shop@a.example" in mailops.public_state(uno)["groups"]["sender"]
    # persisted artifacts all moved
    assert verdictstore.load_account("uno")["sender"]["shop@a.example"]
    assert verdictstore.load()["accounts"].get("one") is None
    assert json.loads(mailops.REPLIED_PATH.read_text())[
        "accounts"]["uno"]["addrs"] == ["pal-one@y.example"]
    assert len(statsmod.load("uno")["scans"]) == 1
    assert rulesmod.load_rules()[0]["account"] == "uno"
    # old name is gone from the API
    assert client.get("/api/state?account=one").status_code == 400
    assert client.get("/api/state?account=uno").json()["account"] == "uno"
    # collisions and unknowns are rejected
    assert client.post("/api/config", json={
        "rename_account": {"from": "uno", "to": "two"}}).status_code == 400
    assert client.post("/api/config", json={
        "rename_account": {"from": "ghost", "to": "x"}}).status_code == 400
    _ = rule, fakes


def test_excluded_folders_are_per_account(monkeypatch):
    fakes = _two_accounts(monkeypatch)
    fakes["host-one"].mailbox["Receipts"] = [
        make_msg(50, frm="rcpt@a.example")]
    fakes["host-two"].mailbox["Receipts"] = [
        make_msg(50, frm="rcpt@b.example")]
    # exclude Receipts only for account one
    r = client.post("/api/config", json={
        "account": "one", "excluded_folders": ["Receipts"]})
    accts = r.json()["accounts"]
    assert accts["one"]["excluded_folders"] == ["Receipts"]
    assert "Receipts" not in accts["two"]["excluded_folders"]

    one, two = accountsmod.get("one"), accountsmod.get("two")
    mailops.run_scan(one)
    mailops.run_scan(two)
    assert "rcpt@a.example" not in mailops.public_state(one)["groups"]["sender"]
    assert "rcpt@b.example" in mailops.public_state(two)["groups"]["sender"]
    # /api/folders reflects each account's own exclusions
    f1 = {x["raw"]: x for x in
          client.get("/api/folders?account=one").json()["folders"]}
    f2 = {x["raw"]: x for x in
          client.get("/api/folders?account=two").json()["folders"]}
    assert f1["Receipts"]["excluded"] is True
    assert f2["Receipts"]["excluded"] is False
