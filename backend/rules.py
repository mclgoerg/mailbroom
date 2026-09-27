"""Saved cleanup rules + scheduler.

A rule is a saved group filter (the SAME query DSL the UI filter box uses;
match_group here is a line-for-line port of frontend/src/lib.ts) plus an
action. Rules always start in REPORT mode: a run only records what WOULD
happen. Only after at least one report run may a rule be switched to
EXECUTE, and every run is capped (RULE_CAP mails) — executed actions go
through the normal delete queue, so they stay reversible via undo.

The scheduler is a plain daemon thread (no cron/APScheduler): every
CHECK_INTERVAL it runs due rules ("daily"/"weekly"), each behind a fresh
scan, never concurrently with user-triggered work.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import uuid
from pathlib import Path

from . import config as cfgmod
from . import mailops
from .mailops import STATE, STATE_LOCK

log = logging.getLogger("pmc.rules")

RULES_PATH = Path(os.environ.get("RULES_PATH", "/data/rules.json"))
RULE_CAP = int(os.environ.get("RULE_CAP", "500"))   # max mails per run
CHECK_INTERVAL = int(os.environ.get("RULES_INTERVAL", "600"))  # seconds

SCHEDULES = ("manual", "daily", "weekly")
_DUE_AFTER = {"daily": 24 * 3600, "weekly": 7 * 24 * 3600}

_LOCK = threading.Lock()          # guards the rules file
_RUN_LOCK = threading.Lock()      # one rule run at a time


# ------------------------------------------------- filter DSL (port of lib.ts)

_QUAL_RE = re.compile(r"^(tag|ai|age|unread|is):(.*)$")
_AGE_RE = re.compile(r"^>?(\d+)(m|y)$")
_UNREAD_RE = re.compile(r"^>?(\d+)$")


def parse_filter(q: str) -> dict:
    out = {"text": [], "tags": [], "ai": None, "age_months": None,
           "unread_min": None, "unsub": False, "protected_only": False,
           "replied": None}
    for tok in (q or "").strip().lower().split():
        m = _QUAL_RE.match(tok)
        if not m:
            out["text"].append(tok)
            continue
        kind, val = m.groups()
        if kind == "tag" and val:
            out["tags"].append(val)
        elif kind == "ai" and val:
            out["ai"] = "delete_safe" if val == "safe" else val
        elif kind == "age":
            a = _AGE_RE.match(val)
            if a:
                out["age_months"] = int(a.group(1)) * \
                    (12 if a.group(2) == "y" else 1)
        elif kind == "unread":
            u = _UNREAD_RE.match(val)
            if u:
                out["unread_min"] = int(u.group(1))
        elif kind == "is" and val == "unsub":
            out["unsub"] = True
        elif kind == "is" and val == "protected":
            out["protected_only"] = True
        elif kind == "is" and val == "replied":
            out["replied"] = True
        elif kind == "is" and val == "noreply-ever":
            out["replied"] = False
        else:
            out["text"].append(tok)
    return out


def match_group(g: dict, f: dict, now: float | None = None) -> bool:
    """`g` is a public_state()-shaped group record (has protected/replied)."""
    label = (g.get("label") or "").lower()
    sub = (g.get("sub") or "").lower()
    for t in f["text"]:
        if t not in g["key"] and t not in label and t not in sub:
            return False
    for t in f["tags"]:
        if not any(t in tag for tag in g["tags"]):
            return False
    if f["ai"] and (not g.get("ai") or f["ai"] not in g["ai"]["verdict"]):
        return False
    if f["unsub"] and not g.get("unsub"):
        return False
    if f["protected_only"] and not g.get("protected"):
        return False
    if f["replied"] is not None and bool(g.get("replied")) != f["replied"]:
        return False
    if f["unread_min"] is not None:
        pct = 100 * g["unread"] / g["count"] if g["count"] else 0
        if pct < f["unread_min"]:
            return False
    if f["age_months"] is not None:
        cutoff = time.strftime(
            "%Y-%m-%d", time.gmtime(
                (now or time.time()) - f["age_months"] * 30.44 * 86400))
        if not g.get("last") or g["last"] >= cutoff:
            return False
    return True


# ---------------------------------------------------------------- persistence

def load_rules() -> list[dict]:
    try:
        data = json.loads(RULES_PATH.read_text())
        return data.get("rules", []) if isinstance(data, dict) else []
    except (OSError, json.JSONDecodeError):
        return []


def _save(rules: list[dict]) -> None:
    RULES_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = RULES_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps({"rules": rules}, indent=1))
    tmp.chmod(0o600)
    tmp.replace(RULES_PATH)
    with STATE_LOCK:
        STATE["rules"] = rules


def publish() -> None:
    """Mirror the saved rules into STATE so SSE clients see them."""
    with STATE_LOCK:
        STATE["rules"] = load_rules()


def _validate(body: dict, rule: dict) -> dict:
    if "name" in body:
        rule["name"] = str(body["name"]).strip()[:80]
    if "grouping" in body:
        if body["grouping"] not in mailops.GROUPINGS:
            raise ValueError("bad grouping")
        rule["grouping"] = body["grouping"]
    if "query" in body:
        rule["query"] = str(body["query"]).strip()[:300]
    if "action" in body:
        if body["action"] not in mailops.ACTIONS:
            raise ValueError("bad action")
        rule["action"] = body["action"]
    if "dest" in body:
        rule["dest"] = str(body["dest"])
    if "schedule" in body:
        if body["schedule"] not in SCHEDULES:
            raise ValueError("bad schedule")
        rule["schedule"] = body["schedule"]
    if "mode" in body:
        if body["mode"] not in ("report", "execute"):
            raise ValueError("bad mode")
        # Safety: a rule must have produced at least one report before it
        # may act on its own.
        if body["mode"] == "execute" and rule.get("report_runs", 0) < 1:
            raise ValueError("run this rule in report mode first")
        rule["mode"] = body["mode"]
    if not rule["name"]:
        raise ValueError("rule needs a name")
    if rule["action"] == "move" and not rule["dest"]:
        raise ValueError("move needs a target folder")
    return rule


def create_rule(body: dict) -> dict:
    rule = {"id": uuid.uuid4().hex[:8], "name": "", "grouping": "sender",
            "query": "", "action": "trash", "dest": "",
            "schedule": "manual", "mode": "report",   # ALWAYS starts report
            "report_runs": 0, "created": int(time.time()), "last_run": None}
    body = dict(body)
    body.pop("mode", None)                            # not on create
    _validate(body, rule)
    with _LOCK:
        rules = load_rules()
        rules.append(rule)
        _save(rules)
    log.info("rule %s created: %r (%s, query %r)", rule["id"], rule["name"],
             rule["action"], rule["query"])
    return rule


def update_rule(rule_id: str, body: dict) -> dict:
    with _LOCK:
        rules = load_rules()
        rule = next((r for r in rules if r["id"] == rule_id), None)
        if not rule:
            raise KeyError(rule_id)
        _validate(body, rule)
        _save(rules)
    log.info("rule %s updated (mode %s)", rule_id, rule["mode"])
    return rule


def delete_rule(rule_id: str) -> None:
    with _LOCK:
        rules = load_rules()
        if not any(r["id"] == rule_id for r in rules):
            raise KeyError(rule_id)
        _save([r for r in rules if r["id"] != rule_id])
    log.info("rule %s deleted", rule_id)


def _record_run(rule_id: str, result: dict) -> None:
    with _LOCK:
        rules = load_rules()
        rule = next((r for r in rules if r["id"] == rule_id), None)
        if not rule:
            return
        rule["last_run"] = result
        if result.get("mode") == "report" and not result.get("error"):
            rule["report_runs"] = rule.get("report_runs", 0) + 1
        _save(rules)


# --------------------------------------------------------------------- engine

def _wait_scan(timeout: float = 600) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        with STATE_LOCK:
            if STATE["status"] != "scanning":
                return STATE["status"] == "done"
        time.sleep(0.05)
    return False


def run_rule(rule_id: str, rescan: bool = True) -> dict:
    """Run one rule (blocking). Returns and records the run result."""
    rule = next((r for r in load_rules() if r["id"] == rule_id), None)
    if not rule:
        raise KeyError(rule_id)
    if not _RUN_LOCK.acquire(blocking=False):
        raise RuntimeError("busy: another rule is running")
    try:
        result = {"ts": int(time.time()), "mode": rule["mode"],
                  "groups": 0, "mails": 0, "acted": 0, "capped": 0,
                  "skipped_protected": 0, "preview": [], "error": ""}
        with STATE_LOCK:
            scan_ok = STATE["status"] == "done"
        if rescan or not scan_ok:
            try:
                mailops.start_scan()
            except RuntimeError as exc:      # busy with user-triggered work
                raise RuntimeError(f"cannot scan now: {exc}")
            if not _wait_scan():
                raise RuntimeError("scan did not finish")

        f = parse_filter(rule["query"])
        snapshot = mailops.public_state()["groups"][rule["grouping"]]
        matched = [g for g in snapshot.values() if match_group(g, f)]
        # Protected groups never take part in rule actions, not even in
        # report numbers for trash-like actions — they are counted apart.
        acted_on = [g for g in matched if not g["protected"]]
        result["skipped_protected"] = len(matched) - len(acted_on)
        result["groups"] = len(acted_on)
        result["mails"] = sum(g["count"] for g in acted_on)

        # Cap: take groups (largest first) while they fit into RULE_CAP.
        picked, total = [], 0
        for g in sorted(acted_on, key=lambda g: -g["count"]):
            if total + g["count"] <= RULE_CAP:
                picked.append(g)
                total += g["count"]
        result["capped"] = result["mails"] - total
        result["preview"] = [
            {"key": g["key"], "label": g["label"], "count": g["count"]}
            for g in sorted(picked, key=lambda g: -g["count"])[:10]]

        if rule["mode"] == "execute" and rule["action"] == "move":
            with STATE_LOCK:
                if rule["dest"] not in STATE["folders_raw"]:
                    raise RuntimeError(
                        f"unknown target folder {rule['dest']!r}")
        if rule["mode"] == "execute" and picked:
            r = mailops.delete_groups(
                rule["grouping"], [g["key"] for g in picked],
                rule["action"], rule["dest"])
            result["acted"] = r["queued"]
        log.info("rule %s (%r, %s) ran: %d groups / %d mails matched, "
                 "%d acted, %d capped, %d protected skipped",
                 rule["id"], rule["name"], rule["mode"], result["groups"],
                 result["mails"], result["acted"], result["capped"],
                 result["skipped_protected"])
        with STATE_LOCK:
            STATE["notice"] = {
                "key": "rule_executed" if rule["mode"] == "execute"
                       else "rule_report",
                "params": {"name": rule["name"], "groups": result["groups"],
                           "mails": total, "acted": result["acted"]}}
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
        log.exception("rule %s failed", rule_id)
    finally:
        _RUN_LOCK.release()
    _record_run(rule_id, result)
    if result["error"]:
        raise RuntimeError(result["error"])
    return result


# ------------------------------------------------------------------ scheduler

def due(rule: dict, now: float | None = None) -> bool:
    period = _DUE_AFTER.get(rule.get("schedule", "manual"))
    if not period:
        return False
    last = (rule.get("last_run") or {}).get("ts", 0)
    return (now or time.time()) - last >= period


def _tick() -> None:
    with STATE_LOCK:
        busy = (STATE["status"] == "scanning"
                or STATE["ai"]["status"] == "running"
                or STATE["delete"]["status"] == "running")
    if busy:
        return
    for rule in load_rules():
        if due(rule):
            log.info("scheduler: rule %s (%r) is due", rule["id"],
                     rule["name"])
            try:
                run_rule(rule["id"], rescan=True)
            except Exception:
                pass          # recorded in last_run; try again next period


_scheduler_started = False


def start_scheduler() -> None:
    global _scheduler_started
    if _scheduler_started:
        return
    _scheduler_started = True
    publish()

    def loop():
        while True:
            time.sleep(CHECK_INTERVAL)
            try:
                _tick()
            except Exception:
                log.exception("scheduler tick failed")

    threading.Thread(target=loop, daemon=True).start()
    log.info("rule scheduler started (checking every %ds)", CHECK_INTERVAL)
