"""Private sender knowledge: the operations behind /api/knowledge.

The store (knowledgestore.py) holds what the user filed - or kept from an AI
answer - per sender address or company; Smart placement reads it
(smartkinds.classify_unit, mailops.build_smart). This module validates and
applies the changes, tells the GUI what each entry does right now, and moves
AI answers between the AI cache (aisortstore) and the knowledge.

Privacy: nothing here logs a key, an address or a company - counts only - and
a refusal is a stable code, never a message that names its subject.
"""

from __future__ import annotations

import logging
import time
from typing import NamedTuple

from . import accounts
from . import aisortstore
from . import config as cfgmod
from . import knowledgestore as ks
from . import mailops
from . import smartkinds as sk

log = logging.getLogger("pmc.knowledge")
KnowledgeError = ks.KnowledgeError

# Why an entry has no effect right now (GUI texts), most telling first.
REASONS = ("own_row", "company_row", "protected", "replied", "rules_confident",
           "decided_by_rules", "shadowed", "freemail", "in_company_group",
           "not_applied")


def _loose_key(key) -> str:
    """A key as stored: shape only. An entry whose company later became a
    platform host (an invalid key now) must still be removable."""
    if isinstance(key, str):
        key = key.strip().lower()
        prefix, _, rest = key.partition(":")
        if prefix in ("a", "co") and rest:
            return key
    raise KnowledgeError(ks.BAD_KEY)


def _tenant_accounts(cfg: dict) -> list:
    return [accounts.get(name) for name in cfg["accounts"]]


def _ai_running(cfg: dict) -> bool:
    return any(acc.state["ai"]["status"] == "running"
               for acc in _tenant_accounts(cfg))


# ---------------------------------------------------------------- changes

def put(body) -> dict:
    """Save and / or remove entries in ONE validated, atomic request.
    `{"key", "kind", "note"?}` files one entry, `{"entries": [...]}` many (each
    {key, kind, note?, src?, ts?}: `src` and `ts` let an Undo restore an
    entry exactly), `"remove": [keys]` removes (also alone). Rebuilds Smart
    once. Returns `previous`: {key: the entry that was there, or null} - what
    an Undo restores."""
    if not isinstance(body, dict):
        raise KnowledgeError(ks.BAD_REQUEST)
    items = body["entries"] if "entries" in body \
        else [body] if "key" in body else []
    remove = body.get("remove") or []
    if not isinstance(items, list) or not isinstance(remove, list) \
            or not (items or remove) \
            or len(items) + len(remove) > ks.MAX_ENTRIES:
        raise KnowledgeError(ks.BAD_REQUEST)
    cats = mailops.user_categories(cfgmod.load_config())
    built: list[tuple[str, dict, bool]] = []
    for it in items:
        if not isinstance(it, dict):
            raise KnowledgeError(ks.BAD_REQUEST)
        key, entry = ks.build_entry(it.get("key"), it.get("kind"),
                                    it.get("src", ks.USER), cats,
                                    it.get("note"), it.get("ts"))
        built.append((key, entry, "note" in it))
    removals = [_loose_key(k) for k in remove]

    def change(entries: dict) -> dict:
        previous: dict[str, dict | None] = {}
        for key, entry, has_note in built:
            previous.setdefault(key, entries.get(key))
            if not has_note and key in entries:
                entry["note"] = entries[key]["note"]     # re-filing keeps the note
            entries[key] = entry
        for key in removals:
            previous.setdefault(key, entries.get(key))
            entries.pop(key, None)
        return previous

    previous = ks.modify(change)
    log.info("sender knowledge: %d saved, %d removed", len(built),
             len(removals))
    mailops.rebuild_smart_all()
    return {"ok": True, "saved": len(built), "removed": len(removals),
            "previous": previous}


def forget(key) -> dict:
    """DELETE one entry (also the way to "reset to automatic")."""
    return put({"remove": [key]})


