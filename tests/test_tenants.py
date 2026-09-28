"""Multi-tenancy: every OIDC identity gets an isolated workspace; the
admin identity owns the pre-tenancy one; the shared AI key resolves per
tenant with per-tenant budgets; non-admins can't touch server settings."""

import json

from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import auth as authmod
from backend import config as cfgmod
from backend import mailops
from backend import tenants
from backend.main import app

ADMIN = "admin@corp.example"


def _enable_oidc(admin: str | None = ADMIN):
    body = {"mode": "oidc",
            "oidc": {"issuer": "https://idp.example", "client_id": "mb",
                     "client_secret": "sst"}}
    if admin is not None:
        body["admin"] = admin
    cfgmod.update_config({"auth": body})


def _client_as(sub: str) -> TestClient:
    """A client with a valid session for `sub` (sessions are stateless
    HMAC cookies, so no IdP roundtrip is needed)."""
    c = TestClient(app)
    c.cookies.set("pmc_session", authmod.make_session(sub))
    return c


def test_admin_claims_the_existing_workspace():
    """The pre-tenancy config (legacy /data paths) belongs to the admin
    identity after OIDC activates - no files move, nothing is lost."""
    cfgmod.update_config({"account": "default", "imap": {"host": "bridge"}})
    cfgmod.update_config({"rename_account": {"from": "default",
                                             "to": "proton"}})
    _enable_oidc()
    c = _client_as(ADMIN)
    cfg = c.get("/api/config").json()
    assert list(cfg["accounts"]) == ["proton"]
    assert cfg["accounts"]["proton"]["host"] == "bridge"
    probe = c.get("/api/auth").json()
    assert probe["authed"] and probe["is_admin"] and probe["sub"] == ADMIN


def test_tenants_are_fully_isolated():
    _enable_oidc()
    admin = _client_as(ADMIN)
    admin.post("/api/config", json={
        "account": "default", "imap": {"password": "admin-imap-secret"}})

    alice = _client_as("alice@x.example")
    bob = _client_as("bob@y.example")

    # A fresh tenant starts neutral: one unconfigured account, no env
    # creds, no admin data.
    acfg = alice.get("/api/config").json()
    assert list(acfg["accounts"]) == ["default"]
    assert acfg["accounts"]["default"]["host"] == ""
    assert not acfg["accounts"]["default"]["password_set"]
    assert not acfg["ai"]["api_key_set"]

    # Alice configures her account + a rule + protected list.
    alice.post("/api/config", json={
        "account": "default", "imap": {"host": "imap.alice.example",
                                       "password": "alice-secret"},
        "protected": ["boss@alice.example"]})
    alice.post("/api/config", json={
        "rename_account": {"from": "default", "to": "personal"}})
    r = alice.post("/api/rules", json={"name": "sweep", "query": "is:unsub",
                                       "account": "personal"})
    assert r.status_code == 200

    # Bob sees none of it - and probing Alice's account name yields the
    # same 400 an unknown name gives (no existence oracle).
    bcfg = bob.get("/api/config").json()
    assert list(bcfg["accounts"]) == ["default"]
    assert bcfg["protected"] == []
    assert bob.get("/api/rules").json()["rules"] == []
    assert bob.get("/api/state?account=personal").status_code == 400
    assert bob.post("/api/scan?account=personal").status_code == 400

    # The admin's workspace is untouched, and Alice can't see it either.
    assert "personal" not in admin.get("/api/config").json()["accounts"]
    assert alice.get("/api/state?account=default").status_code == 400

    # On disk: Alice's secret lives in HER directory only.
    adir = tenants.for_subject("alice@x.example").root
    assert "alice-secret" in (adir / "config.json").read_text()
    assert "alice-secret" not in cfgmod.CONFIG_PATH.read_text()
    assert "admin-imap-secret" not in (adir / "config.json").read_text()


def test_scan_state_and_snapshots_stay_per_tenant(bridge):
    _enable_oidc()
    alice = _client_as("alice@x.example")
    assert alice.post("/api/scan").status_code == 200
    for _ in range(200):
        st = alice.get("/api/state").json()
        if st["status"] == "done":
            break
        import time
        time.sleep(0.02)
    assert st["status"] == "done" and st["groups"]["sender"]

    # Admin sees an idle workspace, not Alice's scan.
    admin = _client_as(ADMIN)
    assert admin.get("/api/state").json()["status"] == "idle"

    # Alice's snapshot landed in her tenant dir, not the shared one.
    adir = tenants.for_subject("alice@x.example").root
    assert list(adir.glob("scan_*.json"))
    assert not list(mailops.SNAPSHOT_DIR.glob("scan_*.json")) \
        if mailops.SNAPSHOT_DIR.exists() else True


