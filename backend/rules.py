"""Saved cleanup rules + scheduler.

A rule is a saved group filter (the SAME query DSL the UI filter box uses;
match_group here is a line-for-line port of frontend/src/lib.ts) plus an
action. Rules always start in REPORT mode: a run only records what WOULD
happen. Only after at least one report run may a rule be switched to
EXECUTE, and every run is capped (RULE_CAP mails) - executed actions go
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

from . import accounts
from . import auditlog
from . import config as cfgmod
from . import mailops
from . import pinstore
from . import tenants

log = logging.getLogger("pmc.rules")

RULES_PATH = Path(os.environ.get("RULES_PATH", "/data/rules.json"))


def _path() -> Path:
    return tenants.current().file("rules.json", RULES_PATH)
RULE_CAP = int(os.environ.get("RULE_CAP", "500"))   # max mails per run
CHECK_INTERVAL = int(os.environ.get("RULES_INTERVAL", "600"))  # seconds

SCHEDULES = ("manual", "daily", "weekly")
# Not "smart": its rows' membership depends on a per-account threshold and
# the protected list, so a standing rule on them would shift under it.
RULE_GROUPINGS = tuple(g for g in mailops.GROUPINGS if g != "smart")
_DUE_AFTER = {"daily": 24 * 3600, "weekly": 7 * 24 * 3600}

_LOCK = threading.Lock()          # guards the rules file
_RUN_LOCK = threading.Lock()      # one rule run at a time


# ------------------------------------------------- filter DSL (port of lib.ts)

_QUAL_RE = re.compile(
    r"^(tag|ai|age|unread|is|has|eng|att|from|domain):(.*)$")
_AGE_RE = re.compile(r"^>?(\d+)(m|y)$")
_UNREAD_RE = re.compile(r"^>?(\d+)$")
_ATT_RE = re.compile(r"^>?(\d+)(k|m|g)?$")
_SIZE_UNIT = {"k": 1024, "m": 1048576, "g": 1073741824}


def parse_filter(q: str) -> dict:
    out = {"text": [], "tags": [], "ai": None, "age_months": None,
           "unread_min": None, "unsub": False, "protected_only": False,
           "replied": None, "att_min": None, "unsubscribed": None,
           "from_addr": None, "domain": None, "new_only": False,
           "pinned_only": False, "eng": None}
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
        elif kind == "is" and val == "unsubscribed":
            out["unsubscribed"] = True
        elif kind == "is" and val == "not-unsubscribed":
            out["unsubscribed"] = False
        elif kind == "is" and val == "new":
            out["new_only"] = True
        elif kind == "eng" and val in ("low", "medium", "high"):
            out["eng"] = val
        elif kind == "has" and val == "pinned":
            out["pinned_only"] = True
        elif kind == "att":
            a = _ATT_RE.match(val)
            if a:
                out["att_min"] = int(a.group(1)) * \
                    _SIZE_UNIT.get(a.group(2) or "", 1)
        elif kind == "from" and val:
            out["from_addr"] = val
        elif kind == "domain" and val:
            out["domain"] = val
        else:
            out["text"].append(tok)
    return out


def match_group(g: dict, f: dict, now: float | None = None) -> bool:
    """`g` is a public_state()-shaped group record (has protected/replied)."""
    label = (g.get("label") or "").lower()
    sub = (g.get("sub") or "").lower()
    if f["from_addr"] is not None and g["key"] != f["from_addr"]:
        return False
    if f["domain"] is not None and g["key"] != f["domain"]:
        return False
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
    if f["new_only"] and not g.get("new"):
        return False
    if f["pinned_only"] and not g.get("pinned"):
        return False
    if f["eng"] is not None and \
            mailops.engagement_tier(g.get("engagement", 0)) != f["eng"]:
        return False
    if f["replied"] is not None and bool(g.get("replied")) != f["replied"]:
        return False
    if f.get("unsubscribed") is not None:
        u = g.get("unsubscribed")
        if (bool(u) and u.get("status") == "done") != f["unsubscribed"]:
            return False
    if f["att_min"] is not None and g.get("att_size", 0) < f["att_min"]:
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
        data = json.loads(_path().read_text())
        rules = data.get("rules", []) if isinstance(data, dict) else []
    except (OSError, json.JSONDecodeError):
        return []
    for r in rules:                       # tolerate pre-retention rules.json
        r.setdefault("keep_latest", None)
        r.setdefault("older_than_days", None)
        r.setdefault("origin", "manual")  # tolerate pre-block rules.json
    return rules


def _save(rules: list[dict]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps({"rules": rules}, indent=1))
    tmp.chmod(0o600)
    tmp.replace(path)
    _publish(rules)


def _publish(rules: list[dict]) -> None:
    """Mirror each account's rules into its state so SSE clients see them."""
    for name in accounts.names():
        acc = accounts.get(name)
        mine = [r for r in rules if r.get("account", name) == name]
        with acc.lock:
            acc.state["rules"] = mine


