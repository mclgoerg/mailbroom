"""Persistent record of which senders were already unsubscribed from.

Entries are keyed by SENDER ADDRESS and namespaced PER ACCOUNT: the same
newsletter may sit in two mailboxes and be handled separately in each.
Keying by address (not by group key) means a sender unsubscribed from its
domain group also shows as handled in the sender view.

One entry: {"status": "done"|"link"|"failed", "method", "detail", "error",
"ts"}. "link" = the sender only offers a confirmation page, which cannot
be automated - the UI hands the URL to the user, who acknowledges it.
"""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path

from . import accounts
from . import tenants

UNSUB_STATE_PATH = Path(os.environ.get("UNSUB_STATE_PATH",
                                       "/data/unsub_state.json"))

STATUSES = ("done", "link", "failed")

_LOCK = threading.Lock()

# Per-tenant cache (keyed by tenant id) so public_state() never re-reads
# the file per request - and never leaks one tenant's senders into another.
_cache: dict[str, dict] = {}


def _path() -> Path:
    return tenants.current().file("unsub_state.json", UNSUB_STATE_PATH)


def load() -> dict:
    """Raw store: {"accounts": {name: {addr: entry}}}."""
    tid = tenants.current().id
    if tid in _cache:
        return _cache[tid]
    try:
        data = json.loads(_path().read_text())
    except (OSError, json.JSONDecodeError):
        data = {}
    accs = data.get("accounts") if isinstance(data, dict) else None
    _cache[tid] = {"accounts": accs if isinstance(accs, dict) else {}}
    return _cache[tid]


def _persist(data: dict) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    tmp.chmod(0o600)
    tmp.replace(path)
    _cache[tenants.current().id] = data


def load_account(account: str | None = None) -> dict[str, dict]:
    """{addr: entry} of one account."""
    account = account or accounts.default_name()
    return load()["accounts"].get(account) or {}


def save(entries: dict[str, dict], account: str | None = None) -> None:
    """Merge {addr: entry} into one account's records."""
    if not entries:
        return
    account = account or accounts.default_name()
    with _LOCK:
        data = load()
        data["accounts"].setdefault(account, {}).update(entries)
        _persist(data)


def record(addr: str, status: str, method: str = "", detail: str = "",
           error: str = "", account: str | None = None) -> dict:
    """Store one sender's outcome; returns the stored entry."""
    entry = {"status": status if status in STATUSES else "failed",
             "method": method[:100], "detail": (detail or "")[:500],
             "error": (error or "")[:300], "ts": int(time.time())}
    save({addr.strip().lower(): entry}, account)
    return entry


def forget(addr: str, account: str | None = None) -> None:
    """Drop one sender's entry (retry a failure, un-acknowledge a link)."""
    account = account or accounts.default_name()
    with _LOCK:
        data = load()
        if (data["accounts"].get(account) or {}).pop(
                addr.strip().lower(), None) is not None:
            _persist(data)


def rename_account(old: str, new: str) -> None:
    """Move one account's entries to a new account name."""
    with _LOCK:
        data = load()
        if old in data["accounts"]:
            data["accounts"][new] = data["accounts"].pop(old)
            _persist(data)


def drop_account(name: str) -> None:
    with _LOCK:
        data = load()
        if data["accounts"].pop(name, None) is not None:
            _persist(data)


def merge_import(data: dict, known_accounts: set[str]) -> int:
    """Merge an imported backup into the current store (tolerates junk;
    unknown accounts are dropped, same as the verdicts/replied importers).
    MERGES rather than overwrites - like every other import path - so
    restoring an older backup can never erase unsubscribe records made
    since that backup was taken. Returns how many entries were merged."""
    accs = data.get("accounts") if isinstance(data, dict) else None
    n = 0
    for name, entries in (accs or {}).items():
        if name not in known_accounts or not isinstance(entries, dict):
            continue
        clean = {
            str(a).strip().lower(): {
                "status": e.get("status") if e.get("status") in STATUSES
                          else "done",
                "method": str(e.get("method") or "")[:100],
                "detail": str(e.get("detail") or "")[:500],
                "error": str(e.get("error") or "")[:300],
                "ts": int(e.get("ts") or 0)}
            for a, e in entries.items() if isinstance(e, dict)}
        save(clean, name)
        n += len(clean)
    return n


def clear() -> None:
    with _LOCK:
        try:
            _path().unlink()
        except FileNotFoundError:
            pass
        _cache.pop(tenants.current().id, None)