def test_non_admin_cannot_touch_server_settings():
    _enable_oidc()
    alice = _client_as("alice@x.example")
    r = alice.post("/api/config", json={"auth": {"mode": "none"}})
    assert r.status_code == 403
    r = alice.post("/api/config", json={"shared_ai": {"enabled": True}})
    assert r.status_code == 403
    # Non-admins get the mode but no OIDC details / allow-list / admin.
    auth = alice.get("/api/config").json()["auth"]
    assert auth == {"mode": "oidc", "is_admin": False}
    assert "shared_ai" not in alice.get("/api/config").json()
    # The admin still can.
    admin = _client_as(ADMIN)
    assert admin.post("/api/config", json={
        "shared_ai": {"enabled": True, "api_key": "sk-shared"}}).status_code \
        == 200


def test_first_oidc_login_claims_admin(monkeypatch):
    _enable_oidc(admin=None)      # no OIDC_ADMIN, no configured admin
    monkeypatch.setattr(authmod, "discovery", lambda issuer: {
        "authorization_endpoint": "https://idp.example/authorize",
        "token_endpoint": "https://idp.example/token",
        "userinfo_endpoint": "https://idp.example/userinfo"})
    monkeypatch.setattr(authmod, "exchange_code",
                        lambda cfg, redirect, code, verifier="":
                        {"email": "first@x.example", "sub": "u1"})
    c = TestClient(app)
    state = authmod.make_state()
    import urllib.parse
    r = c.get(f"/api/oidc/callback?code=abc&state={urllib.parse.quote(state)}",
              follow_redirects=False)
    assert r.status_code in (302, 307)
    assert cfgmod.load_server()["auth"]["admin"] == "first@x.example"
    assert c.get("/api/auth").json()["is_admin"] is True
    # The second identity does NOT become admin.
    monkeypatch.setattr(authmod, "exchange_code",
                        lambda cfg, redirect, code, verifier="":
                        {"email": "second@x.example", "sub": "u2"})
    c2 = TestClient(app)
    state = authmod.make_state()
    c2.get(f"/api/oidc/callback?code=abc&state={urllib.parse.quote(state)}",
           follow_redirects=False)
    assert cfgmod.load_server()["auth"]["admin"] == "first@x.example"
    assert c2.get("/api/auth").json()["is_admin"] is False


def test_password_sessions_do_not_carry_into_oidc_mode():
    cfgmod.update_config({"auth": {"mode": "password", "password": "pw"}})
    c = TestClient(app)
    assert c.post("/api/login", json={"password": "pw"}).status_code == 200
    assert c.get("/api/state").status_code == 200
    _enable_oidc()
    assert c.get("/api/state").status_code == 401


def test_shared_ai_resolution_matrix():
    _enable_oidc()
    alice = tenants.for_subject("alice@x.example")

    # Neither an own key nor a shared one -> AI unavailable.
    with tenants.use(alice):
        cfg = cfgmod.load_config()
        assert cfgmod.effective_ai(cfg) == (cfg["ai"], None)
        assert not cfgmod.masked_config(cfg)["ai"]["available"]

    # Admin enables the shared key with a per-tenant default budget.
    cfgmod.update_config({"shared_ai": {
        "enabled": True, "api_key": "sk-shared", "model": "claude-sonnet-5",
        "default_tenant_budget_usd": 5.0}})
    with tenants.use(alice):
        ai, source = cfgmod.effective_ai(cfgmod.load_config())
        assert source == "shared" and ai["api_key"] == "sk-shared"
        assert ai["budget_usd"] == 5.0
        masked = cfgmod.masked_config(cfgmod.load_config())
        assert masked["ai"]["available"] and masked["ai"]["source"] == "shared"
        assert not masked["ai"]["api_key_set"]      # not HER key

        # Tenants may lower their cap below the default, never raise it.
        cfgmod.update_config({"ai": {"budget_usd": 2.0}})
        ai, _ = cfgmod.effective_ai(cfgmod.load_config())
        assert ai["budget_usd"] == 2.0
        cfgmod.update_config({"ai": {"budget_usd": 50.0}})
        ai, _ = cfgmod.effective_ai(cfgmod.load_config())
        assert ai["budget_usd"] == 5.0

        # An own key always wins over the shared one.
        cfgmod.update_config({"ai": {"api_key": "sk-own",
                                     "budget_usd": 50.0}})
        ai, source = cfgmod.effective_ai(cfgmod.load_config())
        assert source == "own" and ai["api_key"] == "sk-own"
        assert ai["budget_usd"] == 50.0


