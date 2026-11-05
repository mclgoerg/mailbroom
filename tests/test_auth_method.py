"""Per-account sign-in method (`auth`: password | oauth): derivation,
connect()/SMTP honouring it, preset enforcement, token-flow side effects,
masked_config and the test_connection credentials check."""

from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request

import pytest
from fastapi.testclient import TestClient

from backend import config as cfgmod
from backend import mailops
from backend import smtpout
from backend import unsub
from backend.main import app

client = TestClient(app)

TOKENS = {"provider": "google", "client_id": "cid", "client_secret": "sec",
          "refresh_token": "rt", "access_token": "at",
          "expires_at": time.time() + 3600}


def _im(**kw) -> dict:
    return {"host": "imap.example", "port": 993, "security": "ssl",
            "user": "me@mail.example", "password": "", "cafile": "", **kw}


class _Conn:
    """Records which sign-in path connect() took."""
    calls: list = []

    def __init__(self, host, port, ssl_context=None, timeout=None):
        _Conn.calls = []

    def authenticate(self, mechanism, authobject):
        _Conn.calls.append(("authenticate", mechanism))
        return "OK", [b""]

    def login(self, user, password):
        _Conn.calls.append(("login", password))
        return "OK", [b""]

    def shutdown(self):
        pass


class _SMTP:
    calls: list = []

    def __init__(self, host, port, timeout=None, context=None):
        _SMTP.calls = []

    def login(self, user, password):
        _SMTP.calls.append(("login", password))

    def auth(self, mechanism, authobject, initial_response_ok=True):
        _SMTP.calls.append(("auth", mechanism))

    def sendmail(self, frm, to, msg):
        pass

    def quit(self):
        pass


def _gmail(**imap) -> None:
    if "gmail" not in cfgmod.load_config()["accounts"]:
        cfgmod.update_config({"add_account": "gmail"})
    cfgmod.update_config({"account": "gmail", "imap": {
        "preset": "gmail", "host": "imap.gmail.example", **imap}})


# -------------------------------------------------------------- derivation

def test_auth_method_legacy_with_token_is_oauth():
    assert cfgmod.auth_method(_im(oauth=dict(TOKENS))) == "oauth"


def test_auth_method_legacy_without_token_is_password():
    assert cfgmod.auth_method(_im()) == "password"
    assert cfgmod.auth_method(_im(oauth={"provider": "google"})) == "password"


def test_auth_method_explicit_value_wins():
    assert cfgmod.auth_method(_im(auth="password", oauth=dict(TOKENS))) \
        == "password"
    assert cfgmod.auth_method(_im(auth="oauth")) == "oauth"


def test_auth_method_junk_value_is_derived():
    assert cfgmod.auth_method(_im(auth="kerberos", oauth=dict(TOKENS))) \
        == "oauth"
    assert cfgmod.auth_method(_im(auth="kerberos")) == "password"


def test_has_credentials_follows_the_method():
    assert cfgmod.has_credentials(_im(password="pw"))
    assert not cfgmod.has_credentials(_im())
    assert cfgmod.has_credentials(_im(oauth=dict(TOKENS)))
    # an explicit method needs ITS credential, not the other one
    assert not cfgmod.has_credentials(_im(auth="oauth", password="pw"))
    assert not cfgmod.has_credentials(
        _im(auth="password", oauth=dict(TOKENS)))


# ----------------------------------------------------------------- connect

def test_connect_password_wins_over_stored_token(monkeypatch):
    monkeypatch.setattr(mailops.imaplib, "IMAP4_SSL", _Conn)
    mailops.connect(_im(auth="password", password="apppw",
                        oauth=dict(TOKENS)))
    assert _Conn.calls == [("login", "apppw")]


def test_connect_oauth_uses_xoauth2(monkeypatch):
    monkeypatch.setattr(mailops.imaplib, "IMAP4_SSL", _Conn)
    mailops.connect(_im(auth="oauth", password="apppw",
                        oauth=dict(TOKENS)))
    assert _Conn.calls == [("authenticate", "XOAUTH2")]


def test_connect_oauth_without_token_never_falls_back_to_login(monkeypatch):
    monkeypatch.setattr(mailops.imaplib, "IMAP4_SSL", _Conn)
    with pytest.raises(RuntimeError, match="OAuth is not connected"):
        mailops.connect(_im(auth="oauth", password="apppw",
                            oauth={"provider": "google"}))
    assert _Conn.calls == []


