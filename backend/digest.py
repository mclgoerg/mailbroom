"""Per-account daily/weekly activity digest email.

A plain-text summary of what Mailbroom did for one account since its
last digest: actions taken (from the audit log), mails/bytes freed,
rule runs (incl. report-mode results awaiting review), and unsubscribe
outcomes. Schedule + recipient live in the account's own config block
(see config.DIGEST_SCHEDULES); `last_sent` is a small per-tenant file,
following the same pattern as mailops.py's replied.json (per-account,
atomic write).

No empty digests: a send is skipped entirely when nothing happened in
the period - callers (the scheduler and the /test endpoint) both see
that via send_digest()'s return value instead of a mail going out.

The backend has no i18n infrastructure, so the mail body is English
only and every literal string lives in STRINGS below - translation (if
ever added) only has to touch this one dict.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from pathlib import Path

from . import accounts
from . import auditlog
from . import config as cfgmod
from . import smtpout
from . import tenants

log = logging.getLogger("pmc.digest")

DIGEST_PATH = Path(os.environ.get("DIGEST_PATH", "/data/digest.json"))
CHECK_INTERVAL = int(os.environ.get("DIGEST_INTERVAL", "1800"))  # seconds

_DUE_AFTER = {"daily": 24 * 3600, "weekly": 7 * 24 * 3600}

_LOCK = threading.Lock()

STRINGS = {
    "subject": "Mailbroom activity digest ({account})",
    "since_header": "Activity for {account} since {since}:",
    "since_ever": "the beginning",
    "trash": "Moved to Trash",
    "archive": "Archived",
    "move": "Moved to a folder",
    "mark_read": "Marked as read",
    "unsubscribe_attempts": "Unsubscribe attempts",
    "rule_report": "Rule reports awaiting review",
    "rule_execute": "Rule executions",
    "freed": "Space freed",
    "unsub_header": "Unsubscribe outcomes:",
    "unsub_done": "done",
    "unsub_link": "needs manual confirmation",
    "unsub_failed": "failed",
    "footer": "-- \nSent by Mailbroom.",
}

# action -> (STRINGS key, whether to show the mail COUNT vs. just the
# number of audit entries). trash/archive/move/mark_read/unsubscribe
# entries carry a mail count; rule_report/rule_execute entries carry the
# number of MAILS MATCHED by that run (see rules._record_run).
_ACTION_ORDER = ("trash", "archive", "move", "mark_read",
                 "rule_report", "rule_execute")


def _fmt_bytes(n: int) -> str:
    size = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} GB"


def _path() -> Path:
    return tenants.current().file("digest.json", DIGEST_PATH)


def _load() -> dict:
    try:
        data = json.loads(_path().read_text())
    except (OSError, json.JSONDecodeError):
        return {"accounts": {}}
    if isinstance(data, dict) and isinstance(data.get("accounts"), dict):
        return data
    return {"accounts": {}}


def _write(data: dict) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    tmp.chmod(0o600)
    tmp.replace(path)


def last_sent(account: str) -> int:
    return _load()["accounts"].get(account, {}).get("last_sent", 0)


def _record_sent(account: str, ts: int) -> None:
    with _LOCK:
        data = _load()
        data["accounts"][account] = {"last_sent": ts}
        _write(data)


def rename_account(old: str, new: str) -> None:
    """Point a renamed account's last-sent marker at its new name."""
    with _LOCK:
        data = _load()
        if old in data["accounts"]:
            data["accounts"][new] = data["accounts"].pop(old)
            _write(data)


def drop_account(name: str) -> None:
    """Forget a deleted account's last-sent marker."""
    with _LOCK:
        data = _load()
        if data["accounts"].pop(name, None) is not None:
            _write(data)


def due(account: str, schedule: str, now: float | None = None) -> bool:
    period = _DUE_AFTER.get(schedule)
    if not period:
        return False
    return (now or time.time()) - last_sent(account) >= period


