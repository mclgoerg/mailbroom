"""IMAP account OAuth (XOAUTH2): token exchange/refresh mechanics, the
connect() XOAUTH2 path, and the /api/oauth/imap/* endpoints."""

from __future__ import annotations

import json
import urllib.error
import urllib.request

import pytest
from fastapi.testclient import TestClient

from backend import config as cfgmod
from backend import mailops
from backend import oauthflow
from backend.main import app

client = TestClient(app)


def _json_response(payload: dict):
    class _Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return json.dumps(payload).encode()
    return _Resp()


# --------------------------------------------------------------- oauthflow

def test_exchange_code_returns_tokens(monkeypatch):
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=15:
                        _json_response({"access_token": "at", "refresh_token":
                                       "rt", "expires_in": 3600}))
    block = oauthflow.exchange_code("google", "cid", "secret",
                                    "https://x/cb", "code123", "verifier")
    assert block["access_token"] == "at"
    assert block["refresh_token"] == "rt"
    assert block["expires_at"] > 0


def test_exchange_code_without_refresh_token_raises(monkeypatch):
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=15:
                        _json_response({"access_token": "at",
                                       "expires_in": 3600}))
    with pytest.raises(RuntimeError, match="refresh token"):
        oauthflow.exchange_code("google", "cid", "", "https://x/cb", "c", "v")


def test_refresh_keeps_old_refresh_token_when_omitted(monkeypatch):
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=15:
                        _json_response({"access_token": "new-at",
                                       "expires_in": 3600}))
    block = oauthflow.refresh("google", "cid", "secret", "old-rt")
    assert block["access_token"] == "new-at"
    assert block["refresh_token"] == "old-rt"


def test_token_error_raises(monkeypatch):
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=15:
                        _json_response({"error": "invalid_grant",
                                       "error_description": "bad"}))
    with pytest.raises(RuntimeError, match="invalid_grant"):
        oauthflow.refresh("google", "cid", "", "rt")


def test_ensure_fresh_skips_refresh_when_valid():
    import time
    oauth = {"provider": "google", "access_token": "still-good",
             "expires_at": time.time() + 3600, "refresh_token": "rt"}
    assert oauthflow.ensure_fresh(oauth) is oauth


def test_ensure_fresh_refreshes_when_expiring(monkeypatch):
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=15:
                        _json_response({"access_token": "new-at",
                                       "expires_in": 3600}))
    oauth = {"provider": "google", "client_id": "cid", "access_token": "old",
             "expires_at": 0, "refresh_token": "rt"}
    fresh = oauthflow.ensure_fresh(oauth)
    assert fresh["access_token"] == "new-at"
    assert fresh["refresh_token"] == "rt"


def test_xoauth2_string_format():
    s = oauthflow.xoauth2_string("me@example.com", "tok")
    assert s == b"user=me@example.com\x01auth=Bearer tok\x01\x01"


def test_auth_url_has_pkce_and_offline_for_google():
    url = oauthflow.auth_url("google", "cid", "https://x/cb", "state1", "ver")
    assert "code_challenge=" in url and "code_challenge_method=S256" in url
    assert "access_type=offline" in url and "prompt=consent" in url


def test_device_start_requires_shared_client(monkeypatch):
    monkeypatch.setattr(oauthflow, "MS_SHARED_CLIENT_ID", "")
    with pytest.raises(RuntimeError, match="shared Microsoft client"):
        oauthflow.device_start()


def test_device_poll_pending_then_complete(monkeypatch):
    monkeypatch.setattr(oauthflow, "MS_SHARED_CLIENT_ID", "shared-id")
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=15:
                        _json_response({"error": "authorization_pending"}))
    assert oauthflow.device_poll("dc")["status"] == "pending"

    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=15:
                        _json_response({"access_token": "at",
                                       "refresh_token": "rt",
                                       "expires_in": 3600}))
    result = oauthflow.device_poll("dc")
    assert result["status"] == "complete"
    assert result["provider"] == "microsoft"
    assert result["client_id"] == "shared-id"


# ------------------------------------------------------------- connect()

