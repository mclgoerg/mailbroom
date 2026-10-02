"""Per-account automatic scan schedule: due-logic (incl. sub-hour and
multi-hour clock alignment), scheduler tick (dispatch via
mailops.start_scan, busy-skip without consuming the due window), account
lifecycle, tenant isolation, and config persistence/validation."""

import datetime
import json
import time

from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import autoscan as autoscanmod
from backend import config as cfgmod
from backend import mailops
from backend import tenants
from backend.main import app

from conftest import wait_scan_done

client = TestClient(app)


def _configure_account(enabled=True, unit="hours", value=6,
                       align_minute=0):
    cfgmod.update_config({"account": "default", "imap": {
        "host": "h", "user": "u", "password": "pw",
        "auto_scan": {"enabled": enabled, "unit": unit, "value": value,
                     "align_minute": align_minute}}})


def _ts(*dt_args) -> int:
    return int(datetime.datetime(*dt_args).timestamp())


# ------------------------------------------------------------ due logic

def test_due_logic_never_run_fires_immediately():
    assert autoscanmod.due("new-acct", 60, 0, now=_ts(2026, 1, 1, 0, 0))


def test_due_logic_disabled_or_zero_interval_never_due():
    assert not autoscanmod.due("new-acct", 0, 0, now=_ts(2026, 1, 1, 0, 0))


def test_due_logic_hourly_alignment():
    autoscanmod._record_run("acct", _ts(2026, 1, 1, 8, 5))
    # every 60 min aligned to :00 - next boundary is 09:00, not 09:05
    assert not autoscanmod.due("acct", 60, 0, now=_ts(2026, 1, 1, 8, 59))
    assert autoscanmod.due("acct", 60, 0, now=_ts(2026, 1, 1, 9, 0))


def test_due_logic_sub_hour_alignment():
    autoscanmod._record_run("acct", _ts(2026, 1, 1, 8, 10))
    # every 30 min aligned to :10/:40
    assert not autoscanmod.due("acct", 30, 10, now=_ts(2026, 1, 1, 8, 39))
    assert autoscanmod.due("acct", 30, 10, now=_ts(2026, 1, 1, 8, 40))


def test_due_logic_multi_hour_alignment():
    autoscanmod._record_run("acct", _ts(2026, 1, 1, 0, 10))
    # every 3h aligned to :10 -> 00:10, 03:10, 06:10, ...
    assert not autoscanmod.due("acct", 180, 10, now=_ts(2026, 1, 1, 3, 9))
    assert autoscanmod.due("acct", 180, 10, now=_ts(2026, 1, 1, 3, 10))


# ------------------------------------------------------------------ tick

def test_tick_dispatches_a_due_scan_and_records_last_run(bridge):
    _configure_account(enabled=True, unit="minutes", value=5)
    autoscanmod._tick()
    st = wait_scan_done()
    assert st["status"] == "done", st["error"]
    assert autoscanmod.last_run("default") > 0


def test_tick_skips_a_not_yet_due_account(bridge):
    _configure_account(enabled=True, unit="hours", value=6)
    autoscanmod._record_run("default", int(time.time()))
    before = autoscanmod.last_run("default")
    autoscanmod._tick()
    assert autoscanmod.last_run("default") == before     # unchanged
    assert mailops.STATE["status"] != "scanning"


def test_tick_skips_a_disabled_account(bridge):
    _configure_account(enabled=False)
    autoscanmod._tick()
    assert autoscanmod.last_run("default") == 0


def test_tick_skips_a_busy_account_and_does_not_consume_the_due_window(
        bridge):
    _configure_account(enabled=True, unit="minutes", value=5)
    acc = accountsmod.get("default")
    with acc.lock:
        acc.state["status"] = "scanning"
    autoscanmod._tick()
    assert autoscanmod.last_run("default") == 0           # retry next tick
    with acc.lock:
        acc.state["status"] = "idle"


# --------------------------------------------------------- account lifecycle

