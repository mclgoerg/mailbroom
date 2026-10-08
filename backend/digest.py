"""Per-account daily/weekly activity digest email.

A summary of what Mailbroom did for one account since its last digest:
actions taken (from the audit log), mails/bytes freed, rule runs (incl.
report-mode previews not yet applied), and unsubscribe outcomes. Sent
as multipart/alternative (plain text + a lightly branded HTML part, no
external assets - see smtpout.send) so it reads well in any client.
Schedule + recipient live in the account's own config block (see
config.DIGEST_SCHEDULES); `last_sent` is a small per-tenant file,
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

import datetime
import json
import logging
import os
import threading
import time
from pathlib import Path

from . import accounts
from . import auditlog
from . import config as cfgmod
from . import rules as rulesmod
from . import smtpout
from . import tenants

log = logging.getLogger("pmc.digest")


def _masked(addr: str) -> str:
    """'jane@example.com' -> 'j***@example.com' for log lines: enough to
    tell which recipient was used, without writing the full address to the
    server log (the audit log keeps it for the account owner)."""
    local, at, domain = addr.partition("@")
    return f"{local[:1]}***{at}{domain}" if at else "***"

DIGEST_PATH = Path(os.environ.get("DIGEST_PATH", "/data/digest.json"))
CHECK_INTERVAL = int(os.environ.get("DIGEST_INTERVAL", "1800"))  # seconds

_PERIOD_DAYS = {"daily": 1, "weekly": 7}

_LOCK = threading.Lock()

STRINGS = {
    "subject": "Mailbroom activity digest ({account})",
    "heading": "Activity digest",
    "since": "Since {since}",
    "since_ever": "the beginning",
    "trash": "Moved to Trash",
    "archive": "Archived",
    "move": "Moved to a folder",
    "mark_read": "Marked as read",
    "unsubscribe_attempts": "Unsubscribe attempts",
    "rule_preview": "Rule previews (not yet applied)",
    "rule_preview_note":
        "\"Rule previews\" are mails a REPORT-mode rule matched - nothing "
        "was moved. Open Rules in the app to review it and switch it to "
        "Execute if it looks right.",
    "rule_applied": "Rule actions (applied automatically)",
    "freed": "Space freed",
    "unsub_header": "Unsubscribe outcomes",
    "unsub_done": "done",
    "unsub_link": "needs manual confirmation",
    "unsub_failed": "failed",
    "footer": "Sent by Mailbroom.",
    "demo_subject": "Mailbroom activity digest preview ({account})",
    "demo_banner":
        "PREVIEW with made-up example data - nothing below has actually "
        "happened yet. Do some cleanup, then send another test to see "
        "your real activity.",
    "demo_since": "example data",
}

# audit-log action -> STRINGS key, in the order they're shown.
_ACTION_LABELS = (
    ("trash", "trash"), ("archive", "archive"), ("move", "move"),
    ("mark_read", "mark_read"), ("rule_report", "rule_preview"),
    ("rule_execute", "rule_applied"),
)

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


def _next_occurrence(after: datetime.datetime, hour: int,
                     minute: int) -> datetime.datetime:
    """The next local hour:minute at/after `after` (today if not yet
    past, else tomorrow)."""
    candidate = after.replace(hour=hour, minute=minute, second=0,
                              microsecond=0)
    if candidate < after:
        candidate += datetime.timedelta(days=1)
    return candidate


def due(account: str, schedule: str, hour: int = 8, minute: int = 0,
       now: float | None = None) -> bool:
    """Whether this account's digest should fire now: never sent -> due
    right away (same as rules.py's own due() for a never-run rule);
    otherwise due at the next hour:minute strictly after the last send
    (and, for weekly, not before 7 days have passed - so a daily tick
    granularity can't fire it a day early)."""
    if schedule not in _PERIOD_DAYS:
        return False
    last = last_sent(account)
    if not last:
        return True
    now_dt = datetime.datetime.fromtimestamp(now or time.time())
    last_dt = datetime.datetime.fromtimestamp(last)
    next_dt = _next_occurrence(
        last_dt + datetime.timedelta(seconds=1), hour, minute)
    earliest = last_dt + datetime.timedelta(days=_PERIOD_DAYS[schedule])
    while next_dt < earliest:
        next_dt += datetime.timedelta(days=1)
    return now_dt >= next_dt


def _aggregate(entries: list[dict],
              known_rule_ids: set[str]) -> tuple[dict[str, int], int, int,
                                                 dict[str, int]]:
    """-> (mail_counts by action, bytes freed, unsubscribe attempts,
    unsubscribe outcomes by status).

    rule_report/rule_execute entries whose rule has since been deleted
    are skipped: the audit log is append-only (a past run is a fact that
    stays on record even if the rule is gone), but the digest's own
    "open Rules and review it" call-to-action would be a dead end for
    one, so it must not show up here."""
    mail_counts: dict[str, int] = {}
    freed = 0
    unsub_outcomes = {"done": 0, "link": 0, "failed": 0}
    unsub_attempts = 0
    for e in entries:
        a = e["action"]
        if a in ("rule_report", "rule_execute"):
            actor = e.get("actor", "")
            rule_id = actor.split(":", 1)[1] if actor.startswith("rule:") \
                else None
            if rule_id not in known_rule_ids:
                continue
        if any(a == action for action, _ in _ACTION_LABELS):
            mail_counts[a] = mail_counts.get(a, 0) + e.get("count", 0)
        if a == "trash":
            freed += e.get("bytes", 0)
        if a == "unsubscribe":
            unsub_attempts += 1
            if e.get("outcome") in unsub_outcomes:
                unsub_outcomes[e["outcome"]] += 1
    return mail_counts, freed, unsub_attempts, unsub_outcomes


def _rows(mail_counts: dict[str, int], freed: int) -> list[tuple[str, str]]:
    """-> [(label, value)] for every metric that actually happened."""
    rows = [(STRINGS[label], str(mail_counts[action]))
            for action, label in _ACTION_LABELS if mail_counts.get(action)]
    if freed:
        rows.append((STRINGS["freed"], _fmt_bytes(freed)))
    return rows


def _compose_text(account: str, since_str: str, rows: list[tuple[str, str]],
                  mail_counts: dict[str, int], unsub_attempts: int,
                  unsub_outcomes: dict[str, int],
                  banner: str | None = None) -> str:
    headline = banner if banner else STRINGS["since"].format(since=since_str)
    lines = [STRINGS["heading"], headline, ""]
    for label, value in rows:
        lines.append(f"{label}: {value}")
    if unsub_attempts:
        lines.append(f"{STRINGS['unsubscribe_attempts']}: {unsub_attempts}")
        lines.append("")
        lines.append(f"{STRINGS['unsub_header']}:")
        for status in ("done", "link", "failed"):
            if unsub_outcomes[status]:
                lines.append(
                    f"  {STRINGS[f'unsub_{status}']}: {unsub_outcomes[status]}")
    if mail_counts.get("rule_report"):
        lines.append("")
        lines.append(STRINGS["rule_preview_note"])
    lines.append("")
    lines.append(f"-- \n{STRINGS['footer']}")
    return "\n".join(lines) + "\n"


# Brand palette (frontend/src/index.css @theme, light variant) reused for
# the email's one and only theme. Deliberately NOT trying to also offer a
# prefers-color-scheme dark variant: several mail apps (seen: Proton Mail)
# apply their OWN heuristic dark-mode repaint to HTML mail and don't
# reliably respect an email's explicit dark overrides, which fought our
# colors instead of complementing them. The color-scheme/supported-color-
# schemes meta tags below are the signal that tends to opt an email out
# of that auto-repaint - one deliberately light, high-contrast theme reads
# correctly far more reliably than trying to out-guess every client's
# own inversion heuristics. No external assets (images/fonts/tracking
# pixels) either way.
_LIGHT = {"surface": "#eee5d0", "panel": "#faf5e9", "panel2": "#f2ead7",
          "line": "#dccfb2", "accent": "#96570a", "muted": "#6e5e45",
          "body": "#2c2115", "chip": "#e5d9bd"}


def _compose_html(account: str, since_str: str, rows: list[tuple[str, str]],
                  mail_counts: dict[str, int], unsub_attempts: int,
                  unsub_outcomes: dict[str, int],
                  banner: str | None = None) -> str:
    import html as htmlmod
    esc = htmlmod.escape
    row_html = "".join(
        f'<tr style="border-bottom:1px solid {_LIGHT["line"]};">'
        f'<td style="padding:6px 0;font-size:14px;color:{_LIGHT["muted"]};">'
        f'{esc(label)}</td>'
        f'<td style="padding:6px 0;font-size:14px;font-weight:600;'
        f'color:{_LIGHT["body"]};text-align:right;">{esc(value)}</td></tr>'
        for label, value in rows)
    unsub_html = ""
    if unsub_attempts:
        outcome_items = "".join(
            f'<li>{esc(STRINGS[f"unsub_{status}"])}: {unsub_outcomes[status]}'
            f'</li>'
            for status in ("done", "link", "failed") if unsub_outcomes[status])
        unsub_html = f"""
        <p style="margin:16px 0 4px;font-size:14px;color:{_LIGHT["body"]};">
          <strong>{esc(STRINGS["unsubscribe_attempts"])}:</strong>
          {unsub_attempts}
        </p>
        <ul style="margin:4px 0 0;padding-left:20px;font-size:13px;
          color:{_LIGHT["muted"]};">{outcome_items}</ul>"""
    note_html = ""
    if mail_counts.get("rule_report"):
        note_html = (f'<p style="margin:16px 0 0;font-size:12px;'
                     f'color:{_LIGHT["muted"]};">'
                     f'{esc(STRINGS["rule_preview_note"])}</p>')
    banner_html = ""
    if banner:
        banner_html = (
            f'<tr><td style="padding:10px 24px;background:{_LIGHT["chip"]};'
            f'font-size:12px;color:{_LIGHT["accent"]};font-weight:600;'
            f'border-bottom:1px solid {_LIGHT["line"]};">'
            f'{esc(banner)}</td></tr>')
    since_html = "" if banner else f"""
          <div style="font-size:13px;color:{_LIGHT["muted"]};
            margin-top:2px;">
            {esc(STRINGS["since"].format(since=since_str))}
          </div>"""
    return f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
</head>
<body style="margin:0;padding:0;background:{_LIGHT["surface"]};
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,
  Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0"
        style="width:480px;max-width:100%;background:{_LIGHT["panel"]};
        border:1px solid {_LIGHT["line"]};border-radius:12px;
        overflow:hidden;">
        {banner_html}
        <tr><td style="padding:20px 24px;
          border-bottom:1px solid {_LIGHT["line"]};">
          <div style="font-size:12px;letter-spacing:.04em;
            text-transform:uppercase;color:{_LIGHT["muted"]};">
            Mailbroom &middot; {esc(account)}
          </div>
          <div style="font-size:18px;font-weight:600;
            color:{_LIGHT["body"]};margin-top:2px;">
            {esc(STRINGS["heading"])}
          </div>{since_html}
        </td></tr>
        <tr><td style="padding:8px 24px 20px;">
          <table role="presentation" width="100%" cellpadding="0"
            cellspacing="0">{row_html}</table>
          {unsub_html}
          {note_html}
        </td></tr>
        <tr><td style="padding:14px 24px;background:{_LIGHT["panel2"]};
          font-size:12px;color:{_LIGHT["muted"]};">
          {esc(STRINGS["footer"])}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""


def compose(account: str, since_ts: int) -> tuple[str, str, str] | None:
    """-> (subject, text_body, html_body), or None if nothing happened
    since `since_ts` (callers must not send a mail in that case)."""
    # auditlog's own digest-send records never count as "activity" - a
    # digest send recording itself as activity would never run dry.
    entries = [e for e in auditlog._load_all(account)
               if e["ts"] > since_ts and e["action"] != "digest_sent"]
    if not entries:
        return None

    known_rule_ids = {r["id"] for r in rulesmod.load_rules()}
    mail_counts, freed, unsub_attempts, unsub_outcomes = _aggregate(
        entries, known_rule_ids)
    rows = _rows(mail_counts, freed)
    if not rows and not unsub_attempts:
        # every entry in the period turned out to be a phantom rule
        # reference (its rule was deleted meanwhile) - same as no
        # activity at all.
        return None
    since_str = (time.strftime("%Y-%m-%d %H:%M", time.localtime(since_ts))
                 if since_ts else STRINGS["since_ever"])
    subject = STRINGS["subject"].format(account=account)
    text = _compose_text(account, since_str, rows, mail_counts,
                         unsub_attempts, unsub_outcomes)
    html = _compose_html(account, since_str, rows, mail_counts,
                        unsub_attempts, unsub_outcomes)
    return subject, text, html


def compose_demo(account: str) -> tuple[str, str, str]:
    """A fabricated, clearly-labeled example digest - used only by
    POST /api/digest/test when there's genuinely nothing real to show
    yet, so a first-time user can see what the mail looks like without
    having to go clean up mail first. Never counted as a real send."""
    mail_counts = {"trash": 42, "archive": 6, "move": 2, "mark_read": 15,
                   "rule_report": 7, "rule_execute": 3}
    freed = 18_400_000
    unsub_attempts = 4
    unsub_outcomes = {"done": 2, "link": 1, "failed": 1}
    rows = _rows(mail_counts, freed)
    subject = STRINGS["demo_subject"].format(account=account)
    text = _compose_text(account, STRINGS["demo_since"], rows, mail_counts,
                         unsub_attempts, unsub_outcomes,
                         banner=STRINGS["demo_banner"])
    html = _compose_html(account, STRINGS["demo_since"], rows, mail_counts,
                        unsub_attempts, unsub_outcomes,
                        banner=STRINGS["demo_banner"])
    return subject, text, html


def send_digest(account: str, test: bool = False) -> dict:
    """Compose + send one account's digest NOW - used by both the
    scheduler and POST /api/digest/test. A /test send never advances
    `last_sent` (so it doesn't shrink the window the next REAL digest
    covers); if there's genuinely nothing real to report, a /test send
    falls back to a clearly-labeled DEMO digest with example data
    instead of a dead-end "nothing to send" - the scheduler never takes
    this path (demo=False there, so it still skips a real empty send).
    Raises ValueError for an unknown account or a genuinely unsendable
    one (no recipient and no account address)."""
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
    demo = False
    if composed is None:
        if not test:
            return {"sent": False, "demo": False}
        composed = compose_demo(account)
        demo = True
    subject, text, html = composed
    smtpout.send(block, recipient, subject, text, html,
                account_name=account)
    now = int(time.time())
    if not test:
        _record_sent(account, now)
    auditlog.record("digest_sent", account=account, label=recipient,
                    outcome="ok")
    log.info("[%s] activity digest sent to %s%s%s", account,
             _masked(recipient),
             " (test)" if test else "", " (demo data)" if demo else "")
    return {"sent": True, "demo": demo}


# ------------------------------------------------------------------ engine

def _tick() -> None:
    for tenant in tenants.known():
        with tenants.use(tenant):
            cfg = cfgmod.load_config()
            for name, block in cfg["accounts"].items():
                d = block.get("digest") or {}
                schedule = d.get("schedule", "off")
                if not due(name, schedule, d.get("hour", 8),
                          d.get("minute", 0)):
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
