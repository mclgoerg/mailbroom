"""A fresh install (no account set up, no CA file): connecting, scanning,
testing and listing folders answer with coded, translatable errors - never
a raw FileNotFoundError - and the CA path has no default that does not
exist."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend import config as cfgmod
from backend import mailops
from backend import smtpout
from backend.main import app
from conftest import code_re, wait_scan_done

client = TestClient(app)


def _im(**kw) -> dict:
    return {"host": "imap.example", "port": 993, "security": "ssl",
            "user": "me@mail.example", "password": "pw", "cafile": "", **kw}


# ------------------------------------------------------ the CA default

def test_default_cafile_empty_when_bridge_cert_is_absent(monkeypatch,
                                                         tmp_path):
    monkeypatch.delenv("IMAP_CAFILE", raising=False)
    monkeypatch.setattr(cfgmod, "BRIDGE_CAFILE", str(tmp_path / "nope.pem"))
    assert cfgmod._default_cafile() == ""


def test_default_cafile_keeps_an_existing_bridge_cert(monkeypatch, tmp_path):
    cert = tmp_path / "bridge-cert.pem"
    cert.write_text("x")
    monkeypatch.delenv("IMAP_CAFILE", raising=False)
    monkeypatch.setattr(cfgmod, "BRIDGE_CAFILE", str(cert))
    assert cfgmod._default_cafile() == str(cert)


def test_an_explicit_env_cafile_wins_even_when_empty(monkeypatch, tmp_path):
    monkeypatch.setattr(cfgmod, "BRIDGE_CAFILE", str(tmp_path / "x"))
    monkeypatch.setenv("IMAP_CAFILE", "")
    assert cfgmod._default_cafile() == ""
    monkeypatch.setenv("IMAP_CAFILE", "/somewhere/ca.pem")
    assert cfgmod._default_cafile() == "/somewhere/ca.pem"


# --------------------------------------------- a missing CA file, coded

def test_connect_with_a_missing_cafile_names_the_path():
    with pytest.raises(RuntimeError,
                       match=code_re("cafile_missing", path="/nope/ca.pem")):
        mailops.connect(_im(cafile="/nope/ca.pem"))


def test_smtp_with_a_missing_cafile_is_coded_too():
    with pytest.raises(RuntimeError, match="cafile_missing"):
        smtpout._connect(_im(cafile="/nope/ca.pem", smtp_port=465))


# ------------------------------------------ no account set up, coded

@pytest.mark.parametrize("kw", [{"host": ""}, {"user": ""},
                                {"password": ""}])
def test_connect_without_an_account_is_coded(kw):
    with pytest.raises(RuntimeError, match=code_re("no_account")):
        mailops.connect(_im(**kw))


def test_test_connection_on_a_fresh_install():
    r = client.post("/api/test_connection")
    assert r.status_code == 400
    assert r.json()["detail"] == "no_account"


def test_test_connection_reports_a_missing_cafile_coded():
    client.post("/api/config", json={"imap": {
        "host": "imap.example", "user": "me@mail.example", "password": "pw",
        "cafile": "/nope/ca.pem"}})
    r = client.post("/api/test_connection")
    assert r.status_code == 502
    assert r.json()["detail"] == mailops.coded("cafile_missing",
                                               path="/nope/ca.pem")


def test_folders_on_a_fresh_install_is_coded_not_raw():
    r = client.get("/api/folders")
    assert r.status_code == 500
    assert r.json()["detail"] == "no_account"


def test_scan_on_a_fresh_install_ends_in_a_coded_error():
    assert client.post("/api/scan").status_code == 200
    state = wait_scan_done()
    assert state["status"] == "error"
    assert state["error"] == "no_account"
    assert "FileNotFound" not in state["error"]


def test_scan_with_a_missing_cafile_ends_in_a_coded_error():
    client.post("/api/config", json={"imap": {
        "host": "imap.example", "user": "me@mail.example", "password": "pw",
        "cafile": "/nope/ca.pem"}})
    client.post("/api/scan")
    state = wait_scan_done()
    assert state["error"] == mailops.coded("cafile_missing",
                                           path="/nope/ca.pem")


def test_a_coded_scan_failure_logs_one_line_without_a_traceback(caplog):
    client.post("/api/scan")
    wait_scan_done()
    recs = [r for r in caplog.records if "scan failed" in r.getMessage()]
    assert len(recs) == 1
    assert recs[0].exc_info is None


def test_an_unexpected_scan_failure_keeps_its_traceback(monkeypatch, caplog):
    def boom(im, name=None):
        raise ValueError("unexpected")
    monkeypatch.setattr(mailops, "connect", boom)
    client.post("/api/config", json={"imap": {
        "host": "imap.example", "user": "me@mail.example", "password": "pw"}})
    client.post("/api/scan")
    wait_scan_done()
    recs = [r for r in caplog.records if "scan failed" in r.getMessage()]
    assert len(recs) == 1 and recs[0].exc_info is not None


# ------------------------------------------------- setup_needed (wizard)

def _setup_needed() -> bool:
    return client.get("/api/config").json()["setup_needed"]


def _acct(**kw):
    base = {"host": "imap.example", "user": "me@mail.example",
            "password": "pw"}
    client.post("/api/config", json={"imap": {**base, **kw}})


def test_a_fresh_install_needs_setup():
    assert _setup_needed() is True


def test_a_complete_account_ends_setup():
    _acct()
    assert _setup_needed() is False


@pytest.mark.parametrize("kw", [{"host": ""}, {"user": ""},
                                {"password": ""}])
def test_an_incomplete_account_still_needs_setup(kw):
    _acct(**kw)
    assert _setup_needed() is True


def test_an_oauth_account_without_a_password_ends_setup():
    _acct(password="", auth="oauth", preset="gmail")
    assert _setup_needed() is True               # no token yet
    cfgmod.save_oauth("default", {"provider": "google", "client_id": "c",
                                  "refresh_token": "rt"})
    assert _setup_needed() is False


def test_any_one_complete_account_is_enough():
    client.post("/api/config", json={"add_account": "second"})
    client.post("/api/config", json={"account": "second", "imap": {
        "host": "imap.example", "user": "b@mail.example", "password": "pw"}})
    assert _setup_needed() is False


def test_env_bootstrapped_credentials_skip_the_wizard(monkeypatch):
    env = {**cfgmod.ENV_IMAP, "host": "imap.example",
           "user": "me@mail.example", "password": "pw"}
    monkeypatch.setitem(cfgmod.DEFAULT_CONFIG["accounts"]["default"],
                        "user", env["user"])
    monkeypatch.setitem(cfgmod.DEFAULT_CONFIG["accounts"]["default"],
                        "password", env["password"])
    monkeypatch.setitem(cfgmod.DEFAULT_CONFIG["accounts"]["default"],
                        "host", env["host"])
    assert _setup_needed() is False


# ------------------------------------------- classified connect errors

def test_connection_failures_get_a_code_not_raw_text():
    import imaplib
    import socket
    import ssl
    cls = mailops.classify_connect_error
    unreachable = mailops.coded("host_unreachable", host="mail.example")
    assert cls(socket.gaierror("x"), "mail.example") == unreachable
    assert cls(ConnectionRefusedError(), "mail.example") == unreachable
    assert cls(TimeoutError(), "mail.example") == unreachable
    assert cls(ssl.SSLError("bad cert")) == "tls_failed"
    assert cls(imaplib.IMAP4.error(
        "[AUTHENTICATIONFAILED] Invalid credentials")) == "auth_failed"
    # Outlook OAuth: the server answers "AUTHENTICATE failed."
    assert cls(imaplib.IMAP4.error("AUTHENTICATE failed.")) == "auth_failed"
    assert cls(imaplib.IMAP4.error("something else")) is None
    assert cls(ValueError("x")) is None


def test_a_plain_network_oserror_is_host_unreachable():
    import errno
    for no in (errno.EHOSTUNREACH, errno.ENETUNREACH, errno.ETIMEDOUT):
        exc = OSError(no, "No route to host")
        assert mailops.error_text(exc, "mail.example") == mailops.coded(
            "host_unreachable", host="mail.example")
    # ... but not every OSError: a missing file is nothing the network did
    assert mailops.error_text(FileNotFoundError(2, "gone")).startswith(
        "FileNotFoundError")


def _fail_with(monkeypatch, exc):
    def boom(im, name=None):
        raise exc
    monkeypatch.setattr(mailops, "connect", boom)
    _acct()
    return client.post("/api/test_connection")


def test_test_connection_codes(monkeypatch):
    import imaplib
    import socket
    r = _fail_with(monkeypatch, imaplib.IMAP4.error("LOGIN failed"))
    assert (r.status_code, r.json()["detail"]) == (502, "auth_failed")
    r = _fail_with(monkeypatch, socket.gaierror("nodename secret.example"))
    assert r.json()["detail"] == mailops.coded("host_unreachable",
                                               host="imap.example")


def test_an_unknown_failure_never_leaks_its_text(monkeypatch):
    r = _fail_with(monkeypatch, ValueError("password hunter2 on host"))
    assert r.json()["detail"] == "connect_failed"
    assert "hunter2" not in r.text


def test_folders_and_scan_word_a_network_failure_coded(monkeypatch):
    import errno

    def boom(im, name=None):
        raise OSError(errno.EHOSTUNREACH, "No route to host")
    monkeypatch.setattr(mailops, "connect", boom)
    _acct()
    want = mailops.coded("host_unreachable", host="imap.example")
    assert client.get("/api/folders").json()["detail"] == want
    client.post("/api/scan")
    assert wait_scan_done()["error"] == want


def test_a_fresh_second_tenant_needs_setup_though_the_admin_does_not():
    from backend import tenants
    _acct()
    assert _setup_needed() is False
    with tenants.use(tenants.for_subject("alice@x.example")):
        assert cfgmod.masked_config(cfgmod.load_config())[
            "setup_needed"] is True
    assert _setup_needed() is False


def test_the_empty_demo_starts_a_fresh_install():
    """`scripts/demo.py --empty` (what the first-run flow check drives)
    answers setup_needed."""
    import json
    import os
    import socket
    import subprocess
    import sys
    import time
    import urllib.request
    from pathlib import Path
    root = Path(__file__).resolve().parent.parent
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    proc = subprocess.Popen(
        [sys.executable, str(root / "scripts" / "demo.py"), "--empty"],
        env={**os.environ, "DEMO_PORT": str(port)},
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        end = time.time() + 40
        cfg = None
        while time.time() < end and cfg is None:
            try:
                with urllib.request.urlopen(
                        f"http://127.0.0.1:{port}/api/config", timeout=2) as r:
                    cfg = json.load(r)
            except OSError:
                time.sleep(0.3)
        assert cfg is not None, "the empty demo did not start"
        assert cfg["setup_needed"] is True
    finally:
        proc.kill()
        proc.wait()


def test_an_unexpected_failure_never_shows_raw_text(monkeypatch, caplog):
    def boom(im, name=None):
        raise ValueError("secret-ish internal detail")
    monkeypatch.setattr(mailops, "connect", boom)
    _acct()
    r = client.get("/api/folders")
    assert r.json()["detail"] == "connect_failed"
    assert "internal detail" not in r.text
    client.post("/api/scan")
    state = wait_scan_done()
    assert state["error"] == "scan_failed"
    assert "internal detail" not in state["error"]
    # ... while the server log keeps the real exception
    assert "ValueError: secret-ish internal detail" in caplog.text
