"""The demo's generated data: two fake mailboxes plus everything that
belongs to them (verdicts, unsubscribe records, rules, statistics, audit log,
sender knowledge), scanned once so the UI is instant.

Imported by `demo.py` (never run on its own) after it has pointed the
backend's paths at the demo data dir; `generate()` fills that dir and returns
the FakeIMAP servers by host. `NOW` is the instant the mail dates derive from
(`DEMO_NOW`, else the wall clock at import)."""

from __future__ import annotations

import datetime
import json
import os
import random
import re
import time
from pathlib import Path

from conftest import FakeIMAP, make_msg
from backend import (accounts, bodyindex, demo, knowledgestore, mailops, rules,
                     unsubstore, verdictstore)

if "CONFIG_PATH" not in os.environ:
    raise RuntimeError("demo_generate is imported by demo.py, which isolates "
                       "the data dir first")

random.seed(7)
NOW = float(os.environ.get("DEMO_NOW") or time.time())


def _date(days_ago: float) -> str:
    return time.strftime("%d-%b-%Y %H:%M:%S +0000",
                         time.gmtime(NOW - days_ago * 86400))


_UID = iter(range(1, 100000))


def newsletter_html(pixel: str | None = None, click: str | None = None):
    """HTML bodies for the tracker report: a normal banner and link plus,
    optionally, an open-tracking pixel and/or a click-tracking redirect link
    on the given (invented) hosts. No random draws, so the data of the
    other senders stays exactly as it was."""
    def build(i: int) -> str:
        tok = f"d{i:04d}x7k2m9q4w8e6r1t5y"
        parts = ["<p>Hi there - here are this week's highlights.</p>",
                 '<img src="https://cdn.demo.example/banner.jpg" '
                 'width="600" height="300" alt="">',
                 '<a href="https://shop.demo.example/offers">See offers</a>']
        if click:
            parts.append(f'<a href="https://{click}/click/{tok}">Read on</a>')
        if pixel:
            parts.append(f'<img src="https://{pixel}/open/{tok}.gif" '
                         'width="1" height="1" alt="">')
        return "\n".join(parts)
    return build


PIXEL_HOST = "px.beacons-demo.example"
CLICK_HOST = "r.linkhop-demo.example"


ME = "Demo <demo@example.com>"
FREEMAIL = ("@gmail.com", "@gmx.de", "@web.de", "@outlook.com")
_DE = re.compile(r"\b(Ihr|Ihre|Ihren|Ihrem|ist|wurde|am|für|der|die|das|und|"
                 r"Termin\w*|Foto\w*|Hallo|bald|Geschenk|Neu\w*|Angebot|"
                 r"Frage|Wanderung|Sendung|Zustellung|Paket|Rechnung|Befund|"
                 r"Kletterhalle|Wochenend\w*|Urlaub\w*|Sonntag|Geburtstag|"
                 r"Nebenkosten\w*|Mietvertrag|Steuer\w*|Programm|Vorpremiere)"
                 r"\b")


def _kind(m: dict) -> str:
    """What sort of sender a mail came from, to pick a body for it."""
    addr = m["from"].rsplit("<", 1)[-1].rstrip(">").lower()
    subj = m["subject"].lower()
    if addr.startswith("demo@"):
        return "me"
    if "praxis" in addr:
        return "practice"
    if (addr.endswith(FREEMAIL) or "anna.weber@" in addr
            or addr.split("@")[1].startswith(("familienpost", "kletterhalle",
                                              "mietverein", "kanzlei"))):
        return "person"
    if any(w in subj for w in ("sendung", "paket", "shipped", "delivery",
                               "zustellung", "unterwegs", "bestellung")):
        return "parcel"
    return "newsletter" if m["unsub"] else "service"


