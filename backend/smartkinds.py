"""What a Smart row is *about*: purpose evidence, company identity, unit kinds.

Pure and deterministic (no IMAP, no state, no dependencies), so placement
(`mailops.build_smart`) and the evaluation harness run the very same code.
See DECISIONS.md 2026-10-09 / 2026-10-12.

Purposes are read from MESSAGES (the subject of each mail), not from the
sender's address or a keyword in its name. A sender - or a small company
treated as one unit - gets a purpose only when a clear share of its mails
matches exactly that one purpose; mixed or weak evidence ends up in Other.
"""

from __future__ import annotations

import functools
import hashlib
import json
import re
from typing import Iterable, NamedTuple

# --------------------------------------------------------------- domains

# Registrable domain = last two labels, or three under these suffixes.
MULTI_SUFFIXES = frozenset({
    "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au",
    "co.jp", "ne.jp", "or.jp", "com.br", "co.nz", "co.za", "com.tr",
    "com.mx", "co.in", "co.at", "or.at", "com.cn", "com.sg", "com.hk",
    "co.kr"})
# Freemail providers are NEVER pooled by domain (their addresses belong to
# unrelated people): exact registrable domains, plus brands that exist
# under many TLDs (outlook.com, outlook.de, outlook.co.uk, ...).
FREEMAIL_DOMAINS = frozenset({
    "gmail.com", "googlemail.com", "msn.com", "ymail.com", "web.de",
    "t-online.de", "icloud.com", "me.com", "mac.com", "proton.me", "pm.me",
    "mail.de", "freenet.de", "mailbox.org", "mail.ru", "zoho.com",
    "fastmail.com", "tutanota.com", "tuta.io", "arcor.de", "vodafone.de",
    "1und1.de"})
FREEMAIL_BRANDS = frozenset({
    "outlook", "hotmail", "live", "yahoo", "gmx", "protonmail", "aol",
    "posteo", "yandex"})


def registrable_domain(domain: str) -> str:
    """`mail.payco.example` -> `payco.example`; under a multi-part suffix
    from MULTI_SUFFIXES (`co.uk`, ...) the registrable domain is one label
    more (`mail.shop` + suffix -> `shop` + suffix). A small built-in suffix
    list, no public-suffix dependency."""
    labels = [p for p in domain.lower().strip(".").split(".") if p]
    if len(labels) <= 2:
        return ".".join(labels)
    if ".".join(labels[-2:]) in MULTI_SUFFIXES:
        return ".".join(labels[-3:])
    return ".".join(labels[-2:])


def is_freemail(domain: str) -> bool:
    reg = registrable_domain(domain)
    return reg in FREEMAIL_DOMAINS or reg.split(".")[0] in FREEMAIL_BRANDS


# Mail platforms: the domain belongs to the PLATFORM, not to the company
# that writes. "tenant": every company has its own host under the platform
# (`acme.zendesk.com` IS acme); the platform's root host identifies nobody.
# "shared": one address / host serves many unrelated companies (Stripe
# receipts, Shopify mail, payment processors, booking tools, relays): never
# company-pooled, each sender is placed by what its mail is about.
# Suffixes match on whole labels only (`zendesk.com.attacker.example` is
# NOT zendesk). Only generic infrastructure is listed - no company names.
TENANT, SHARED = "tenant", "shared"
MAIL_PLATFORMS: dict[str, str] = {
    # support / helpdesk: a host per tenant
    "zendesk.com": TENANT, "freshdesk.com": TENANT, "helpscoutapp.com": TENANT,
    "intercom-mail.com": TENANT, "intercom.io": TENANT, "desk.com": TENANT,
    "myshopify.com": TENANT, "atlassian.net": TENANT, "force.com": TENANT,
    # shop platforms, payment processors, e-mail services, marketplace relays:
    # one address or host for many companies
    "stripe.com": SHARED, "shopifyemail.com": SHARED, "paddle.com": SHARED,
    "paypal-communication.com": SHARED, "ratepay.de": SHARED,
    "myafterpay.com": SHARED, "sofort.com": SHARED, "cleverbridge.com": SHARED,
    "privaterelay.appleid.com": SHARED, "sendgrid.net": SHARED,
    "mcsv.net": SHARED, "mailchimpapp.net": SHARED, "klaviyomail.com": SHARED,
    "exacttarget.com": SHARED, "hubspotemail.net": SHARED,
    "members.ebay.com": SHARED, "members.ebay.de": SHARED,
    "members.ebay.co.uk": SHARED, "members.ebay.es": SHARED,
    "members.ebay.nl": SHARED, "members.ebay.fr": SHARED,
    "members.ebay.at": SHARED, "members.ebay.it": SHARED,
}
# On a tenant platform these leftmost labels are the platform's own hosts,
# not a company (`mail.zendesk.com`, `support.intercom-mail.com`).
PLATFORM_ROOT_LABELS = frozenset({
    "www", "mail", "email", "smtp", "bounce", "bounces", "notify",
    "notifications", "support", "help", "info", "em", "e", "m", "app"})


