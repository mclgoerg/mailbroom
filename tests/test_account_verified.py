"""An account counts as set up only once a connection test, an OAuth connect
or a scan has succeeded for it (`verified` on the account block)."""

from __future__ import annotations

import json
import time

from fastapi.testclient import TestClient

from backend import config as cfgmod
from backend import mailops
from backend.main import app

client = TestClient(app)


def _verified(name: str = "default") -> bool:
    return cfgmod.masked_config(cfgmod.load_config())["accounts"][name][
        "verified"]


def _save(**imap) -> None:
    cfgmod.update_config({"account": "default", "imap": {
        "host": "imap.example", "user": "me@mail.example", **imap}})


def _stored(name: str = "default"):
    return json.loads(cfgmod.config_path().read_text())["accounts"][
        name].get("verified")


class _Conn:
    def logout(self):
        pass


def test_saving_a_new_sign_in_makes_the_account_unverified():
    _save(password="pw")
    assert _stored() is False and _verified() is False


def test_failed_connection_test_keeps_it_unverified(monkeypatch):
    _save(password="pw")

    def boom(im, name=None):
        raise OSError("down")
    monkeypatch.setattr(mailops, "connect", boom)
    assert client.post("/api/test_connection").status_code == 502
    assert _verified() is False


def test_successful_test_verifies_and_unrelated_edits_keep_it(monkeypatch):
    _save(password="pw")
    monkeypatch.setattr(mailops, "connect", lambda im, name=None: _Conn())
    monkeypatch.setattr(mailops, "selectable_folders", lambda c: ["INBOX"])
    assert client.post("/api/test_connection").status_code == 200
    assert _verified() is True
    # same values again, and a settings-only change: still verified
    _save(password="pw")
    cfgmod.update_config({"account": "default",
                          "imap": {"excluded_folders": ["Spam"]}})
    assert _verified() is True
    # a changed password or host needs a new test
    _save(password="other")
    assert _verified() is False


def test_oauth_connect_verifies():
    _save()
    cfgmod.update_config({"account": "default", "imap": {
        "preset": "gmail", "auth": "oauth"}})
    assert _verified() is False
    cfgmod.save_oauth("default", {"provider": "google", "client_id": "c",
                                  "refresh_token": "rt",
                                  "access_token": "at",
                                  "expires_at": time.time() + 3600}, use=True)
    assert _verified() is True


def test_a_silent_token_refresh_does_not_verify():
    _save()
    cfgmod.update_config({"account": "default", "imap": {
        "preset": "gmail", "auth": "oauth"}})
    cfgmod.save_oauth("default", {"provider": "google", "client_id": "c",
                                  "refresh_token": "rt"})
    assert _verified() is False


def test_scan_verifies(bridge):
    cfgmod.update_config({"account": "default", "imap": {"password": "x2"}})
    assert _verified() is False
    mailops.run_scan()
    assert _verified() is True


def test_configs_without_the_flag_count_as_verified():
    """Upgrade path: existing accounts (and the env bootstrap) carry no
    `verified` key and must not get a setup card."""
    _save(password="pw")
    raw = json.loads(cfgmod.config_path().read_text())
    for block in raw["accounts"].values():
        block.pop("verified", None)
    cfgmod.config_path().write_text(json.dumps(raw))
    assert _verified() is True
    assert cfgmod.setup_needed(cfgmod.load_config()) is False


import pytest

_BASE = {"host": "imap.example", "port": 993, "security": "ssl",
         "user": "me@mail.example", "password": "pw", "preset": "custom",
         "auth": "password", "cafile": ""}
_CHANGES = {"host": "other.example", "port": 1143, "security": "starttls",
            "user": "you@mail.example", "password": "other",
            "cafile": "/certs/ca.pem"}


@pytest.mark.parametrize("field", sorted(_CHANGES))
def test_every_sign_in_field_resets_verified(field):
    cfgmod.update_config({"account": "default", "imap": dict(_BASE)})
    cfgmod.mark_verified("default")
    assert _verified() is True
    cfgmod.update_config({"account": "default",
                          "imap": {field: _CHANGES[field]}})
    assert _verified() is False


def test_oauth_client_and_method_reset_verified():
    cfgmod.update_config({"account": "default", "imap": {
        **_BASE, "preset": "custom",
        "oauth": {"provider": "google", "client_id": "a"}}})
    for imap in ({"oauth": {"client_id": "b"}},
                 {"oauth": {"client_secret": "s"}},
                 {"auth": "oauth"}):
        cfgmod.mark_verified("default")
        assert _verified() is True
        cfgmod.update_config({"account": "default", "imap": imap})
        assert _verified() is False
