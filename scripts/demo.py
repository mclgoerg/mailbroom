"""Demo server: Mailbroom on fully fake, in-memory mailboxes.

For screenshots and local poking without any real IMAP server:

    docker run --rm -p 127.0.0.1:8765:8765 \
      -v "$PWD":/repo ghcr.io/mclgoerg/mailbroom:latest \
      python /repo/scripts/demo.py

Two demo accounts ("proton", "icloud") with plausible senders, seeded AI
verdicts/ratings and statistics. Everything lives in a temp dir; nothing
touches /data or the network. All addresses use .example domains.
"""

from __future__ import annotations

import json
import os
import random
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

# Isolated storage — set BEFORE importing the backend (paths bind at import).
DATA = Path(tempfile.mkdtemp(prefix="mailbroom-demo-"))
os.environ.update(
    CONFIG_PATH=str(DATA / "config.json"),
    STATS_PATH=str(DATA / "ai_usage.json"),
    VERDICTS_PATH=str(DATA / "ai_verdicts.json"),
    REPLIED_PATH=str(DATA / "replied.json"),
    RULES_PATH=str(DATA / "rules.json"),
    STATS_HISTORY_PATH=str(DATA / "stats_history.json"),
    SNAPSHOT_DIR=str(DATA),
    SERVER_PATH=str(DATA / "server.json"),
    TENANTS_DIR=str(DATA / "tenants"),
    SESSION_SECRET_PATH=str(DATA / "session_secret"),
    IMAP_CAFILE="", IMAP_USER="demo@example.com", IMAP_PASSWORD="demo",
    LOG_LEVEL="INFO",
)
# When run inside the release image, serve ITS built bundle (the repo
# checkout only has a placeholder static/).
if Path("/app/static/index.html").exists() and "STATIC_DIR" not in os.environ:
    os.environ["STATIC_DIR"] = "/app/static"

# conftest imports pytest only for its fixtures; stub it so the demo can
# reuse FakeIMAP without installing test dependencies.
import types                                     # noqa: E402


def _fixture(*a, **k):
    return a[0] if a and callable(a[0]) else (lambda f: f)


sys.modules.setdefault("pytest", types.SimpleNamespace(fixture=_fixture))

from conftest import FakeIMAP, make_msg          # noqa: E402
from backend import accounts, mailops, rules, verdictstore  # noqa: E402

random.seed(7)
NOW = time.time()


def _date(days_ago: float) -> str:
    return time.strftime("%d-%b-%Y %H:%M:%S +0000",
                         time.gmtime(NOW - days_ago * 86400))


_UID = iter(range(1, 100000))


def mails(frm: str, subjects: list[str], n: int, *, newest_days=1.0,
          span_days=700.0, unread=0.7, size=(9000, 60000), unsub=False,
          atts=None) -> list[dict]:
    out = []
    for i in range(n):
        days = newest_days + (span_days - newest_days) * (i / max(1, n - 1)) \
            * random.uniform(0.6, 1.15)
        subj = subjects[i % len(subjects)]
        if "{n}" in subj:
            subj = subj.replace("{n}", str(random.randint(10000, 99999)))
        out.append(make_msg(
            next(_UID), frm=frm, subject=subj,
            unsub="<https://unsub.example/u>" if unsub else None,
            msgid=f"<demo-{next(_UID)}@demo.example>",
            size=random.randint(*size),
            seen=random.random() > unread,
            date=_date(days),
            atts=atts if (atts and i < 3) else None))
    return out