def platform_of(domain: str) -> tuple[str, str] | None:
    """(suffix, mode) when `domain` sits on a known mail platform. Longest
    suffix wins; matching is on whole labels."""
    host = domain.lower().strip(".")
    best = None
    for suffix, mode in MAIL_PLATFORMS.items():
        if host == suffix or host.endswith("." + suffix):
            if best is None or len(suffix) > len(best[0]):
                best = (suffix, mode)
    return best


def company_id(domain: str) -> str | None:
    """The company a sender domain identifies, or None when it identifies
    none (freemail, a shared platform host, a tenant platform's own host).
    Normal domains: the registrable domain (`mail.shop.example` -> `shop.example`);
    tenant platforms: the tenant's full host (`acme.zendesk.com`)."""
    domain = (domain or "").lower().strip(".")
    if not domain or is_freemail(domain):
        return None
    plat = platform_of(domain)
    if plat is None:
        return registrable_domain(domain)
    suffix, mode = plat
    if mode == SHARED or domain == suffix:
        return None
    tenant = domain[:-len(suffix) - 1].split(".")[-1]
    if tenant in PLATFORM_ROOT_LABELS:
        return None
    return f"{tenant}.{suffix}"


# ------------------------------------------------------ purpose evidence

PURPOSES = ("orders", "appointments", "jobs", "support", "accounts")

# Existing, validated on ~5,600 real subjects (EN + DE, ~97% precision);
# `\b` on aktivier/willkommen drops reaktivieren / Losaktivierung /
# Willkommensgeschenk. Order/shipping/appointment mails do NOT match.
ACCOUNT_SUBJECT_RE = re.compile(
    r"welcome|\bwillkommen\b|verify|verification|verifizier|"
    r"confirm\b.{0,25}\b(e-?mail|account|registration|subscription|identity)|"
    r"(e-?mail|account|subscri\w*) (address )?confirmation|confirmation instructions|"
    r"(e-?mail|konto|account|registrierung|anmeldung)[- ]?(adresse )?best[aä]tig|"
    r"best[aä]tige (deine|ihre|die)|best[aä]tigen sie|identit[aä]t best[aä]tig|"
    r"activate your|\baktivier|account activation|password|passwort|kennw[oö]rt|"
    r"(sign-?in|log-?in|anmelde|confirmation|best[aä]tigungs|recovery|security|"
    r"sicherheits|verification|verifizierungs|freischalt|einmal|one-time|"
    r"access|zugangs)[- ]?code|login-?tan|login-?link|anmelde-?link|magic link|"
    r"\b2fa\b|two-factor|zwei-faktor|new (sign-in|login|device)|"
    r"neue anmeldung|neue[mns]? ger[aä]t|ger[aä]te-?login|anmeldung erkannt|"
    r"security alert|sicherheitswarnung|sicherheitsalarm|"
    r"registration|registrierung|sign up|signed up|your code|ihr code|"
    r"dein code|account created|account is ready|konto erstellt|"
    r"konto (wurde )?eingerichtet|login attempt", re.IGNORECASE)

