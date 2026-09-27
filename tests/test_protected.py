"""Protected senders: matching, delete skip + force, AI prompt injection."""

import pytest
from fastapi.testclient import TestClient

from backend import aihelper
from backend import config as cfgmod
from backend import mailops
from backend.main import app

from conftest import wait_delete_done
from test_ai_unsub import FakeClient

client = TestClient(app)


# ------------------------------------------------------------------ matching

def test_normalize_and_is_protected():
    plist = cfgmod.normalize_protected(
        ["  Boss@Work.example ", "@Bank.example", "dhl.example", "", None,
         "boss@work.example"])
    assert plist == ["boss@work.example", "@bank.example", "@dhl.example"]

    assert cfgmod.is_protected("boss@work.example", plist)
    assert cfgmod.is_protected("BOSS@work.example", plist)
    assert cfgmod.is_protected("anyone@bank.example", plist)
    assert cfgmod.is_protected("noreply@dhl.example", plist)
    # domain match is exact — no subdomains, no substring surprises
    assert not cfgmod.is_protected("a@mail.bank.example", plist)
    assert not cfgmod.is_protected("a@notbank.example", plist)
    assert not cfgmod.is_protected("other@work.example", plist)
    assert not cfgmod.is_protected("", plist)
    assert not cfgmod.is_protected("x@y.example", [])


def test_config_roundtrip_and_quick_toggle():
    cfgmod.update_config({"protected": ["A@b.example", "c.example"]})
    assert cfgmod.load_config()["protected"] == ["a@b.example", "@c.example"]

    assert cfgmod.set_protected("New@x.example", True) == [
        "a@b.example", "@c.example", "new@x.example"]
    assert cfgmod.set_protected("a@b.example", False) == [
        "@c.example", "new@x.example"]
    with pytest.raises(ValueError):
        cfgmod.set_protected("   ", True)

    masked = cfgmod.masked_config(cfgmod.load_config())
    assert masked["protected"] == ["@c.example", "new@x.example"]


# ----------------------------------------------------------- state & deletes

def test_state_flags_protected_groups(bridge):
    cfgmod.update_config({"protected": ["noreply@dhl.example"]})
    mailops.run_scan()
    st = mailops.public_state()
    assert st["groups"]["sender"]["noreply@dhl.example"]["protected"]
    assert not st["groups"]["sender"]["alice@friends.example"]["protected"]
    # domain and subject groups containing protected mail are protected too
    assert st["groups"]["domain"]["dhl.example"]["protected"]
    assert not st["groups"]["domain"]["shop.example"]["protected"]


def test_trash_skips_protected_unless_forced(bridge):
    cfgmod.update_config({"protected": ["@dhl.example"]})
    mailops.run_scan()

    r = mailops.delete_groups(
        "sender", ["noreply@dhl.example", "news@shop.example"])
    assert r["skipped"] == 1 and r["queued"] == 1      # only the shop mail
    wait_delete_done()
    assert "noreply@dhl.example" in mailops.STATE["groups"]["sender"]
    assert "news@shop.example" not in mailops.STATE["groups"]["sender"]

    # everything protected -> clear error, nothing moved
    with pytest.raises(ValueError, match="protected"):
        mailops.delete_groups("sender", ["noreply@dhl.example"])

    # force overrides (single-group confirm path in the UI)
    r = mailops.delete_groups("sender", ["noreply@dhl.example"], force=True)
    assert r["queued"] == 3 and r["skipped"] == 0
    wait_delete_done()
    assert "noreply@dhl.example" not in mailops.STATE["groups"]["sender"]


def test_non_trash_actions_ignore_protection(bridge):
    """Archive/move/mark_read are reversible — protection only guards trash."""
    cfgmod.update_config({"protected": ["noreply@dhl.example"]})
    mailops.run_scan()
    r = mailops.delete_groups("sender", ["noreply@dhl.example"], "mark_read")
    assert r["queued"] == 3 and r["skipped"] == 0
    wait_delete_done()


def test_protect_api_and_delete_400(bridge):
    r = client.post("/api/protect", json={"entry": "Noreply@dhl.example"})
    assert r.json() == {"protected": ["noreply@dhl.example"]}
    assert client.post("/api/protect",
                       json={"entry": " "}).status_code == 400

    client.post("/api/scan", json={})
    for _ in range(200):
        if client.get("/api/state").json()["status"] != "scanning":
            break
    r = client.post("/api/delete", json={
        "grouping": "sender", "keys": ["noreply@dhl.example"]})
    assert r.status_code == 400 and "protected" in r.json()["detail"]

    r = client.post("/api/delete", json={
        "grouping": "sender", "keys": ["noreply@dhl.example"],
        "force": True})
    assert r.status_code == 200 and r.json()["queued"] == 3
    wait_delete_done()

    r = client.post("/api/protect", json={"entry": "noreply@dhl.example",
                                          "on": False})
    assert r.json() == {"protected": []}


# ------------------------------------------------------------------------ AI

@pytest.fixture
def ai_protected(bridge, monkeypatch):
    cfgmod.update_config({"ai": {"api_key": "test-key"},
                          "protected": ["@dhl.example"]})
    mailops.run_scan()
    return monkeypatch


def test_group_review_marks_and_downgrades_protected(ai_protected):
    def payload(sent):
        # The model misbehaves and rates everything delete_safe.
        return {"verdicts": [
            {"key": g["key"], "verdict": "delete_safe", "reason": "x"}
            for g in sent["groups"]]}
    fake = FakeClient(payload)
    ai_protected.setattr(aihelper, "ai_client", lambda cfg: fake)

    aihelper._run_ai("sender")
    assert mailops.STATE["ai"]["status"] == "done", \
        mailops.STATE["ai"]["error"]

    # prompt injection: protected flag in payload + system note
    import json
    sent = json.loads(fake.calls[0]["messages"][0]["content"])
    by_key = {g["key"]: g for g in sent["groups"]}
    assert by_key["noreply@dhl.example"].get("protected") is True
    assert "protected" not in by_key["alice@friends.example"]
    assert "NEVER rate a protected group" in fake.calls[0]["system"]

    # hard downgrade regardless of what the model answered
    senders = mailops.STATE["groups"]["sender"]
    assert senders["noreply@dhl.example"]["ai"]["verdict"] == "review"
    assert senders["alice@friends.example"]["ai"]["verdict"] == "delete_safe"


def test_ai_group_marks_and_downgrades_protected(ai_protected):
    def payload(sent):
        assert all(m.get("protected") for m in sent["mails"])
        return {"items": [
            {"uid": m["uid"], "folder_i": m["folder_i"],
             "verdict": "delete_safe"} for m in sent["mails"]],
            "note": "n"}
    fake = FakeClient(payload)
    ai_protected.setattr(aihelper, "ai_client", lambda cfg: fake)

    r = aihelper.ai_group("sender", "noreply@dhl.example")
    assert "NEVER rate a protected mail" in fake.calls[0]["system"]
    assert r["reviewed"] == 3
    assert all(v[2] == "review" for v in r["verdicts"])
    mails = mailops.group_mails("sender", "noreply@dhl.example")
    assert all(m["ai"] == "review" for m in mails)