PROTON_INBOX = (
    mails('"ACME Store" <news@acme-store.example>',
          ["Weekend SALE — up to 70% off ✨", "Your points expire soon",
           "New arrivals for autumn", "Last chance: free shipping"],
          214, unsub=True)
    + mails('"PaketFix" <noreply@paketfix.example>',
            ["Ihre Sendung {n} ist unterwegs", "Zustellung heute: Paket {n}",
             "Ihr Paket {n} wurde zugestellt"], 96, unread=0.85)
    + mails('"Chirper" <notify@chirper.example>',
            ["You have 3 new followers", "Trending now on Chirper",
             "@rob mentioned you"], 168, unsub=True, unread=0.9)
    + mails('"TechDigest" <digest@techdigest.example>',
            ["Issue #{n}: Rust vs. the world", "Weekly: self-hosting corner",
             "Issue #{n}: the terminal renaissance"], 88, unsub=True)
    + mails('"Streamly" <info@streamly.example>',
            ["New this week on Streamly", "Your watchlist just got better"],
            64, unsub=True, unread=0.8)
    + mails('"Bergsport Huber" <newsletter@bergsport-huber.example>',
            ["Neu eingetroffen: Tourenski 2026", "Wochenend-Angebote",
             "Gutschein: 10 € für deine nächste Tour"], 51, unsub=True)
    + mails('"PayBank" <service@paybank.example>',
            ["Ihr Kontoauszug ist verfügbar", "Sicherheitshinweis zu Ihrem "
             "Konto", "Zahlung über {n},00 € ausgeführt"],
            42, unread=0.3, size=(14000, 40000))
    + mails('"CloudBox" <billing@cloudbox.example>',
            ["Invoice CB-{n}", "Payment receipt CB-{n}"],
            24, unread=0.2, size=(220000, 480000),
            atts=[("invoice.pdf", 310000)])
    + mails('"JobPortal" <jobs@jobportal.example>',
            ["12 new jobs matching your profile", "Someone viewed your "
             "profile"], 33, unsub=True)
    + mails('"GreenEnergy AG" <kundenservice@greenenergy.example>',
            ["Ihre Rechnung {n}", "Abschlagsänderung ab August"],
            18, unread=0.25, size=(90000, 200000),
            atts=[("rechnung.pdf", 150000)])
    + mails('"Anna Weber" <anna.weber@mailfox.example>',
            ["Re: Wanderung am Samstag?", "Fotos vom Wochenende",
             "Re: Geschenk für Papa"], 12, unread=0.05,
            size=(4000, 30000))
    + mails('"Photo Club" <hello@photoclub.example>',
            ["March meetup — RAW files inside", "Contest results 🎉"],
            9, unread=0.1, size=(2000000, 6000000),
            atts=[("IMG_2041.jpg", 4200000), ("IMG_2044.jpg", 3800000)])
    + mails('"Dr. Meier Praxis" <praxis@dr-meier.example>',
            ["Terminbestätigung", "Ihr Laborbefund ist da"], 5, unread=0.1)
)

PROTON = FakeIMAP({
    "INBOX": PROTON_INBOX,
    "Sent": [make_msg(next(_UID), frm="Demo <demo@example.com>",
                      subject="Re: Wanderung am Samstag?",
                      to="anna.weber@mailfox.example",
                      cc="praxis@dr-meier.example", seen=True)],
    "Trash": mails('"Old Newsletter" <bye@gone.example>',
                   ["We miss you!"], 34, unread=0.9),
    "Spam": [],
    "Archive": [],
    "Drafts": [],
})

ICLOUD = FakeIMAP({
    "INBOX": (
        mails('"Fruit Store" <receipts@fruitstore.example>',
              ["Your receipt #{n}", "Pre-order now"], 40, unread=0.5)
        + mails('"Family Chat" <lisa@familienpost.example>',
                ["Re: Sonntag bei Oma?", "Urlaubsfotos!"], 8, unread=0.1)
        + mails('"Cloud Photos" <no-reply@cloudphotos.example>',
                ["Your storage is 80% full", "Memories from last year"],
                22, unsub=True)
    ),
    "Sent Messages": [make_msg(next(_UID), frm="Demo <demo@icloud.example>",
                               subject="Re: Sonntag bei Oma?",
                               to="lisa@familienpost.example", seen=True)],
    "Deleted Messages": [],
})

FAKES = {"demo-proton": PROTON, "demo-icloud": ICLOUD}
mailops.connect = lambda im: FAKES[im["host"]]

