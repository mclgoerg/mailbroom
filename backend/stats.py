"""Cleanup history: per-scan snapshots and per-month action tallies.

Persisted to /data/stats_history.json so progress ("freed this month",
mailbox shrinking over time) survives restarts. Pure bookkeeping — no
IMAP access here; live-index numbers (histogram, top domains) come from
mailops.index_stats().
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from pathlib import Path

log = logging.getLogger("pmc.stats")

HISTORY_PATH = Path(
    os.environ.get("STATS_HISTORY_PATH", "/data/stats_history.json"))
MAX_SCANS = 200

_LOCK = threading.Lock()

_ACTIONS = ("trash", "archive", "move", "mark_read")


def load() -> dict:
    try:
        data = json.loads(HISTORY_PATH.read_text())
        if isinstance(data, dict):
            return {"scans": data.get("scans", []),
                    "actions": data.get("actions", {})}
    except (OSError, json.JSONDecodeError):
        pass
    return {"scans": [], "actions": {}}


def _write(data: dict) -> None:
    try:
        HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = HISTORY_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        tmp.chmod(0o600)
        tmp.replace(HISTORY_PATH)
    except OSError:
        log.exception("could not persist stats history")


def record_scan(mails: int, size: int, senders: int) -> None:
    with _LOCK:
        data = load()
        data["scans"].append({"ts": int(time.time()), "mails": mails,
                              "size": size, "senders": senders})
        data["scans"] = data["scans"][-MAX_SCANS:]
        _write(data)


def record_action(action: str, count: int, size: int) -> None:
    """Tally one finished job into the current month. `size` should be the
    bytes moved; only trash counts towards 'freed'."""
    if action not in _ACTIONS or count <= 0:
        return
    month = time.strftime("%Y-%m")
    with _LOCK:
        data = load()
        m = data["actions"].setdefault(
            month, {a: 0 for a in _ACTIONS} | {"freed": 0})
        m[action] = m.get(action, 0) + count
        if action == "trash":
            m["freed"] = m.get("freed", 0) + size
        _write(data)
