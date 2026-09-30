"""Native login: password mode, OIDC mode, sessions, and the default
(mode none) staying completely open for reverse-proxy setups."""

import time

from fastapi.testclient import TestClient

from backend import auth as authmod
from backend import config as cfgmod
from backend.main import app

client = TestClient(app)


def test_mode_none_is_open_by_default():
    assert client.get("/api/state").status_code == 200
    probe = client.get("/api/auth").json()
    assert probe == {"mode": "none", "authed": True,
                     "sub": "", "is_admin": True}


def test_password_hashing_roundtrip():
    h = authmod.hash_password("hunter2")
    assert h.startswith("scrypt$") and "hunter2" not in h
    assert authmod.verify_password("hunter2", h)
    assert not authmod.verify_password("HUNTER2", h)
    assert not authmod.verify_password("hunter2", "garbage")


def test_sessions_expire_and_reject_tampering():
    tok = authmod.make_session("me@x")
    assert authmod.verify_session(tok) == "me@x"
    assert authmod.verify_session(tok + "x") is None
    old = authmod.make_session("me@x", now=time.time()
                               - authmod.SESSION_MAX_AGE - 10)
    assert authmod.verify_session(old) is None


def test_password_mode_locks_the_api():
    # enabling password mode without a password is refused
    r = client.post("/api/config", json={"auth": {"mode": "password"}})
    assert r.status_code == 400
    r = client.post("/api/config", json={
        "auth": {"mode": "password", "password": "s3cret"}})
    assert r.status_code == 200
    masked = r.json()["auth"]
    assert masked["mode"] == "password" and masked["password_set"]
    assert "password_hash" not in masked

    c = TestClient(app)                       # fresh cookies
    assert c.get("/api/state").status_code == 401
    # login screen probes stay public
    assert c.get("/api/auth").json() == {"mode": "password", "authed": False}
    # SPA bundle stays public (it renders the login screen)
    assert c.get("/").status_code == 200

    assert c.post("/api/login", json={"password": "wrong"}).status_code == 401
    r = c.post("/api/login", json={"password": "s3cret"})
    assert r.status_code == 200 and "pmc_session" in r.cookies
    assert c.get("/api/state").status_code == 200
    assert c.get("/api/auth").json()["authed"] is True

    c.post("/api/logout")
    assert c.get("/api/state").status_code == 401


def test_oidc_mode_flow(monkeypatch):
    r = client.post("/api/config", json={"auth": {"mode": "oidc"}})
    assert r.status_code == 400               # issuer/client missing
    r = client.post("/api/config", json={"auth": {
        "mode": "oidc",
        "oidc": {"issuer": "https://idp.example", "client_id": "mailbroom",
                 "client_secret": "sst", "allowed": ["Me@Corp.example"]}}})
    assert r.status_code == 200
    masked = r.json()["auth"]["oidc"]
    assert masked["client_secret_set"] and "client_secret" not in masked
    assert masked["allowed"] == ["me@corp.example"]

    monkeypatch.setattr(authmod, "discovery", lambda issuer: {
        "authorization_endpoint": "https://idp.example/authorize",
        "token_endpoint": "https://idp.example/token",
        "userinfo_endpoint": "https://idp.example/userinfo"})

    c = TestClient(app)
    assert c.get("/api/state").status_code == 401
    r = c.get("/api/oidc/login", follow_redirects=False)
    assert r.status_code == 307 or r.status_code == 302
    loc = r.headers["location"]
    assert loc.startswith("https://idp.example/authorize?")
    assert "client_id=mailbroom" in loc and "state=" in loc
    # PKCE: challenge in the authorize URL, verifier in an HttpOnly cookie
    # (providers like Pocket ID reject requests without code_challenge).
    assert "code_challenge_method=S256" in loc
    challenge = loc.split("code_challenge=")[1].split("&")[0]
    verifier = r.cookies.get("pmc_oidc_pkce")
    assert verifier and authmod.code_challenge(verifier) == challenge
    state = loc.split("state=")[1].split("&")[0]

    # tampered/expired state is rejected
    assert c.get("/api/oidc/callback?code=abc&state=bad").status_code == 400

    # an IdP error redirect surfaces the IdP's reason, not "bad state"
    r = c.get("/api/oidc/callback?error=invalid_request"
              "&error_description=This+client+requires+PKCE&state=x")
    assert r.status_code == 502 and "requires PKCE" in r.json()["detail"]

    # a user NOT on the allow-list is rejected
    monkeypatch.setattr(authmod, "exchange_code",
                        lambda cfg, redirect, code, verifier="":
                        {"email": "evil@other.example", "sub": "e1"})
    import urllib.parse
    q = urllib.parse.quote(state)
    assert c.get(f"/api/oidc/callback?code=abc&state={q}").status_code == 403

    # allowed user gets a session and lands on /; the token exchange
    # receives the SAME verifier the login leg set
    seen = {}

    def fake_exchange(cfg, redirect, code, verifier=""):
        seen["verifier"] = verifier
        return {"email": "me@corp.example", "sub": "u1"}

    monkeypatch.setattr(authmod, "exchange_code", fake_exchange)
    r = c.get(f"/api/oidc/callback?code=abc&state={q}",
              follow_redirects=False)
    assert r.status_code in (302, 307) and r.headers["location"] == "/"
    assert seen["verifier"] == verifier
    assert "pmc_session" in r.cookies
    assert c.get("/api/state").status_code == 200