_I = re.IGNORECASE
# (purpose, rule id, pattern). One rule per kind of evidence, so a rule the
# maintainer's review turns down is one line to drop (policy-dependent ones
# are marked). Every rule has a true / false table in tests/test_smartkinds.py.
PURPOSE_RULES: list[tuple[str, str, re.Pattern]] = [
    ("orders", "order", re.compile(
        r"bestell(ung|bestätigung|eingang|übersicht|status|nummer)|\bbestellt\b|"
        r"auftrags?(bestätigung|eingang|info|status)|(?<![a-zäöüß])auftrag\b.{0,40}"
        r"(bereit|wird|ist|\d)|\border\b.{0,20}(confirm|#|no\b|number|receipt|received|update|\d)|"
        r"your order|(danke|vielen dank).{0,24}(bestellung|einkauf|kauf)\b|"
        r"(your|ihr(e)?) purchase|purchase (confirmation|receipt|order|#|complete|successful)|"
        r"\bpurchased\b|kaufbestätigung|kaufvertrag|transaktionsbestätigung|"
        r"your payment (has been|was)|key purchase|order #", _I)),
    ("orders", "shipping", re.compile(
        r"versand(bestätigung|benachrichtigung|mitteilung|meldung|status|information)|"
        r"(wurde|wird|ist|sind) (bald |gleich |heute |soeben )?"
        r"(versendet|verschickt|versandt|geliefert|zugestellt|abgeschickt|abholbereit)|"
        r"\b(zugestellt|geliefert|versendet|versandt|verschickt)\s*:|"
        r"\bshipped\b|has shipped|shipping (confirmation|notification|update)|"
        r"out for delivery|\bdelivered\b|zustellung|sendung (kommt|ist|wird)|"
        r"paket(ankündigung| kommt| ist| wird| da)|\bdpd paket|lieferung (vom|ist|wird|zu)|"
        r"in zustellung|sendungs(nummer|verfolgung|information)|"
        r"tracking (number|link|info|information|id|code|url)|track & trace|"
        r"abhol(benachrichtigung|nummer|schein)|bald bei dir|dein paket|ihr paket|"
        r"retoure|rücksendung|return (instructions|label)|returns?\b.{0,20}(received|confirm)|"
        r"rückerstattung|erstattung|refund|einlieferungsbeleg|ware.{0,12}abholbereit", _I)),
    ("orders", "invoice", re.compile(
        r"rechnung(?!sadresse)|\binvoice\b|\breceipt\b|zahlungsbeleg|quittung|"
        r"kassenbon|\bebon\b|spielquittung|tankbeleg|beleg\b|"
        r"zahlungs(eingang|bestätigung|erinnerung)|payment (received|confirm|accepted|successful)|"
        r"zahlung (ist |wurde |erfolgreich|eingegangen)|abbuchung|gutschrift zu", _I)),
    ("appointments", "appointment", re.compile(
        r"\btermin(e|s)?\b|terminbestätigung|terminerinnerung|appointment|"
        r"beratungstermin|click and meet|besichtigung|sprechstunde", _I)),
    ("appointments", "booking", re.compile(
        r"reservierung|reservation|\bbuchung|booking|\bcheck-?(in|out)\b|"
        r"boarding|bordkarte|sitzplatz|\bflug\b|your trip|ihre reise|reise(unterlagen|details)|"
        r"\btickets?\b(?![ -]?(nr|id)|\s*[#:(\[])|eintrittskarte|tageskarte|fahrkarte|"
        r"kinotickets|e-ticket|pnr\b", _I)),
    ("jobs", "application", re.compile(
        r"bewerbung|bewerber|your application|application (received|status|update|for|"
        r"to|submitted|was)|thank you for (your )?appl|recruiting|talent acquisition|"
        r"vorstellungsgespräch|gesprächseinladung|einladung zum interview|"
        r"interview (invitation|request|confirm|scheduled?)|invitation to (an? )?interview", _I)),
    ("support", "inquiry", re.compile(
        r"anfrage|inquiry|enquiry|ihre nachricht|your (message|request|inquiry)|"
        r"kontaktformular|kontaktaufnahme|kontaktier|ihr anliegen|rückmeldung zu|"
        r"ihre mitteilung|ihre e-?mail an|ihre frage|antwort (zu|auf) ihre|hat ihnen geantwortet|"
        r"fragen zu produkten|exposé|\bexpose\b|ihr interesse am objekt|objektanfrage|"
        r"wohnungsanfrage|fahrzeuganfrage|kostenvoranschlag|immobilien(suche|angebot)|"
        r"vorstellung beim anbieter|ihr widerspruch|\bproblem(s)? (with|mit)\b|"
        r"neue nachricht (von|zu(?! (deinem|ihrem|dem) beitrag)|:)|\bquery created", _I)),
    ("support", "case", re.compile(
        r"\bticket[ -]?(nr|id)|ticket\s*[#:(]|\[ticket|\bcase (id|no|number|#|\d)|"
        r"\bcase[:#]|your case|fallnummer|"
        r"vorgang(s)?(nr|nummer)?|supportfall|servicevorgang|reparaturauftrag|repnr|"
        r"\bsupport\b(?! (our|us|the|my|your|a|ukraine|local)\b)|kundenservice|"
        r"customer (care|service|support)|reklamation|"
        r"beschwerde|schadenfall|schaden(s)?nummer|neue antwort auf ihre|"
        r"\[?(zendesk|freshdesk)\]?|we have received your (request|message)", _I)),
    ("accounts", "account", ACCOUNT_SUBJECT_RE),
    ("accounts", "account_more", re.compile(
        r"(ihr|dein|deine|your|neues?|neuen)\s+(\w+[- ])?(konto|account)\b|kundenkonto|"
        r"kundenaccount|nutzerkonto|benutzerkonto|zugangsdaten|e-?mail-?adress(e|vali)|"
        r"bestätigungs-?e-?mail|passwortänderung|\bsign[ -]?in\b|\blog[ -]?in\b|"
        r"zwei-?faktor|2-?faktor|(hier ist|here is) (der|ihr|dein|your) code|"
        r"code,? den sie angefordert|konto.{0,20}(gelöscht|löschung)|"
        r"löschung.{0,25}(accounts?|konto)|account notification|computer added|"
        r"schließen sie ihre registrierung|einrichtung des .{0,20}account|"
        r"just one more step|bitte (bestätigen|verifizieren) sie", _I)),
    # policy-dependent (maintainer question: are ToS / privacy notices
    # "accounts & security"?): drop this one rule if the answer is no.
    ("accounts", "policy_notice", re.compile(
        r"nutzungsbedingungen|geschäftsbedingungen|\bagb\b|datenschutz(erklärung|richtlinie|hinweis)|"
        r"privacy (policy|notice)|terms (of (service|use)|and conditions)|terms & conditions|"
        r"user agreement|subscriber agreement|\bpolicy update", _I)),
]

