"""Pinned ("protected") single mails - exempt from every bulk action.

A pin is a Message-ID in a per-account set, so it survives rescans,
incremental scans and folder moves (UIDs don't). Mirrors verdictstore.py's
persistence (per-tenant file, atomic write, tolerant read) but stays
STRICTLY per account: unlike AI verdicts, a pin is a decision about one
mailbox and must never leak into another account that happens to hold a
copy of the same mail.

File shape: {"accounts": {name: [message-id, ...]}}. Anything that does
not fit that shape is ignored on read - a damaged file must never take the
app down, it only forgets the pins it cannot understand.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

from . import accounts
from . import tenants

PINS_PATH = Path(os.environ.get("PINS_PATH", "/data/pinned_mails.json"))

_LOCK = threading.Lock()

# Per-tenant cache (keyed by tenant id) so public_state() never re-reads
# the file - and never leaks one tenant's pins into another.
_cache: dict[str, dict[str, set[str]]] = {}


def _path() -> Path:
    return tenants.current().file("pinned_mails.json", PINS_PATH)


def _read() -> dict[str, set[str]]:
    try:
        data = json.loads(_path().read_text())
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return {}
    accs = data.get("accounts") if isinstance(data, dict) else None
    if not isinstance(accs, dict):
        return {}
    return {name: {m for m in mids if isinstance(m, str) and m}
            for name, mids in accs.items() if isinstance(mids, list)}


def _load() -> dict[str, set[str]]:
    tid = tenants.current().id
    if tid not in _cache:
        _cache[tid] = _read()
    return _cache[tid]


def _persist(data: dict[str, set[str]]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(
        {"accounts": {n: sorted(s) for n, s in data.items() if s}}))
    tmp.chmod(0o600)
    tmp.replace(path)
    _cache[tenants.current().id] = data


def load_account(account: str | None = None) -> set[str]:
    """The pinned Message-IDs of one account (a copy - safe to keep)."""
    account = account or accounts.default_name()
    with _LOCK:
        return set(_load().get(account, ()))


def is_pinned(msgid: str, account: str | None = None) -> bool:
    return bool(msgid) and msgid in load_account(account)


def set_pinned(msgid: str, pinned: bool, account: str | None = None) -> None:
    """Pin or unpin one Message-ID of one account."""
    account = account or accounts.default_name()
    with _LOCK:
        data = _load()
        if pinned == (msgid in data.get(account, ())):
            return
        mine = set(data.get(account, ()))
        mine.add(msgid) if pinned else mine.discard(msgid)
        _persist({**data, account: mine})


def rename_account(old: str, new: str) -> None:
    """Move one account's pins to a new account name."""
    with _LOCK:
        data = _load()
        if old in data:
            moved = {k: v for k, v in data.items() if k != old}
            moved[new] = data[old]
            _persist(moved)


def drop_account(name: str) -> None:
    with _LOCK:
        data = _load()
        if name in data:
            _persist({k: v for k, v in data.items() if k != name})