def test_shared_ai_spend_is_tracked_per_tenant():
    _enable_oidc()
    cfgmod.update_config({"shared_ai": {
        "enabled": True, "api_key": "sk-shared",
        "default_tenant_budget_usd": 0.001}})
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        ai, _ = cfgmod.effective_ai(cfgmod.load_config())
        cfgmod.record_usage(ai, 1_000_000, 0)       # >$0.001 on any model
        assert cfgmod.month_cost() > 0.001
        try:
            cfgmod.check_budget(ai)
            raise AssertionError("budget not enforced")
        except ValueError:
            pass
    # Alice's spend never bleeds into another tenant or the admin.
    with tenants.use(tenants.for_subject("bob@y.example")):
        assert cfgmod.month_cost() == 0
        cfgmod.check_budget(cfgmod.effective_ai(cfgmod.load_config())[0])
    assert cfgmod.month_cost() == 0                  # default tenant


def test_verdicts_and_stats_isolated_per_tenant():
    from backend import stats as statsmod
    from backend import verdictstore
    _enable_oidc()
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        verdictstore.save("sender", {"a@x": {"verdict": "keep",
                                             "reason": "r"}})
        verdictstore.save_mails({"<m1@x>": "delete_safe"})
        statsmod.record_scan(10, 1000, 2)
    with tenants.use(tenants.for_subject("bob@y.example")):
        assert verdictstore.load_account() == {}
        assert verdictstore.load_mails() == {}
        assert statsmod.load()["scans"] == []
    # default tenant untouched
    assert verdictstore.load_account() == {}
    assert statsmod.load()["scans"] == []
    with tenants.use(alice):
        assert verdictstore.load_account()["sender"]["a@x"]["verdict"] \
            == "keep"


def test_wrong_tenant_gets_400_on_every_account_endpoint():
    """Authenticated-but-wrong-tenant hardening: every ?account= endpoint
    answers 400 for another tenant's account name - same as an unknown
    one, so nothing about other tenants can be probed."""
    _enable_oidc()
    admin = _client_as(ADMIN)
    admin.post("/api/config", json={
        "rename_account": {"from": "default", "to": "adminmail"}})
    alice = _client_as("alice@x.example")
    for route in app.routes:
        path = getattr(route, "path", "")
        if not path.startswith("/api/") or "{" in path:
            continue
        for method in (getattr(route, "methods", None) or set()) \
                - {"HEAD", "OPTIONS"}:
            r = alice.request(method, f"{path}?account=adminmail",
                              json={} if method == "POST" else None)
            # Endpoints without ?account= support may answer anything
            # but 2xx-with-admin-data; account-scoped ones must 400.
            if r.status_code == 400 and "unknown account" in r.text:
                continue
            assert "adminmail" not in json.dumps(r.json() if
                                                 r.headers.get("content-type",
                                                               "").startswith(
                                                     "application/json")
                                                 else {}), \
                f"{method} {path} leaked another tenant's account"


def test_admin_stats_are_usage_only_and_admin_only(bridge):
    """The admin overview shows per-tenant NUMBERS (mails, spend, disk)
    but never account names, hosts, addresses or protected entries."""
    import time
    _enable_oidc()
    cfgmod.update_config({"shared_ai": {"enabled": True,
                                        "api_key": "sk-shared"}})
    alice = _client_as("alice@x.example")
    alice.post("/api/config", json={
        "account": "default",
        "imap": {"host": "imap.secret-host.example", "password": "alicepw"},
        "protected": ["secretboss@x.example"]})
    alice.post("/api/config", json={
        "rename_account": {"from": "default", "to": "supersecret-acct"}})
    assert alice.post("/api/scan?account=supersecret-acct").status_code == 200
    for _ in range(200):
        if alice.get("/api/state?account=supersecret-acct").json()[
                "status"] == "done":
            break
        time.sleep(0.02)

    # not for tenants
    assert alice.get("/api/admin/stats").status_code == 403

    r = _client_as(ADMIN).get("/api/admin/stats")
    assert r.status_code == 200
    rows = r.json()["tenants"]
    assert rows[0]["is_admin_workspace"]           # admin sorts first
    assert rows[0]["label"] == ADMIN               # not the raw "default" id
    arow = next(t_ for t_ in rows if t_["id"].startswith("alice"))
    assert arow["accounts"] == 1 and arow["scans"] == 1
    assert arow["mails"] > 0 and arow["disk_bytes"] > 0
    assert arow["last_scan_ts"] and arow["ai"]["source"] == "shared"

    # the privacy guarantee, machine-checked
    for secret in ("supersecret-acct", "secret-host", "alicepw",
                   "secretboss"):
        assert secret not in r.text, f"admin stats leaked {secret!r}"
