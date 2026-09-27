"""Monthly AI budget cap."""

import time

import pytest
from fastapi.testclient import TestClient

from backend import aihelper
from backend import config as cfgmod
from backend import mailops
from backend.main import app

from test_ai_unsub import FakeClient

client = TestClient(app)


def test_monthly_tracking_and_check():
    cfgmod.update_config({"ai": {"api_key": "k", "model": "claude-sonnet-5"}})
    cfg = cfgmod.load_config()
    cfgmod.record_usage(cfg["ai"], 1_000_000, 0)      # $2 at sonnet-5 rates
    month = time.strftime("%Y-%m")
    assert cfgmod.load_stats()["months"][month] == 2.0
    assert cfgmod.month_cost() == 2.0

    cfgmod.check_budget({"budget_usd": 0})            # no cap: fine
    cfgmod.check_budget({"budget_usd": 5})            # under: fine
    with pytest.raises(ValueError, match="budget"):
        cfgmod.check_budget({"budget_usd": 2})        # reached

    masked = cfgmod.masked_config(cfgmod.load_config())
    assert masked["ai"]["month_cost"] == 2.0


def test_budget_blocks_ai_endpoints(bridge, monkeypatch):
    cfgmod.update_config({"ai": {"api_key": "k", "budget_usd": 0.001}})
    cfgmod.record_usage(cfgmod.load_config()["ai"], 1_000_000, 0)
    mailops.run_scan()

    r = client.post("/api/ai", json={"grouping": "sender"})
    assert r.status_code == 400 and "budget" in r.json()["detail"]
    r = client.post("/api/ai_group", json={
        "grouping": "sender", "key": "noreply@dhl.example"})
    assert r.status_code == 400 and "budget" in r.json()["detail"]


def test_budget_stops_running_review_between_batches(bridge, monkeypatch):
    # Tiny budget: the first batch is billed, the loop then stops itself.
    cfgmod.update_config({"ai": {"api_key": "k", "budget_usd": 0.0001},
                          })
    monkeypatch.setattr(aihelper, "AI_BATCH", 2)
    mailops.run_scan()

    def payload(sent):
        return {"verdicts": [
            {"key": g["key"], "verdict": "review", "reason": "x"}
            for g in sent["groups"]]}
    fake = FakeClient(payload)
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: fake)

    aihelper._run_ai("sender")
    assert mailops.STATE["ai"]["status"] == "done"
    assert mailops.STATE["notice"]["key"] == "ai_budget"
    assert len(fake.calls) == 1                       # stopped after batch 1
