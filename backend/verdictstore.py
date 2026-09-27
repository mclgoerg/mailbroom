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

VERDICTS_PATH = Path(os.environ.get("VERDICTS_PATH", "/data/ai_verdicts.json"))

_LOCK = threading.Lock()

_GROUPINGS = ("sender", "domain", "subject")


def load() -> dict:
    """Raw store: {"accounts": {name: {grouping: {...}}}, "_mails": {...}},
    migrating old top-level groupings into the default account."""
    try:
        data = json.loads(VERDICTS_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return {"accounts": {}, "_mails": {}}
    if not isinstance(data, dict):
        return {"accounts": {}, "_mails": {}}
    out = {"accounts": data.get("accounts")
           if isinstance(data.get("accounts"), dict) else {},
           "_mails": data.get("_mails")
           if isinstance(data.get("_mails"), dict) else {}}
    legacy = {g: v for g, v in data.items()
              if g in _GROUPINGS and isinstance(v, dict)}
    if legacy:                                   # pre-multi-account format
        acct = out["accounts"].setdefault(accounts.default_name(), {})
        for g, v in legacy.items():
            acct.setdefault(g, {}).update(v)
    return out


def load_account(account: str | None = None) -> dict:
    """{grouping: {key: {verdict, reason}}} of one account."""
    account = account or accounts.default_name()
    return load()["accounts"].get(account) or {}


def _persist(data: dict) -> None:
    VERDICTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = VERDICTS_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    tmp.chmod(0o600)
    tmp.replace(VERDICTS_PATH)


def save(grouping: str, verdicts: dict[str, dict],
         account: str | None = None) -> None:
    """Merge new {key: {verdict, reason}} entries for one account."""
    account = account or accounts.default_name()
    with _LOCK:
        data = load()
        data["accounts"].setdefault(account, {}).setdefault(
            grouping, {}).update(verdicts)
        _persist(data)


_mails_cache: dict[str, str] | None = None   # avoids re-reading the file
                                             # on every state snapshot


def load_mails() -> dict[str, str]:
    """Per-mail verdicts, keyed by Message-ID (global across accounts)."""
    global _mails_cache
    if _mails_cache is None:
        _mails_cache = load().get("_mails") or {}
    return _mails_cache


def save_mails(verdicts: dict[str, str]) -> None:
    global _mails_cache
    with _LOCK:
        data = load()
        data.setdefault("_mails", {}).update(verdicts)
        _persist(data)
        _mails_cache = data["_mails"]


def clear() -> None:
    global _mails_cache
    with _LOCK:
        try:
            VERDICTS_PATH.unlink()
        except FileNotFoundError:
            pass
        _mails_cache = None


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
