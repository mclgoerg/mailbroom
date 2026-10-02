"""First-seen tracking for new-sender detection ("screener-lite").

Every distinct sender address, first seen at a given scan, persisted PER
ACCOUNT per tenant - mirrors mailops.py's replied.json exactly (same
file shape family: {"accounts": {name: {...}}}, atomic write, read-side
tolerance for a missing/corrupt file).

The FIRST scan of an account seeds the store silently (every address
scanned becomes "known" with first_seen = 0, i.e. "known forever") and
flags nothing - otherwise the whole mailbox would show as new. A LATER
scan only adds addresses not already in the store (first_seen = that
scan's time); an existing entry's first_seen is never updated/
overwritten. Flagging itself (public_state()'s "new" field, is:new) is
computed fresh each time from first_seen vs. the window - nothing needs
to be re-scanned for an entry to stop being flagged once it ages out.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

from . import tenants

log = logging.getLogger("pmc.knownsenders")

KNOWN_SENDERS_PATH = Path(
    os.environ.get("KNOWN_SENDERS_PATH", "/data/known_senders.json"))

# How long a sender counts as "new" after its first scan. Like RULE_CAP
# and friends, an env-var knob - no dedicated settings UI for this one.
NEW_SENDER_WINDOW_DAYS = float(os.environ.get("NEW_SENDER_WINDOW_DAYS", "7"))


def _path(tenant=None) -> Path:
    return (tenant or tenants.current()).file(
        "known_senders.json", KNOWN_SENDERS_PATH)


def _read(tenant=None) -> dict:
    """Raw file: {"accounts": {name: {addrs: {addr: first_seen_ts}}}}."""
    try:
        data = json.loads(_path(tenant).read_text())
    except (OSError, json.JSONDecodeError):
        return {"accounts": {}}
    if isinstance(data, dict) and isinstance(data.get("accounts"), dict):
        return data
    return {"accounts": {}}


def _write(data: dict, tenant=None) -> None:
    path = _path(tenant)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    tmp.chmod(0o600)
    tmp.replace(path)


def load_account(account: str, tenant=None) -> dict[str, int]:
    """{addr: first_seen_ts} for one account."""
    entry = _read(tenant)["accounts"].get(account) or {}
    addrs = entry.get("addrs")
    return dict(addrs) if isinstance(addrs, dict) else {}


def rename_account(old: str, new: str) -> None:
    """Move one account's known-senders cache to a new account name."""
    try:
        data = _read()
        if old in data["accounts"]:
            data["accounts"][new] = data["accounts"].pop(old)
            _write(data)
    except OSError:
        log.exception("could not rename known_senders account")


def drop_account(name: str) -> None:
    try:
        data = _read()
        if data["accounts"].pop(name, None) is not None:
            _write(data)
    except OSError:
        log.exception("could not drop known_senders account")


def update_scan(account: str, scanned_addrs: set[str],
                now: int | None = None) -> None:
    """Record every address in `scanned_addrs` not already known - an
    existing entry is never touched. The very first call for an account
    (nothing known yet) seeds the store with first_seen=0 ("known since
    the epoch") instead of `now`, so the scan that seeds the mailbox
    never flags its own senders as new regardless of the configured
    window - only a LATER scan's genuinely new addresses get a real
    first_seen."""
    now = now or int(time.time())
    try:
        data = _read()
        entry = data["accounts"].setdefault(account, {"addrs": {}})
        existing = entry.setdefault("addrs", {})
        is_first_scan = not existing
        new_addrs = scanned_addrs - set(existing)
        if not new_addrs:
            return
        seed_ts = 0 if is_first_scan else now
        for addr in new_addrs:
            existing[addr] = seed_ts
        _write(data)
    except OSError:
        log.exception("could not persist known_senders.json")


def new_since(account: str, window_days: float = NEW_SENDER_WINDOW_DAYS,
             now: float | None = None) -> set[str]:
    """Addresses first seen within the last `window_days`."""
    cutoff = (now or time.time()) - window_days * 86400
    return {a for a, ts in load_account(account).items() if ts >= cutoff}
