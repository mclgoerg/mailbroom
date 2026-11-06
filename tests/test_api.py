"""API-level tests via FastAPI's TestClient (no server, no network)."""

import time

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
    assert set(st["groups"]) == {"sender", "smart", "domain", "subject",
                                 "thread"}
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


def test_unknown_api_paths_answer_404_json():
    for path in ["/api/nope", "/api/state/extra/nope", "/api/", "/api"]:
        r = client.get(path)
        assert r.status_code == 404, path
        assert r.headers["content-type"].startswith("application/json")
        assert r.json() == {"detail": "not found"}
    # Real endpoints and SPA routes that merely start with "api" still work.
    assert client.get("/api/version").status_code == 200
    r = client.get("/apiary")
    assert r.status_code == 200 and b"placeholder index" in r.content


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
    seq1 = st["delete"]["seq"]
    assert seq1 >= int(time.time()) - 3600   # clock-seeded, survives restarts

    # Every new job gets a new sequence number (the UI uses it to tell a
    # finished job from a stale tick of the previous one, even when the
    # counts are equal); undo is not a delete job.
    assert client.post("/api/undo", json={}).json()["restored"] == 3
    assert client.get("/api/state").json()["delete"]["seq"] == seq1
    client.post("/api/delete", json={
        "grouping": "sender", "keys": ["noreply@dhl.example"]})
    wait_delete_done()
    st = client.get("/api/state").json()
    assert st["delete"]["moved"] == 3 and st["delete"]["seq"] == seq1 + 1

    assert client.post("/api/undo", json={}).json()["restored"] == 3
    assert client.get("/api/state").json()["notice"]["key"] == "restored"
    # a scoped clear leaves a notice of another key alone
    client.post("/api/notice/clear", json={"keys": ["emptied_trash"]})
    assert client.get("/api/state").json()["notice"]["key"] == "restored"
    client.post("/api/notice/clear", json={"keys": ["restored"]})
    assert client.get("/api/state").json()["notice"] is None
    mailops.STATE["notice"] = {"key": "emptied_trash", "params": {}}
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
        lambda grouping, acc=None, keys=None, rerate=False:
            captured.update(grouping=grouping, keys=keys, rerate=rerate))

    assert client.post("/api/ai", json={"grouping": "sender",
        "keys": ["noreply@dhl.example"]}).json() == {"ok": True}
    assert captured == {"grouping": "sender", "keys": ["noreply@dhl.example"],
                        "rerate": False}

    client.post("/api/ai", json={"grouping": "sender", "rerate": True,
                                 "keys": ["noreply@dhl.example"]})
    assert captured["rerate"] is True

    client.post("/api/ai", json={"grouping": "sender"})
    assert captured["keys"] is None   # omitted -> every unrated group


def _access_record(client_addr, method, path):
    import logging
    return logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 0,
        '%s - "%s %s HTTP/%s" %d',
        (client_addr, method, path, "1.1", 200), None)


def test_healthcheck_access_lines_are_dropped_only():
    import logging
    log = logging.getLogger("uvicorn.access")

    def kept(*a):
        return all(f.filter(_access_record(*a)) for f in log.filters)

    # The container's own probe is silent ...
    assert not kept("127.0.0.1:41234", "GET", "/api/auth")
    assert not kept("::1:41234", "GET", "/api/auth")
    # ... but the same path from a real client, other paths and other
    # methods are still logged.
    assert kept("192.0.2.7:5555", "GET", "/api/auth")
    assert kept("127.0.0.1:41234", "GET", "/api/state")
    assert kept("127.0.0.1:41234", "POST", "/api/auth")


def test_openapi_version_is_the_release_version():
    from pathlib import Path
    from backend.main import app
    want = (Path(__file__).resolve().parent.parent
            / "version.txt").read_text().strip()
    assert want and app.version == want
    assert app.openapi()["info"]["version"] == want
