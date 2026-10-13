"""Persistent cache of AI-sorted Smart units, per account.

A unit (a lone sender, or the small senders of one company) the rules left in
Other can be sorted by the optional AI sorting. The AI's answer - one of the
fixed kind ids - is stored with a fingerprint of the evidence it saw (the
sample subjects, see smartkinds.unit_fp): when the evidence changes, the entry
stops applying (and is dropped on the next rebuild). Entries are keyed by
`co:<company>` or `a:<address>`. Same shape and locking as verdictstore.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
from pathlib import Path

from . import accounts
from . import tenants

AI_SORT_PATH = Path(os.environ.get("AI_SORT_PATH", "/data/ai_sort.json"))

_LOCK = threading.Lock()


def _path() -> Path:
    return tenants.current().file("ai_sort.json", AI_SORT_PATH)


def load() -> dict:
    """Raw store: {"accounts": {name: {unit key: {"kind", "fp", "sure"}}}}."""
    try:
        data = json.loads(_path().read_text())
    except (OSError, json.JSONDecodeError):
        return {"accounts": {}}
    accs = data.get("accounts") if isinstance(data, dict) else None
    return {"accounts": accs if isinstance(accs, dict) else {}}


def _persist(data: dict) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    tmp.chmod(0o600)
    tmp.replace(path)


def load_account(account: str | None = None) -> dict[str, dict]:
    account = account or accounts.default_name()
    mine = load()["accounts"].get(account)
    return {k: v for k, v in (mine or {}).items()
            if isinstance(v, dict) and isinstance(v.get("kind"), str)
            and isinstance(v.get("fp"), str)}


def save(entries: dict[str, dict], account: str | None = None) -> None:
    """Merge {unit key: {"kind", "fp", "sure"}} into one account's entries.
    `sure` (older entries have none): the AI was confident - for "other" that
    means it belongs there, not that the AI could not tell."""
    account = account or accounts.default_name()
    with _LOCK:
        data = load()
        data["accounts"].setdefault(account, {}).update(entries)
        _persist(data)


def drop(keys: list[str], account: str | None = None) -> None:
    account = account or accounts.default_name()
    with _LOCK:
        data = load()
        mine = data["accounts"].get(account) or {}
        for k in keys:
            mine.pop(k, None)
        _persist(data)


def clear(account: str | None = None) -> int:
    """Forget every AI-sorted unit of one account; returns how many."""
    account = account or accounts.default_name()
    with _LOCK:
        data = load()
        n = len(data["accounts"].pop(account, None) or {})
        _persist(data)
        return n


def drop_account(name: str) -> None:
    """An account was deleted: its AI answers go with it."""
    clear(name)


def rename_account(old: str, new: str) -> None:
    with _LOCK:
        data = load()
        if old in data["accounts"]:
            data["accounts"][new] = data["accounts"].pop(old)
            _persist(data)


def digest(entries: dict[str, dict]) -> str:
    """Short fingerprint of an account's entries (part of the Smart
    signature: a change re-derives the rows on restore)."""
    items = sorted((k, v["kind"], v["fp"], bool(v.get("sure")))
                   for k, v in entries.items())
    return hashlib.sha1(json.dumps(items).encode()).hexdigest()[:12]