def compose(account: str, since_ts: int) -> tuple[str, str] | None:
    """-> (subject, body), or None if nothing happened since `since_ts`
    (callers must not send a mail in that case)."""
    # auditlog's own digest-send records never count as "activity" - a
    # digest send recording itself as activity would never run dry.
    entries = [e for e in auditlog._load_all(account)
               if e["ts"] > since_ts and e["action"] != "digest_sent"]
    if not entries:
        return None

    mail_counts: dict[str, int] = {}
    freed = 0
    unsub_outcomes = {"done": 0, "link": 0, "failed": 0}
    unsub_attempts = 0
    for e in entries:
        a = e["action"]
        if a in _ACTION_ORDER:
            mail_counts[a] = mail_counts.get(a, 0) + e.get("count", 0)
        if a == "trash":
            freed += e.get("bytes", 0)
        if a == "unsubscribe":
            unsub_attempts += 1
            if e.get("outcome") in unsub_outcomes:
                unsub_outcomes[e["outcome"]] += 1

    since_str = (time.strftime("%Y-%m-%d %H:%M", time.localtime(since_ts))
                 if since_ts else STRINGS["since_ever"])
    lines = [STRINGS["since_header"].format(account=account, since=since_str),
             ""]
    for action in _ACTION_ORDER:
        if mail_counts.get(action):
            lines.append(f"{STRINGS[action]}: {mail_counts[action]}")
    if freed:
        lines.append(f"{STRINGS['freed']}: {_fmt_bytes(freed)}")
    if unsub_attempts:
        lines.append(
            f"{STRINGS['unsubscribe_attempts']}: {unsub_attempts}")
        lines.append("")
        lines.append(STRINGS["unsub_header"])
        for status in ("done", "link", "failed"):
            if unsub_outcomes[status]:
                lines.append(
                    f"  {STRINGS[f'unsub_{status}']}: {unsub_outcomes[status]}")
    lines.append("")
    lines.append(STRINGS["footer"])
    body = "\n".join(lines) + "\n"
    subject = STRINGS["subject"].format(account=account)
    return subject, body


def send_digest(account: str, test: bool = False) -> dict:
    """Compose + send one account's digest NOW - used by both the
    scheduler and POST /api/digest/test. A /test send never advances
    `last_sent` (so it doesn't shrink the window the next REAL digest
    covers). Raises ValueError for an unknown account or a genuinely
    unsendable one (no recipient and no account address)."""
    cfg = cfgmod.load_config()
    if account not in cfg["accounts"]:
        raise ValueError(f"unknown account {account!r}")
    block = cfg["accounts"][account]
    recipient = (block.get("digest") or {}).get("recipient") or ""
    recipient = recipient.strip() or block["user"]
    if not recipient:
        raise ValueError(
            "no digest recipient configured and the account has no "
            "address of its own")
    composed = compose(account, last_sent(account))
    if composed is None:
        return {"sent": False}
    subject, body = composed
    smtpout.send(block, recipient, subject, body, account)
    now = int(time.time())
    if not test:
        _record_sent(account, now)
    auditlog.record("digest_sent", account=account, label=recipient,
                    outcome="ok")
    log.info("[%s] activity digest sent to %s%s", account, recipient,
             " (test)" if test else "")
    return {"sent": True}


# ------------------------------------------------------------------ engine

def _tick() -> None:
    for tenant in tenants.known():
        with tenants.use(tenant):
            cfg = cfgmod.load_config()
            for name, block in cfg["accounts"].items():
                schedule = (block.get("digest") or {}).get("schedule", "off")
                if not due(name, schedule):
                    continue
                try:
                    acc = accounts.get(name)
                except KeyError:
                    continue                 # account was deleted
                with acc.lock:
                    busy = (acc.state["status"] == "scanning"
                            or acc.state["ai"]["status"] == "running"
                            or acc.state["delete"]["status"] == "running"
                            or acc.state["atts"]["status"] == "running"
                            or acc.state["unsub"]["status"] == "running")
                if busy:
                    continue                 # try again next tick
                try:
                    send_digest(name)
                except Exception:
                    log.exception("[%s] digest send failed", name)


_scheduler_started = False


def start_scheduler() -> None:
    global _scheduler_started
    if _scheduler_started:
        return
    _scheduler_started = True

    def loop():
        while True:
            time.sleep(CHECK_INTERVAL)
            try:
                _tick()
            except Exception:
                log.exception("digest scheduler tick failed")

    threading.Thread(target=loop, daemon=True).start()
    log.info("digest scheduler started (checking every %ds)", CHECK_INTERVAL)
