"""Per-account automatic scan schedule: "every N minutes/hours, aligned
to a specific minute" (not raw cron syntax). Schedule + unit/value/
align_minute live in the account's own config block (see
config.ENV_IMAP's "auto_scan"); `last_run` is a small per-tenant file,
following the same pattern as digest.py's digest.json (per-account,
atomic write) - it's the scheduler's own bookkeeping of when an account
last fired, independent of config, and must survive restarts.

Dispatch goes through mailops.start_scan() (not run_scan() directly):
it already does its own atomic busy-check + status flip + background
thread, so the tick loop never blocks on a slow scan and never needs to
duplicate the busy-check every other scheduler in this codebase repeats.
"""

from __future__ import annotations

import datetime
import json
import logging
import os
import threading
import time
from pathlib import Path

from . import accounts
from . import config as cfgmod
from . import mailops
from . import tenants

log = logging.getLogger("pmc.autoscan")

AUTOSCAN_PATH = Path(os.environ.get("AUTOSCAN_PATH", "/data/autoscan.json"))
CHECK_INTERVAL = int(os.environ.get("AUTOSCAN_INTERVAL", "60"))  # seconds

_LOCK = threading.Lock()


def _path() -> Path:
    return tenants.current().file("autoscan.json", AUTOSCAN_PATH)


def _load() -> dict:
    try:
        data = json.loads(_path().read_text())
    except (OSError, json.JSONDecodeError):
        return {"accounts": {}}
    if isinstance(data, dict) and isinstance(data.get("accounts"), dict):
        return data
    return {"accounts": {}}


def _write(data: dict) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    tmp.chmod(0o600)
    tmp.replace(path)


def last_run(account: str) -> int:
    return _load()["accounts"].get(account, {}).get("last_run", 0)


def _record_run(account: str, ts: int | None = None) -> None:
    with _LOCK:
        data = _load()
        data["accounts"][account] = {"last_run": ts or int(time.time())}
        _write(data)


def rename_account(old: str, new: str) -> None:
    """Point a renamed account's last-run marker at its new name."""
    with _LOCK:
        data = _load()
        if old in data["accounts"]:
            data["accounts"][new] = data["accounts"].pop(old)
            _write(data)


def drop_account(name: str) -> None:
    """Forget a deleted account's last-run marker."""
    with _LOCK:
        data = _load()
        if data["accounts"].pop(name, None) is not None:
            _write(data)


def _next_occurrence(after: datetime.datetime, interval_minutes: int,
                     align_minute: int) -> datetime.datetime:
    """The next whole minute at/after `after` where minutes-since-local-
    midnight is congruent to `align_minute` mod `interval_minutes` -
    generalizes digest.py's day-granularity _next_occurrence(after, hour,
    minute) to arbitrary sub-day periods. Covers both multi-hour cadences
    (every 3h at align_minute=10 -> 00:10, 03:10, 06:10, ...) and sub-hour
    ones (every 30 min at align_minute=10 -> :10, :40)."""
    midnight = after.replace(hour=0, minute=0, second=0, microsecond=0)
    elapsed = int((after - midnight).total_seconds() // 60)
    phase = align_minute % interval_minutes
    delta = (phase - elapsed) % interval_minutes
    candidate = midnight + datetime.timedelta(minutes=elapsed + delta)
    if candidate < after:
        # `elapsed` floors away `after`'s leftover seconds, so a `delta`
        # of 0 can land exactly on `after`'s own minute - one interval
        # earlier than the real next occurrence strictly after `after`.
        candidate += datetime.timedelta(minutes=interval_minutes)
    return candidate


def due(account: str, interval_minutes: int, align_minute: int,
       now: float | None = None) -> bool:
    """Whether this account's auto-scan should fire now: never run ->
    due right away; otherwise due at the next aligned occurrence strictly
    after the last run."""
    if interval_minutes <= 0:
        return False
    last = last_run(account)
    if not last:
        return True
    now_dt = datetime.datetime.fromtimestamp(now or time.time())
    last_dt = datetime.datetime.fromtimestamp(last)
    next_dt = _next_occurrence(
        last_dt + datetime.timedelta(seconds=1), interval_minutes,
        align_minute)
    return now_dt >= next_dt


def _interval_minutes(a: dict) -> int:
    value = a.get("value", 60)
    return value * 60 if a.get("unit") == "hours" else value


# ------------------------------------------------------------------ engine

def _tick() -> None:
    for tenant in tenants.known():
        with tenants.use(tenant):
            cfg = cfgmod.load_config()
            for name, block in cfg["accounts"].items():
                a = block.get("auto_scan") or {}
                if not a.get("enabled"):
                    continue
                if not due(name, _interval_minutes(a),
                          a.get("align_minute", 0)):
                    continue
                try:
                    acc = accounts.get(name)
                except KeyError:
                    continue                 # account was deleted
                try:
                    mailops.start_scan(acc)
                except RuntimeError:
                    continue                 # busy - retry next tick
                _record_run(name)
                log.info("[%s] auto-scan dispatched", name)


_scheduler_started = False


def start_scheduler() -> None:
    global _scheduler_started
    if _scheduler_started:
        return
    _scheduler_started = True

    def loop():
        while True:
            time.sleep(CHECK_INTERVAL)
            try:
                _tick()
            except Exception:
                log.exception("autoscan scheduler tick failed")

    threading.Thread(target=loop, daemon=True).start()
    log.info("autoscan scheduler started (checking every %ds)",
             CHECK_INTERVAL)