def test_smtp_password_vs_xoauth2(monkeypatch):
    monkeypatch.setattr(smtpout.smtplib, "SMTP_SSL", _SMTP)
    base = {"host": "smtp.example", "smtp_security": "ssl",
            "user": "me@mail.example", "cafile": "", "password": "apppw",
            "oauth": dict(TOKENS)}
    unsub._send_mailto({**base, "auth": "password"},
                       "mailto:u@list.example")
    assert _SMTP.calls == [("login", "apppw")]
    unsub._send_mailto({**base, "auth": "oauth"}, "mailto:u@list.example")
    assert _SMTP.calls == [("auth", "XOAUTH2")]


def test_smtp_oauth_without_token_raises_and_never_logs_in(monkeypatch):
    monkeypatch.setattr(smtpout.smtplib, "SMTP_SSL", _SMTP)
    with pytest.raises(RuntimeError, match="OAuth is not connected"):
        smtpout.send({"host": "smtp.example", "smtp_security": "ssl",
                      "user": "me@mail.example", "cafile": "",
                      "password": "apppw", "auth": "oauth", "oauth": None},
                     "u@list.example", "s", "b")
    assert _SMTP.calls == []


# ------------------------------------------------------------------- merge

def test_merge_validates_auth():
    _gmail(auth="oauth")
    assert cfgmod.account_imap("gmail")["auth"] == "oauth"
    cfgmod.update_config({"account": "gmail", "imap": {"auth": "bogus"}})
    assert cfgmod.account_imap("gmail")["auth"] == "oauth"


def test_icloud_preset_forces_password_even_with_token():
    """Fix A: a preset without OAuth never keeps signing in via XOAUTH2."""
    _gmail(auth="oauth")
    cfgmod.save_oauth("gmail", dict(TOKENS))
    cfgmod.update_config({"account": "gmail", "imap": {
        "preset": "icloud", "auth": "oauth"}})
    im = cfgmod.account_imap("gmail")
    assert im["auth"] == "password" and cfgmod.auth_method(im) == "password"
    assert im["oauth"]["refresh_token"] == "rt"      # kept, just unused


def test_every_password_only_preset_forces_password():
    for preset in cfgmod.PASSWORD_ONLY_PRESETS:
        _gmail(auth="oauth")
        cfgmod.update_config({"account": "gmail", "imap": {
            "preset": preset, "auth": "oauth"}})
        assert cfgmod.account_imap("gmail")["auth"] == "password", preset


def test_outlook_preset_forces_oauth():
    cfgmod.update_config({"add_account": "outlook"})
    cfgmod.update_config({"account": "outlook", "imap": {
        "preset": "outlook", "auth": "password"}})
    assert cfgmod.account_imap("outlook")["auth"] == "oauth"


def test_gmail_and_custom_keep_the_sent_value():
    _gmail(auth="password")
    assert cfgmod.account_imap("gmail")["auth"] == "password"
    cfgmod.update_config({"account": "gmail", "imap": {"auth": "oauth"}})
    assert cfgmod.account_imap("gmail")["auth"] == "oauth"
    cfgmod.update_config({"account": "gmail", "imap": {
        "preset": "custom", "auth": "password"}})
    assert cfgmod.account_imap("gmail")["auth"] == "password"


def test_unrelated_update_does_not_touch_a_legacy_account():
    """No `auth` stored + no preset/auth in the update -> still derived."""
    cfgmod.update_config({"add_account": "legacy"})
    cfgmod.update_config({"account": "legacy", "imap": {
        "oauth": {"provider": "google", "client_id": "cid"}}})
    cfgmod.save_oauth("legacy", {"refresh_token": "rt"})
    cfgmod.update_config({"account": "legacy", "imap": {"smart_min": 4}})
    assert "auth" not in cfgmod.account_imap("legacy")
    assert cfgmod.auth_method(cfgmod.account_imap("legacy")) == "oauth"


def test_switching_keeps_password_and_oauth_block():
    _gmail(auth="password", password="apppw", oauth={
        "provider": "google", "client_id": "cid", "client_secret": "sec"})
    cfgmod.save_oauth("gmail", dict(TOKENS))
    for method in ("oauth", "password", "oauth"):
        cfgmod.update_config({"account": "gmail",
                              "imap": {"auth": method}})
        im = cfgmod.account_imap("gmail")
        assert im["auth"] == method
        assert im["password"] == "apppw"
        assert im["oauth"]["refresh_token"] == "rt"
        assert im["oauth"]["client_secret"] == "sec"


# --------------------------------------------------- token flows set `auth`

def _json_response(payload: dict):
    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return json.dumps(payload).encode()
    return _Resp()