_BODY = {
    "person": ("Hallo!\n\n{subj} - melde dich einfach, wenn es dir "
               "passt. Ich freue mich!\n\nLG {name}",
               "Hi!\n\n{subj} - let me know what works for you.\n\n"
               "Cheers,\n{name}"),
    "me": ("Hallo {first},\n\n{subj} - passt für mich, danke dir!\n\n"
           "Viele Grüße\nDemo",
           "Hi {first},\n\n{subj} - works for me, thanks!\n\nBest,\nDemo"),
    "practice": ("Guten Tag,\n\n{subj}. Bitte bringen Sie Ihre "
                 "Versichertenkarte mit.\n\nFreundliche Grüße\n{name}",
                 "Hello,\n\n{subj}. Please bring your insurance card.\n\n"
                 "Kind regards,\n{name}"),
    "parcel": ("Hallo,\n\n{subj}. Den aktuellen Status sehen Sie jederzeit "
               "in der Sendungsverfolgung.\n\n{name}",
               "Hello,\n\n{subj}. You can follow the delivery any time in "
               "your account.\n\n{name}"),
    "service": ("Guten Tag,\n\n{subj}. Die Details finden Sie in Ihrem "
                "Konto.\n\nDies ist eine automatische Nachricht.\n{name}",
                "Hello,\n\n{subj}. The details are in your account.\n\n"
                "This is an automated message.\n{name}"),
    "newsletter": ("Hallo,\n\n{subj}\n\nDas gibt es diese Woche Neues. "
                   "Kein Interesse mehr? Abmelden geht ganz unten.\n\n{name}",
                   "Hi,\n\n{subj}\n\nHere is what is new this week. Not "
                   "interested any more? Unsubscribe at the bottom.\n\n{name}"),
}


def _who(addr: str) -> str:
    """The display name of an address header, else its local part."""
    name = addr.split("<")[0].strip(' "')
    return name or addr.strip("<>").split("@")[0].split(".")[0].title() or "Demo"


def body_for(m: dict) -> str:
    """A short plain-text body fitting the sender: friendly for people, terse
    for services, a pitch for newsletters; German or English by subject."""
    kind = _kind(m)
    disp = _who(m["from"])
    first = _who(m.get("to") or "").split()[0] if kind == "me" \
        else disp.split()[0]
    subj = re.sub(r"^(re|fwd): *", "", m["subject"], flags=re.I).rstrip("?!.")
    de = bool(_DE.search(m["subject"]))
    return _BODY[kind][0 if de else 1].format(
        first=first, subj=subj, name=disp)


def fill_bodies(box: list[dict]) -> list[dict]:
    """Give every plain-text mail without a body one (see `body_for`). Run
    AFTER the Proton body index was built: that index keeps every body it
    sees (encrypted, so it does not compress) and is part of the seed's
    size budget; the viewer reads the mail from the server, not the index."""
    for m in box:
        if m["body"] is None and m["html"] is None:
            m["body"] = body_for(m)
    return box


def _when(date: str) -> float:
    return datetime.datetime.strptime(date, "%d-%b-%Y %H:%M:%S %z").timestamp()


def thread_chains(msgs: list[dict], sent: list[dict], me: str = ME,
                  seed: int = 23) -> list[dict]:
    """Turn runs of 3-7 neighbouring mails (newest first, as `mails` makes
    them) into conversations: the sender writes, the demo user answers (the
    answer moves to `sent`), the sender replies again, ... Each reply follows
    the mail before it by a few hours to a day or two, with In-Reply-To /
    References and a `Re:` subject. Own random stream: nothing else in the
    demo shifts. Returns the mails that stay in the folder."""
    rng = random.Random(seed)
    keep: list[dict] = []
    i = 0
    while i < len(msgs):
        run = msgs[i:i + rng.randint(3, 7)]
        i += len(run)
        run.reverse()                       # oldest first, the sender starts
        person = run[0]["from"]
        t = _when(run[-1]["date"])
        stamps = [t]
        for _ in run[:-1]:                  # walk back from the newest
            t -= rng.uniform(3, 40) * 3600
            stamps.append(t)
        stamps.reverse()
        refs: list[str] = []
        for k, m in enumerate(run):
            m["date"] = time.strftime("%d-%b-%Y %H:%M:%S +0000",
                                      time.gmtime(stamps[k]))
            if refs:
                m["irt"], m["refs"] = refs[-1], " ".join(refs)
                m["subject"] = "Re: " + run[0]["subject"].removeprefix("Re: ")
            refs.append(m["msgid"])
            if k % 2:                       # the user's turn
                m.update(to=person, atts=[], unsub=None, seen=True, size=2500)
                m["from"] = me
                sent.append(m)
            else:
                keep.append(m)
    return keep


def _atts_for(i: int, atts, att_n: int):
    """The attachments of mail `i`: only the `att_n` newest carry them; a
    list of lists is cycled through (a mix of file types)."""
    if not atts or i >= att_n:
        return None
    return atts[i % len(atts)] if isinstance(atts[0], list) else atts


