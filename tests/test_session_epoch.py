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


def test_sign_out_all_is_admin_only_and_locked_without_a_session(monkeypatch):
    _password_mode()
    assert TestClient(app).post("/api/auth/sign_out_all").status_code == 401
    a = _login()
    other = _login()
    monkeypatch.setattr(cfgmod, "is_admin", lambda: False)
    assert a.post("/api/auth/sign_out_all").status_code == 403
    assert other.get("/api/state").status_code == 200


def test_logout_is_stateless():
    _password_mode()
    a = _login()
    other = _login()
    assert a.post("/api/logout").status_code == 200
    assert other.get("/api/state").status_code == 200