def keep_ai(acc, keys=None, everything: bool = False) -> dict:
    """Keep chosen AI answers of one account: each becomes a permanent
    `src: "ai"` entry and its cached copy is REMOVED (one source of truth).
    Only answers that apply right now can be kept (a stale one would be made
    permanent on evidence nobody saw), and not the AI's "could not tell".
    Refused while an AI run is going."""
    cfg = cfgmod.load_config()
    if _ai_running(cfg):
        raise KnowledgeError(ks.AI_RUNNING)
    if not everything and (not isinstance(keys, list) or not keys):
        raise KnowledgeError(ks.BAD_REQUEST)
    cached = aisortstore.load_account(acc.name)
    with acc.lock:
        # unit key -> senders it covers (a small company's answer covers
        # all its senders); the user is told in senders everywhere
        applying: dict[str, int] = {}
        for addr, rec in acc.state["groups"]["sender"].items():
            why = rec.get("smart_why") or {}
            if why.get("r") == "ai" and why.get("k") != "other":
                key = f"co:{why['co']}" if why.get("co") else f"a:{addr}"
                applying[key] = applying.get(key, 0) + 1
    wanted = set(applying) if everything else \
        {k for k in keys if isinstance(k, str)} & set(applying)
    chosen = {k: cached[k]["kind"] for k in sorted(wanted)
              if k in cached and cached[k]["kind"] in sk.SORT_KINDS
              and cached[k]["kind"] != "other" and ks.is_valid_key(k)}
    asked = sum(applying[k] for k in wanted)         # senders asked for
    if not chosen:
        return {"ok": True, "kept": 0, "senders": 0, "skipped": asked}
    now = int(time.time())

    def change(entries: dict) -> list[str]:
        # (an own filing of the same key - possibly inactive for now - is
        # never overwritten by an AI answer)
        kept = [k for k in chosen if entries.get(k, {}).get("src") != ks.USER]
        for key in kept:
            entries[key] = {"kind": chosen[key], "src": ks.AI, "ts": now,
                            "note": ""}
        return kept

    kept = ks.modify(change)
    aisortstore.drop(kept, acc.name)                    # a move, not a copy
    covered = sum(applying[k] for k in kept)
    log.info("sender knowledge: %d AI answers kept (%d senders)", len(kept),
             covered)
    if kept:
        mailops.rebuild_smart_all()
    # `kept` = answers stored, `senders` = senders they cover, `skipped` =
    # senders asked for whose answer could not be kept (an own filing of the
    # same key exists, or the key is not valid)
    return {"ok": True, "kept": len(kept), "senders": covered,
            "skipped": asked - covered}


def forget_ai() -> dict:
    """Remove every kept AI answer (the user's own filings stay)."""
    cfg = cfgmod.load_config()
    if _ai_running(cfg):
        raise KnowledgeError(ks.AI_RUNNING)

    def change(entries: dict) -> int:
        gone = [k for k, e in entries.items() if e["src"] == ks.AI]
        for k in gone:
            del entries[k]
        return len(gone)

    n = ks.modify(change)
    log.info("sender knowledge: %d kept AI answers forgotten", n)
    if n:
        mailops.rebuild_smart_all()
    return {"ok": True, "forgotten": n}


def remove_unused() -> dict:
    """Remove the entries no sender of any account matches. Only when EVERY
    configured account has a finished scan - an entry for a mailbox that is
    not loaded is `unknown`, never `unused`."""
    cfg = cfgmod.load_config()
    entries = ks.load()
    info = _live(cfg, entries)
    if not info.complete:
        raise KnowledgeError(ks.UNSCANNED)
    unused = {k for k, row in info.rows.items() if row["status"] == "unused"}

    def change(current: dict) -> int:
        gone = [k for k in unused if k in current
                and current[k] == entries.get(k)]          # not edited since
        for k in gone:
            del current[k]
        return len(gone)

    n = ks.modify(change)
    log.info("sender knowledge: %d unused entries removed", n)
    if n:
        mailops.rebuild_smart_all()
    return {"ok": True, "removed": n}


# -------------------------------------------------------------- live info

class _Live(NamedTuple):
    rows: dict[str, dict]       # entry key -> {status, reason, senders, filed, rows}
    complete: bool              # every configured account has a finished scan
    unscanned: list[str]


def _reason(why: dict, entry: dict, members_freemail: bool) -> str:
    """Why one matching sender is NOT filed by this entry."""
    r = why.get("r")
    if r in ("own", "company", "protected", "replied"):
        return {"own": "own_row", "company": "company_row",
                "protected": "protected", "replied": "replied"}[r]
    if r in ("purpose", "category"):
        return "rules_confident"
    if r in ("newsletter", "individual", "notification"):
        return "decided_by_rules"
    if r in ("rule", "kept_ai"):
        return "shadowed"                # another entry decided this sender
    if entry["src"] == ks.AI:
        if entry["kind"] in sk.PURPOSES and members_freemail:
            return "freemail"
        if why.get("co"):
            return "in_company_group"    # a kept answer never splits a unit
    return "not_applied"