# A request to review, rate or answer a survey about something is NOT about
# that something ("Bitte bewerten Sie Ihre Bestellung" is no order mail): it
# carries no purpose evidence and reads as marketing-adjacent bulk mail.
SURVEY_RE = re.compile(
    r"\bfeedback\b|umfrage|ihre meinung|deine meinung|meinung (ist|zählt)|wie war|"
    r"bewerten sie|bewerte (deine|ihre|uns)|bitte bewerten|ihre bewertung|"
    r"zufriedenheit|\bsurvey\b|rate your|how was|your opinion|leave (us )?a review|"
    r"write a review|review your", _I)

# Marketing look of a subject. NOT a purpose: it only decides "newsletter"
# when no purpose evidence exists at all (so it cannot hurt purpose
# precision) - plain List-Unsubscribe stays enough on its own.
PROMO_RE = re.compile(
    r"\d{1,3} ?(%|prozent)|\brabatt|gutschein|coupon|discount|\bsale\b|\bdeals?\b|gratis|"
    r"kostenlos|\bfree\b|gewinn|giveaway|black (friday|november)|cyber|spare?n?\b|\bsave\b|"
    r"jetzt (sichern|kaufen|entdecken|shoppen|testen)|exklusiv|nur (noch|heute)|"
    r"last chance|letzte chance|limited|entdecke|\baktion\b|newsletter|"
    r"neuheit|neu(e|es)? (bei|im|in)\b|\bnew:|now (live|available)|jetzt (live|verfügbar)|"
    r"angebot(e)?\b|bonus|prämie|offer|upgrade|vermisst|wir vermissen|zurück zu|"
    # review / survey requests, loyalty points, cashback, price alerts
    # (maintainer 2026-10-12: all newsletters)
    + SURVEY_RE.pattern + r"|rückmeldung|"
    r"punkte|punktestand|\bpoints\b|cashback|wunschpreis|preisalarm|price alert", _I)

