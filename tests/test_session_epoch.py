"""Session epoch: every token carries a server-side epoch that is renewed
whenever the login configuration changes (or on "sign out all")."""

import pytest
from fastapi.testclient import TestClient

from backend import auth as authmod
from backend import config as cfgmod
from backend.main import app

OIDC = {"issuer": "https://idp.example", "client_id": "app",
        "client_secret": "sst", "allowed": ["me@corp.example"]}


def _password_mode(pw="s3cret"):
    cfgmod.update_config({"auth": {"mode": "password", "password": pw}})


def _login(pw="s3cret"):
    c = TestClient(app)
    assert c.post("/api/login", json={"password": pw}).status_code == 200
    return c


def _cookie_client(token):
    c = TestClient(app)
    c.cookies.set("pmc_session", token)
    return c


def _ok(token):
    return _cookie_client(token).get("/api/state").status_code == 200


def test_token_format_and_epoch_persisted():
    tok = authmod.make_session("me@x")
    assert len(tok.split(".")) == 4
    assert authmod.verify_session(tok) == "me@x"
    assert authmod._epoch_path().read_text() == authmod.current_epoch()
    assert authmod.current_epoch() == authmod.current_epoch()
    renewed = authmod.renew_epoch()
    assert renewed == authmod.current_epoch()
    assert authmod.verify_session(tok) is None


def test_old_three_part_token_is_refused_once():
    import base64
    import time
    sub64 = base64.urlsafe_b64encode(b"me@x").decode().rstrip("=")
    body = f"{int(time.time()) + 100}.{sub64}"
    assert authmod.verify_session(f"{body}.{authmod._sign(body.encode())}") \
        is None


def test_new_token_fails_cleanly_in_the_previous_parser():
    """Rollback: the older verify_session unpacks exactly three parts."""
    tok = authmod.make_session("me@x")
    with pytest.raises(ValueError):
        exp_s, sub64, sig = tok.split(".")        # noqa: F841


def test_password_change_signs_everyone_out_but_the_caller():
    _password_mode()
    a = _login()
    other = _login()
    r = a.post("/api/config", json={"auth": {"password": "n3w"}})
    assert r.status_code == 200
    assert a.get("/api/state").status_code == 200      # fresh cookie kept
    assert other.get("/api/state").status_code == 401
    assert _login("n3w").get("/api/state").status_code == 200


def test_resaving_unchanged_login_settings_keeps_sessions():
    _password_mode()
    a = _login()
    other = _login()
    r = a.post("/api/config", json={"auth": {
        "mode": "password", "admin": "", "oidc": {"allowed": []}}})
    assert r.status_code == 200
    assert other.get("/api/state").status_code == 200


def test_mode_change_refuses_the_old_session():
    _password_mode()
    a = _login()
    cfgmod.update_config({"auth": {"mode": "none"}})
    cfgmod.update_config({"auth": {"mode": "password"}})
    assert a.get("/api/state").status_code == 401


def test_sso_session_is_not_accepted_after_switching_to_password():
    cfgmod.update_config({"auth": {"mode": "oidc", "oidc": OIDC}})
    sso = authmod.make_session("me@corp.example")
    assert _ok(sso)
    cfgmod.update_config({"auth": {"mode": "password", "password": "pw"}})
    assert not _ok(sso)


def test_allow_list_and_admin_edits_sign_everyone_out():
    cfgmod.update_config({"auth": {"mode": "oidc", "admin": "me@corp.example",
                                   "oidc": OIDC}})
    tok = authmod.make_session("me@corp.example")
    assert _ok(tok)
    cfgmod.update_config({"auth": {"oidc": {"allowed": ["me@corp.example",
                                                        "b@corp.example"]}}})
    assert not _ok(tok)
    tok = authmod.make_session("me@corp.example")
    assert _ok(tok)
    cfgmod.update_config({"auth": {"admin": "b@corp.example"}})
    assert not _ok(tok)
    tok = authmod.make_session("me@corp.example")
    cfgmod.update_config({"auth": {"admin": "b@corp.example",
                                   "oidc": {"allowed": [
                                       "me@corp.example",
                                       "b@corp.example"]}}})
    assert _ok(tok)                                    # nothing changed


def test_sign_out_all():
    _password_mode()
    a = _login()
    other = _login()
    assert a.post("/api/auth/sign_out_all").json() == {"ok": True}
    assert a.get("/api/state").status_code == 200
    assert other.get("/api/state").status_code == 401


