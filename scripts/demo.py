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
    AI_SORT_PATH=str(DATA / "ai_sort.json"),
    SENDER_KNOWLEDGE_PATH=str(DATA / "sender_knowledge.json"),
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
from backend import (accounts, aihelper, knowledgestore, mailops,   # noqa: E402
                     rules, unsubstore, verdictstore)

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
    # Quick wins (F5): senders that have gone quiet, so the strip has cards
    # - old unread newsletters, a low-engagement sender, an unsubscribed one
    # still holding mail, and old big attachments.
    + mails('"Gadget Weekly" <news@gadgetweekly.example>',
            ["Gadget of the week", "Ten tips for your desk"], 120,
            newest_days=260, span_days=800, unread=0.99, unsub=True)
    + mails('"Deal Hunter" <hello@dealhunter.example>',
            ["Deals you missed", "Flash sale ends tonight"], 80,
            newest_days=300, span_days=750, unread=0.99, unsub=True)
    + mails('"Old Forum" <digest@oldforum.example>',
            ["Your daily digest", "New replies in threads you follow"], 60,
            newest_days=500, span_days=900, unread=0.97)
    + mails('"Coupon Club" <offers@couponclub.example>',
            ["Your coupon is waiting", "Members-only offer"], 40,
            newest_days=40, span_days=400, unread=0.9, unsub=True)
    + mails('"Photo Archive" <hello@photoarchive.example>',
            ["Scans from the family archive", "Your scanned documents"], 12,
            newest_days=800, span_days=1000, unread=0.5,
            size=(7000000, 8000000),
            atts=[("scan-1.pdf", 6000000), ("scan-2.pdf", 6000000)])
)


