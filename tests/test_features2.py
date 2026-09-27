"""Tests for verdict caching, archive/move/mark-read, undo index, and auth."""

import json
import types

import pytest
from fastapi.testclient import TestClient

from backend import aihelper
from backend import config as cfgmod
from backend import main as mainmod
from backend import mailops
from backend import verdictstore

from conftest import wait_delete_done


def scan(bridge):
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]


# ------------------------------------------------------------ verdict cache

def _fake_client(monkeypatch, verdict="delete_safe"):
    calls = []

    def create(**kw):
        calls.append(kw)
        sent = json.loads(kw["messages"][0]["content"])
        payload = {"verdicts": [
            {"key": g["key"], "verdict": verdict, "reason": "t"}
            for g in sent["groups"]]}
        return types.SimpleNamespace(
            stop_reason="end_turn",
            content=[types.SimpleNamespace(type="text",
                                           text=json.dumps(payload))],
            usage=types.SimpleNamespace(input_tokens=10, output_tokens=5))

    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: types.SimpleNamespace(
        messages=types.SimpleNamespace(create=create)))
    return calls


def test_verdicts_persist_across_rescans(bridge, monkeypatch):
    cfgmod.update_config({"ai": {"api_key": "k"}})
    calls = _fake_client(monkeypatch)
    scan(bridge)
    aihelper._run_ai("sender")
    n_groups = len(mailops.STATE["groups"]["sender"])
    assert calls, "AI was called"

    scan(bridge)   # rescan: verdicts come from the cache
    senders = mailops.STATE["groups"]["sender"]
    assert all(r["ai"] for r in senders.values())
    assert mailops.STATE["notice"]["key"] == "cached_verdicts"
    assert mailops.STATE["notice"]["params"]["n"] == n_groups

    calls.clear()
    aihelper._run_ai("sender")   # nothing new to review
    assert calls == []
    assert mailops.STATE["notice"]["key"] == "ai_all_cached"

    # clearing the cache brings groups back into scope
    verdictstore.clear()
    mailops.clear_ai_marks()
    aihelper._run_ai("sender")
    assert sum(len(json.loads(c["messages"][0]["content"])["groups"])
               for c in calls) == n_groups


# ----------------------------------------------------------------- actions

def test_archive_action_and_undo(bridge):
    scan(bridge)
    mailops.delete_groups("sender", ["noreply@dhl.example"], action="archive")
    d = wait_delete_done()
    # 2 INBOX mails moved; the Archive one was already there (self-move skip)
    assert d["moved"] == 2, d
    assert len(bridge.mailbox["Archive"]) == 3
    # The mail that already lived in Archive stays known: group shrinks to 1.
    dhl = mailops.STATE["groups"]["sender"]["noreply@dhl.example"]
    assert dhl["count"] == 1
    assert mailops.STATE["undo"][-1]["action"] == "archive"

    r = mailops.undo_last()
    assert r["restored"] == 2
    assert len(bridge.mailbox["INBOX"]) == 4


def test_move_action_validates_folder(bridge):
    scan(bridge)
    mailops.delete_groups("sender", ["alice@friends.example"],
                          action="move", dest="Spam")
    d = wait_delete_done()
    assert d["moved"] == 1
    assert bridge.mailbox["Spam"][0]["uid"] == 3

    with pytest.raises(ValueError):
        mailops.delete_groups("sender", ["news@shop.example"], action="move")
    mailops.delete_groups("sender", ["news@shop.example"],
                          action="move", dest="Nope")
    d = wait_delete_done()
    assert "unknown target folder" in d["error"]


def test_mark_read(bridge):
    scan(bridge)
    dhl = mailops.STATE["groups"]["sender"]["noreply@dhl.example"]
    assert dhl["unread"] == 1
    mailops.delete_groups("sender", ["noreply@dhl.example"],
                          action="mark_read")
    d = wait_delete_done()
    assert d["moved"] == 3 and not d["error"]
    dhl = mailops.STATE["groups"]["sender"]["noreply@dhl.example"]
    assert dhl["count"] == 3          # nothing deleted
    assert dhl["unread"] == 0
    assert mailops.STATE["groups"]["domain"]["dhl.example"]["unread"] == 0
    assert all(m["seen"] for m in bridge.mailbox["INBOX"]
               if m["uid"] in (1, 2))
    assert mailops.STATE["undo"] == []   # mark-read is not undoable


def test_undo_by_index(bridge):
    scan(bridge)
    mailops.delete_messages([["INBOX", 1]])
    wait_delete_done()
    mailops.delete_messages([["INBOX", 3]])
    wait_delete_done()
    assert len(mailops.STATE["undo"]) == 2
    r = mailops.undo_last(0)              # undo the FIRST job (uid 1)
    assert r["restored"] == 1
    assert any(m["uid"] == 1 for m in bridge.mailbox["INBOX"])
    assert any(m["uid"] == 3 for m in bridge.mailbox["Trash"])
    assert len(mailops.STATE["undo"]) == 1


# -------------------------------------------------------------------- auth

def test_auth_token_middleware(monkeypatch):
    monkeypatch.setattr(mainmod, "AUTH_TOKEN", "s3same")
    client = TestClient(mainmod.app)

    assert client.get("/api/state").status_code == 401
    assert client.get("/").status_code == 401

    ok = client.get("/api/state",
                    headers={"Authorization": "Bearer s3same"})
    assert ok.status_code == 200
    assert client.get("/api/state",
                      headers={"Authorization": "Bearer wrong"}
                      ).status_code == 401

    # Query token sets the cookie and redirects; cookie then works.
    r = client.get("/?token=s3same", follow_redirects=False)
    assert r.status_code in (302, 307)
    assert "pmc_token" in r.headers.get("set-cookie", "")
    client.cookies.set("pmc_token", "s3same")
    assert client.get("/api/state").status_code == 200

    monkeypatch.setattr(mainmod, "AUTH_TOKEN", "")
    assert TestClient(mainmod.app).get("/api/state").status_code == 200