def test_allowed_subject_rules():
    assert authmod.allowed_subject({"email": "A@B.c"}, []) == "a@b.c"
    assert authmod.allowed_subject({"sub": "u1"}, []) == "u1"
    assert authmod.allowed_subject({}, []) is None
    assert authmod.allowed_subject({"email": "a@b.c"}, ["x@y.z"]) is None
    assert authmod.allowed_subject({"email": "a@b.c", "sub": "u1"},
                                   ["u1"]) == "a@b.c"


def test_auth_secrets_never_exported():
    cfgmod.update_config({"auth": {"mode": "password", "password": "pw",
                                   "oidc": {"client_secret": "sst"}}})
    text = client.get("/api/export_config").text
    assert "password_hash" not in text and "scrypt" not in text
    assert "sst" not in text


def test_every_api_route_is_locked_without_a_session():
    """The guarantee behind the login screen: with auth enabled, EVERY
    /api route except the login machinery answers 401 (no data, no
    actions) until a session exists. Walks the live route table so a
    future endpoint can't be forgotten."""
    from backend.main import _PUBLIC_API
    cfgmod.update_config({"auth": {"mode": "password", "password": "pw"}})
    c = TestClient(app)
    checked = []
    for route in app.routes:
        path = getattr(route, "path", "")
        if not path.startswith("/api/") or path in _PUBLIC_API:
            continue
        for method in (getattr(route, "methods", None) or {"GET"}) \
                - {"HEAD", "OPTIONS"}:
            url = path.replace("{rule_id}", "deadbeef")
            r = c.request(method, url,
                          json={} if method in ("POST", "PUT") else None)
            assert r.status_code == 401, f"{method} {path}: {r.status_code}"
            assert r.json() == {"detail": "login required"}
            checked.append(f"{method} {path}")
    assert len(checked) >= 25, checked

    # the public probe leaks nothing but the mode
    assert set(c.get("/api/auth").json()) == {"mode", "authed"}
    # the update-check probe stays reachable too - no session leaked either
    assert c.get("/api/version").status_code == 200
    # ... and the SSE stream is locked too (it is in the route walk, but
    # make the flagship data stream explicit)
    assert c.get("/api/events").status_code == 401


def test_env_bootstrap_password_mode(monkeypatch):
    import importlib
    monkeypatch.setenv("AUTH_MODE", "password")
    monkeypatch.setenv("AUTH_PASSWORD", "envpw")
    import backend.config as cfg2
    importlib.reload(cfg2)
    try:
        loaded = cfg2.load_config()
        assert loaded["auth"]["mode"] == "password"
        assert authmod.verify_password("envpw",
                                       loaded["auth"]["password_hash"])
        # missing prerequisites fall back to none
        monkeypatch.setenv("AUTH_MODE", "oidc")   # no issuer/client set
        importlib.reload(cfg2)
        assert cfg2.load_config()["auth"]["mode"] == "none"
    finally:
        monkeypatch.delenv("AUTH_MODE")
        monkeypatch.delenv("AUTH_PASSWORD")
        importlib.reload(cfg2)