# Automatic notifications from forums, developer tools and communities are
# neither a purpose nor a newsletter (maintainer 2026-10-12: Other) - even
# when they carry a List-Unsubscribe header.
NOTIFICATION_RE = re.compile(
    r"^\s*((re|aw|fwd?|wg)\s*:\s*)*\[[^\]]{2,80}\]|hat eine antwort kommentiert|"
    r"neue antwort (auf|zu)|zu (deinem|ihrem|dem) beitrag|\bnew reply\b|\bcommented on\b|\bhas replied\b|"
    r"\breplied to\b|mentioned (you|in)\b|you were mentioned|pull request|"
    r"\bissue #?\d+", _I)

# Account mail is about credentials and security. The WEAK account words
# (welcome, "your account", sign in, ...) also open promotional mail ("Sign in
# to Comet", "Willkommen im GoldClub"), so they count only when neither the
# subject nor the sender looks promotional (maintainer 2026-10-12).
STRONG_ACCOUNT_RE = re.compile(
    ACCOUNT_SUBJECT_RE.pattern.replace(r"welcome|\bwillkommen\b|", "", 1), _I)
assert STRONG_ACCOUNT_RE.pattern != ACCOUNT_SUBJECT_RE.pattern

# Senders that sell tickets: their order mail is a booking (maintainer
# 2026-10-12: event tickets are appointments & bookings).
TICKET_RE = re.compile(r"ticket", _I)

# Regular bills - utility, telco, insurance, bank - are contracts, not
# purchases (maintainer 2026-10-12: Other): for them the invoice rule does
# not count as "orders". Recognised by the subject or by the sender.
BILL_SUBJECT_RE = re.compile(
    r"versicherung|beitragsrechnung|mobilfunk|kontoauszug|stromrechnung|"
    r"gasrechnung|telefonrechnung|internetrechnung|nebenkosten|betriebskosten|"
    r"abschlag|schlussabrechnung|jahresabrechnung|\bmahnung\b", _I)
BILLER_RE = re.compile(
    r"energie|strom|\bgas\b|stadtwerke|versicherung|haftpflicht|krankenkasse|"
    r"sparkasse|volksbank|\bbank\b|kredit|finanz|mobilfunk", _I)


def sender_hint(addr: str, unsub: bool = False) -> str:
    """What the SENDER adds to reading its subjects: `b` a biller (utility,
    telco, insurer, bank), `t` a ticket seller, `p` promotional (it offers
    List-Unsubscribe)."""
    return (("b" if BILLER_RE.search(addr) else "")
            + ("t" if TICKET_RE.search(addr) else "") + ("p" if unsub else ""))


@functools.lru_cache(maxsize=65536)
def message_purposes(subject: str, hint: str = "") -> frozenset[str]:
    """Every purpose whose evidence appears in this subject, read with the
    sender's `hint` (see sender_hint): a bare invoice from a biller - or any
    subject that says so itself - is a bill, not an order; a ticket seller's
    orders are bookings; weak account words in promotional mail are not
    account evidence; a request to review or rate carries none at all."""
    s = subject or ""
    if SURVEY_RE.search(s):
        return frozenset()
    bill = "b" in hint or bool(BILL_SUBJECT_RE.search(s))
    soft = "p" in hint or bool(PROMO_RE.search(s))
    out = set()
    for p, rid, rx in PURPOSE_RULES:
        if bill and rid == "invoice":
            continue
        if soft and rid == "account_more":
            continue
        if not (STRONG_ACCOUNT_RE if soft and rid == "account" else rx).search(s):
            continue
        out.add("appointments" if p == "orders" and "t" in hint else p)
    return frozenset(out)


def message_purpose(subject: str) -> str | None:
    """The ONE purpose a mail is about, or None when it matches none or
    several (overlapping matches are ambiguous: not counted twice)."""
    hit = message_purposes(subject)
    return next(iter(hit)) if len(hit) == 1 else None


# Senders on freemail domains are usually people, not transactions: S1 data
# (DEV, 2026-10-12): purpose precision 78% (9 clear labels) / 64% (11 all)
# for freemail vs 97% / 92% for company domains. So they get no purpose
# kind (they stay newsletter / individuals / Other). Small sample - revisit
# with the reviewed labels.
FREEMAIL_PURPOSES = False

