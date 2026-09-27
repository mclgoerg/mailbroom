"""Cleanup history: per-scan snapshots and per-month action tallies.

Persisted to /data/stats_history.json, namespaced PER ACCOUNT (strict
separation — nothing is aggregated across accounts). The old
single-account file shape ({scans, actions}) is migrated on read.
Pure bookkeeping — no IMAP access here; live-index numbers (histogram,
top domains) come from mailops.index_stats().
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

log = logging.getLogger("pmc.stats")

HISTORY_PATH = Path(
    os.environ.get("STATS_HISTORY_PATH", "/data/stats_history.json"))
MAX_SCANS = 200


def _path() -> Path:
    return tenants.current().file("stats_history.json", HISTORY_PATH)

_LOCK = threading.Lock()

_ACTIONS = ("trash", "archive", "move", "mark_read")

_EMPTY = {"scans": [], "actions": {}}


def _load_all() -> dict:
    """Raw file: {"accounts": {name: {scans, actions}}}, migrating the old
    single-account top-level shape into the default account."""
    try:
        data = json.loads(_path().read_text())
    except (OSError, json.JSONDecodeError):
        return {"accounts": {}}
    if not isinstance(data, dict):
        return {"accounts": {}}
    if isinstance(data.get("accounts"), dict):
        return data
    if "scans" in data or "actions" in data:    # pre-multi-account format
        return {"accounts": {accounts.default_name(): {
            "scans": data.get("scans", []),
            "actions": data.get("actions", {})}}}
    return {"accounts": {}}


def rename_account(old: str, new: str) -> None:
    """Move one account's history to a new account name."""
    with _LOCK:
        data = _load_all()
        if old in data["accounts"]:
            data["accounts"][new] = data["accounts"].pop(old)
            _write(data)


def load(account: str | None = None) -> dict:
    """One account's history (default: the default account)."""
    account = account or accounts.default_name()
    entry = _load_all()["accounts"].get(account) or {}
    return {"scans": entry.get("scans", []),
            "actions": entry.get("actions", {})}


def _write(data: dict) -> None:
    try:
        path = _path()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        tmp.chmod(0o600)
        tmp.replace(path)
    except OSError:
        log.exception("could not persist stats history")


def record_scan(mails: int, size: int, senders: int,
                account: str | None = None) -> None:
    account = account or accounts.default_name()
    with _LOCK:
        data = _load_all()
        entry = data["accounts"].setdefault(
            account, json.loads(json.dumps(_EMPTY)))
        entry.setdefault("scans", []).append(
            {"ts": int(time.time()), "mails": mails,
             "size": size, "senders": senders})
        entry["scans"] = entry["scans"][-MAX_SCANS:]
        _write(data)


def admin_overview() -> list[dict]:
    """Per-tenant USAGE numbers for the admin: counts, spend, timestamps
    and disk footprint only — deliberately NO account names, addresses,
    folder names or any other mail-derived content. The only identifier
    is the tenant's storage id."""
    # Lazy imports: mailops imports this module at load time.
    from . import config as cfgmod
    from . import mailops
    from . import rules as rulesmod
    from . import verdictstore

    def fsize(path) -> int:
        try:
            return path.stat().st_size
        except OSError:
            return 0

    month = time.strftime("%Y-%m")
    out = []
    for tenant in tenants.known():
        with tenants.use(tenant):
            cfg = cfgmod.load_config()
            ai_eff, ai_source = cfgmod.effective_ai(cfg)
            usage = cfgmod.load_stats()
            hist = _load_all()["accounts"]
            scans = [s for e in hist.values() for s in e.get("scans", [])]
            mails = size = 0
            for e in hist.values():
                if e.get("scans"):
                    mails += e["scans"][-1].get("mails", 0)
                    size += e["scans"][-1].get("size", 0)
            acts = {a: 0 for a in _ACTIONS} | {"freed": 0}
            for e in hist.values():
                for k, v in (e.get("actions", {}).get(month) or {}).items():
                    acts[k] = acts.get(k, 0) + v
            vdata = verdictstore.load()
            verdicts = sum(len(v) for acct in vdata["accounts"].values()
                           for v in acct.values()) + len(vdata["_mails"])
            disk = sum(fsize(p) for p in (
                cfgmod.config_path(), cfgmod.stats_path(),
                verdictstore._path(), rulesmod._path(), _path(),
                mailops._replied_path(),
                *(mailops._snap_path(n) for n in cfg["accounts"])))
            out.append({
                "id": tenant.id,
                # "default" is just the storage id of the pre-tenancy
                # workspace — display the admin identity instead. Other
                # tenants keep their directory id (their subject is not
                # recoverable from the slug, by design).
                "label": (cfgmod.load_server()["auth"].get("admin") or "")
                if tenant.is_default else "",
                "is_admin_workspace": tenant.is_default,
                "accounts": len(cfg["accounts"]),
                "mails": mails, "size": size,
                "scans": len(scans),
                "last_scan_ts": max((s.get("ts", 0) for s in scans),
                                    default=None),
                "rules": len(rulesmod.load_rules()),
                "verdicts": verdicts,
                "actions_month": acts,
                "ai": {"source": ai_source,
                       "runs": usage.get("runs", 0),
                       "input_tokens": usage.get("input_tokens", 0),
                       "output_tokens": usage.get("output_tokens", 0),
                       "cost": usage.get("cost", 0.0),
                       "month_cost": cfgmod.month_cost(),
                       "budget_usd": float(ai_eff.get("budget_usd") or 0)},
                "disk_bytes": disk,
            })
    out.sort(key=lambda r: (not r["is_admin_workspace"], r["id"]))
    return out


def record_action(action: str, count: int, size: int,
                  account: str | None = None) -> None:
    """Tally one finished job into the current month. `size` should be the
    bytes moved; only trash counts towards 'freed'."""
    if action not in _ACTIONS or count <= 0:
        return
    account = account or accounts.default_name()
    month = time.strftime("%Y-%m")
    with _LOCK:
        data = _load_all()
        entry = data["accounts"].setdefault(
            account, json.loads(json.dumps(_EMPTY)))
        m = entry.setdefault("actions", {}).setdefault(
            month, {a: 0 for a in _ACTIONS} | {"freed": 0})
        m[action] = m.get(action, 0) + count
        if action == "trash":
            m["freed"] = m.get("freed", 0) + size
        _write(data)