def mails(frm: str, subjects: list[str], n: int, *, newest_days=1.0,
          span_days=700.0, unread=0.7, size=(9000, 60000), unsub=False,
          atts=None, att_n=3, html=None, chain: list | None = None,
          me: str = ME) -> list[dict]:
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
            atts=_atts_for(i, atts, att_n),
            html=html(i) if html else None,
            body=None))
    return out if chain is None else thread_chains(out, chain, me)


def copies(msgs: list[dict], *, seen=None) -> list[dict]:
    """Copies of `msgs` under fresh UIDs but the same Message-ID, date and
    size: the same mail filed twice (another folder, or the mailbox
    delivered it twice)."""
    return [{**m, "uid": next(_UID),
             "seen": m["seen"] if seen is None else seen} for m in msgs]


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

PROTON_SENT: list[dict] = []       # the user's side of the Proton conversations

PROTON_INBOX = WANDER + (
    mails('"ACME Store" <news@acme-store.example>',
          ["Weekend SALE - up to 70% off ✨", "Your points expire soon",
           "New arrivals for autumn", "Last chance: free shipping"],
          214, unsub=True,
          html=newsletter_html(PIXEL_HOST, CLICK_HOST))
    + mails('"PaketFix" <noreply@paketfix.example>',
            ["Ihre Sendung {n} ist unterwegs", "Zustellung heute: Paket {n}",
             "Ihr Paket {n} wurde zugestellt"], 96, unread=0.85)
    + mails('"Chirper" <notify@chirper.example>',
            ["You have 3 new followers", "Trending now on Chirper",
             "@rob mentioned you"], 168, unsub=True, unread=0.9,
          html=newsletter_html(PIXEL_HOST))
    + mails('"TechDigest" <digest@techdigest.example>',
            ["Issue #{n}: Rust vs. the world", "Weekly: self-hosting corner",
             "Issue #{n}: the terminal renaissance"], 88, unsub=True,
          html=newsletter_html(click=CLICK_HOST))
    + mails('"Streamly" <info@streamly.example>',
            ["New this week on Streamly", "Your watchlist just got better"],
            64, unsub=True, unread=0.8,
            html=newsletter_html("track.streamly-demo.example"))
    + mails('"Bergsport Huber" <newsletter@bergsport-huber.example>',
            ["Neu eingetroffen: Tourenski 2026", "Wochenend-Angebote",
             "Gutschein: 10 € für deine nächste Tour"], 51, unsub=True,
          html=newsletter_html())
    + mails('"PayBank" <service@paybank.example>',
            ["Your statement is available", "Security notice about your "
             "account", "Payment of ${n}.00 completed",
             "Offer: 3% cashback on your next card purchase"],
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
            atts=[[("rechnung.pdf", 150000)],
                  [("Vertragsbedingungen.docx", 85000)]])
    + mails('"Anna Weber" <anna.weber@mailfox.example>',
            ["Kletterhalle am Freitag", "Fotos vom Wochenende",
             "Geschenk für Papa"], 12, unread=0.05,
            size=(4000, 30000), chain=PROTON_SENT)
    + mails('"Photo Club" <hello@photoclub.example>',
            ["March meetup - RAW files inside", "Contest results 🎉"],
            9, unread=0.1, size=(2000000, 6000000),
            atts=[("IMG_2041.jpg", 4200000), ("IMG_2044.jpg", 3800000)])
    # one domain with several senders (and one protected address on another
    # shared domain), so the Space map has something to drill into
    + mails('"Northwind Shop" <shop@northwind.example>',
            ["Your order {n} is confirmed", "Autumn collection is here"],
            60, unread=0.6, size=(40000, 120000))
    + mails('"Northwind News" <news@northwind.example>',
            ["Northwind weekly", "Members only: early access"],
            80, unsub=True, unread=0.9, size=(30000, 90000))
    + mails('"Northwind Invoices" <invoices@northwind.example>',
            ["Invoice NW-{n}", "Your receipt NW-{n}"],
            20, unread=0.3, size=(300000, 700000),
            atts=[("invoice.pdf", 420000)])
    + mails('"Mailfox Photos" <photos@mailfox.example>',
            ["Your album is ready", "New photos from the trip"],
            14, unread=0.2, size=(800000, 2500000),
            atts=[[("album.zip", 1900000)], [("beach.png", 1400000)]])
    + mails('"Dr. Meier Praxis" <praxis@dr-meier.example>',
            ["Terminbestätigung", "Ihr Laborbefund ist da"], 5, unread=0.1,
          chain=PROTON_SENT)
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

# A "ghost" sender for Your year in mail: plenty of mail, never opened. The
# shared random stream is restored so the data after it stays unchanged.
_rs = random.getstate()
PROTON_INBOX += mails('"Quiet Deals" <promo@quietdeals.example>',
                      ["Deal of the day", "Members only: 20% off",
                       "Your cart misses you"], 36, span_days=500,
                      unread=1.0, unsub=True)
random.setstate(_rs)


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


def long_tail(scale: float = 1.0, me: str = ME) -> tuple[list[dict], list[dict]]:
    """(inbox mails, sent mails): ~100 small senders spread over every kind
    Smart pools - companies, sign-ups, newsletters, orders, appointments,
    applications, support, private addresses, people you write to, the
    rest."""
    state = random.getstate()
    random.seed(11)
    sent: list[dict] = []                # the user's side of the conversations
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
                   unsub=True, html=newsletter_html(PIXEL_HOST))
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
                   ["Your inquiry", "Ticket-ID {n} updated"], chain=sent,
                   me=me)
    people = [f"demo.person{i:02d}@{d}" for i, d in enumerate(
        ["gmail.com", "gmx.de", "web.de", "gmail.com", "outlook.com",
         "gmx.de", "gmail.com", "web.de", "gmail.com", "gmx.de"][:k(10)])]
    names = ["Mia Becker", "Jonas Keller", "Sofia Lang", "Ben Hartmann",
             "Clara Neumann", "Lukas Vogel", "Emma Roth", "Paul Fischer",
             "Hannah Wolf", "Felix Brandt"]
    for addr, name in zip(people, names):
        inbox += mails(f'"{name}" <{addr}>', ["Hallo!", "Foto vom Sonntag", "Bis bald"],
                       random.randint(1, 3), newest_days=random.uniform(1, 90),
                       chain=sent, me=me)
    inbox += _tail("m.schulz", "{b}-gmbh.example", w[20:20 + k(16)],
                   ["Ihr Angebot", "Quarterly update", "Terminerinnerung"],
                   (1, 2), unread=0.4, chain=sent, me=me)
    # People you write to: small senders that also got a mail from the user.
    wrote = [f"{n}@{d}.example" for n, d in (
        ("tobi", "kletterhalle"), ("nina.k", "mietverein"),
        ("vermieter", "hausverwaltung-nord"), ("opa", "familienpost"),
        ("steuerberater", "kanzlei-brandt"))]
    for addr in wrote:
        inbox += mails(f"<{addr}>", ["Termin am Donnerstag", "Kurze Frage"],
                       random.randint(2, 4), newest_days=random.uniform(3, 60),
                       unread=0.2, chain=sent, me=me)
    random.setstate(state)
    return inbox, sent


