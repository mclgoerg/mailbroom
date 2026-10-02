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


def due(account: str, schedule: str, now: float | None = None) -> bool:
    period = _DUE_AFTER.get(schedule)
    if not period:
        return False
    return (now or time.time()) - last_sent(account) >= period


def _aggregate(entries: list[dict]) -> tuple[dict[str, int], int, int,
                                             dict[str, int]]:
    """-> (mail_counts by action, bytes freed, unsubscribe attempts,
    unsubscribe outcomes by status)."""
    mail_counts: dict[str, int] = {}
    freed = 0
    unsub_outcomes = {"done": 0, "link": 0, "failed": 0}
    unsub_attempts = 0
    for e in entries:
        a = e["action"]
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
                  unsub_outcomes: dict[str, int]) -> str:
    lines = [STRINGS["heading"], STRINGS["since"].format(since=since_str), ""]
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


# Brand palette (frontend/src/index.css @theme, light then dark variant) -
# email clients mostly default to light, so inline styles use the light
# tokens; the <style> block's prefers-color-scheme swaps them for the
# minority of clients that honour it. No external assets (images/fonts/
# tracking pixels) either way.
_LIGHT = {"surface": "#eee5d0", "panel": "#faf5e9", "panel2": "#f2ead7",
          "line": "#dccfb2", "accent": "#96570a", "muted": "#6e5e45",
          "body": "#2c2115"}
_DARK = {"surface": "#171310", "panel": "#1f1913", "panel2": "#272017",
         "line": "#372c1e", "accent": "#a16207", "muted": "#b5a68d",
         "body": "#f0e8d8"}


def _compose_html(account: str, since_str: str, rows: list[tuple[str, str]],
                  mail_counts: dict[str, int], unsub_attempts: int,
                  unsub_outcomes: dict[str, int]) -> str:
    import html as htmlmod
    esc = htmlmod.escape
    row_html = "".join(
        f'<tr class="mb-row" style="border-bottom:1px solid '
        f'{_LIGHT["line"]};">'
        f'<td class="mb-row-label" style="padding:6px 0;font-size:14px;'
        f'color:{_LIGHT["muted"]};">{esc(label)}</td>'
        f'<td class="mb-row-value" style="padding:6px 0;font-size:14px;'
        f'font-weight:600;color:{_LIGHT["body"]};text-align:right;">'
        f'{esc(value)}</td></tr>'
        for label, value in rows)
    unsub_html = ""
    if unsub_attempts:
        outcome_items = "".join(
            f'<li>{esc(STRINGS[f"unsub_{status}"])}: {unsub_outcomes[status]}'
            f'</li>'
            for status in ("done", "link", "failed") if unsub_outcomes[status])
        unsub_html = f"""
        <p class="mb-sub-strong" style="margin:16px 0 4px;font-size:14px;
          color:{_LIGHT["body"]};">
          <strong>{esc(STRINGS["unsubscribe_attempts"])}:</strong>
          {unsub_attempts}
        </p>
        <ul class="mb-sub-list" style="margin:4px 0 0;padding-left:20px;
          font-size:13px;color:{_LIGHT["muted"]};">{outcome_items}</ul>"""
    note_html = ""
    if mail_counts.get("rule_report"):
        note_html = (f'<p class="mb-note" style="margin:16px 0 0;'
                     f'font-size:12px;color:{_LIGHT["muted"]};">'
                     f'{esc(STRINGS["rule_preview_note"])}</p>')
    return f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @media (prefers-color-scheme: dark) {{
    .mb-page {{ background:{_DARK["surface"]} !important; }}
    .mb-card {{ background:{_DARK["panel"]} !important;
      border-color:{_DARK["line"]} !important; }}
    .mb-header {{ border-color:{_DARK["line"]} !important; }}
    .mb-footer {{ background:{_DARK["panel2"]} !important;
      color:{_DARK["muted"]} !important; }}
    .mb-eyebrow, .mb-since {{ color:{_DARK["muted"]} !important; }}
    .mb-title {{ color:{_DARK["body"]} !important; }}
    .mb-row-label, .mb-note, .mb-sub-list {{
      color:{_DARK["muted"]} !important; }}
    .mb-row-value, .mb-sub-strong {{ color:{_DARK["body"]} !important; }}
    .mb-row {{ border-color:{_DARK["line"]} !important; }}
  }}
</style>
</head>
<body class="mb-page" style="margin:0;padding:0;background:{_LIGHT["surface"]};
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,
  Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0"
        class="mb-card" style="width:480px;max-width:100%;
        background:{_LIGHT["panel"]};border:1px solid {_LIGHT["line"]};
        border-radius:12px;overflow:hidden;">
        <tr><td class="mb-header" style="padding:20px 24px;
          border-bottom:1px solid {_LIGHT["line"]};">
          <div class="mb-eyebrow" style="font-size:12px;letter-spacing:.04em;
            text-transform:uppercase;color:{_LIGHT["muted"]};">
            Mailbroom &middot; {esc(account)}
          </div>
          <div class="mb-title" style="font-size:18px;font-weight:600;
            color:{_LIGHT["body"]};margin-top:2px;">
            {esc(STRINGS["heading"])}
          </div>
          <div class="mb-since" style="font-size:13px;color:{_LIGHT["muted"]};
            margin-top:2px;">
            {esc(STRINGS["since"].format(since=since_str))}
          </div>
        </td></tr>
        <tr><td style="padding:8px 24px 20px;">
          <table role="presentation" width="100%" cellpadding="0"
            cellspacing="0">{row_html}</table>
          {unsub_html}
          {note_html}
        </td></tr>
        <tr><td class="mb-footer" style="padding:14px 24px;
          background:{_LIGHT["panel2"]};font-size:12px;
          color:{_LIGHT["muted"]};">
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

    mail_counts, freed, unsub_attempts, unsub_outcomes = _aggregate(entries)
    rows = _rows(mail_counts, freed)
    since_str = (time.strftime("%Y-%m-%d %H:%M", time.localtime(since_ts))
                 if since_ts else STRINGS["since_ever"])
    subject = STRINGS["subject"].format(account=account)
    text = _compose_text(account, since_str, rows, mail_counts,
                         unsub_attempts, unsub_outcomes)
    html = _compose_html(account, since_str, rows, mail_counts,
                        unsub_attempts, unsub_outcomes)
    return subject, text, html


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
    subject, text, html = composed
    smtpout.send(block, recipient, subject, text, html,
                account_name=account)
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
