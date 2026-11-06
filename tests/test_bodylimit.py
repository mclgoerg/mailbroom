"""The request body cap (backend/bodylimit.py): a body over the limit is
answered 413 before the endpoint reads it - by Content-Length, or by
counting the bytes of a chunked body."""

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from backend import auth as authmod
from backend import bodylimit
from backend import config as cfgmod
from backend import demo, mailops
from backend.main import app

client = TestClient(app)


@pytest.fixture
def password_mode(monkeypatch):
    cfgmod.update_config({"auth": {"mode": "password", "password": "right"}})
    calls = []
    real = authmod.login_throttle.attempt
    monkeypatch.setattr(authmod.login_throttle, "attempt",
                        lambda peer: calls.append(peer) or real(peer))
    return calls


def _chunks(total, size=4096):
    for _ in range(total // size):
        yield b"x" * size


def test_code_matches_the_mailops_constant():
    assert bodylimit.TOO_LARGE == mailops.REQUEST_TOO_LARGE


def test_oversized_login_by_content_length_never_reaches_the_handler(
        password_mode):
    big = json.dumps({"password": "x" * (bodylimit.LIMIT_PUBLIC + 1)})
    r = client.post("/api/login", content=big,
                    headers={"Content-Type": "application/json"})
    assert r.status_code == 413
    assert r.json()["detail"] == mailops.REQUEST_TOO_LARGE
    assert password_mode == []                  # the throttle never ran
    assert r.headers["x-content-type-options"] == "nosniff"


def test_oversized_chunked_login_stops_reading_and_413s(password_mode):
    r = client.post("/api/login", content=_chunks(256 * 1024),
                    headers={"Content-Type": "application/json"})
    assert r.status_code == 413
    assert r.json()["detail"] == mailops.REQUEST_TOO_LARGE
    assert password_mode == []


def test_normal_login_still_works(password_mode):
    assert client.post("/api/login",
                       json={"password": "wrong"}).status_code == 401
    assert client.post("/api/login",
                       json={"password": "right"}).status_code == 200
    assert len(password_mode) == 2


def test_other_writes_have_the_default_cap(monkeypatch):
    monkeypatch.setattr(bodylimit, "LIMIT_DEFAULT", 10_000)
    ok = client.post("/api/presets", json={"name": "a", "query": "x"})
    assert ok.status_code != 413
    r = client.post("/api/presets",
                    json={"name": "a", "query": "x" * 20_000})
    assert r.status_code == 413
    r = client.post("/api/presets", content=_chunks(20_480),
                    headers={"Content-Type": "application/json"})
    assert r.status_code == 413


def test_reads_are_not_limited(monkeypatch):
    monkeypatch.setattr(bodylimit, "LIMIT_DEFAULT", 1)
    assert client.get("/api/version").status_code == 200


def test_import_has_its_own_larger_limit(monkeypatch):
    monkeypatch.setattr(bodylimit, "LIMIT_DEFAULT", 10_000)
    monkeypatch.setattr(bodylimit, "LIMIT_IMPORT", 200_000)

    def backup(n):
        # exactly n bytes of JSON
        base = len(json.dumps({"rules": [], "pad": ""}))
        return json.dumps({"rules": [], "pad": "x" * (n - base)}).encode()

    hdr = {"Content-Type": "application/json"}
    at = backup(200_000)
    assert len(at) == 200_000
    assert client.post("/api/import_config", content=at,
                       headers=hdr).status_code == 200
    r = client.post("/api/import_config", content=backup(200_001),
                    headers=hdr)
    assert r.status_code == 413
    assert r.json()["detail"] == mailops.REQUEST_TOO_LARGE
    r = client.post("/api/import_config", content=_chunks(204_800),
                    headers=hdr)
    assert r.status_code == 413


def test_real_limits_leave_headroom_for_a_big_backup():
    assert bodylimit.LIMIT_PUBLIC >= 4 * 1024
    assert bodylimit.LIMIT_DEFAULT >= 1024 * 1024
    assert bodylimit.LIMIT_IMPORT >= 32 * 1024 * 1024
    public = frozenset({"/api/login"})
    assert bodylimit.limit_for("/api/login/", public) == bodylimit.LIMIT_PUBLIC
    assert bodylimit.limit_for("/api/import_config", public) \
        == bodylimit.LIMIT_IMPORT


def test_the_demo_bridge_goes_through_the_same_stack(monkeypatch):
    monkeypatch.setattr(bodylimit, "LIMIT_DEFAULT", 1000)
    out = asyncio.run(demo.request(
        "POST", "/api/presets", body={"name": "a", "query": "x" * 2000}))
    assert out["status"] == 413
    assert json.loads(out["body"])["detail"] == mailops.REQUEST_TOO_LARGE