PROTON_TAIL, PROTON_TAIL_SENT = long_tail()
ICLOUD_ME = "Demo <demo@icloud.example>"
ICLOUD_TAIL, ICLOUD_TAIL_SENT = long_tail(0.4, ICLOUD_ME)
ICLOUD_SENT = ICLOUD_TAIL_SENT


# Duplicates and the Archive folder, from their own random stream. The same
# mail filed twice has the same Message-ID (Inbox + Archive); a mail the
# server delivered twice is an exact copy in the same folder. Mails that
# merely look alike (two monthly statements) keep their own ids.
_state = random.getstate()
random.seed(31)
_by = lambda inbox, key: [m for m in inbox if key in m["from"]]   # noqa: E731
PROTON_COPIES = copies(_by(PROTON_INBOX, "paybank")[:3])
PROTON_ARCHIVE = (
    copies(_by(PROTON_INBOX, "cloudbox")[:6])
    + copies(_by(PROTON_INBOX, "greenenergy")[:4])
    + mails('"Finanzamt Musterstadt" <bescheid@finanzamt-musterstadt.example>',
            ["Steuerbescheid {n}", "Ihre Steuererklärung ist eingegangen"],
            5, newest_days=400, span_days=1100, unread=0.0,
            size=(300000, 900000), atts=[("Steuerbescheid.pdf", 420000)],
            att_n=5)
    + mails('"Dr. Meier Praxis" <praxis@dr-meier.example>',
            ["Ihr Laborbefund ist da"], 3, newest_days=200, span_days=600,
            unread=0.0))