def _live(cfg: dict, entries: dict[str, dict]) -> _Live:
    """What each entry does right now, from the loaded scans of the tenant's
    accounts (their senders' `smart_key` / `smart_why` stamps)."""
    cats = mailops.user_categories(cfg)
    by_addr: dict[str, list[tuple[str, dict]]] = {}
    by_company: dict[str, set[str]] = {}
    unscanned: list[str] = []
    need_company = any(k.startswith("co:") for k in entries)
    for acc in _tenant_accounts(cfg):
        with acc.lock:
            if acc.state["status"] != "done":
                unscanned.append(acc.name)
                continue
            for addr, rec in acc.state["groups"]["sender"].items():
                by_addr.setdefault(addr, []).append(
                    (rec.get("smart_key") or "", rec.get("smart_why") or {}))
                if need_company and (cid := sk.sender_company(addr)):
                    by_company.setdefault(cid, set()).add(addr)
    complete = not unscanned and bool(cfg["accounts"])
    rows: dict[str, dict] = {}
    for key, entry in entries.items():
        prefix, _, rest = key.partition(":")
        kind = entry["kind"]
        row = {"status": "active", "reason": "", "senders": 0, "filed": 0,
               "rows": []}
        rows[key] = row
        valid = sk.valid_address_key(rest) if prefix == "a" \
            else sk.valid_company_key(rest)
        if not valid:
            row.update(status="inert", reason="invalid_key")
            continue
        if kind.startswith(sk.CATEGORY_PREFIX) \
                and kind[len(sk.CATEGORY_PREFIX):] not in cats:
            row.update(status="inactive", reason="inactive_category")
            continue
        if kind not in sk.SORT_KINDS and not kind.startswith(sk.CATEGORY_PREFIX):
            row.update(status="inert", reason="invalid_kind")
            continue
        addrs = [rest] if prefix == "a" else sorted(by_company.get(rest, ()))
        matches = [(a, m) for a in addrs for m in by_addr.get(a, ())]
        row["senders"] = len({a for a, _ in matches})
        row["rows"] = sorted({m[0] for _, m in matches})[:5]
        if not matches:
            row.update(status="unused" if complete else "unknown")
            continue
        rank = "rule" if entry["src"] == ks.USER else "kept_ai"
        # `filed`: the senders this entry actually decides right now (a sender
        # that merely matches, e.g. one with its own row, is not counted)
        row["filed"] = len({a for a, (_, why) in matches
                            if why.get("r") == rank and why.get("by") == prefix})
        if row["filed"]:
            continue                                        # active
        reasons = [_reason(why, entry, sk.is_freemail(a.rpartition("@")[2]))
                   for a, (_, why) in matches]
        row.update(status="no_effect",
                   reason=min(reasons, key=REASONS.index))
    return _Live(rows, complete, unscanned)


def listing() -> dict:
    """GET /api/knowledge: every entry with what it does now."""
    cfg = cfgmod.load_config()
    entries = ks.load()
    live = _live(cfg, entries)
    return {
        "entries": [{"key": k, **e, **live.rows[k]}
                    for k, e in sorted(entries.items())],
        "complete": live.complete, "unscanned": live.unscanned,
        "categories": sorted(mailops.user_categories(cfg)),
        "max": ks.MAX_ENTRIES, "ai_running": _ai_running(cfg),
    }


# ----------------------------------------------------------- export / import

def export_section() -> dict:
    return {"version": ks.VERSION, "entries": ks.load()}


def import_section(data) -> int:
    """MERGE an exported section: every entry is validated like a PUT (an
    invalid one is skipped, `src` is kept only when valid), the total stays
    within the cap, and on a clash the newer entry wins. Apply AFTER the
    config import (a `cat:` entry needs its category) and BEFORE the Smart
    rebuild. Returns how many entries were added or updated."""
    raw = data.get("entries") if isinstance(data, dict) else None
    if not isinstance(raw, dict):
        return 0
    cats = mailops.user_categories(cfgmod.load_config())
    incoming: dict[str, dict] = {}
    for key, item in raw.items():
        if not isinstance(item, dict) or len(incoming) >= ks.MAX_ENTRIES:
            continue
        src = item.get("src") if item.get("src") in (ks.USER, ks.AI) else ks.USER
        try:
            k, entry = ks.build_entry(key, item.get("kind"), src, cats,
                                      item.get("note"), item.get("ts"))
        except KnowledgeError:
            continue
        incoming[k] = entry

    def change(entries: dict) -> int:
        n = 0
        for k, entry in incoming.items():
            cur = entries.get(k)
            if cur is None and len(entries) >= ks.MAX_ENTRIES:
                continue
            if cur is None or entry["ts"] >= cur["ts"]:
                if cur != entry:
                    entries[k] = entry
                    n += 1
        return n

    return ks.modify(change)
