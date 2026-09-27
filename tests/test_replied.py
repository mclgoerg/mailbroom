"""'Never replied' signal: Sent-folder scan, group flag, AI payload hint."""

import json

from backend import aihelper
from backend import config as cfgmod
from backend import mailops

from test_ai_unsub import FakeClient


def test_scan_sets_replied_flags_and_persists(bridge):
    mailops.run_scan()
    assert mailops.STATE["status"] == "done"
    # To/Cc of Sent both count; Sent itself stays out of the cleanup views
    assert mailops.REPLIED_TO == {"alice@friends.example", "bob@corp.example"}
    assert "Sent" not in mailops.STATE["folders"]

    st = mailops.public_state()
    assert st["groups"]["sender"]["alice@friends.example"]["replied"]
    assert not st["groups"]["sender"]["noreply@dhl.example"]["replied"]
    assert st["groups"]["domain"]["friends.example"]["replied"]
    assert not st["groups"]["domain"]["dhl.example"]["replied"]

    data = json.loads(mailops.REPLIED_PATH.read_text())
    assert "alice@friends.example" in data["addrs"] and data["ts"] > 0

    # the cache is merged, not replaced: mail deleted from Sent later must
    # not flip a sender back to "never replied"
    bridge.mailbox["Sent"] = []
    mailops.REPLIED_TO.clear()
    mailops._replied_loaded = False
    mailops.run_scan()
    assert "alice@friends.example" in mailops.REPLIED_TO
    st = mailops.public_state()
    assert st["groups"]["sender"]["alice@friends.example"]["replied"]


def test_no_sent_folder_is_fine(bridge):
    del bridge.mailbox["Sent"]
    mailops.run_scan()
    assert mailops.STATE["status"] == "done"
    assert mailops.REPLIED_TO == set()
    st = mailops.public_state()
    assert not st["groups"]["sender"]["alice@friends.example"]["replied"]


def test_ai_payloads_carry_replied_flag(bridge, monkeypatch):
    cfgmod.update_config({"ai": {"api_key": "test-key"}})
    mailops.run_scan()

    def group_payload(sent):
        return {"verdicts": [
            {"key": g["key"], "verdict": "review", "reason": "x"}
            for g in sent["groups"]]}
    fake = FakeClient(group_payload)
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: fake)

    aihelper._run_ai("sender")
    assert mailops.STATE["ai"]["status"] == "done", \
        mailops.STATE["ai"]["error"]
    sent = json.loads(fake.calls[0]["messages"][0]["content"])
    by_key = {g["key"]: g for g in sent["groups"]}
    assert by_key["alice@friends.example"].get("replied") is True
    assert "replied" not in by_key["noreply@dhl.example"]
    assert '"replied": true' in fake.calls[0]["system"]

    def mail_payload(sent):
        assert all(m.get("replied") for m in sent["mails"])
        return {"items": [
            {"uid": m["uid"], "folder_i": m["folder_i"],
             "verdict": "keep"} for m in sent["mails"]], "note": "n"}
    fake2 = FakeClient(mail_payload)
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: fake2)
    r = aihelper.ai_group("sender", "alice@friends.example")
    assert r["reviewed"] == 1
    assert '"replied": true' in fake2.calls[0]["system"]