def publish() -> None:
    """Startup: mirror every tenant's rules into their account states."""
    for tenant in tenants.known():
        with tenants.use(tenant):
            _publish(load_rules())


def _validate(body: dict, rule: dict) -> dict:
    if "name" in body:
        rule["name"] = str(body["name"]).strip()[:80]
    if "grouping" in body:
        if body["grouping"] not in RULE_GROUPINGS:
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
    if "origin" in body:
        if body["origin"] not in ("manual", "block"):
            raise ValueError("bad origin")
        rule["origin"] = body["origin"]
    if "account" in body and body["account"]:
        if body["account"] not in accounts.names():
            raise ValueError(f"unknown account {body['account']!r}")
        rule["account"] = body["account"]
    if "mode" in body:
        if body["mode"] not in ("report", "execute"):
            raise ValueError("bad mode")
        # Safety: a rule must have produced at least one report before it
        # may act on its own.
        if body["mode"] == "execute" and rule.get("report_runs", 0) < 1:
            raise ValueError("run this rule in report mode first")
        rule["mode"] = body["mode"]
    for field in ("keep_latest", "older_than_days"):
        if field in body:
            val = body[field]
            if val is None:
                rule[field] = None
                continue
            try:
                val = int(val)
            except (TypeError, ValueError):
                raise ValueError(f"{field} must be an integer")
            if val < 1:
                raise ValueError(f"{field} must be >= 1")
            rule[field] = val
    if rule.get("keep_latest") is not None \
            and rule.get("older_than_days") is not None:
        raise ValueError(
            "keep_latest and older_than_days are mutually exclusive")
    if not rule["name"]:
        raise ValueError("rule needs a name")
    if rule["action"] == "move" and not rule["dest"]:
        raise ValueError("move needs a target folder")
    return rule


def rename_account(old: str, new: str) -> None:
    """Point rules of a renamed account at its new name."""
    with _LOCK:
        rules = load_rules()
        changed = False
        for r in rules:
            if r.get("account") == old:
                r["account"] = new
                changed = True
        if changed:
            _save(rules)