# Newsletters nobody has opened for ages (the "Describe a filter" demo
# sentence selects them). Own random stream: the senders above, the long tail
# and everything seeded later keep their exact data.
_state = random.getstate()
random.seed(11)
PROTON_INBOX += (
    mails('"Old Gazette" <weekly@old-gazette.example>',
          ["The week in brief", "Reader offers", "Editor's picks"], 26,
          newest_days=410, span_days=900, unread=1.0, unsub=True)
    + mails('"Retro Deals" <digest@retro-deals.example>',
            ["Deals you missed", "Back in stock", "Final reminder"], 12,
            newest_days=560, span_days=1000, unread=0.97, unsub=True)
)
random.setstate(_state)


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
    Smart pools - companies, sign-ups, newsletters, orders, appointments,
    applications, support, private addresses, people you write to, the
    rest."""
    state = random.getstate()
    random.seed(11)
    w = _WORDS
    k = lambda n: max(1, round(n * scale))          # noqa: E731
    inbox: list[dict] = []
    inbox += _tail("service", "{b}.example", ["paymate"],
                   ["Your invoice {n}", "Rewards update"], (5, 5))
    inbox += _tail("alerts", "{b}.example", ["paymate"],
                   ["New sign-in alert", "Spending summary"], (3, 3))
    inbox += _tail("support", "mail.{b}.example", ["paymate"],
                   ["Ticket-ID {n} updated"], (3, 3))     # a subdomain: mixed
    for brand in ("rentwheels", "tripnest"):                # one exact domain
        for local in ("deals", "booking", "club"):
            inbox += _tail(local, "{b}.example", [brand],
                           ["Your deal of the week", "Booking {n}"], (4, 4))
    inbox += _tail("no-reply", "{b}.example", w[:k(14)],
                   ["Welcome to {b}", "Please verify your email address",
                    "Your {b} login code"], unread=0.8)
    inbox += _tail("news", "{b}.example", w[14:14 + k(28)],
                   ["This week at {b}", "Our autumn picks", "{b} news"],
                   unsub=True)
    # what the mails are about decides the row (not the address): orders,
    # appointments, applications, support - and some that say nothing (Other)
    inbox += _tail("noreply", "{b}-app.example", w[2:2 + k(12)],
                   ["Your weekly summary", "Reminder: an update is ready"])
    inbox += _tail("parcel", "{b}-post.example", w[5:5 + k(6)],
                   ["Your order {n} has shipped", "Delivery: parcel {n} is on its way"])
    inbox += _tail("billing", "{b}-pay.example", w[9:9 + k(6)],
                   ["Invoice {n}", "Payment received"])
    inbox += _tail("termin", "{b}-praxis.example", w[12:12 + k(7)],
                   ["Terminbestätigung", "Erinnerung an Ihren Termin"])
    inbox += _tail("hr", "{b}-karriere.example", w[18:18 + k(4)],
                   ["Your application at {b}", "Interview invitation"])
    inbox += _tail("help", "{b}-desk.example", w[24:24 + k(6)],
                   ["Re: Your inquiry", "Ticket-ID {n} updated"])
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
                   ["We miss you!"], 34, unread=0.9)
    + mails('"Bergsport Huber" <newsletter@bergsport-huber.example>',
            ["Alte Aktion {n}"], 22, unread=0.2)
    + mails('"Ticket Shop" <orders@ticketshop.example>',
            ["Your order {n}", "Cancelled: {n}"], 14, unread=0.1),
    # Junk: a few invented senders, one of them a false alarm to rescue
    "Spam": mails('"Prize Desk" <win@prize-desk.example>',
                  ["You have won {n}", "Claim now"], 6, newest_days=0.5,
                  span_days=20, unread=0.9)
    + mails('"Cheap Meds" <offers@pharma-deals.example>',
            ["Limited offer {n}"], 4, newest_days=1.5, span_days=25,
            unread=0.9)
    + mails('"Anna Weber" <anna.weber@mailfox.example>',
            ["Fwd: Wanderkarte"], 1, newest_days=2, unread=1.0),
    # a client-made second Junk folder: Settings > Folders asks which one
    "Junk Email": mails('"Old Newsletter" <bye@gone.example>',
                        ["Special offer"], 3, unread=0.9),
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
    # a client-made look-alike of the server's Trash (Settings can move it)
    "Gelöschte Elemente": mails('"Cloud Photos" <no-reply@cloudphotos.example>',
                                ["Storage reminder"], 5, unread=0.5),
}, flags={"Deleted Messages": "\\Trash"})

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

# Unsubscribe records for the watchdog: three "done" senders whose mail kept
# arriving (flagged "Still mailing"), one that went quiet (just a tick), and
# a confirmation-page ("link") and a failed attempt that must NOT be flagged.
_UN_NOW = int(NOW)
unsubstore.save({
    "news@acme-store.example": {"status": "done", "method": "one-click",
        "detail": "", "error": "", "ts": _UN_NOW - 40 * 86400},
    "notify@chirper.example": {"status": "done", "method": "mailto",
        "detail": "", "error": "", "ts": _UN_NOW - 120 * 86400},
    "jobs@jobportal.example": {"status": "done",
        "method": "confirmed by hand", "detail": "", "error": "",
        "ts": _UN_NOW - 300 * 86400},
    "digest@techdigest.example": {"status": "done", "method": "one-click",
        "detail": "", "error": "", "ts": _UN_NOW - 86400},
    "info@streamly.example": {"status": "link", "method": "",
        "detail": "https://streamly.example/stop", "error": "",
        "ts": _UN_NOW - 200 * 86400},
    "newsletter@bergsport-huber.example": {"status": "failed", "method": "",
        "detail": "", "error": "HTTP 500", "ts": _UN_NOW - 200 * 86400},
}, "proton")

# The unsubscribe the Coupon Club sender already went through (card 3).
unsubstore.record("offers@couponclub.example", "done", "one-click",
                  account="proton")

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

# Sender knowledge (what the user filed in Smart): a regular bill filed under
# Other, a sign-up sender under Accounts, a company entry that has no effect
# (the company has a row of its own), a kept AI answer and an entry nobody
# matches - every status the Settings table can show.
_NOW = int(NOW)
knowledgestore.modify(lambda entries: entries.update({
    "a:billing@juniper-pay.example": {
        "kind": "other", "src": "user", "ts": _NOW - 86400 * 5,
        "note": "regular bill"},
    "a:noreply@cobalt-app.example": {
        "kind": "accounts", "src": "user", "ts": _NOW - 86400 * 3, "note": ""},
    "co:paymate.example": {
        "kind": "support", "src": "user", "ts": _NOW - 86400 * 2,
        "note": "company with its own row"},
    "a:noreply@dune-app.example": {
        "kind": "support", "src": "ai", "ts": _NOW - 86400, "note": ""},
    "a:ghost@nowhere.example": {
        "kind": "jobs", "src": "user", "ts": _NOW - 86400 * 30,
        "note": "left the mailbox"},
}))

# "Describe a filter" without a provider: a canned stand-in for the AI client
# that knows three sentences (English + German) and answers everything else
# with "not expressible". It sees exactly what a real provider would see (the
# prompt and the sentence), so the panel behaves like the real thing.
_FILTER_ANSWERS = [
    (("never read", "nie lese"),
     {"query": "tag:newsletter unread:>90 age:>1y", "unsupported": [],
      "explanation": "Newsletters, which you hardly ever open, with no mail "
                     "for over a year."}),
    (("shipping", "versand"),
     {"query": "tag:shipping ai:safe", "unsupported": [],
      "explanation": "Shipping notifications the AI rated safe to delete."}),
    (("never answered", "nie geantwortet"),
     {"query": "att:>5m is:noreply-ever",
      "unsupported": ["only mails from last week"],
      "explanation": "Senders with large attachments that you never wrote "
                     "to."}),
]
_FILTER_ANSWERS_DE = {
    "tag:newsletter unread:>90 age:>1y":
        "Newsletter, die Sie kaum öffnen, ohne Mail seit über einem Jahr.",
    "tag:shipping ai:safe":
        "Versandmeldungen, die die KI als harmlos einstuft.",
    "att:>5m is:noreply-ever":
        "Absender mit großen Anhängen, denen Sie nie geschrieben haben.",
}


_real_ai_client = aihelper.ai_client


def _demo_ai_client(cfg):

    def create(**kw):
        ask = json.loads(kw["messages"][0]["content"])
        if "sentence" not in ask:            # not a filter request
            return _real_ai_client(cfg).messages.create(**kw)
        sentence = ask["sentence"].lower()
        out = {"query": "", "unsupported": [ask["sentence"][:80]],
               "explanation": "The demo AI only knows three example "
                              "sentences."}
        for needles, answer in _FILTER_ANSWERS:
            if any(n in sentence for n in needles):
                out = dict(answer)
                if ask["language"] == "German":
                    out["explanation"] = _FILTER_ANSWERS_DE[out["query"]]
                    out["unsupported"] = [u.replace(
                        "only mails from last week", "nur Mails der letzten Woche")
                        for u in out["unsupported"]]
        return types.SimpleNamespace(
            stop_reason="end_turn",
            content=[types.SimpleNamespace(type="text",
                                           text=json.dumps(out))],
            usage=types.SimpleNamespace(input_tokens=900, output_tokens=80))
    return types.SimpleNamespace(messages=types.SimpleNamespace(create=create))


aihelper.ai_client = _demo_ai_client

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