def test_sign_out_all_is_admin_only_and_locked_without_a_session():
    cfgmod.update_config({"auth": {"mode": "oidc", "admin": "me@corp.example",
                                   "oidc": {**OIDC, "allowed": [
                                       "me@corp.example",
                                       "user@corp.example"]}}})
    assert TestClient(app).post("/api/auth/sign_out_all").status_code == 401
    admin = authmod.make_session("me@corp.example")
    user = authmod.make_session("user@corp.example")
    r = _cookie_client(user).post("/api/auth/sign_out_all")
    assert r.status_code == 403                        # a real tenant, not admin
    assert _ok(admin) and _ok(user)
    assert _cookie_client(admin).post("/api/auth/sign_out_all").status_code \
        == 200
    assert not _ok(user)


def test_only_the_request_that_caused_the_renewal_gets_a_cookie(monkeypatch):
    """A signed-in user's harmless save that overlaps someone else's
    password change must not be handed a fresh cookie."""
    _password_mode()
    a = _login()
    real = cfgmod.update_config

    def overlapping(body):
        authmod.renew_epoch()                          # someone else, meanwhile
        return real(body)

    monkeypatch.setattr(cfgmod, "update_config", overlapping)
    r = a.post("/api/config", json={"smart_min": 3})
    assert r.status_code == 200
    assert "set-cookie" not in r.headers
    assert a.get("/api/state").status_code == 401


def test_oidc_issuer_and_client_changes_sign_everyone_out():
    cfgmod.update_config({"auth": {"mode": "oidc", "admin": "me@corp.example",
                                   "oidc": OIDC}})
    tok = authmod.make_session("me@corp.example")
    cfgmod.update_config({"auth": {"oidc": {"issuer": "https://idp2.example"}}})
    assert not _ok(tok)
    tok = authmod.make_session("me@corp.example")
    cfgmod.update_config({"auth": {"oidc": {"client_id": "other"}}})
    assert not _ok(tok)


def _env_login(monkeypatch, password):
    monkeypatch.setenv("AUTH_MODE", "password")
    monkeypatch.setenv("AUTH_PASSWORD", password)
    monkeypatch.setattr(cfgmod, "_ENV_AUTH_CACHE", None)


def test_rotating_the_env_password_ends_old_sessions_at_startup(monkeypatch):
    from backend import main
    _env_login(monkeypatch, "first")
    main._sync_session_epoch()                         # first start: records
    c = _login("first")
    assert c.get("/api/state").status_code == 200
    # restart with the same settings: sessions survive (stable env hash)
    monkeypatch.setattr(cfgmod, "_ENV_AUTH_CACHE", None)
    main._sync_session_epoch()
    assert c.get("/api/state").status_code == 200
    # .env edited + restart
    _env_login(monkeypatch, "second")
    main._sync_session_epoch()
    assert c.get("/api/state").status_code == 401
    assert _login("second").get("/api/state").status_code == 200


def test_env_allow_list_change_ends_old_sessions_at_startup(monkeypatch):
    from backend import main
    monkeypatch.setenv("AUTH_MODE", "oidc")
    monkeypatch.setenv("OIDC_ISSUER", "https://idp.example")
    monkeypatch.setenv("OIDC_CLIENT_ID", "app")
    monkeypatch.setenv("OIDC_CLIENT_SECRET", "sst")
    monkeypatch.setenv("OIDC_ADMIN", "me@corp.example")
    monkeypatch.setenv("OIDC_ALLOWED", "me@corp.example,b@corp.example")
    monkeypatch.setattr(cfgmod, "_ENV_AUTH_CACHE", None)
    main._sync_session_epoch()
    tok = authmod.make_session("b@corp.example")
    assert _ok(tok)
    monkeypatch.setenv("OIDC_ALLOWED", "me@corp.example")
    monkeypatch.setattr(cfgmod, "_ENV_AUTH_CACHE", None)
    main._sync_session_epoch()
    assert not _ok(tok)


@pytest.mark.parametrize("content", [b"\xff\xfe\x00bad", b"abc.def", b"short",
                                     b"", b"G" * 16])
def test_a_damaged_epoch_file_is_replaced_not_a_500(content):
    _password_mode()
    authmod._epoch_path().write_bytes(content)
    c = TestClient(app, raise_server_exceptions=True)
    assert c.post("/api/login", json={"password": "s3cret"}).status_code == 200
    assert c.get("/api/state").status_code == 200
    assert len(authmod._epoch_path().read_text()) == 16
    assert c.post("/api/config", json={"smart_min": 3}).status_code == 200


def test_logout_is_stateless():
    _password_mode()
    a = _login()
    other = _login()
    assert a.post("/api/logout").status_code == 200
    assert other.get("/api/state").status_code == 200
