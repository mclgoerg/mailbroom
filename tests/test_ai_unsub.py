"""AI review paths with a mocked Anthropic client, and unsubscribe dispatch."""

import json
import types

import pytest

from backend import aihelper
from backend import config as cfgmod
from backend import mailops
from backend import unsub
from backend import verdictstore


class FakeClient:
    """Stands in for anthropic.Anthropic — returns canned JSON verdicts."""

    def __init__(self, make_payload):
        self._make = make_payload
        self.calls: list[dict] = []
        self.messages = types.SimpleNamespace(create=self._create)

    def _create(self, **kw):
        self.calls.append(kw)
        sent = json.loads(kw["messages"][0]["content"])
        return types.SimpleNamespace(
            stop_reason="end_turn",
            content=[types.SimpleNamespace(
                type="text", text=json.dumps(self._make(sent)))],
            usage=types.SimpleNamespace(input_tokens=1000, output_tokens=200),
        )


@pytest.fixture
def ai_ready(bridge, monkeypatch):
    cfgmod.update_config({"ai": {"api_key": "test-key",
                                 "model": "claude-sonnet-5"}})
    mailops.run_scan()
    assert mailops.STATE["status"] == "done"
    return monkeypatch


def test_group_review_applies_verdicts_and_cost(ai_ready):
    def payload(sent):
        return {"verdicts": [
            {"key": g["key"],
             "verdict": "delete_safe" if "dhl" in g["key"] else "review",
             "reason": "test"} for g in sent["groups"]]}
    client = FakeClient(payload)
    ai_ready.setattr(aihelper, "ai_client", lambda cfg: client)

    aihelper._run_ai("sender")
    ai = mailops.STATE["ai"]
    assert ai["status"] == "done", ai["error"]
    senders = mailops.STATE["groups"]["sender"]
    assert senders["noreply@dhl.example"]["ai"]["verdict"] == "delete_safe"
    assert senders["alice@friends.example"]["ai"]["verdict"] == "review"
    # cost: 1000 in * $2/M + 200 out * $10/M
    assert abs(ai["usage"]["cost"] - 0.004) < 1e-9
    assert cfgmod.load_stats()["runs"] == 1


def test_ai_group_rates_and_caches(ai_ready):
    def payload(sent):
        items = [{"uid": m["uid"], "folder_i": m["folder_i"],
                  "verdict": "delete_safe"} for m in sent["mails"]]
        items.append({"uid": 999, "folder_i": 0,
                      "verdict": "delete_safe"})     # bogus, filtered
        return {"items": items, "note": "mostly disposable"}
    client = FakeClient(payload)
    ai_ready.setattr(aihelper, "ai_client", lambda cfg: client)

    r = aihelper.ai_group("sender", "noreply@dhl.example")
    assert r["reviewed"] == 3 and r["total"] == 3 and r["remaining"] == 0
    assert len(r["verdicts"]) == 3                 # uid 999 filtered out
    assert all(v[2] == "delete_safe" for v in r["verdicts"])
    assert r["usage"]["cost"] > 0

    # verdicts are cached by Message-ID: mails carry them, nothing to re-rate
    mails = mailops.group_mails("sender", "noreply@dhl.example")
    assert all(m["ai"] == "delete_safe" for m in mails)
    r2 = aihelper.ai_group("sender", "noreply@dhl.example")
    assert r2["reviewed"] == 0 and r2["remaining"] == 0
    assert r2["usage"]["cost"] == 0

    # ...and they survive a rescan (keyed by Message-ID, not UID)
    mailops.run_scan()
    mails = mailops.group_mails("sender", "noreply@dhl.example")
    assert all(m["ai"] == "delete_safe" for m in mails)

    # public_state exposes the per-group rating summary
    st = mailops.public_state()
    dhl = st["groups"]["sender"]["noreply@dhl.example"]
    assert dhl["ratings"] == {"delete_safe": 3, "review": 0, "keep": 0}
    alice = st["groups"]["sender"]["alice@friends.example"]
    assert alice["ratings"] is None

    # paging: limit slices the unrated set
    verdictstore.clear()
    r3 = aihelper.ai_group("sender", "noreply@dhl.example", limit=2)
    assert r3["reviewed"] == 2 and r3["remaining"] == 1


def test_unsubscribe_dispatch(bridge, monkeypatch):
    mailops.run_scan()
    posted, mailed = [], []
    monkeypatch.setattr(unsub, "_post_one_click", lambda url: posted.append(url))
    monkeypatch.setattr(unsub, "_send_mailto",
                        lambda cfg, uri: mailed.append(uri))

    # shop.example: one-click header -> POST wins
    r = unsub.unsubscribe("sender", "news@shop.example")
    assert r["action"] == "done" and posted and not mailed

    # dhl.example: plain https link, no one-click -> hand back the link
    r = unsub.unsubscribe("sender", "noreply@dhl.example")
    assert r["action"] == "link"
    assert r["detail"].startswith("https://dhl.example/")

    # alice: no header at all
    with pytest.raises(RuntimeError, match="List-Unsubscribe"):
        unsub.unsubscribe("sender", "alice@friends.example")


def test_ssrf_guard(monkeypatch):
    monkeypatch.setattr(unsub.socket, "getaddrinfo",
                        lambda host, port: [(2, 1, 6, "", ("10.0.0.5", 0))])
    with pytest.raises(RuntimeError, match="non-public"):
        unsub._assert_public_host("https://internal.example/u")
