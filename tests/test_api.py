"""API-level tests via FastAPI's TestClient (no server, no network)."""

import pytest
from fastapi.testclient import TestClient

from backend import config as cfgmod
from backend import mailops
from backend.main import app

from conftest import wait_delete_done

client = TestClient(app)


def test_state_shape():
    st = client.get("/api/state").json()
    assert st["status"] == "idle"
    assert set(st["groups"]) == {"sender", "domain", "subject", "thread"}
    assert "undo" in st and "trash_count" in st


def test_config_never_leaks_secrets():
    client.post("/api/config", json={
        "imap": {"user": "a@b.c", "password": "s3cret"},
        "ai": {"api_key": "sk-secret"}})
    body = client.get("/api/config").text
    assert "s3cret" not in body and "sk-secret" not in body
    cfg = client.get("/api/config").json()
    default = cfg["default_account"]
    assert cfg["accounts"][default]["password_set"]
    assert cfg["ai"]["api_key_set"]


def test_validation_errors():
    assert client.post("/api/delete", json={
        "grouping": "nope", "keys": ["x"]}).status_code == 400
    assert client.post("/api/delete", json={
        "grouping": "sender", "keys": []}).status_code == 422
    assert client.post("/api/ai", json={
        "grouping": "sender"}).status_code == 400      # no API key
    assert client.post("/api/cancel", json={
        "target": "everything"}).status_code == 400
    assert client.post("/api/undo", json={}).status_code == 409  # empty log


def test_spa_fallback_is_contained():
    # Regular fetches serve the bundle / index fallback.
    assert b"placeholder index" in client.get("/").content
    assert b"placeholder index" in client.get("/some/spa/route").content
    # Traversal and absolute paths must never escape the static dir.
    for path in ["/../backend/config.py", "/..%2f..%2fetc%2fpasswd",
                 "//etc/passwd", "/%2e%2e/backend/main.py"]:
        r = client.get(path)
        assert r.status_code == 200
        assert b"placeholder index" in r.content, path


def test_spa_index_is_never_cached():
    # index.html references the current build's hashed /assets bundle - it
    # must always be revalidated, or an installed PWA can keep showing a
    # stale shell indefinitely (no service worker to force an update).
    assert client.get("/").headers["cache-control"] == "no-cache"


def test_version_endpoint_is_public_and_stable():
    # An already-open tab/PWA polls this (never cached itself) to detect a
    # newer build without depending on the browser ever re-fetching
    # index.html on its own.
    r = client.get("/api/version")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"
    build = r.json()["build"]
    assert build and client.get("/api/version").json()["build"] == build


def test_scan_group_delete_via_api(bridge):
    assert client.post("/api/scan", json={}).json() == {"ok": True}
    for _ in range(200):
        st = client.get("/api/state").json()
        if st["status"] != "scanning":
            break
    assert st["status"] == "done"
    assert "folders" not in next(iter(st["groups"]["sender"].values()))

    mails = client.get("/api/group", params={
        "grouping": "sender", "key": "noreply@dhl.example"}).json()
    assert len(mails) == 3

    hits = client.get("/api/search", params={"q": "sale"}).json()
    assert len(hits["mails"]) == 1 and hits["notes"] == []

    csv_text = client.get("/api/export",
                          params={"grouping": "sender"}).text
    assert "noreply@dhl.example" in csv_text
    assert csv_text.splitlines()[0].startswith("key,label,mails")

    r = client.post("/api/delete", json={
        "grouping": "sender", "keys": ["noreply@dhl.example"]})
    assert r.json()["queued"] == 3
    wait_delete_done()
    st = client.get("/api/state").json()
    assert st["delete"]["moved"] == 3
    assert len(st["undo"]) == 1

    assert client.post("/api/undo", json={}).json()["restored"] == 3
    assert client.get("/api/state").json()["notice"]["key"] == "restored"
    client.post("/api/notice/clear", json={})
    assert client.get("/api/state").json()["notice"] is None


def test_export_can_be_scoped_to_keys(bridge):
    mailops.run_scan()
    everything = client.get("/api/export", params={"grouping": "sender"}).text
    assert "noreply@dhl.example" in everything
    assert "alice@friends.example" in everything

    scoped = client.get("/api/export", params={
        "grouping": "sender", "keys": ["noreply@dhl.example"]}).text
    assert "noreply@dhl.example" in scoped
    assert "alice@friends.example" not in scoped

    # An unknown key is silently ignored (no existence oracle), not an error.
    header_only = client.get("/api/export", params={
        "grouping": "sender", "keys": ["nope@nowhere.example"]}).text
    assert header_only.splitlines() == [everything.splitlines()[0]]


def test_post_ai_threads_keys_through_to_start_group_review(bridge, monkeypatch):
    from backend import aihelper
    mailops.run_scan()
    captured = {}
    monkeypatch.setattr(aihelper, "start_group_review",
        lambda grouping, acc=None, keys=None:
            captured.update(grouping=grouping, keys=keys))

    assert client.post("/api/ai", json={"grouping": "sender",
        "keys": ["noreply@dhl.example"]}).json() == {"ok": True}
    assert captured == {"grouping": "sender", "keys": ["noreply@dhl.example"]}

    client.post("/api/ai", json={"grouping": "sender"})
    assert captured["keys"] is None   # omitted -> every unrated group
