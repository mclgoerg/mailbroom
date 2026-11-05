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