# Two configured accounts (hosts route to the fakes above).
Path(os.environ["CONFIG_PATH"]).write_text(json.dumps({
    "accounts": {
        "proton": {"host": "demo-proton", "user": "demo@example.com",
                   "password": "demo", "preset": "proton", "cafile": ""},
        "icloud": {"host": "demo-icloud", "user": "demo@icloud.example",
                   "password": "demo", "preset": "icloud", "cafile": ""},
    },
    "protected": ["anna.weber@mailfox.example", "@dr-meier.example"],
    "ai": {"provider": "anthropic", "api_key": "demo-key",
           "model": "claude-sonnet-5"},
}))

# Cached AI verdicts -> colored tags on the group rows.
for key, verdict, reason in [
    ("news@acme-store.example", "delete_safe", "Promotional newsletter, never replied"),
    ("noreply@paketfix.example", "delete_safe", "Automated shipping notifications"),
    ("notify@chirper.example", "delete_safe", "Social media notifications"),
    ("digest@techdigest.example", "delete_safe", "Subscribed newsletter, low engagement"),
    ("info@streamly.example", "delete_safe", "Streaming service promotions"),
    ("newsletter@bergsport-huber.example", "review", "Shop newsletter with vouchers"),
    ("service@paybank.example", "review", "Bank statements and security notices"),
    ("billing@cloudbox.example", "review", "Invoices worth keeping"),
    ("jobs@jobportal.example", "delete_safe", "Job alerts, outdated quickly"),
    ("kundenservice@greenenergy.example", "keep", "Utility invoices and contract mail"),
    ("anna.weber@mailfox.example", "keep", "Personal correspondence, protected"),
    ("praxis@dr-meier.example", "keep", "Medical practice, protected sender"),
]:
    verdictstore.save("sender", {key: {"verdict": verdict, "reason": reason}},
                      "proton")

# Per-mail ratings on the PayBank group -> rating chips.
paybank = [m for m in PROTON_INBOX if "paybank" in m["from"]]
verdictstore.save_mails(
    {m["msgid"]: ("delete_safe" if i % 3 else "review")
     for i, m in enumerate(paybank)})

# A saved rule + cleanup history for the stats panel.
rules.create_rule({"name": "Sweep old newsletters",
                   "query": "is:unsub age:>1y", "action": "trash",
                   "schedule": "weekly", "account": "proton"})
history = {"accounts": {"proton": {
    "scans": [{"ts": int(NOW - d * 86400), "mails": m, "size": s,
               "senders": g}
              for d, m, s, g in [(21, 1108, 301_000_000, 15),
                                 (14, 1041, 274_000_000, 14),
                                 (7, 933, 247_000_000, 14),
                                 (1, 824, 205_000_000, 13)]],
    "actions": {
        time.strftime("%Y-%m", time.gmtime(NOW - 62 * 86400)):
            {"trash": 214, "archive": 40, "move": 0, "mark_read": 120,
             "freed": 61_000_000},
        time.strftime("%Y-%m", time.gmtime(NOW - 31 * 86400)):
            {"trash": 187, "archive": 12, "move": 30, "mark_read": 0,
             "freed": 48_000_000},
        time.strftime("%Y-%m", time.gmtime(NOW)):
            {"trash": 284, "archive": 25, "move": 0, "mark_read": 66,
             "freed": 96_000_000},
    }}}}
Path(os.environ["STATS_HISTORY_PATH"]).write_text(json.dumps(history))
Path(os.environ["STATS_PATH"]).write_text(json.dumps(
    {"input_tokens": 412_331, "output_tokens": 60_112, "cost": 1.43,
     "runs": 9, "months": {time.strftime("%Y-%m"): 0.38}}))

# Pre-scan both accounts (incl. attachments) so screenshots are instant.
for name in ("proton", "icloud"):
    acc = accounts.get(name)
    mailops.run_scan(acc)
    mailops._run_atts(acc)
    st = mailops.public_state(acc)
    print(f"[demo] {name}: {len(st['groups']['sender'])} senders, "
          f"{sum(g['count'] for g in st['groups']['sender'].values())} mails")

if __name__ == "__main__":
    import uvicorn
    from backend.main import app
    uvicorn.run(app, host="0.0.0.0", port=8765, log_level="warning")