@functools.lru_cache(maxsize=65536)
def message_kind(subject: str, hint: str = "") -> str:
    """What ONE mail is, for a company row's summary: a purpose, `newsletter`
    (no purpose, but a promotional sender or look) or `unclassified`.
    Overlapping matches stay unclassified, so counts never double-count."""
    hit = message_purposes(subject, hint)
    if len(hit) == 1:
        return next(iter(hit))
    if not hit and not NOTIFICATION_RE.search(subject or "") \
            and ("p" in hint or PROMO_RE.search(subject or "")):
        return "newsletter"
    return "unclassified"


# Share of a unit's mails that must be about the winning purpose, and how
# far it must be ahead of the runner-up. Set on the S1 evaluation set.
CONFIDENCE = 0.5
CLEAR_WIN = 2
# A small company's ONE verdict is applied to every one of its senders, so
# it needs a clear majority of the mails behind it, not a bare half. S1 DEV
# (placement level, clear labels): 0.5 -> 93% pooled precision (accounts 85%),
# 0.6 -> 96% (accounts 91%), at about 2 points less recall.
UNIT_CONFIDENCE = 0.6


class Evidence(NamedTuple):
    counts: dict[str, int]      # mails per purpose (unambiguous matches)
    total: int                  # all mails of the unit
    ambiguous: int              # mails matching two or more purposes


def purpose_evidence(subjects: Iterable[str], hint: str = "") -> Evidence:
    counts: dict[str, int] = {}
    total = ambiguous = 0
    for s in subjects:
        total += 1
        hit = message_purposes(s, hint)
        if len(hit) == 1:
            p = next(iter(hit))
            counts[p] = counts.get(p, 0) + 1
        elif hit:
            ambiguous += 1
    return Evidence(counts, total, ambiguous)


def pick_purpose(ev: Evidence,
                 confidence: float | None = None) -> tuple[str | None, str]:
    """(purpose, why). `none`: no mail matched anything; `weak`: the best
    purpose covers too small a share; `competing`: no clear winner; else
    `clear`. Anything but `clear` / `none` means Other (never a fallback)."""
    if not ev.counts:
        return None, "none" if not ev.ambiguous else "competing"
    ranked = sorted(ev.counts.items(), key=lambda kv: (-kv[1], kv[0]))
    best, n = ranked[0]
    if n < (CONFIDENCE if confidence is None else confidence) * ev.total:
        return None, "weak"
    if len(ranked) > 1 and n < CLEAR_WIN * ranked[1][1]:
        return None, "competing"
    return best, "clear"


# ------------------------------------------------------------ unit kind

AUTOMATED_RE = re.compile(
    r"^(no.?reply|do.?not.?reply|noreply|notification|notifications|"
    r"mailer-daemon|auto[-.])", re.IGNORECASE)


class Member(NamedTuple):
    """One sender of a unit (a lone sender, or the senders of a small
    company treated as one)."""
    addr: str
    subjects: tuple[str, ...]   # one per mail
    unsub: bool                 # List-Unsubscribe on any of its mails
    tags: tuple[str, ...]       # category tags of the sender record
    sample: tuple[str, ...] = ()   # newest few subjects (what an AI is shown)


class Verdict(NamedTuple):
    kind: str                   # a purpose, newsletter, individuals, other, category
    name: str                   # category name (kind "category"), else ""
    why: dict                   # structured reason, translated by the UI