# iCloud: a busy inbox with a few big senders, old photo and document
# attachments, a full Trash, a Junk folder with one false alarm, an Archive.
ICLOUD_INBOX = (
    mails('"Fruit Store" <receipts@fruitstore.example>',
          ["Your receipt #{n}", "Pre-order now", "Your order #{n} has shipped"],
          120, unread=0.5, size=(30000, 90000),
          atts=[("receipt.pdf", 60000)], att_n=30)
    + mails('"Quick Bite" <deals@quickbite.example>',
            ["Your voucher expires tonight", "Free delivery this weekend",
             "New in your area"], 140, unsub=True, unread=0.85)
    + mails('"Cloud Photos" <no-reply@cloudphotos.example>',
            ["Your storage is 80% full", "Memories from last year"],
            90, unsub=True)
    + mails('"Reisefieber" <news@reisefieber.example>',
            ["Last-Minute: Städtetrips ab 49 €", "Ihr Urlaubsmagazin",
             "Sommer-Highlights"], 55, unsub=True, unread=0.8)
    + mails('"Fit Club" <hello@fitclub.example>',
            ["Your trial week is over", "Come back for 50% off"], 48,
            newest_days=200, span_days=600, unread=0.97, unsub=True)
    + mails('"Kino Zentral" <programm@kino-zentral.example>',
            ["Das Programm der Woche", "Vorpremiere: Karten sichern"], 40,
            unsub=True, unread=0.9)
    + mails('"Family Chat" <lisa@familienpost.example>',
            ["Sonntag bei Oma?", "Urlaubsfotos!", "Geburtstag am Samstag"],
            14, unread=0.1, size=(3000000, 5500000), chain=ICLOUD_SENT,
            me=ICLOUD_ME,
            atts=[[("IMG_3310.jpg", 3400000)],
                  [("Oma-Geburtstag.png", 2100000)],
                  [("Urlaub.zip", 5200000)]], att_n=9)
    + mails('"Verwaltung Nord" <post@hausverwaltung-nord.example>',
            ["Nebenkostenabrechnung {n}", "Mietvertrag: Nachtrag"], 9,
            newest_days=800, span_days=1150, unread=0.3,
            size=(6000000, 9000000),
            atts=[[("Nebenkostenabrechnung.pdf", 7000000)],
                  [("Mietvertrag.docx", 900000), ("Anlage.zip", 6000000)]],
            att_n=9)
    + ICLOUD_TAIL)
ICLOUD_COPIES = copies(_by(ICLOUD_INBOX, "cloudphotos")[:3])
ICLOUD_ARCHIVE = (copies(_by(ICLOUD_INBOX, "fruitstore")[:3])
                  + copies(_by(ICLOUD_INBOX, "hausverwaltung-nord")[:2]))
random.setstate(_state)


def _server(mailbox: dict, **kw) -> FakeIMAP:
    return FakeIMAP(mailbox, date_header=True, **kw)