def create_rule(body: dict) -> dict:
    rule = {"id": uuid.uuid4().hex[:8], "name": "", "grouping": "sender",
            "query": "", "action": "trash", "dest": "",
            "account": accounts.default_name(),
            "schedule": "manual", "mode": "report",   # ALWAYS starts report
            "keep_latest": None, "older_than_days": None, "origin": "manual",
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
    auditlog.record(
        f"rule_{result.get('mode', 'report')}", actor=f"rule:{rule_id}",
        account=rule.get("account"), count=result.get("mails", 0),
        label=rule.get("name", ""),
        outcome="error" if result.get("error") else "ok",
        error=result.get("error", ""))


# --------------------------------------------------------------------- engine

def _wait_scan(acc, timeout: float = 600) -> bool:
    end = time.time() + timeout
    while time.time() < end:
        with acc.lock:
            if acc.state["status"] != "scanning":
                return acc.state["status"] == "done"
        time.sleep(0.05)
    return False


def run_rule(rule_id: str, rescan: bool = True) -> dict:
    """Run one rule (blocking). Returns and records the run result."""
    rule = next((r for r in load_rules() if r["id"] == rule_id), None)
    if not rule:
        raise KeyError(rule_id)
    try:
        acc = accounts.get(rule.get("account"))
    except KeyError as exc:
        raise RuntimeError(str(exc))
    if not _RUN_LOCK.acquire(blocking=False):
        raise RuntimeError("busy: another rule is running")
    try:
        result = {"ts": int(time.time()), "mode": rule["mode"],
                  "groups": 0, "mails": 0, "acted": 0, "capped": 0,
                  "skipped_protected": 0, "skipped_pinned": 0, "preview": [],
                  "error": ""}
        with acc.lock:
            scan_ok = acc.state["status"] == "done"
        if rescan or not scan_ok:
            try:
                mailops.start_scan(acc)
            except RuntimeError as exc:      # busy with user-triggered work
                raise RuntimeError(f"cannot scan now: {exc}")
            if not _wait_scan(acc):
                raise RuntimeError("scan did not finish")

        f = parse_filter(rule["query"])
        snapshot = mailops.public_state(acc)["groups"][rule["grouping"]]
        matched = [g for g in snapshot.values() if match_group(g, f)]
        # Protected groups never take part in rule actions, not even in
        # report numbers for trash-like actions - they are counted apart.
        acted_on = [g for g in matched if not g["protected"]]
        result["skipped_protected"] = len(matched) - len(acted_on)
        result["groups"] = len(acted_on)

        keep_latest = rule.get("keep_latest")
        older_than_days = rule.get("older_than_days")
        # Report counts must reflect the retention restriction: only mails
        # that would ACTUALLY be acted on (i.e. beyond the keep-window) -
        # and pinned mails, which no rule may move (mark_read is
        # non-destructive and therefore exempt, like in delete_groups).
        pinned = (pinstore.load_account(acc.name)
                  if rule["action"] != "mark_read" else set())
        with acc.lock:
            recs = acc.state["groups"][rule["grouping"]]
            counts = {}
            for g in acted_on:
                if g["key"] in recs:
                    rec = recs[g["key"]]
                    counts[g["key"]] = mailops.group_act_count(
                        rec, acc, keep_latest, older_than_days, pinned)
                    result["skipped_pinned"] += mailops.group_act_count(
                        rec, acc, keep_latest, older_than_days) \
                        - counts[g["key"]]
        result["mails"] = sum(counts.values())

        # Cap: take groups (largest first) while they fit into RULE_CAP.
        picked, total = [], 0
        for g in sorted(acted_on, key=lambda g: -counts.get(g["key"], 0)):
            c = counts.get(g["key"], 0)
            if c and total + c <= RULE_CAP:
                picked.append(g)
                total += c
        result["capped"] = result["mails"] - total
        result["preview"] = [
            {"key": g["key"], "label": g["label"], "count": counts[g["key"]]}
            for g in sorted(picked, key=lambda g: -counts[g["key"]])[:10]]

        if rule["mode"] == "execute" and rule["action"] == "move":
            with acc.lock:
                if rule["dest"] not in acc.state["folders_raw"]:
                    raise RuntimeError(
                        f"unknown target folder {rule['dest']!r}")
        if rule["mode"] == "execute" and picked:
            r = mailops.delete_groups(
                rule["grouping"], [g["key"] for g in picked],
                rule["action"], rule["dest"], keep_latest=keep_latest,
                older_than_days=older_than_days, acc=acc,
                actor=f"rule:{rule_id}")
            result["acted"] = r["queued"]
        log.info("rule %s (%r, %s) ran: %d groups / %d mails matched, "
                 "%d acted, %d capped, %d protected / %d pinned skipped",
                 rule["id"], rule["name"], rule["mode"], result["groups"],
                 result["mails"], result["acted"], result["capped"],
                 result["skipped_protected"], result["skipped_pinned"])
        with acc.lock:
            acc.state["notice"] = {
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
    # Every tenant's due rules, each inside its own tenant context.
    for tenant in tenants.known():
        with tenants.use(tenant):
            for rule in load_rules():
                if not due(rule):
                    continue
                try:
                    acc = accounts.get(rule.get("account"))
                except KeyError:
                    continue                 # account was deleted
                with acc.lock:
                    busy = (acc.state["status"] == "scanning"
                            or acc.state["ai"]["status"] == "running"
                            or acc.state["delete"]["status"] == "running"
                            or acc.state["atts"]["status"] == "running")
                if busy:
                    continue
                log.info("scheduler: rule %s (%r) is due", rule["id"],
                         rule["name"])
                try:
                    run_rule(rule["id"], rescan=True)
                except Exception:
                    pass      # recorded in last_run; try again next period


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
