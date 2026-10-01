"""Append-only, per-tenant audit log of every action Mailbroom performs on
a mailbox: trash/archive/move/mark_read (incl. rule-triggered), rule runs,
unsubscribes, undo and empty-trash.

Persisted as JSONL (one JSON object per line) via
`tenants.current().file(...)`, the same per-tenant pattern as
`stats.py`/`rules.py` - strict separation, nothing aggregated across
tenants. Size-capped: once the file grows past MAX_ENTRIES it is rewritten
atomically (tmp + replace, like `rules._save`) keeping only the newest
entries.

Never log mail bodies or secrets - addresses/subjects/labels only (the
same data class as the existing stats history and group state).
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from pathlib import Path

from . import accounts
from . import tenants

log = logging.getLogger("pmc.auditlog")

AUDIT_PATH = Path(os.environ.get("AUDIT_LOG_PATH", "/data/audit_log.jsonl"))
MAX_ENTRIES = 10_000

_LOCK = threading.Lock()


def _path() -> Path:
    return tenants.current().file("audit_log.jsonl", AUDIT_PATH)


def _rewrite(path: Path, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text("".join(f"{line}\n" for line in lines))
    tmp.chmod(0o600)
    tmp.replace(path)


def _needs_leading_newline(path: Path) -> bool:
    """True if the file has content and does not end in a newline - a
    process that crashed mid-write could have left a truncated last line;
    starting the next append on its own line keeps that truncated line
    (and only that line) unparseable, instead of silently merging it into
    the next entry."""
    try:
        with path.open("rb") as f:
            f.seek(0, os.SEEK_END)
            if f.tell() == 0:
                return False
            f.seek(-1, os.SEEK_END)
            return f.read(1) != b"\n"
    except OSError:
        return False


def record(action: str, actor: str = "user", account: str | None = None,
          count: int = 0, size: int = 0, label: str = "",
          outcome: str = "ok", error: str = "") -> None:
    """Append one entry. Never raises - a logging failure must not break
    the mailbox action it is recording."""
    account = account or accounts.default_name()
    entry = {"ts": int(time.time()), "account": account, "actor": actor,
             "action": action, "count": count, "bytes": size,
             "label": str(label)[:200], "outcome": outcome,
             "error": str(error)[:300]}
    try:
        with _LOCK:
            path = _path()
            path.parent.mkdir(parents=True, exist_ok=True)
            prefix = "\n" if _needs_leading_newline(path) else ""
            with path.open("a") as f:
                f.write(prefix + json.dumps(entry) + "\n")
            try:
                lines = path.read_text().splitlines()
            except OSError:
                lines = []
            if len(lines) > MAX_ENTRIES:
                _rewrite(path, lines[-MAX_ENTRIES:])
    except OSError:
        log.exception("could not persist audit log entry")


def _load_all(account: str) -> list[dict]:
    """This tenant's entries for one account, oldest first. Tolerates a
    partial/corrupt trailing line (e.g. a crash mid-write) and entries
    from a future schema version missing fields we know about."""
    try:
        lines = _path().read_text().splitlines()
    except OSError:
        return []
    out = []
    for line in lines:
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(entry, dict) or entry.get("account") != account:
            continue
        out.append({
            "ts": entry.get("ts", 0), "account": entry.get("account", ""),
            "actor": entry.get("actor", "user"),
            "action": entry.get("action", ""), "count": entry.get("count", 0),
            "bytes": entry.get("bytes", 0), "label": entry.get("label", ""),
            "outcome": entry.get("outcome", "ok"),
            "error": entry.get("error", "")})
    return out


def load(account: str | None = None, offset: int = 0,
        limit: int = 50) -> dict:
    """One account's entries, newest first, paged: {total, entries}."""
    account = account or accounts.default_name()
    entries = list(reversed(_load_all(account)))
    return {"total": len(entries),
            "entries": entries[max(0, offset):max(0, offset) + max(0, limit)]}


def rename_account(old: str, new: str) -> None:
    """Point every entry of a renamed account at its new name (mirrors
    stats.rename_account / rules.rename_account)."""
    with _LOCK:
        path = _path()
        try:
            lines = path.read_text().splitlines()
        except OSError:
            return
        changed = False
        out = []
        for line in lines:
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                out.append(line)
                continue
            if isinstance(entry, dict) and entry.get("account") == old:
                entry["account"] = new
                changed = True
            out.append(json.dumps(entry))
        if changed:
            _rewrite(path, out)