class _FakeSSLConn:
    def __init__(self, host, port, ssl_context=None, timeout=None):
        pass

    def authenticate(self, mechanism, authobject):
        self.mechanism = mechanism
        self.response = authobject(b"")
        return "OK", [b"AUTHENTICATE done"]

    def login(self, user, password):
        raise AssertionError("should not call login() for an oauth account")

    def shutdown(self):
        pass


def test_connect_uses_xoauth2_when_oauth_configured(monkeypatch):
    import time
    monkeypatch.setattr(mailops.imaplib, "IMAP4_SSL", _FakeSSLConn)
    im = {"host": "imap.example", "port": 993, "security": "ssl",
         "user": "me@gmail.com", "password": "", "cafile": "",
         "oauth": {"provider": "google", "client_id": "cid",
                   "client_secret": "sec", "refresh_token": "rt",
                   "access_token": "at", "expires_at": time.time() + 3600}}
    conn = mailops.connect(im)
    assert conn.mechanism == "XOAUTH2"
    assert conn.response == b"user=me@gmail.com\x01auth=Bearer at\x01\x01"


def test_connect_refreshes_and_persists_expired_token(monkeypatch, isolate):
    import time
    monkeypatch.setattr(mailops.imaplib, "IMAP4_SSL", _FakeSSLConn)
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=15:
                        _json_response({"access_token": "new-at",
                                       "expires_in": 3600}))
    cfgmod.update_config({"add_account": "gmail"})
    cfgmod.update_config({"account": "gmail", "imap": {
        "host": "imap.gmail.com", "oauth": {
            "provider": "google", "client_id": "cid",
            "client_secret": "sec"}}})
    cfgmod.save_oauth("gmail", {"provider": "google", "client_id": "cid",
                                "client_secret": "sec",
                                "refresh_token": "rt",
                                "access_token": "old-at", "expires_at": 0})
    im = cfgmod.account_imap("gmail")
    conn = mailops.connect(im, "gmail")
    assert conn.response == b"user=\x01auth=Bearer new-at\x01\x01"
    saved = cfgmod.account_imap("gmail")["oauth"]
    assert saved["access_token"] == "new-at"
    assert saved["refresh_token"] == "rt"


# -------------------------------------------------------------- endpoints

def _setup_gmail_account(client_id="cid", client_secret="sec"):
    cfgmod.update_config({"add_account": "gmail"})
    cfgmod.update_config({"account": "gmail", "imap": {
        "host": "imap.gmail.com", "oauth": {
            "provider": "google", "client_id": client_id,
            "client_secret": client_secret}}})


def test_oauth_login_requires_client_id_first():
    cfgmod.update_config({"add_account": "gmail"})
    r = client.get("/api/oauth/imap/login",
                   params={"account": "gmail", "provider": "google"})
    assert r.status_code == 400


def test_oauth_login_redirects_and_sets_pending_cookie():
    _setup_gmail_account()
    r = client.get("/api/oauth/imap/login",
                   params={"account": "gmail", "provider": "google"},
                   follow_redirects=False)
    assert r.status_code in (302, 307)
    assert "accounts.google.com" in r.headers["location"]
    assert "pmc_oauth_pending" in r.cookies


def test_oauth_callback_completes_connect(monkeypatch):
    _setup_gmail_account()
    login = client.get("/api/oauth/imap/login",
                       params={"account": "gmail", "provider": "google"},
                       follow_redirects=False)
    import urllib.parse
    qs = urllib.parse.parse_qs(
        urllib.parse.urlparse(login.headers["location"]).query)
    state = qs["state"][0]

    monkeypatch.setattr(
        urllib.request, "urlopen", lambda req, timeout=15:
        _json_response({"access_token": "at", "refresh_token": "rt",
                        "expires_in": 3600}))
    client.cookies.update(login.cookies)
    r = client.get("/api/oauth/imap/callback",
                   params={"code": "authcode", "state": state},
                   follow_redirects=False)
    assert r.status_code in (302, 307)
    saved = cfgmod.account_imap("gmail")["oauth"]
    assert saved["refresh_token"] == "rt" and saved["access_token"] == "at"


