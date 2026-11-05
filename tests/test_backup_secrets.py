"""The settings backup never carries a secret, and importing one never
deletes the secrets this instance already holds."""

import json
import re

from fastapi.testclient import TestClient

from backend import config as cfgmod
from backend.main import app

client = TestClient(app)

SENTINELS = ("pw-sentinel", "csec-sentinel", "rtok-sentinel",
             "atok-sentinel", "aikey-sentinel")


def _connect_account():
    cfgmod.update_config({
        "imap": {"user": "me@mail.example", "password": "pw-sentinel",
                 "oauth": {"provider": "google", "client_id": "cid.example",
                           "client_secret": "csec-sentinel"}},
        "ai": {"api_key": "aikey-sentinel"}})
    cfgmod.save_oauth(next(iter(cfgmod.load_config()["accounts"])), {
        "refresh_token": "rtok-sentinel", "access_token": "atok-sentinel",
        "expires_at": 123})


def _account():
    return next(iter(cfgmod.load_config()["accounts"].items()))


def test_export_contains_no_secret_anywhere():
    _connect_account()
    text = client.get("/api/export_config").text
    for s in SENTINELS:
        assert s not in text
    oauth = json.loads(text)["config"]["accounts"][_account()[0]]["oauth"]
    # the non-secret facts stay, so the UI can offer "reconnect"
    assert oauth["provider"] == "google" and oauth["client_id"] == "cid.example"


def test_import_keeps_existing_secrets_and_ignores_smuggled_ones():
    _connect_account()
    name = _account()[0]
    backup = json.loads(client.get("/api/export_config").text)
    # an OLD backup (or a hand-edited one) that does carry secrets
    acc = backup["config"]["accounts"][name]
    acc["password"] = "evil-pw"
    acc["oauth"].update(client_secret="evil-cs", refresh_token="evil-rt",
                        access_token="evil-at")
    backup["config"]["ai"]["api_key"] = "evil-key"
    assert client.post("/api/import_config", json=backup).status_code == 200
    blk = _account()[1]
    assert blk["password"] == "pw-sentinel"
    assert blk["oauth"]["client_secret"] == "csec-sentinel"
    assert blk["oauth"]["refresh_token"] == "rtok-sentinel"
    assert blk["oauth"]["access_token"] == "atok-sentinel"
    assert cfgmod.load_config()["ai"]["api_key"] == "aikey-sentinel"


def test_every_secret_like_config_field_is_listed_as_secret():
    """Fails when someone adds a token/secret/password/key field to the
    tenant config without listing it in cfgmod.*_SECRET_FIELDS (which drives
    both sealing at rest and the backup strip)."""
    _connect_account()
    cfg = cfgmod.load_config()
    listed = (set(cfgmod.ACCOUNT_SECRET_FIELDS) | set(cfgmod.OAUTH_SECRET_FIELDS)
              | set(cfgmod.AI_SECRET_FIELDS))
    looks_secret = re.compile(r"secret|token|pass|key|credential", re.I)
    keys = set(cfg["ai"])
    for block in cfg["accounts"].values():
        keys |= set(block)
        keys |= set(block.get("oauth") or {})
    # defaults too, not just what this test populated
    keys |= set(cfgmod.NEUTRAL_IMAP)
    unlisted = {k for k in keys if looks_secret.search(k)} - listed
    assert unlisted <= set(), f"secret-looking but not stripped: {unlisted}"
    # and the strip really removes every listed field
    stripped = cfgmod.strip_account_secrets(
        {**{k: "x" for k in cfgmod.ACCOUNT_SECRET_FIELDS},
         "oauth": {k: "x" for k in cfgmod.OAUTH_SECRET_FIELDS}})
    assert not (set(stripped) & set(cfgmod.ACCOUNT_SECRET_FIELDS))
    assert stripped["oauth"] == {}