def test_rename_account_follows():
    autoscanmod._record_run("default", 12345)
    client.post("/api/config", json={
        "rename_account": {"from": "default", "to": "renamed"}})
    assert autoscanmod.last_run("default") == 0
    assert autoscanmod.last_run("renamed") == 12345


def test_delete_account_drops_its_last_run():
    cfgmod.update_config({"add_account": "two"})
    autoscanmod._record_run("default", 111)
    autoscanmod._record_run("two", 222)
    client.post("/api/config", json={"delete_account": "two"})
    assert autoscanmod.last_run("default") == 111
    assert autoscanmod.last_run("two") == 0


# ------------------------------------------------------------ tenant isolation

def test_last_run_is_isolated_per_tenant():
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        autoscanmod._record_run("default", 999)
    assert autoscanmod.last_run("default") == 0     # default tenant untouched
    with tenants.use(alice):
        assert autoscanmod.last_run("default") == 999


# -------------------------------------------------------- read-side tolerance

def test_tolerates_missing_or_corrupt_file(tmp_path, monkeypatch):
    missing = tmp_path / "nope.json"
    monkeypatch.setattr(autoscanmod, "AUTOSCAN_PATH", missing)
    assert autoscanmod.last_run("default") == 0

    corrupt = tmp_path / "corrupt.json"
    corrupt.write_text("{not json")
    monkeypatch.setattr(autoscanmod, "AUTOSCAN_PATH", corrupt)
    assert autoscanmod.last_run("default") == 0


# ------------------------------------------------------- config persistence

def test_auto_scan_settings_persist_through_config_api():
    r = client.post("/api/config", json={"account": "default", "imap": {
        "host": "h", "auto_scan": {"enabled": True, "unit": "minutes",
                                   "value": 15, "align_minute": 10}}})
    assert r.status_code == 200
    saved = r.json()["accounts"]["default"]["auto_scan"]
    assert saved == {"enabled": True, "unit": "minutes", "value": 15,
                     "align_minute": 10}

    # invalid unit is silently rejected, not stored
    r = client.post("/api/config", json={"account": "default", "imap": {
        "auto_scan": {"unit": "fortnights"}}})
    assert r.json()["accounts"]["default"]["auto_scan"]["unit"] == "minutes"


def test_auto_scan_value_is_clamped_per_unit():
    r = client.post("/api/config", json={"account": "default", "imap": {
        "auto_scan": {"unit": "minutes", "value": 1}}})
    assert r.json()["accounts"]["default"]["auto_scan"]["value"] == 5
    r = client.post("/api/config", json={"account": "default", "imap": {
        "auto_scan": {"unit": "minutes", "value": 99999}}})
    assert r.json()["accounts"]["default"]["auto_scan"]["value"] == 1440

    r = client.post("/api/config", json={"account": "default", "imap": {
        "auto_scan": {"unit": "hours", "value": 0}}})
    assert r.json()["accounts"]["default"]["auto_scan"]["value"] == 1
    r = client.post("/api/config", json={"account": "default", "imap": {
        "auto_scan": {"unit": "hours", "value": 999}}})
    assert r.json()["accounts"]["default"]["auto_scan"]["value"] == 24


def test_auto_scan_align_minute_is_clamped():
    r = client.post("/api/config", json={"account": "default", "imap": {
        "auto_scan": {"align_minute": -5}}})
    assert r.json()["accounts"]["default"]["auto_scan"]["align_minute"] == 0
    r = client.post("/api/config", json={"account": "default", "imap": {
        "auto_scan": {"align_minute": 99}}})
    assert r.json()["accounts"]["default"]["auto_scan"]["align_minute"] == 59


def test_auto_scan_defaults_to_off_for_a_pre_auto_scan_saved_config():
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "default": {"host": "h", "user": "u", "password": "pw"}}}))
    cfg = cfgmod.load_config()
    assert cfg["accounts"]["default"]["auto_scan"] == \
        {"enabled": False, "unit": "hours", "value": 6, "align_minute": 0}