def test_callback_sets_auth_oauth(monkeypatch):
    _gmail(auth="password", password="apppw", oauth={
        "provider": "google", "client_id": "cid", "client_secret": "sec"})
    login = client.get("/api/oauth/imap/login",
                       params={"account": "gmail", "provider": "google"},
                       follow_redirects=False)
    state = urllib.parse.parse_qs(
        urllib.parse.urlparse(login.headers["location"]).query)["state"][0]
    monkeypatch.setattr(
        urllib.request, "urlopen", lambda req, timeout=15:
        _json_response({"access_token": "at", "refresh_token": "rt",
                        "expires_in": 3600}))
    client.cookies.update(login.cookies)
    r = client.get("/api/oauth/imap/callback",
                   params={"code": "c", "state": state},
                   follow_redirects=False)
    assert r.status_code in (302, 307)
    im = cfgmod.account_imap("gmail")
    assert im["auth"] == "oauth" and im["password"] == "apppw"


def test_device_poll_completion_sets_auth_oauth(monkeypatch):
    from backend import oauthflow
    cfgmod.update_config({"add_account": "outlook"})
    monkeypatch.setattr(oauthflow, "MS_SHARED_CLIENT_ID", "shared-id")
    monkeypatch.setattr(
        urllib.request, "urlopen", lambda req, timeout=15:
        _json_response({"access_token": "at", "refresh_token": "rt",
                        "expires_in": 3600}))
    r = client.post("/api/oauth/imap/device/poll",
                    params={"account": "outlook", "device_code": "dc"})
    assert r.json()["status"] == "complete"
    assert cfgmod.account_imap("outlook")["auth"] == "oauth"


def test_silent_refresh_leaves_auth_alone(monkeypatch):
    monkeypatch.setattr(mailops.imaplib, "IMAP4_SSL", _Conn)
    monkeypatch.setattr(
        urllib.request, "urlopen", lambda req, timeout=15:
        _json_response({"access_token": "new-at", "expires_in": 3600}))
    _gmail(auth="oauth")
    cfgmod.save_oauth("gmail", {**TOKENS, "access_token": "old",
                                "expires_at": 0})
    mailops.connect(cfgmod.account_imap("gmail"), "gmail")   # refreshes
    im = cfgmod.account_imap("gmail")
    assert im["oauth"]["access_token"] == "new-at" and im["auth"] == "oauth"
    # even when the account was switched to App password meanwhile, a
    # refresh-style save_oauth() must not flip it back
    cfgmod.update_config({"account": "gmail", "imap": {"auth": "password"}})
    cfgmod.save_oauth("gmail", {"access_token": "newer"})
    assert cfgmod.account_imap("gmail")["auth"] == "password"


def test_disconnect_leaves_auth_alone():
    _gmail(auth="oauth")
    cfgmod.save_oauth("gmail", dict(TOKENS))
    client.post("/api/oauth/imap/disconnect", params={"account": "gmail"})
    im = cfgmod.account_imap("gmail")
    assert im["oauth"] is None and im["auth"] == "oauth"


# ------------------------------------------------------------ masked_config

def test_masked_config_exposes_auth_but_no_token():
    _gmail(auth="password", password="apppw")
    cfgmod.save_oauth("gmail", dict(TOKENS))
    masked = cfgmod.masked_config(cfgmod.load_config())
    acct = masked["accounts"]["gmail"]
    assert acct["auth"] == "password" and acct["password_set"] is True
    assert acct["oauth"]["connected"] is True
    dumped = json.dumps(masked)
    assert "rt" not in acct["oauth"].values() and '"at"' not in dumped
    assert "apppw" not in dumped
    # a legacy account (no stored auth) reports the derived value
    cfgmod.update_config({"add_account": "legacy"})
    cfgmod.save_oauth("legacy", {"provider": "google", "refresh_token": "x"})
    legacy = cfgmod.masked_config(cfgmod.load_config())["accounts"]["legacy"]
    assert legacy["auth"] == "oauth"


# -------------------------------------------------------- test_connection

def test_test_connection_oauth_account_without_password(monkeypatch):
    """Fix B: a token is a credential, no password needed."""
    _gmail(auth="oauth")
    cfgmod.save_oauth("gmail", dict(TOKENS))

    class _C:
        def logout(self):
            pass
    monkeypatch.setattr(mailops, "connect", lambda im, name=None: _C())
    monkeypatch.setattr(mailops, "list_folders", lambda c: ["INBOX", "Sent"])
    r = client.post("/api/test_connection", params={"account": "gmail"})
    assert r.status_code == 200 and r.json() == {"ok": True, "folders": 2}


def test_test_connection_without_any_credential_is_400():
    _gmail(auth="oauth")
    r = client.post("/api/test_connection", params={"account": "gmail"})
    assert r.status_code == 400
    assert "no credentials" in r.json()["detail"]
    _gmail(auth="password")
    r = client.post("/api/test_connection", params={"account": "gmail"})
    assert r.status_code == 400
