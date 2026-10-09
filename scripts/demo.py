"""Demo server: Mailbroom on fully fake, in-memory mailboxes.

For screenshots and local poking without any real IMAP server:

    docker run --rm -p 127.0.0.1:8765:8765 \
      -v "$PWD":/repo ghcr.io/mclgoerg/mailbroom:latest \
      python /repo/scripts/demo.py

Two demo accounts ("proton", "icloud") with plausible senders, seeded AI
verdicts/ratings and statistics, plus a long tail of small senders so the
Smart tab has something to pool. Everything lives in a temp dir; nothing
touches /data or the network. All addresses use .example domains (the
"Individuals" tail writes from gmail.com / gmx.de / web.de with obviously
fake `demo.person*` local parts - freemail is what makes them individuals).
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

# Isolated storage - set BEFORE importing the backend (paths bind at import).
DATA = Path(tempfile.mkdtemp(prefix="mailbroom-demo-"))
os.environ.update(
    CONFIG_PATH=str(DATA / "config.json"),
    STATS_PATH=str(DATA / "ai_usage.json"),
    VERDICTS_PATH=str(DATA / "ai_verdicts.json"),
    UNSUB_STATE_PATH=str(DATA / "unsub_state.json"),
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


# One real conversation (Anna writes, the user replies from Sent, Anna answers
# with a quoted history) so the "Read conversation" view has something to show.
WANDER_1 = "<wander-1@demo.example>"
WANDER_R1 = "<wander-r1@demo.example>"
WANDER = [
    make_msg(next(_UID), frm='"Anna Weber" <anna.weber@mailfox.example>',
             subject="Wanderung am Samstag?", msgid=WANDER_1, size=2400,
             seen=True, date=_date(5),
             body="Hi!\n\nHast du am Samstag Zeit für eine Wanderung? Ich "
                  "dachte an die Runde um den See, ca. 5 Stunden.\n\nLG Anna"),
    make_msg(next(_UID), frm='"Anna Weber" <anna.weber@mailfox.example>',
             subject="Re: Wanderung am Samstag?", msgid="<wander-2@demo.example>",
             irt=WANDER_R1, refs=f"{WANDER_1} {WANDER_R1}", size=3100,
             seen=False, date=_date(2),
             body="Super, dann treffen wir uns um 9 Uhr am Parkplatz!\n\n"
                  "Am Mittwoch, 1. Oktober 2026 um 18:30 schrieb Demo "
                  "<demo@example.com>:\n> Klingt gut, ich bringe Brote mit.\n"
                  "> Wann geht es los?\n>\n> Am Montag, 29. September 2026 "
                  "um 09:12 schrieb Anna Weber <anna.weber@mailfox.example>:\n"
                  ">> Hi! Hast du am Samstag Zeit für eine Wanderung?\n"),
]

PROTON_INBOX = WANDER + (
    mails('"ACME Store" <news@acme-store.example>',
          ["Weekend SALE - up to 70% off ✨", "Your points expire soon",
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
            ["March meetup - RAW files inside", "Contest results 🎉"],
            9, unread=0.1, size=(2000000, 6000000),
            atts=[("IMG_2041.jpg", 4200000), ("IMG_2044.jpg", 3800000)])
    + mails('"Dr. Meier Praxis" <praxis@dr-meier.example>',
            ["Terminbestätigung", "Ihr Laborbefund ist da"], 5, unread=0.1)
)


# --- long tail ------------------------------------------------------------
# Real mailboxes are 80% senders with < 10 mails. Generated from a separate
# seeded stream, so the hand-written senders above keep their exact data.
_WORDS = ["acorn", "birch", "cobalt", "dune", "ember", "fjord", "glacier",
          "harbor", "iris", "juniper", "kelp", "lagoon", "maple", "nectar",
          "onyx", "pebble", "quartz", "reed", "sable", "tundra", "umber",
          "velvet", "willow", "yarrow", "zephyr", "amber", "basil", "cedar",
          "delta", "elm", "fern", "grove", "hazel", "indigo", "jade", "kiwi",
          "lotus", "mint", "nova", "olive"]


def _tail(local: str, domain: str, brands: list[str], subjects: list[str],
          counts=(1, 3), **kw) -> list[dict]:
    out: list[dict] = []
    for b in brands:
        out += mails(
            f'"{b.title()}" <{local}@{domain.format(b=b)}>',
            [s.replace("{b}", b.title()) for s in subjects],
            random.randint(*counts), newest_days=random.uniform(1, 200),
            span_days=random.uniform(30, 600), **kw)
    return out


def long_tail(scale: float = 1.0) -> tuple[list[dict], list[dict]]:
    """(inbox mails, sent mails): ~100 small senders spread over every kind
    Smart pools - companies, sign-ups, newsletters, notifications, shipping /
    finance categories, private addresses, people you write to, the rest."""
    state = random.getstate()
    random.seed(11)
    w = _WORDS
    k = lambda n: max(1, round(n * scale))          # noqa: E731
    inbox: list[dict] = []
    inbox += _tail("service", "{b}.example", ["paymate"],
                   ["Your monthly statement {n}", "Rewards update"], (5, 5))
    inbox += _tail("alerts", "{b}.example", ["paymate"],
                   ["New sign-in alert", "Spending summary"], (3, 3))
    inbox += _tail("support", "mail.{b}.example", ["paymate"],
                   ["Ticket {n} updated"], (3, 3))         # a subdomain: mixed
    for brand in ("rentwheels", "tripnest"):                # one exact domain
        for local in ("deals", "booking", "club"):
            inbox += _tail(local, "{b}.example", [brand],
                           ["Your trip, your deal", "Booking {n}"], (4, 4))
    inbox += _tail("no-reply", "{b}.example", w[:k(14)],
                   ["Welcome to {b}", "Please verify your email address",
                    "Your {b} login code"], unread=0.8)
    inbox += _tail("news", "{b}.example", w[14:14 + k(28)],
                   ["This week at {b}", "Our autumn picks", "{b} news"],
                   unsub=True)
    inbox += _tail("noreply", "{b}-app.example", w[2:2 + k(12)],
                   ["Your weekly summary", "Reminder: an update is ready"])
    inbox += _tail("parcel", "{b}-post.example", w[5:5 + k(6)],
                   ["Your parcel is on its way", "Shipment update {n}"])
    inbox += _tail("billing", "{b}-pay.example", w[9:9 + k(6)],
                   ["Invoice {n}", "Payment received"])
    people = [f"demo.person{i:02d}@{d}" for i, d in enumerate(
        ["gmail.com", "gmx.de", "web.de", "gmail.com", "outlook.com",
         "gmx.de", "gmail.com", "web.de", "gmail.com", "gmx.de"][:k(10)])]
    for addr in people:
        inbox += mails(f'"{addr.split("@")[0].replace(".", " ").title()}" '
                       f"<{addr}>", ["Hallo!", "Foto vom Sonntag", "Bis bald"],
                       random.randint(1, 3), newest_days=random.uniform(1, 90))
    inbox += _tail("m.schulz", "{b}-gmbh.example", w[20:20 + k(16)],
                   ["Ihr Angebot", "Quarterly update", "Terminerinnerung"],
                   (1, 2), unread=0.4)
    # People you write to: small senders that also got a mail from the user.
    wrote = [f"{n}@{d}.example" for n, d in (
        ("tobi", "kletterhalle"), ("nina.k", "mietverein"),
        ("vermieter", "hausverwaltung-nord"), ("opa", "familienpost"),
        ("steuerberater", "kanzlei-brandt"))]
    sent: list[dict] = []
    for addr in wrote:
        inbox += mails(f"<{addr}>", ["Re: Termin", "Kurze Frage"],
                       random.randint(2, 4), newest_days=random.uniform(3, 60),
                       unread=0.2)
        sent.append(make_msg(next(_UID), frm="Demo <demo@example.com>",
                             subject="Re: Termin", to=addr, seen=True,
                             date=_date(random.uniform(2, 50))))
    random.setstate(state)
    return inbox, sent


PROTON_TAIL, PROTON_TAIL_SENT = long_tail()
ICLOUD_TAIL, ICLOUD_TAIL_SENT = long_tail(0.4)


PROTON = FakeIMAP({
    "INBOX": PROTON_INBOX + PROTON_TAIL,
    "Sent": PROTON_TAIL_SENT + [make_msg(
        next(_UID), frm="Demo <demo@example.com>",
        subject="Re: Wanderung am Samstag?", msgid=WANDER_R1,
        irt=WANDER_1, refs=WANDER_1, to="anna.weber@mailfox.example",
        cc="praxis@dr-meier.example", seen=True, date=_date(4),
        body="Klingt gut, ich bringe Brote mit. Wann geht es los?\n\n"
             "Am Montag, 29. September 2026 um 09:12 schrieb Anna Weber "
             "<anna.weber@mailfox.example>:\n> Hi! Hast du am Samstag Zeit "
             "für eine Wanderung?")],
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
        + ICLOUD_TAIL
    ),
    "Sent Messages": ICLOUD_TAIL_SENT + [make_msg(
        next(_UID), frm="Demo <demo@icloud.example>",
        subject="Re: Sonntag bei Oma?",
        to="lisa@familienpost.example", seen=True)],
    "Deleted Messages": [],
})

FAKES = {"demo-proton": PROTON, "demo-icloud": ICLOUD}
mailops.connect = lambda im, name=None: FAKES[im["host"]]

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