def classify_unit(members: list[Member],
                  user_cats: Iterable[str] = ()) -> Verdict:
    """The kind of one unit. Order (DECISIONS 2026-10-12):
      1 an explicit user category (several different ones: Other - a unit is
        never split to settle a category conflict)
      2 a confident purpose from the mails
      3 no purpose evidence at all: newsletter (any List-Unsubscribe), then
        individuals (every member writes from a private address), then Other
    Weak or competing purpose evidence goes straight to Other: it must not
    be papered over by a fallback. The automated look of an address is only
    supporting evidence (a private-looking address that is no-reply is not
    a person)."""
    user = set(user_cats)
    cats = sorted({t for m in members for t in m.tags if t in user})
    if len(cats) == 1:
        return Verdict("category", cats[0], {"r": "category", "name": cats[0]})
    if len(cats) > 1:
        return Verdict("other", "", {"r": "category_conflict"})
    ev = Evidence({}, 0, 0)
    for m in members:
        if FREEMAIL_PURPOSES or not is_freemail(m.addr.rpartition("@")[2]):
            ev = _merge(ev, purpose_evidence(
                m.subjects, sender_hint(m.addr, m.unsub)))
    purpose, why = pick_purpose(
        ev, CONFIDENCE if len(members) == 1 else UNIT_CONFIDENCE)
    if purpose:
        return Verdict(purpose, "", {"r": "purpose", "k": purpose,
                                     "n": ev.counts[purpose], "of": ev.total})
    if why != "none":
        best = min(ev.counts, key=lambda p: (-ev.counts[p], p), default="")
        return Verdict("other", "", {"r": why, "k": best,
                                     "n": ev.counts.get(best, 0),
                                     "of": ev.total})
    subjects = [s for m in members for s in m.subjects]
    if subjects and 2 * sum(1 for s in subjects
                            if NOTIFICATION_RE.search(s or "")) >= len(subjects):
        return Verdict("other", "", {"r": "notification"})
    promo = sum(1 for s in subjects if PROMO_RE.search(s or ""))
    if any(m.unsub for m in members) or (subjects and promo * 2 >= len(subjects)):
        return Verdict("newsletter", "", {"r": "newsletter"})
    if all(_private(m.addr) for m in members):
        return Verdict("individuals", "", {"r": "individual"})
    return Verdict("other", "", {"r": "none"})


def _merge(a: Evidence, b: Evidence) -> Evidence:
    counts = dict(a.counts)
    for p, n in b.counts.items():
        counts[p] = counts.get(p, 0) + n
    return Evidence(counts, a.total + b.total, a.ambiguous + b.ambiguous)


def _private(addr: str) -> bool:
    local, _, domain = addr.rpartition("@")
    return bool(domain) and is_freemail(domain) \
        and not AUTOMATED_RE.match(local) and "_at_" not in local   # relay alias


# ------------------------------------------------------------- AI sorting
# What the optional AI sorting may see and answer (see aisort.py). Pure
# helpers live here so placement (mailops.build_smart) can apply a cached
# answer without importing anything that talks to a provider.

SORT_KINDS = PURPOSES + ("newsletter", "individuals", "other")
SAMPLE_SUBJECTS = 3        # newest subjects shown per sender
SUBJECT_CHARS = 120
# Only units the rules left in Other for lack of a confident answer.
AI_ELIGIBLE = frozenset({"none", "weak", "competing"})


def sample_subjects(mails: Iterable[tuple[int, str]]) -> tuple[str, ...]:
    """The newest SAMPLE_SUBJECTS distinct subjects of (ts, subject) pairs,
    clipped: exactly what the AI is shown - and what its cached answer is
    fingerprinted on."""
    out: list[str] = []
    for _, subject in sorted(mails, key=lambda m: (-m[0], m[1] or "")):
        s = (subject or "").strip()[:SUBJECT_CHARS]
        if s not in out:
            out.append(s)
            if len(out) == SAMPLE_SUBJECTS:
                break
    return tuple(out)


def unit_key(company: str, members: list[Member]) -> str:
    """Stable id of a unit: its company, or the address of a lone sender."""
    return f"co:{company}" if company else f"a:{members[0].addr}"


def unit_fp(members: list[Member]) -> str:
    """Fingerprint of the evidence an AI answer was based on: who is in the
    unit and the sample subjects it was shown. New mail that pushes a subject
    out of the sample changes it; so does a member joining or leaving."""
    h = hashlib.sha256()
    for m in sorted(members, key=lambda m: m.addr):
        h.update(json.dumps([m.addr, m.sample, m.unsub]).encode())
    return h.hexdigest()[:16]


def ai_kind_for(entry: dict | None, members: list[Member]) -> str | None:
    """The cached AI kind of a unit when it still applies, else None. An AI
    purpose is never given to a freemail sender (they are people, not shops:
    FREEMAIL_PURPOSES)."""
    if not entry or entry.get("fp") != unit_fp(members) \
            or entry.get("kind") not in SORT_KINDS:
        return None
    kind = entry["kind"]
    if kind in PURPOSES and not FREEMAIL_PURPOSES \
            and all(is_freemail(m.addr.rpartition("@")[2]) for m in members):
        return None
    return kind