def test_oauth_callback_surfaces_idp_error():
    _setup_gmail_account()
    r = client.get("/api/oauth/imap/callback",
                   params={"error": "access_denied",
                          "error_description": "user said no"})
    assert r.status_code == 502
    assert "user said no" in r.json()["detail"]


def test_oauth_disconnect_clears_tokens():
    _setup_gmail_account()
    cfgmod.save_oauth("gmail", {"provider": "google", "client_id": "cid",
                                "refresh_token": "rt", "access_token": "at",
                                "expires_at": 0})
    assert cfgmod.account_imap("gmail")["oauth"]["refresh_token"] == "rt"
    r = client.post("/api/oauth/imap/disconnect", params={"account": "gmail"})
    assert r.status_code == 200
    assert cfgmod.account_imap("gmail")["oauth"] is None


def test_oauth_device_start_and_poll(monkeypatch):
    cfgmod.update_config({"add_account": "outlook"})
    monkeypatch.setattr(oauthflow, "MS_SHARED_CLIENT_ID", "shared-id")
    monkeypatch.setattr(
        urllib.request, "urlopen", lambda req, timeout=15:
        _json_response({"device_code": "dc", "user_code": "ABCD-EFGH",
                        "verification_uri": "https://microsoft.com/devicelogin",
                        "expires_in": 900, "interval": 5}))
    r = client.post("/api/oauth/imap/device/start",
                    params={"account": "outlook"})
    assert r.status_code == 200
    body = r.json()
    assert body["user_code"] == "ABCD-EFGH"

    monkeypatch.setattr(
        urllib.request, "urlopen", lambda req, timeout=15:
        _json_response({"access_token": "at", "refresh_token": "rt",
                        "expires_in": 3600}))
    r2 = client.post("/api/oauth/imap/device/poll",
                     params={"account": "outlook", "device_code": "dc"})
    assert r2.json()["status"] == "complete"
    saved = cfgmod.account_imap("outlook")["oauth"]
    assert saved["provider"] == "microsoft" and saved["refresh_token"] == "rt"


def test_unsub_smtp_uses_xoauth2(monkeypatch):
    from backend import unsub
    import time

    seen = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout=None, context=None):
            pass

        def login(self, user, password):
            raise AssertionError("should not use plain login for oauth")

        def auth(self, mechanism, authobject, initial_response_ok=True):
            seen["mechanism"] = mechanism
            seen["response"] = authobject()

        def sendmail(self, frm, to, msg):
            seen["to"] = to

        def quit(self):
            pass

    monkeypatch.setattr(unsub.smtplib, "SMTP_SSL", FakeSMTP)
    unsub._send_mailto(
        {"host": "smtp.gmail.example", "smtp_security": "ssl",
         "user": "me@gmail.com", "password": "", "cafile": "",
         "oauth": {"provider": "google", "client_id": "cid",
                   "client_secret": "sec", "refresh_token": "rt",
                   "access_token": "at", "expires_at": time.time() + 3600}},
        "mailto:unsub@list.example")
    assert seen["mechanism"] == "XOAUTH2"
    assert seen["response"] == "user=me@gmail.com\x01auth=Bearer at\x01\x01"
    assert seen["to"] == ["unsub@list.example"]


def test_unsub_smtp_xoauth2_error_continuation_returns_empty():
    from backend import oauthflow
    cb = oauthflow.smtp_auth_callback("me@gmail.com", "at")
    assert cb() == "user=me@gmail.com\x01auth=Bearer at\x01\x01"
    assert cb(b"{\"status\":\"400\"}") == ""


def test_masked_config_hides_oauth_tokens():
    _setup_gmail_account()
    cfgmod.save_oauth("gmail", {"provider": "google", "client_id": "cid",
                                "client_secret": "sec", "refresh_token": "rt",
                                "access_token": "at", "expires_at": 0})
    masked = cfgmod.masked_config(cfgmod.load_config())
    oauth = masked["accounts"]["gmail"]["oauth"]
    assert oauth == {"provider": "google", "client_id": "cid",
                     "client_secret_set": True, "connected": True}
