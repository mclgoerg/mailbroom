"""Persistent cache of AI group verdicts, so rescans don't re-bill the LLM.

Keyed by grouping + group key. Applied to freshly scanned groups; the AI
review only evaluates groups without a cached verdict.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

VERDICTS_PATH = Path(os.environ.get("VERDICTS_PATH", "/data/ai_verdicts.json"))

_LOCK = threading.Lock()


def load() -> dict:
    try:
        data = json.loads(VERDICTS_PATH.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save(grouping: str, verdicts: dict[str, dict]) -> None:
    """Merge new {key: {verdict, reason}} entries for a grouping."""
    with _LOCK:
        data = load()
        data.setdefault(grouping, {}).update(verdicts)
        VERDICTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = VERDICTS_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        tmp.chmod(0o600)
        tmp.replace(VERDICTS_PATH)


_mails_cache: dict[str, str] | None = None   # avoids re-reading the file
                                             # on every state snapshot


def load_mails() -> dict[str, str]:
    """Per-mail verdicts, keyed by Message-ID (stable across rescans)."""
    global _mails_cache
    if _mails_cache is None:
        _mails_cache = load().get("_mails") or {}
    return _mails_cache


def save_mails(verdicts: dict[str, str]) -> None:
    global _mails_cache
    with _LOCK:
        data = load()
        data.setdefault("_mails", {}).update(verdicts)
        VERDICTS_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = VERDICTS_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        tmp.chmod(0o600)
        tmp.replace(VERDICTS_PATH)
        _mails_cache = data["_mails"]


def clear() -> None:
    global _mails_cache
    with _LOCK:
        try:
            VERDICTS_PATH.unlink()
        except FileNotFoundError:
            pass
        _mails_cache = None


def apply_to_groups(groups: dict) -> int:
    """Attach cached verdicts to scanned groups; returns how many applied."""
    data = load()
    applied = 0
    for grouping, recs in groups.items():
        if grouping.startswith("_"):
            continue
        cached = data.get(grouping) or {}
        for key, rec in recs.items():
            v = cached.get(key)
            if v and rec.get("ai") is None:
                rec["ai"] = {"verdict": v["verdict"], "reason": v["reason"]}
                applied += 1
    return applied
