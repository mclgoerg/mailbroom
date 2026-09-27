"""Cleanup history: per-scan snapshots and per-month action tallies.

Persisted to /data/stats_history.json, namespaced PER ACCOUNT (strict
separation — nothing is aggregated across accounts). The old
single-account file shape ({scans, actions}) is migrated on read.
Pure bookkeeping — no IMAP access here; live-index numbers (histogram,
top domains) come from mailops.index_stats().
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from pathlib import Path

from . import accounts

log = logging.getLogger("pmc.stats")

HISTORY_PATH = Path(
    os.environ.get("STATS_HISTORY_PATH", "/data/stats_history.json"))
MAX_SCANS = 200

_LOCK = threading.Lock()

_ACTIONS = ("trash", "archive", "move", "mark_read")

_EMPTY = {"scans": [], "actions": {}}


def _load_all() -> dict:
    """Raw file: {"accounts": {name: {scans, actions}}}, migrating the old
    single-account top-level shape into the default account."""
    try:
        data = json.loads(HISTORY_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return {"accounts": {}}
    if not isinstance(data, dict):
        return {"accounts": {}}
    if isinstance(data.get("accounts"), dict):
        return data
    if "scans" in data or "actions" in data:    # pre-multi-account format
        return {"accounts": {accounts.default_name(): {
            "scans": data.get("scans", []),
            "actions": data.get("actions", {})}}}
    return {"accounts": {}}


def rename_account(old: str, new: str) -> None:
    """Move one account's history to a new account name."""
    with _LOCK:
        data = _load_all()
        if old in data["accounts"]:
            data["accounts"][new] = data["accounts"].pop(old)
            _write(data)


def load(account: str | None = None) -> dict:
    """One account's history (default: the default account)."""
    account = account or accounts.default_name()
    entry = _load_all()["accounts"].get(account) or {}
    return {"scans": entry.get("scans", []),
            "actions": entry.get("actions", {})}


def _write(data: dict) -> None:
    try:
        HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = HISTORY_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        tmp.chmod(0o600)
        tmp.replace(HISTORY_PATH)
    except OSError:
        log.exception("could not persist stats history")


def record_scan(mails: int, size: int, senders: int,
                account: str | None = None) -> None:
    account = account or accounts.default_name()
    with _LOCK:
        data = _load_all()
        entry = data["accounts"].setdefault(
            account, json.loads(json.dumps(_EMPTY)))
        entry.setdefault("scans", []).append(
            {"ts": int(time.time()), "mails": mails,
             "size": size, "senders": senders})
        entry["scans"] = entry["scans"][-MAX_SCANS:]
        _write(data)


def record_action(action: str, count: int, size: int,
                  account: str | None = None) -> None:
    """Tally one finished job into the current month. `size` should be the
    bytes moved; only trash counts towards 'freed'."""
    if action not in _ACTIONS or count <= 0:
        return
    account = account or accounts.default_name()
    month = time.strftime("%Y-%m")
    with _LOCK:
        data = _load_all()
        entry = data["accounts"].setdefault(
            account, json.loads(json.dumps(_EMPTY)))
        m = entry.setdefault("actions", {}).setdefault(
            month, {a: 0 for a in _ACTIONS} | {"freed": 0})
        m[action] = m.get(action, 0) + count
        if action == "trash":
            m["freed"] = m.get("freed", 0) + size
        _write(data)
