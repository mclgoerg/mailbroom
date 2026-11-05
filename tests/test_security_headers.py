"""Anti-framing / sniffing headers on every kind of response."""

from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)

EXPECTED = {
    "x-frame-options": "DENY",
    "content-security-policy": "frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
}


def _check(r):
    for k, v in EXPECTED.items():
        assert r.headers.get(k) == v, k


def test_on_index_asset_and_api():
    r = client.get("/")
    assert r.status_code == 200
    _check(r)
    r = client.get("/assets/.gitkeep")
    assert r.status_code == 200
    _check(r)
    r = client.get("/api/auth")
    assert r.headers["content-type"].startswith("application/json")
    _check(r)


def test_on_401():
    client.post("/api/config", json={
        "auth": {"mode": "password", "password": "s3cret"}})
    c = TestClient(app)
    r = c.get("/api/state")
    assert r.status_code == 401
    _check(r)


def test_on_403(monkeypatch):
    from backend import config as cfgmod
    monkeypatch.setattr(cfgmod, "is_admin", lambda: False)
    r = client.get("/api/admin/stats")
    assert r.status_code == 403
    _check(r)
