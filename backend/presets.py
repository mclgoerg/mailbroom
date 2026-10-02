"""Saved filter presets: a named, recallable filter-box query.

A preset is just {id, name, query, account} - the query string is stored
verbatim (same DSL the filter box and rules.py's match_group use), never
parsed or validated here. Persistence/publish mirrors rules.py's pattern
(per-tenant JSON file, atomic save, mirrored into each account's state so
SSE clients see their own presets), but there is no engine or scheduler:
presets are inert until a user taps one.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from pathlib import Path

from . import accounts
from . import tenants

PRESETS_PATH = Path(os.environ.get("PRESETS_PATH", "/data/presets.json"))

NAME_MAX = 60
QUERY_MAX = 300
PRESET_CAP = 20     # max saved presets per account

_LOCK = threading.Lock()


def _path() -> Path:
    return tenants.current().file("presets.json", PRESETS_PATH)


def load_presets() -> list[dict]:
    try:
        data = json.loads(_path().read_text())
        presets = data.get("presets", []) if isinstance(data, dict) else []
    except (OSError, json.JSONDecodeError):
        return []
    return [p for p in presets if isinstance(p, dict)]


def _save(presets: list[dict]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"presets": presets}, indent=1))
    tmp.chmod(0o600)
    tmp.replace(path)
    _publish(presets)


def _publish(presets: list[dict]) -> None:
    """Mirror each account's presets into its state so SSE clients see
    them (strict separation: an account never sees another's presets)."""
    for name in accounts.names():
        acc = accounts.get(name)
        mine = [p for p in presets if p.get("account", name) == name]
        with acc.lock:
            acc.state["presets"] = mine


def publish() -> None:
    """Startup: mirror every tenant's presets into their account states."""
    for tenant in tenants.known():
        with tenants.use(tenant):
            _publish(load_presets())


def rename_account(old: str, new: str) -> None:
    """Point presets of a renamed account at its new name."""
    with _LOCK:
        presets = load_presets()
        changed = False
        for p in presets:
            if p.get("account") == old:
                p["account"] = new
                changed = True
        if changed:
            _save(presets)


def drop_account(name: str) -> None:
    """Forget a deleted account's presets."""
    with _LOCK:
        presets = load_presets()
        kept = [p for p in presets if p.get("account") != name]
        if len(kept) != len(presets):
            _save(kept)


def create_preset(body: dict) -> dict:
    account = body.get("account") or accounts.default_name()
    if account not in accounts.names():
        raise ValueError(f"unknown account {account!r}")
    name = str(body.get("name", "")).strip()[:NAME_MAX]
    if not name:
        raise ValueError("preset needs a name")
    query = str(body.get("query", "")).strip()[:QUERY_MAX]
    with _LOCK:
        presets = load_presets()
        if sum(1 for p in presets if p.get("account") == account) \
                >= PRESET_CAP:
            raise ValueError(
                f"at most {PRESET_CAP} saved presets per account")
        preset = {"id": uuid.uuid4().hex[:8], "name": name, "query": query,
                  "account": account}
        presets.append(preset)
        _save(presets)
    return preset


def update_preset(preset_id: str, body: dict) -> dict:
    """Full replace of name+query (account stays put - editing never
    moves a preset to another account)."""
    name = str(body.get("name", "")).strip()[:NAME_MAX]
    if not name:
        raise ValueError("preset needs a name")
    query = str(body.get("query", "")).strip()[:QUERY_MAX]
    with _LOCK:
        presets = load_presets()
        preset = next((p for p in presets if p["id"] == preset_id), None)
        if not preset:
            raise KeyError(preset_id)
        preset["name"] = name
        preset["query"] = query
        _save(presets)
    return preset


def delete_preset(preset_id: str) -> None:
    with _LOCK:
        presets = load_presets()
        if not any(p["id"] == preset_id for p in presets):
            raise KeyError(preset_id)
        _save([p for p in presets if p["id"] != preset_id])
