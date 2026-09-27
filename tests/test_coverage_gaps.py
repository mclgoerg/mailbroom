"""Tests for previously uncovered paths: folders endpoint, OpenAI provider
branch, HTML extraction, partial undo, verdict-cache clearing via API."""

import email
import json
import types

from fastapi.testclient import TestClient

from backend import aihelper
from backend import config as cfgmod
from backend import mailops
from backend import verdictstore
from backend.main import app

from conftest import wait_delete_done

client = TestClient(app)


def test_folders_endpoint(bridge):
    r = client.get("/api/folders").json()
    by_name = {f["name"]: f["excluded"] for f in r["folders"]}
    assert by_name["INBOX"] is False
    assert by_name["Archive"] is False
    assert by_name["Trash"] is True
    assert by_name["Spam"] is True
    assert "Labels/*" in r["wildcards"]


def test_clear_ai_verdicts_via_api(bridge):
    mailops.run_scan()
    verdictstore.save("sender", {"noreply@dhl.example":
                                 {"verdict": "keep", "reason": "x"}})
    verdictstore.save_mails({"<m1@shop.example>": "delete_safe"})
    mailops.run_scan()   # applies the cached group verdict
    assert mailops.STATE["groups"]["sender"]["noreply@dhl.example"]["ai"]

    client.post("/api/config", json={"clear_ai_verdicts": True})
    assert verdictstore.load() == {"accounts": {}, "_mails": {}}
    assert verdictstore.load_mails() == {}
    assert mailops.STATE["groups"]["sender"]["noreply@dhl.example"]["ai"] is None


def test_extract_text_strips_html():
    msg = email.message_from_string(
        "Content-Type: text/html\n\n"
        "<style>.x{color:red}</style><p>Hello<br>World</p> &amp; more"
        "<script>alert(1)</script>")
    text = mailops.extract_text(msg)
    assert "Hello" in text and "World" in text and "& more" in text
    assert "<" not in text and "alert" not in text and "color" not in text


def test_undo_partial_restore(bridge):
    mailops.run_scan()
    mailops.delete_groups("sender", ["noreply@dhl.example"])
    wait_delete_done()
    # One trashed mail vanishes (e.g. emptied elsewhere) before the undo.
    bridge.mailbox["Trash"] = [m for m in bridge.mailbox["Trash"]
                               if m["uid"] != 1]
    r = mailops.undo_last()
    assert r["restored"] == 2 and r["of"] == 3
    notice = mailops.STATE["notice"]
    assert notice["key"] == "restored"
    assert notice["params"]["restored"] == 2


class FakeOpenAI:
    """OpenAI-SDK double; optionally rejects json_schema like old servers."""

    def __init__(self, fail_json_schema=False):
        self.calls: list[dict] = []
        self._fail = fail_json_schema
        completions = types.SimpleNamespace(create=self._create)
        self.chat = types.SimpleNamespace(completions=completions)

    def _create(self, **kw):
        self.calls.append(kw)
        if self._fail and kw["response_format"]["type"] == "json_schema":
            raise RuntimeError("response_format json_schema not supported")
        payload = {"verdicts": [{"key": "k", "verdict": "review",
                                 "reason": "r"}]}
        return types.SimpleNamespace(
            choices=[types.SimpleNamespace(
                message=types.SimpleNamespace(content=json.dumps(payload)))],
            usage=types.SimpleNamespace(prompt_tokens=7, completion_tokens=3))


def _openai_cfg():
    cfgmod.update_config({"ai": {"provider": "openai", "api_key": "sk-x",
                                 "model": "gpt-4.1-mini"}})
    return cfgmod.load_config()


def test_ai_call_openai_json_schema(monkeypatch):
    fake = FakeOpenAI()
    monkeypatch.setattr(aihelper, "_openai_client", lambda cfg: fake)
    data, tin, tout = aihelper._ai_call(
        _openai_cfg(), "gpt-4.1-mini", "sys", {"groups": []},
        aihelper.AI_SCHEMA)
    assert data["verdicts"][0]["verdict"] == "review"
    assert (tin, tout) == (7, 3)
    assert len(fake.calls) == 1
    assert fake.calls[0]["response_format"]["type"] == "json_schema"


def test_ai_call_openai_fallback_json_object(monkeypatch):
    fake = FakeOpenAI(fail_json_schema=True)
    monkeypatch.setattr(aihelper, "_openai_client", lambda cfg: fake)
    data, tin, tout = aihelper._ai_call(
        _openai_cfg(), "gpt-4.1-mini", "sys", {"groups": []},
        aihelper.AI_SCHEMA)
    assert data["verdicts"]
    assert len(fake.calls) == 2
    assert fake.calls[1]["response_format"] == {"type": "json_object"}
    # the schema moved into the system prompt for the fallback
    assert "schema" in fake.calls[1]["messages"][0]["content"]


def test_ollama_needs_no_api_key(bridge, monkeypatch):
    cfgmod.update_config({"ai": {"provider": "ollama", "model": "llama3"}})
    cfg = cfgmod.load_config()
    cfg["ai"]["api_key"] = ""     # explicitly no key
    assert cfgmod.ai_available(cfg["ai"]) is True
    masked = cfgmod.masked_config(cfg)
    assert masked["ai"]["available"] is True
    # openai provider without key stays unavailable
    cfg["ai"]["provider"] = "openai"
    assert cfgmod.ai_available(cfg["ai"]) is False


def test_cancel_endpoint():
    assert client.post("/api/cancel",
                       json={"target": "scan"}).json() == {"ok": True}
    assert mailops.cancel_requested("scan") is True
