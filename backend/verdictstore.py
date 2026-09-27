"""Persistent cache of AI verdicts, so rescans don't re-bill the LLM.

Group verdicts (keyed by grouping + group key) are namespaced PER ACCOUNT
— the same sender key can mean different things in different mailboxes.
Per-mail verdicts ("_mails", keyed by Message-ID) stay GLOBAL: Message-IDs
are unique and a mail's rating doesn't depend on which account holds it.
The old file shape (groupings at the top level) is migrated on read.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

from . import accounts
from . import tenants

VERDICTS_PATH = Path(os.environ.get("VERDICTS_PATH", "/data/ai_verdicts.json"))

_LOCK = threading.Lock()


def _path() -> Path:
    return tenants.current().file("ai_verdicts.json", VERDICTS_PATH)


def load() -> dict:
    """Raw store: {"accounts": {name: {grouping: {...}}}, "_mails": {...}}."""
    try:
        data = json.loads(_path().read_text())
    except (OSError, json.JSONDecodeError):
        return {"accounts": {}, "_mails": {}}
    if not isinstance(data, dict):
        return {"accounts": {}, "_mails": {}}
    return {"accounts": data.get("accounts")
            if isinstance(data.get("accounts"), dict) else {},
            "_mails": data.get("_mails")
            if isinstance(data.get("_mails"), dict) else {}}


def rename_account(old: str, new: str) -> None:
    """Move one account's group verdicts to a new account name."""
    with _LOCK:
        data = load()
        if old in data["accounts"]:
            data["accounts"][new] = data["accounts"].pop(old)
            _persist(data)


def load_account(account: str | None = None) -> dict:
    """{grouping: {key: {verdict, reason}}} of one account."""
    account = account or accounts.default_name()
    return load()["accounts"].get(account) or {}


def _persist(data: dict) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    tmp.chmod(0o600)
    tmp.replace(path)


def save(grouping: str, verdicts: dict[str, dict],
         account: str | None = None) -> None:
    """Merge new {key: {verdict, reason}} entries for one account."""
    account = account or accounts.default_name()
    with _LOCK:
        data = load()
        data["accounts"].setdefault(account, {}).setdefault(
            grouping, {}).update(verdicts)
        _persist(data)


# Per-tenant caches (keyed by tenant id) so the 1/s state snapshot never
# re-reads the file — and never leaks one tenant's ratings into another.
_mails_cache: dict[str, dict[str, str]] = {}


def load_mails() -> dict[str, str]:
    """Per-mail verdicts, keyed by Message-ID (global across the tenant's
    accounts — Message-IDs are unique)."""
    tid = tenants.current().id
    if tid not in _mails_cache:
        _mails_cache[tid] = load().get("_mails") or {}
    return _mails_cache[tid]


def save_mails(verdicts: dict[str, str]) -> None:
    with _LOCK:
        data = load()
        data.setdefault("_mails", {}).update(verdicts)
        _persist(data)
        _mails_cache[tenants.current().id] = data["_mails"]


def clear() -> None:
    with _LOCK:
        try:
            _path().unlink()
        except FileNotFoundError:
            pass
        _mails_cache.pop(tenants.current().id, None)


def apply_to_groups(groups: dict, account: str | None = None) -> int:
    """Attach one account's cached verdicts to scanned groups; returns how
    many were applied."""
    data = load_account(account)
    applied = 0
    for grouping, recs in groups.items():
        cached = data.get(grouping) or {}
        for key, rec in recs.items():
            v = cached.get(key)
            if v and rec.get("ai") is None:
                rec["ai"] = {"verdict": v["verdict"], "reason": v["reason"]}
                applied += 1
    return applied
