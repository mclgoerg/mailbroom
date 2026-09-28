"""Secrets encryption at rest (opt-in via MAILBROOM_SECRET_KEY):
sealed fields never hit the disk in plaintext, loading is transparent,
missing/wrong keys degrade to "re-enter the secret" instead of crashing."""

import json

from hypothesis import given, settings
from hypothesis import strategies as st

from backend import config as cfgmod
from backend import secretbox

KEY = "0Yl6dY0zXhP0aXkQ0T5S5vC9m3o0J8m1kU4dY2wG9pA="   # gitleaks:allow
# ^ made-up fixture (any string works as a key) - NOT a real secret


def test_seal_unseal_roundtrip(monkeypatch):
    monkeypatch.setenv(secretbox.ENV_VAR, KEY)
    sealed = secretbox.seal("hunter2")
    assert sealed.startswith("enc:v1:") and "hunter2" not in sealed
    assert secretbox.unseal(sealed) == "hunter2"
    # idempotent: sealing a sealed value doesn't double-wrap
    assert secretbox.seal(sealed) == sealed
    # empty stays empty
    assert secretbox.seal("") == "" and secretbox.unseal("") == ""


def test_no_key_means_plaintext_passthrough(monkeypatch):
    monkeypatch.delenv(secretbox.ENV_VAR, raising=False)
    assert not secretbox.enabled()
    assert secretbox.seal("hunter2") == "hunter2"
    assert secretbox.unseal("hunter2") == "hunter2"


def test_config_secrets_never_hit_disk_in_plaintext(monkeypatch):
    monkeypatch.setenv(secretbox.ENV_VAR, KEY)
    cfgmod.update_config({
        "account": "default",
        "imap": {"password": "imap-secret-xyz"},
        "ai": {"api_key": "sk-ai-secret"},
        "auth": {"oidc": {"client_secret": "oidc-secret-123"}},  # gitleaks:allow
        "shared_ai": {"api_key": "sk-shared-secret"},
    })
    raw_cfg = cfgmod.CONFIG_PATH.read_text()
    raw_server = cfgmod.SERVER_PATH.read_text()
    for secret in ("imap-secret-xyz", "sk-ai-secret"):
        assert secret not in raw_cfg
    for secret in ("oidc-secret-123", "sk-shared-secret"):
        assert secret not in raw_server
    assert "enc:v1:" in raw_cfg and "enc:v1:" in raw_server
    # ...but loading is transparent
    cfg = cfgmod.load_config()
    assert cfg["accounts"]["default"]["password"] == "imap-secret-xyz"
    assert cfg["ai"]["api_key"] == "sk-ai-secret"
    assert cfg["auth"]["oidc"]["client_secret"] == "oidc-secret-123"
    assert cfgmod.load_server()["shared_ai"]["api_key"] == "sk-shared-secret"


def test_existing_plaintext_is_encrypted_on_next_save(monkeypatch):
    monkeypatch.delenv(secretbox.ENV_VAR, raising=False)
    cfgmod.update_config({"account": "default",
                          "imap": {"password": "old-plain"}})
    assert "old-plain" in cfgmod.CONFIG_PATH.read_text()
    monkeypatch.setenv(secretbox.ENV_VAR, KEY)     # key introduced later
    cfgmod.update_config({"protected": ["x@y.z"]})  # ANY save re-seals
    assert "old-plain" not in cfgmod.CONFIG_PATH.read_text()
    assert cfgmod.load_config()["accounts"]["default"]["password"] \
        == "old-plain"


def test_wrong_or_missing_key_degrades_cleanly(monkeypatch):
    monkeypatch.setenv(secretbox.ENV_VAR, KEY)
    cfgmod.update_config({"account": "default",
                          "imap": {"password": "s3cret"}})
    # key lost -> secret reads as unset, nothing crashes
    monkeypatch.delenv(secretbox.ENV_VAR)
    cfg = cfgmod.load_config()
    assert cfg["accounts"]["default"]["password"] == ""
    assert not cfgmod.masked_config(cfg)["accounts"]["default"][
        "password_set"]
    # wrong key -> same clean degradation
    monkeypatch.setenv(secretbox.ENV_VAR, "a-different-key")
    assert cfgmod.load_config()["accounts"]["default"]["password"] == ""


def test_export_backup_stays_secret_free(monkeypatch):
    from fastapi.testclient import TestClient
    from backend.main import app
    monkeypatch.setenv(secretbox.ENV_VAR, KEY)
    cfgmod.update_config({"account": "default",
                          "imap": {"password": "s3cret"},
                          "ai": {"api_key": "sk-x"}})
    text = TestClient(app).get("/api/export_config").text
    assert "s3cret" not in text and "sk-x" not in text
    assert "enc:v1:" not in text        # not even in sealed form
    assert "password" not in json.loads(text)["config"]["accounts"][
        "default"]


@settings(max_examples=50, deadline=None)
@given(st.text(max_size=200))
def test_fuzz_seal_roundtrip(value):
    import os
    old = os.environ.get(secretbox.ENV_VAR)
    os.environ[secretbox.ENV_VAR] = KEY
    try:
        assert secretbox.unseal(secretbox.seal(value)) == value
    finally:
        if old is None:
            os.environ.pop(secretbox.ENV_VAR, None)
        else:
            os.environ[secretbox.ENV_VAR] = old