PROTON = _server({
    "INBOX": PROTON_INBOX + PROTON_COPIES + PROTON_TAIL,
    "Sent": PROTON_TAIL_SENT + PROTON_SENT + [make_msg(
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
    "Archive": PROTON_ARCHIVE,
    "Drafts": [],
})

ICLOUD = _server({
    "INBOX": ICLOUD_INBOX + ICLOUD_COPIES,
    "Sent Messages": ICLOUD_SENT,
    "Deleted Messages": (
        mails('"Quick Bite" <deals@quickbite.example>',
              ["Your voucher expired", "Order #{n} delivered"], 26,
              unread=0.9)
        + mails('"Fit Club" <hello@fitclub.example>',
                ["Membership offer"], 12, unread=0.9)
        + mails('"Fruit Store" <receipts@fruitstore.example>',
                ["Your receipt #{n}"], 9, unread=0.2)),
    "Junk": mails('"Lotto Winner" <claim@lotto-prize.example>',
                  ["You are our lucky winner {n}", "Claim your prize"], 5,
                  newest_days=0.5, span_days=15, unread=0.9)
    + mails('"Crypto Gains" <invest@coin-boost.example>',
            ["Double your savings {n}"], 4, newest_days=1, span_days=20,
            unread=0.9)
    + mails('"Family Chat" <lisa@familienpost.example>',
            ["Fwd: Fotos von Oma"], 1, newest_days=2, unread=1.0),
    "Archive": ICLOUD_ARCHIVE,
    # a client-made look-alike of the server's Trash (Settings can move it)
    "Gelöschte Elemente": mails('"Cloud Photos" <no-reply@cloudphotos.example>',
                                ["Storage reminder"], 5, unread=0.5),
}, flags={"Deleted Messages": "\\Trash", "Junk": "\\Junk"})

FAKES = {"demo-proton": PROTON, "demo-icloud": ICLOUD}


def generate() -> dict:
    """Fill the data dir, scan both accounts and return `{host: FakeIMAP}`."""
    def _connect(im, name=None):
        if im.get("host") not in FAKES:
            raise demo.refusal()          # "Add account" with a real server
        return FAKES[im["host"]]


    mailops.connect = _connect

    # Two configured, fully scanned accounts (hosts route to the fakes above).
    Path(os.environ["CONFIG_PATH"]).write_text(json.dumps({
        "accounts": {
            "proton": {"host": "demo-proton", "user": "demo@example.com",
                       "password": "demo", "preset": "proton", "cafile": "",
                       "body_search": "local"},
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

    for key, verdict, reason in [
        ("deals@quickbite.example", "delete_safe", "Food delivery promotions"),
        ("news@reisefieber.example", "delete_safe", "Travel newsletter, never opened"),
        ("hello@fitclub.example", "delete_safe", "Gym marketing after the trial"),
        ("programm@kino-zentral.example", "delete_safe", "Weekly cinema programme"),
        ("no-reply@cloudphotos.example", "review", "Storage notices and memories"),
        ("receipts@fruitstore.example", "review", "Receipts you may need for returns"),
        ("post@hausverwaltung-nord.example", "keep", "Rental contract and utility statements"),
        ("lisa@familienpost.example", "keep", "Family, photos from relatives"),
    ]:
        verdictstore.save("sender", {key: {"verdict": verdict, "reason": reason}},
                          "icloud")

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

    # iCloud: one done (and quiet since), one that kept mailing, one that
    # needs a confirmation page.
    unsubstore.save({
        "deals@quickbite.example": {"status": "done", "method": "one-click",
            "detail": "", "error": "", "ts": _UN_NOW - 4 * 86400},
        "hello@fitclub.example": {"status": "done", "method": "mailto",
            "detail": "", "error": "", "ts": _UN_NOW - 400 * 86400},
        "programm@kino-zentral.example": {"status": "link", "method": "",
            "detail": "https://kino-zentral.example/abmelden", "error": "",
            "ts": _UN_NOW - 30 * 86400},
    }, "icloud")

    # Per-mail ratings on the PayBank group -> rating chips. Plausible ones:
    # statements and payments are worth a look, security notices are kept,
    # only the promotional mails are safe to delete.
    def _paybank_rating(subject: str) -> str:
        if subject.startswith("Offer"):
            return "delete_safe"
        return "keep" if subject.startswith("Security") else "review"


    paybank = [m for m in PROTON_INBOX if "paybank" in m["from"]]
    verdictstore.save_mails(
        {m["msgid"]: _paybank_rating(m["subject"]) for m in paybank})

    # A saved rule + cleanup history for the stats panel.
    sweep = rules.create_rule({"name": "Sweep old newsletters",
                               "query": "is:unsub age:>1y", "action": "trash",
                               "schedule": "manual", "account": "proton"})
    parcels = rules.create_rule({"name": "Archive old parcel mails",
                                 "query": "tag:shipping age:>1y",
                                 "action": "archive", "schedule": "manual",
                                 "account": "proton"})
    lapsed = rules.create_rule({"name": "Sweep lapsed promotions",
                                "query": "is:unsub age:>1y unread:>90",
                                "action": "trash", "schedule": "manual",
                                "account": "icloud"})
    _ic = ICLOUD.mailbox["INBOX"]
    _icn, _icb = len(_ic), sum(m["size"] for m in _ic)
    history = {"accounts": {"proton": {
        "scans": [{"ts": int(NOW - d * 86400), "mails": m, "size": s,
                   "senders": g}
                  for d, m, s, g in [(21, 1108, 301_000_000, 15),
                                     (14, 1041, 274_000_000, 14),
                                     (7, 933, 247_000_000, 14),
                                     (1, 824, 205_000_000, 13)]],
        "actions": {
            "2025-11": {"trash": 90, "archive": 8, "move": 0, "mark_read": 0,
                        "freed": 0},
            "2026-03": {"trash": 142, "archive": 33, "move": 0, "mark_read": 12,
                        "freed": 0, "purge": 60, "purged_bytes": 41_000_000},
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
    history["accounts"]["icloud"] = {
        "scans": [{"ts": int(NOW - d * 86400), "mails": int(_icn * f),
                   "size": int(_icb * f), "senders": g}
                  for d, f, g in [(21, 0.86, 70), (14, 0.9, 74), (7, 0.95, 77),
                                  (1, 1.0, 80)]],
        "actions": {
            time.strftime("%Y-%m", time.gmtime(NOW - 31 * 86400)):
                {"trash": 96, "archive": 20, "move": 0, "mark_read": 40,
                 "freed": 22_000_000},
            time.strftime("%Y-%m", time.gmtime(NOW)):
                {"trash": 61, "archive": 5, "move": 0, "mark_read": 12,
                 "freed": 15_000_000},
        }}
    Path(os.environ["STATS_HISTORY_PATH"]).write_text(json.dumps(history))
    # Audit entries (the cleanup card of Your year in mail): unsubscribes and
    # rule runs in 2026 + 2025, at varied times of day, in date order. The
    # rules that ran carry the same run as their last run (Rules panel).
    _hours = random.Random(5)

    def _t(days_ago: float) -> int:
        return int(NOW - days_ago * 86400 - _hours.uniform(0, 23) * 3600)

    _au = [("proton", "unsubscribe", _t(40), 1, "ok", "user", ""),
           ("proton", "unsubscribe", _t(120), 1, "ok", "user", ""),
           ("proton", "unsubscribe", _t(300), 1, "ok", "user", ""),
           ("proton", "unsubscribe", _t(30), 1, "failed", "user", ""),
           ("proton", "unsubscribe", _t(420), 1, "ok", "user", ""),
           ("icloud", "unsubscribe", _t(4), 1, "ok", "user", ""),
           ("icloud", "unsubscribe", _t(400), 1, "ok", "user", "")]
    for rule, d, count in ((sweep, 21, 150), (parcels, 14, 60),
                           (lapsed, 9, 48)):
        ts = _t(d)
        _au.append((rule["account"], "rule_execute", ts, count, "ok",
                    f"rule:{rule['id']}", rule["name"]))
        with rules._LOCK:
            stored = rules.load_rules()
            r = next(x for x in stored if x["id"] == rule["id"])
            r.update(mode="execute", created=ts - 30 * 86400, report_runs=1,
                     report_sig=rules.definition_sig(r),
                     report_box=rules.box_sig(r), report_at=ts - 86400,
                     last_run={"ts": ts, "mode": "execute", "groups": 4,
                               "mails": count, "acted": count, "capped": 0,
                               "skipped_protected": 0, "skipped_pinned": 0,
                               "preview": [], "error": ""})
            rules._save(stored)
    _au.sort(key=lambda e: e[2])
    Path(os.environ["AUDIT_LOG_PATH"]).write_text("".join(
        json.dumps({"ts": ts, "account": acct, "actor": actor,
                    "action": action, "count": count, "bytes": 0,
                    "label": label, "outcome": outcome, "error": ""}) + "\n"
        for acct, action, ts, count, outcome, actor, label in _au))
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

    # Pre-scan both accounts (incl. attachments) so screenshots are instant. The
    # Proton demo also builds its local body index, which is where the tracker
    # report (Tools -> Trackers) comes from; iCloud stays without one (empty state).
    for name in ("proton", "icloud"):
        acc = accounts.get(name)
        mailops.run_scan(acc)
        mailops._run_atts(acc)
        if name == "proton":
            bodyindex.sync(acc)
        st = mailops.public_state(acc)
        print(f"[demo] {name}: {len(st['groups']['sender'])} senders, "
              f"{sum(g['count'] for g in st['groups']['sender'].values())} mails")
    # Bodies come last: the Proton body index above must not hold them (see
    # fill_bodies).
    for fake in FAKES.values():
        for box in fake.mailbox.values():
            fill_bodies(box)
    return FAKES
