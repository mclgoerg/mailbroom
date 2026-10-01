"""POST /api/block: one-click block-sender/domain -> standing auto-trash
rule (report-then-execute transition, protected/duplicate refusal,
optional immediate trash, scheduler pickup)."""

from fastapi.testclient import TestClient

from backend import config as cfgmod
from backend import mailops
from backend import rules as rulesmod
from backend.main import app

from conftest import wait_delete_done

client = TestClient(app)


def test_block_refuses_protected_sender(bridge):
    mailops.run_scan()
    cfgmod.update_config({"protected": ["alice@friends.example"]})
    r = client.post("/api/block",
                    json={"grouping": "sender", "key": "alice@friends.example"})
    assert r.status_code == 400
    assert "protected" in r.json()["detail"]
    assert rulesmod.load_rules() == []


def test_block_refuses_protected_domain(bridge):
    mailops.run_scan()
    cfgmod.update_config({"protected": ["@dhl.example"]})
    r = client.post("/api/block",
                    json={"grouping": "domain", "key": "dhl.example"})
    assert r.status_code == 400
    assert rulesmod.load_rules() == []


def test_block_creates_visible_rule_report_then_execute(bridge):
    mailops.run_scan()
    r = client.post("/api/block", json={
        "grouping": "sender", "key": "noreply@dhl.example",
        "label": "DHL Paket"})
    assert r.status_code == 200
    rule = r.json()["rule"]
    assert rule["origin"] == "block"
    assert rule["grouping"] == "sender"
    assert rule["query"] == "from:noreply@dhl.example"
    assert rule["action"] == "trash"
    assert rule["schedule"] == "daily"
    # Safety invariant held: it only reached execute because of the
    # immediate report run the endpoint ran first.
    assert rule["mode"] == "execute"
    assert rule["report_runs"] >= 1

    saved = rulesmod.load_rules()
    assert len(saved) == 1 and saved[0]["id"] == rule["id"]
    # Visible like any other rule via the normal rules API/account state.
    assert client.get("/api/rules").json()["rules"][0]["id"] == rule["id"]


def test_block_domain_query_uses_exact_qualifier(bridge):
    mailops.run_scan()
    r = client.post("/api/block",
                    json={"grouping": "domain", "key": "dhl.example"})
    assert r.status_code == 200
    rule = r.json()["rule"]
    assert rule["query"] == "domain:dhl.example"
    assert rule["grouping"] == "domain"


def test_block_refuses_duplicate(bridge):
    mailops.run_scan()
    r = client.post("/api/block",
                    json={"grouping": "sender", "key": "noreply@dhl.example"})
    assert r.status_code == 200
    r = client.post("/api/block",
                    json={"grouping": "sender", "key": "noreply@dhl.example"})
    assert r.status_code == 400
    assert "already blocked" in r.json()["detail"]
    assert len(rulesmod.load_rules()) == 1


def test_block_with_immediate_trash_flag(bridge):
    mailops.run_scan()
    assert "noreply@dhl.example" in mailops.STATE["groups"]["sender"]
    r = client.post("/api/block", json={
        "grouping": "sender", "key": "noreply@dhl.example",
        "trash_existing": True})
    assert r.status_code == 200
    body = r.json()
    assert body["trashed"]["queued"] == 3      # 2 INBOX + 1 Archive mail
    wait_delete_done()
    assert "noreply@dhl.example" not in mailops.STATE["groups"]["sender"]


def test_block_bad_grouping_rejected(bridge):
    mailops.run_scan()
    r = client.post("/api/block",
                    json={"grouping": "subject", "key": "whatever"})
    assert r.status_code == 400


def test_scheduler_picks_up_block_rule(bridge):
    mailops.run_scan()
    r = client.post("/api/block",
                    json={"grouping": "sender", "key": "news@shop.example"})
    rule_id = r.json()["rule"]["id"]

    # "daily" is only due after >= 24h; force it due like test_due_logic.
    rules = rulesmod.load_rules()
    rules[0]["last_run"]["ts"] = 0
    rulesmod._save(rules)

    rulesmod._tick()
    wait_delete_done()
    after = rulesmod.load_rules()[0]
    assert after["id"] == rule_id
    assert after["last_run"]["ts"] > 0           # the tick's own run recorded
    assert after["last_run"]["mode"] == "execute"
    assert after["last_run"]["acted"] == 1
    assert "news@shop.example" not in mailops.STATE["groups"]["sender"]
