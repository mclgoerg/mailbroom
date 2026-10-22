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

PURGE RULES (scope "junk" / "trash") are the one irreversible kind: they
delete mail in the Junk / Trash folder PERMANENTLY, on the server. They are
opt-in (nothing creates one by default), start in report mode, need a report
run of their CURRENT definition before they may execute (editing the
definition sends an execute-mode rule back to report), skip protected
senders and pinned mails without any override, are capped per run, and
delete ONLY through `mailops.purge_mails` (exact UIDs of the live listing,
counted UIDVALIDITY + folder). Their action is named "purge" - never one of
`mailops.ACTIONS` - so an older release, which ignores `scope`, rejects them
("bad action") before anything is queued instead of running them as an
ordinary trash rule on the main index.
"""

from __future__ import annotations

import hashlib
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
# Where a rule looks: "mail" = the main cleanup index (the original rules),
# "junk" / "trash" = that role folder's own index (purge rules).
PURGE_SCOPES = ("junk", "trash")
SCOPES = ("mail",) + PURGE_SCOPES
PURGE_ACTION = "purge"     # the ONLY action of a purge rule; not in mailops.ACTIONS
PURGE_DEFAULT_DAYS = 30
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

# ------------------------------------------------------------- purge rules

_DEF_FIELDS = ("scope", "grouping", "query", "action", "dest",
               "keep_latest", "older_than_days")
# Why an armed purge rule was sent back to report mode (shown on its card).
RESET_REASONS = ("edited", "account", "folder")


def definition_sig(rule: dict) -> str:
    """Fingerprint of everything that decides WHAT a rule acts on. A purge
    rule may only execute while the fingerprint of its last report run
    equals the current one: what was previewed is what runs."""
    blob = json.dumps([rule.get(k) for k in _DEF_FIELDS])
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def mailbox_id(account) -> str:
    """Identity of the MAILBOX an account name points at: a SHA-256 of host
    and login (never a secret, nothing reversible). Another server / login
    under the same name - or a deleted and re-created account - is another
    mailbox."""
    try:
        im = cfgmod.account_imap(account)
    except (ValueError, KeyError, TypeError, AttributeError):
        return ""
    blob = json.dumps([str(im.get("host", "")).strip().lower(),
                       str(im.get("user", "")).strip().lower()])
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def box_sig(rule: dict) -> str:
    """The account the rule runs on: its name AND the mailbox behind it."""
    acct = rule.get("account") or accounts.default_name()  # None = default
    return hashlib.sha256(json.dumps(
        [acct, mailbox_id(acct)]).encode()).hexdigest()[:16]


def purge_armed(rule: dict) -> bool:
    """A purge rule may execute only after a report run of its CURRENT
    definition, on the same mailbox, with the folder(s) that report was
    computed on on record (the report-first gate, bound to what was
    previewed; the folders themselves are re-checked at every run)."""
    return rule.get("report_runs", 0) >= 1 \
        and bool(rule.get("report_at")) \
        and rule.get("report_sig") == definition_sig(rule) \
        and rule.get("report_box") == box_sig(rule)


def _reset_to_report(rule: dict, reason: str) -> None:
    """Send a purge rule back to report mode: no report on record, so the
    next execute needs a fresh one."""
    rule["mode"] = "report"
    rule["report_runs"] = 0
    rule["report_sig"] = rule["report_box"] = ""
    rule["report_at"] = None
    rule["reset_reason"] = reason


# Filter qualifiers a purge rule refuses: the role index holds sender, date
# and read state only (no tags / AI / engagement / reply data), and a
# qualifier answered from missing data would silently widen the match (e.g.
# `eng:low` would hit every sender). Protected / pinned mail is never purged
# anyway, so those two qualifiers cannot select anything either.
_PURGE_UNSUPPORTED = (
    ("tags", "tag:"), ("ai", "ai:"), ("unsub", "is:unsub"),
    ("protected_only", "is:protected"), ("replied", "is:replied"),
    ("unsubscribed", "is:unsubscribed"), ("new_only", "is:new"),
    ("pinned_only", "has:pinned"), ("eng", "eng:"), ("att_min", "att:"),
    ("domain", "domain:"))


def purge_unsupported(query: str) -> list[str]:
    f = parse_filter(query)
    # `replied` / `unsubscribed` are tri-state: False is a qualifier too.
    # `domain:` compares a DOMAIN group's key; sender groups never match it,
    # so it would report 0 mails forever.
    return [name for key, name in _PURGE_UNSUPPORTED
            if (f[key] is not None if key in ("replied", "unsubscribed")
                else bool(f[key]))]


def _normalise(r: dict) -> None:
    """Read-side defaults and the purge safety floor for one rule loaded
    from disk (an old rules.json, an imported or restored file)."""
    r.setdefault("keep_latest", None)    # tolerate pre-retention rules.json
    r.setdefault("older_than_days", None)
    r.setdefault("origin", "manual")     # tolerate pre-block rules.json
    r.setdefault("scope", "mail")        # tolerate pre-purge rules.json
    if r["scope"] == "mail":
        return
    # A purge rule can never carry an ordinary action, and never executes
    # without a report run of its current definition on this mailbox -
    # whatever the file (a hand edit, a restored backup, a renamed or
    # re-created account) claims.
    r.setdefault("report_at", None)
    r.setdefault("reset_reason", "")
    if r.get("action") != PURGE_ACTION:
        r["action"] = PURGE_ACTION
        r["report_sig"] = ""
    if not purge_armed(r):
        if r.get("mode") == "execute":
            _reset_to_report(
                r, "account" if r.get("report_sig") == definition_sig(r)
                and r.get("report_box") != box_sig(r) else "edited")
        r["report_runs"] = 0


def load_rules() -> list[dict]:
    try:
        data = json.loads(_path().read_text())
        rules = data.get("rules", []) if isinstance(data, dict) else []
    except (OSError, json.JSONDecodeError):
        return []
    for r in rules:
        _normalise(r)
    return rules


def _save(rules: list[dict]) -> None:
    # Rollback safety: a rule outside the main index must carry the one
    # action an older release rejects as unknown. Never write anything else.
    for r in rules:
        if r.get("scope", "mail") != "mail" \
                and r.get("action") != PURGE_ACTION:
            raise ValueError("a Junk / Trash rule can only purge")
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
    was_purge = rule.get("scope", "mail") in PURGE_SCOPES
    before, before_box = definition_sig(rule), box_sig(rule)
    if "name" in body:
        rule["name"] = str(body["name"]).strip()[:80]
    if "scope" in body:
        if body["scope"] not in SCOPES:
            raise ValueError("bad scope")
        rule["scope"] = body["scope"]
    purge = rule["scope"] in PURGE_SCOPES
    if "grouping" in body:
        if body["grouping"] not in RULE_GROUPINGS:
            raise ValueError("bad grouping")
        rule["grouping"] = body["grouping"]
    if "query" in body:
        rule["query"] = str(body["query"]).strip()[:300]
    if "action" in body:
        if body["action"] not in (*mailops.ACTIONS, PURGE_ACTION):
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
    if purge:
        # Junk / Trash rules: one action ("purge"), sender groups only, an
        # age (the retention rule), the filter qualifiers the role index can
        # answer. Anything else is refused, never coerced into a wider rule.
        if rule["action"] != PURGE_ACTION:
            if "action" in body:
                raise ValueError("bad action")
            rule["action"] = PURGE_ACTION    # the scope changed under it
        if rule["grouping"] != "sender":
            if "grouping" in body:
                raise ValueError("Junk and Trash rules match sender groups")
            rule["grouping"] = "sender"
        if rule.get("keep_latest") is not None:
            raise ValueError("keep_latest is not available for Junk and "
                             "Trash rules")
        if rule.get("older_than_days") is None:
            raise ValueError("a Junk or Trash rule needs older_than_days")
        if rule.get("origin") != "manual":
            raise ValueError("bad origin")
        bad = purge_unsupported(rule["query"])
        if bad:
            raise ValueError(
                "filter not available for Junk and Trash rules: "
                + ", ".join(bad)
                + (" (it never matches sender groups - use plain text such "
                   "as the domain name)" if "domain:" in bad else ""))
        rule["dest"] = ""
    elif rule["action"] not in mailops.ACTIONS:
        raise ValueError("bad action")       # e.g. a purge rule moved to mail
    elif rule["action"] == "move" and not rule["dest"]:
        raise ValueError("move needs a target folder")
    if (purge or was_purge) and (definition_sig(rule) != before
                                 or box_sig(rule) != before_box):
        # What was previewed is what runs: a changed definition (or another
        # account) starts over in report mode, with no report run on record.
        _reset_to_report(rule, "edited" if definition_sig(rule) != before
                         else "account")
    if "mode" in body:
        if body["mode"] not in ("report", "execute"):
            raise ValueError("bad mode")
        # Safety: a rule must have produced at least one report before it
        # may act on its own - a purge rule one of its current definition.
        if body["mode"] == "execute" and (
                rule.get("report_runs", 0) < 1
                or (purge and not purge_armed(rule))):
            raise ValueError("run this rule in report mode first")
        rule["mode"] = body["mode"]
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


def drop_account(name: str) -> None:
    """A deleted account takes its PURGE rules (Junk / Trash) with it: one
    must never outlive its mailbox (a re-created account of the same name
    is another mailbox). Ordinary mail rules stay, as before - they keep
    the account name but stop running."""
    with _LOCK:
        rules = load_rules()
        mine = [r for r in rules if r.get("account") == name
                and r.get("scope", "mail") in PURGE_SCOPES]
        if mine:
            _save([r for r in rules if r not in mine])
            log.info("account %r deleted: %d purge rule(s) removed", name,
                     len(mine))


def create_rule(body: dict) -> dict:
    rule = {"id": uuid.uuid4().hex[:8], "name": "", "scope": "mail",
            "grouping": "sender",
            "query": "", "action": "trash", "dest": "",
            "account": accounts.default_name(),
            "schedule": "manual", "mode": "report",   # ALWAYS starts report
            "keep_latest": None, "older_than_days": None, "origin": "manual",
            "report_runs": 0, "created": int(time.time()), "last_run": None,
            "report_sig": "", "report_box": "", "report_at": None,
            "reset_reason": ""}
    body = dict(body)
    body.pop("mode", None)                            # not on create
    if body.get("scope") in PURGE_SCOPES:
        # the one action of a purge rule, whatever the client sent as the
        # (mail-rule) default; a missing age starts at the D8 default
        body.setdefault("action", PURGE_ACTION)
        if body.get("older_than_days") is None:
            body["older_than_days"] = PURGE_DEFAULT_DAYS
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
        # what a purge report was computed on is rule state, not run output
        sig, box, at = (result.pop(k, None) for k in ("sig", "box", "at"))
        rule["last_run"] = result
        if result.get("mode") == "report" and not result.get("error"):
            rule["report_runs"] = rule.get("report_runs", 0) + 1
            if rule.get("scope", "mail") in PURGE_SCOPES:
                # the definition, mailbox and folder(s) this report
                # previewed (see purge_armed): a run that started before an
                # edit must not arm the edit
                rule["report_sig"] = sig or definition_sig(rule)
                rule["report_box"] = box or box_sig(rule)
                rule["report_at"] = at
                rule["reset_reason"] = ""
        _save(rules)
    auditlog.record(
        f"rule_{result.get('mode', 'report')}", actor=f"rule:{rule_id}",
        account=rule.get("account"),
        # a purge rule's execute run counts what it really deleted
        count=(result.get("acted", 0) if result.get("mode") == "execute"
               and rule.get("scope", "mail") in PURGE_SCOPES
               else result.get("mails", 0)),
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
        if rule.get("scope", "mail") != "mail":
            _run_purge(rule, acc, result)
            return _finish_run(rule_id, result)
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
    except _RunFailed:
        raise                      # a purge run, already recorded
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
        log.exception("rule %s failed", rule_id)
    finally:
        _RUN_LOCK.release()
    return _finish_run(rule_id, result)


def _disarm(rule_id: str, reason: str) -> None:
    with _LOCK:
        rules = load_rules()
        rule = next((r for r in rules if r["id"] == rule_id), None)
        if rule:
            _reset_to_report(rule, reason)
            _save(rules)


class _RunFailed(RuntimeError):
    """A run that failed and was recorded (see _finish_run)."""


def _finish_run(rule_id: str, result: dict) -> dict:
    _record_run(rule_id, result)
    if result["error"]:
        raise _RunFailed(result["error"])
    return result


def _run_purge(rule: dict, acc, result: dict) -> None:
    """One run of a Junk / Trash purge rule (fills `result`; an error is
    recorded in it, never raised).

    The role folder is read LIVE (its role index is refreshed first - the
    main scan is not involved). The filter runs on that role's SENDER groups
    (same parse_filter / match_group as every rule), `older_than_days` keeps
    the mails received more than N days ago (INTERNALDATE), protected senders
    and pinned mails are dropped and counted. The run is capped at RULE_CAP,
    OLDEST UID FIRST: an exact-UID selection has no meaningful 'largest
    group', and `purge_mails` caps the same way. REPORT mode stops there -
    counts and a sender-level preview, nothing is deleted or moved. EXECUTE
    mode hands exactly the capped UIDs, the counted UIDVALIDITY and folder
    to `mailops.purge_mails` - the only deletion path - as `rule:<id>`; any
    refusal (ambiguous / unconfirmed / missing role, UIDVALIDITY change, no
    UIDPLUS, busy) is the run's error and nothing was deleted by it."""
    try:
        role = rule["scope"]
        if role not in PURGE_SCOPES or rule.get("action") != PURGE_ACTION \
                or rule.get("older_than_days") is None \
                or rule.get("keep_latest") is not None:
            raise ValueError("not a valid Junk / Trash rule")
        if purge_unsupported(rule["query"]):
            raise ValueError("filter not available for Junk and Trash rules")
        result["sig"], result["box"] = definition_sig(rule), box_sig(rule)
        if rule["mode"] == "execute" and not purge_armed(rule):
            raise RuntimeError("run this rule in report mode first")
        f = parse_filter(rule["query"])
        now = time.time()

        def match(mails: list[dict]) -> set[int]:
            keys = {g["key"] for g in mailops.role_sender_groups(mails)
                    if match_group(g, f, now)}
            return {m["uid"] for m in mails if m["addr"] in keys}

        pv = mailops.purge_preview(role, older_than_days=rule["older_than_days"],
                                   match=match, acc=acc)
        # the folder(s) and the UIDVALIDITY of the role folder as counted: a
        # folder deleted and re-created under the same name is another one
        at = {"folder": pv["folder"], "trash_folder": pv["trash_folder"],
              "uv": pv["uv"]}
        result["at"] = at
        if rule["mode"] == "execute" and at != rule["report_at"]:
            # The folder(s) the role resolves to now are not the ones the
            # report was computed on (role choice changed in Settings, or
            # the server moved the role): nothing was previewed there.
            _disarm(rule["id"], "folder")
            raise RuntimeError(
                "the Junk / Trash folder changed since the last report - "
                "the rule is back in report mode, nothing was deleted")
        picked = sorted(pv["uids"])[:RULE_CAP]
        by_uid = {m["uid"]: m for m in mailops.role_mails(role, acc)}
        senders: dict[str, dict] = {}
        for u in picked:
            m = by_uid.get(u)
            if m:
                g = senders.setdefault(m["addr"], {
                    "key": m["addr"], "label": m["name"] or m["addr"],
                    "count": 0})
                g["count"] += 1
        result.update(
            groups=len(senders), mails=pv["count"],
            capped=pv["count"] - len(picked),
            skipped_protected=pv["skipped_protected"],
            skipped_pinned=pv["skipped_pinned"],
            preview=sorted(senders.values(),
                           key=lambda g: (-g["count"], g["key"]))[:10])
        total = len(picked)
        if rule["mode"] == "execute" and picked:
            try:
                r = mailops.purge_mails(
                    role, picked, pv["uv"], acc, folder=pv["folder"],
                    trash_folder=pv["trash_folder"],
                    actor=f"rule:{rule['id']}", cap=RULE_CAP)
            except mailops.PurgeError as exc:   # stopped part-way
                result["acted"] = exc.deleted
                result["unverified"] = exc.unverified
                raise
            result["acted"] = r["deleted"]
            # skips found at delete time on top (a mail protected or pinned
            # since the count a moment ago)
            result["skipped_protected"] += r["skipped_protected"]
            result["skipped_pinned"] += r["skipped_pinned"]
            result["unverified"] = r["unverified"]
        log.info("purge rule %s (%r, %s %s) ran: %d mails matched, %d "
                 "deleted, %d capped, %d protected / %d pinned skipped",
                 rule["id"], rule["name"], rule["mode"], role, pv["count"],
                 result["acted"], result["capped"],
                 result["skipped_protected"], result["skipped_pinned"])
        with acc.lock:
            acc.state["notice"] = {
                "key": "rule_executed" if rule["mode"] == "execute"
                       else "rule_report",
                "params": {"name": rule["name"], "groups": result["groups"],
                           "mails": total, "acted": result["acted"]}}
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
        log.exception("purge rule %s failed", rule["id"])


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
