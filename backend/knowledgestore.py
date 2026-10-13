"""Private sender knowledge: where the user wants a sender or a company filed
in Smart, per tenant (all of a user's accounts share it - a pharmacy is a
pharmacy).

    {"version": 1, "entries": {"co:<company id>" | "a:<address>": {
        "kind": "<fixed kind>" | "cat:<name of one of the user's categories>",
        "src": "user" | "ai", "ts": <epoch>, "note": "<= 200 chars"}}}

`src` "user": the user filed it. `src` "ai": an AI sorting answer the user
chose to keep (permanent, no fingerprint, ranks below confident evidence -
see smartkinds.classify_unit). Entries are looked up by IDENTITY (an address,
a company id), never by the key of today's Smart unit.

The file lives under the tenant's directory (mode 0600, atomic write, one
in-process lock like aisortstore). It is NEVER logged, never sent to an AI
provider and never echoed in an error message: failures are stable codes
(the frontend maps them to translated texts), counts are the only thing that
may be logged.
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Callable

from . import smartkinds as sk
from . import tenants

KNOWLEDGE_PATH = Path(os.environ.get("SENDER_KNOWLEDGE_PATH",
                                     "/data/sender_knowledge.json"))
VERSION = 1
MAX_ENTRIES = 5000
NOTE_MAX = 200
USER, AI = sk.USER_SRC, sk.KEPT_SRC

# Stable error codes (HTTP detail; frontend api.ts ERROR_CODES).
BAD_REQUEST = "knowledge_bad_request"
BAD_KEY = "knowledge_bad_key"
BAD_KIND = "knowledge_bad_kind"
BAD_NOTE = "knowledge_bad_note"
FULL = "knowledge_full"
AI_RUNNING = "knowledge_ai_running"
UNSCANNED = "knowledge_unscanned"


class KnowledgeError(ValueError):
    """A refused request: `code` is one of the stable codes above. The
    message IS the code - never a key, an address or a company."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


_LOCK = threading.Lock()
_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")


def _path() -> Path:
    return tenants.current().file("sender_knowledge.json", KNOWLEDGE_PATH)


# ------------------------------------------------------------- validation

def normalize_key(key) -> str:
    """The canonical key, or raise BAD_KEY: `a:<address>` or
    `co:<company id>` (smartkinds.valid_*_key - no freemail, shared platform
    or tenant-platform root host as a company), lowercase."""
    if not isinstance(key, str):
        raise KnowledgeError(BAD_KEY)
    key = key.strip().lower()
    prefix, _, rest = key.partition(":")
    ok = (prefix == "a" and sk.valid_address_key(rest)) \
        or (prefix == "co" and sk.valid_company_key(rest))
    if not ok:
        raise KnowledgeError(BAD_KEY)
    return key


def is_valid_key(key) -> bool:
    try:
        normalize_key(key)
        return True
    except KnowledgeError:
        return False


def clean_note(note) -> str:
    if note is None:
        return ""
    if not isinstance(note, str):
        raise KnowledgeError(BAD_NOTE)
    note = _CONTROL.sub(" ", note).strip()
    if len(note) > NOTE_MAX:
        raise KnowledgeError(BAD_NOTE)
    return note


def check_kind(kind, src: str, user_cats) -> str:
    """The kind, or raise BAD_KIND: a fixed kind (smartkinds.SORT_KINDS), or
    - user filings only - `cat:<name>` of a CURRENT user category."""
    if kind in sk.SORT_KINDS:
        return kind
    if src == USER and isinstance(kind, str) \
            and kind.startswith(sk.CATEGORY_PREFIX) \
            and kind[len(sk.CATEGORY_PREFIX):] in user_cats:
        return kind
    raise KnowledgeError(BAD_KIND)


def build_entry(key, kind, src, user_cats, note=None, ts=None) -> tuple[str, dict]:
    """(canonical key, entry) of one validated request; raises
    KnowledgeError. An unknown `src` is a bad request."""
    if src not in (USER, AI):
        raise KnowledgeError(BAD_REQUEST)
    key = normalize_key(key)
    kind = check_kind(kind, src, user_cats)
    stamp = ts if isinstance(ts, int) and not isinstance(ts, bool) \
        and ts > 0 else int(time.time())
    return key, {"kind": kind, "src": src, "ts": stamp,
                 "note": clean_note(note)}


# ---------------------------------------------------------------- storage

def _read_entry(raw) -> dict | None:
    """Read-side tolerance: a damaged entry is dropped, never a crash. The
    key's identity rules are NOT re-checked here (an entry whose company
    later became a platform stays on file, inert, and the GUI says so)."""
    if not isinstance(raw, dict) or not isinstance(raw.get("kind"), str):
        return None
    src = raw.get("src") if raw.get("src") in (USER, AI) else USER
    ts = raw.get("ts")
    note = raw.get("note")
    return {"kind": raw["kind"], "src": src,
            "ts": ts if isinstance(ts, int) and not isinstance(ts, bool) else 0,
            "note": note[:NOTE_MAX] if isinstance(note, str) else ""}


def load() -> dict[str, dict]:
    """{key: {"kind", "src", "ts", "note"}} of the current tenant."""
    try:
        data = json.loads(_path().read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    raw = data.get("entries") if isinstance(data, dict) else None
    out: dict[str, dict] = {}
    for key, entry in (raw if isinstance(raw, dict) else {}).items():
        clean = _read_entry(entry)
        if clean and isinstance(key, str) and key.partition(":")[0] in ("a", "co"):
            out[key] = clean
    return out


def _persist(entries: dict[str, dict]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"version": VERSION, "entries": entries}))
    tmp.chmod(0o600)
    tmp.replace(path)


def modify(change: Callable[[dict[str, dict]], object]):
    """Read, change and write the tenant's entries under the lock. `change`
    mutates the dict it is given and may raise KnowledgeError (then nothing
    is written); its return value is passed on. The file is only rewritten
    when the entries really changed."""
    with _LOCK:
        entries = load()
        before, size = json.dumps(entries, sort_keys=True), len(entries)
        result = change(entries)
        if len(entries) > max(size, MAX_ENTRIES):     # growing past the cap
            raise KnowledgeError(FULL)
        if json.dumps(entries, sort_keys=True) != before:
            _persist(entries)
        return result


def digest(entries: dict[str, dict]) -> str:
    """Part of the Smart signature (see smartkinds.knowledge_digest)."""
    return sk.knowledge_digest(entries)
