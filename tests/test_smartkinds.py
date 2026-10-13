"""smartkinds: what a mail / a sender / a small company is about.

Every purpose rule has a true and a false table (EN + DE; synthetic
subjects only - no real mail data in the repo), company identity covers
tenant platforms, shared platforms and look-alike suffixes, and the unit
classifier covers the order of its fallbacks."""

import pytest

from backend import smartkinds as sk

RULES = {rid: (purpose, rx) for purpose, rid, rx in sk.PURPOSE_RULES}

# The domain one label above a platform host: an ordinary company.
PLATFORM_PARENT = "members.ebay.co.uk".split(".", 1)[1]

# rule id -> (subjects that MUST match, subjects that must NOT match)
TABLES = {
    "order": (
        ["Ihre Bestellung 123456 ist eingegangen", "Bestellbestätigung",
         "Order confirmation #A-1", "Thank you for your order",
         "Vielen Dank für Ihren Einkauf", "Auftragsbestätigung 4711",
         "Your purchase", "Kaufvertrag Nr. 55", "Transaktionsbestätigung",
         "Bestellt: Notizbuch und 2 weitere Artikel"],
        ["Neue Angebote für dich", "Willkommen bei Acme", "Termin morgen",
         "Weekly newsletter", "Ihr Reparaturauftrag 99",
         "Hello from the team", "Purchase a gift card today"]),
    "shipping": (
        ["Ihr Paket wurde versendet", "Deine Sendung kommt heute",
         "Your parcel has shipped", "Out for delivery", "Zugestellt: Paket",
         "Versandbestätigung 77", "Tracking information", "Retoure eingegangen",
         "Your refund is on its way", "Ihre Ware ist abholbereit",
         "Return instructions 8812"],
        ["Gratis Versand ab 20 Euro", "Termin bestätigt", "Dein Passwort",
         "Weekly digest", "Neue Kollektion", "How cookie tracking works"]),
    "invoice": (
        ["Ihre Rechnung 2024-17", "Invoice #881", "Your receipt from Acme",
         "Zahlungsbeleg", "Dein Acme eBon vom 01.02.", "Zahlungseingang bestätigt",
         "Payment received", "Spielquittung"],
        ["Neue Angebote", "Sicherheitswarnung", "Terminerinnerung",
         "Rechnungsadresse ändern"]),
    "appointment": (
        ["Terminbestätigung für Dienstag", "Erinnerung an Ihren Termin",
         "Your appointment is confirmed", "Beratungstermin vereinbart",
         "Besichtigung am Samstag", "Sprechstunde entfällt"],
        ["Ihre Bestellung", "Reset your password", "Newsletter Oktober",
         "Interminable meetings", "Safety recall notice"]),
    "booking": (
        ["Reservierungsbestätigung", "Your reservation at Luigi's",
         "Buchungsbestätigung 9F2", "Online Check-in ist geöffnet",
         "Ihr Ticket für Samstag", "Your tickets for the show",
         "Bordkarte XQ 232", "Ihre Reiseunterlagen"],
        ["Ticket-ID 123: Ihre Anfrage", "Ticket #5521 Status", "Ihre Rechnung",
         "Neue Angebote", "Ticket (YH-3)", "Schnellere Checkouts mit Mastercard"]),
    "application": (
        ["Ihre Bewerbung bei Acme", "Bewerbung eingegangen",
         "Your application was received", "Recruiting-Team", "Eine Einladung zum Interview",
         "Gesprächseinladung für Ihre Bewerbung", "Interview invitation for Monday"],
        ["Ihre Bestellung", "Terminbestätigung", "Passwort zurücksetzen",
         "Weekly digest", "Interview with our founder", "Career tips for autumn",
         "Our new application is live", "Neue Karriere-Tipps"]),
    "inquiry": (
        ["Ihre Anfrage ist eingegangen", "Re: Anfrage zu Ihrem Objekt 12",
         "Your inquiry", "Ihre Nachricht an uns", "Antwort auf Ihre Frage",
         "Kontaktformular", "Exposé zu Immobilie 7", "Kostenvoranschlag"],
        ["Ihre Bestellung", "Termin bestätigt", "Neue Angebote",
         "Verify your email", "Neue Nachricht zu deinem Beitrag: Küche"]),
    "case": (
        ["Ticket-ID 4711 - Antwort", "[Ticket#18475177] RE: Kontakt",
         "Case 01684814 - Status", "Fallnummer 12345", "Ihr Reparaturauftrag 77",
         "Kundenservice: Ihre Reklamation", "Customer care reply",
         "Support update"],
        ["Ihre Bestellung", "Terminbestätigung", "Neue Angebote",
         "Ticket für Samstag", "In case you missed it", "Support our work",
         "Support us today"]),
    "account": (
        ["Welcome to Acme", "Verify your email address", "Ihr Passwort wurde geändert",
         "Dein Login-Code", "Security alert", "Neue Anmeldung erkannt",
         "Account created", "Bitte bestätigen Sie Ihre E-Mail-Adresse"],
        ["Ihre Bestellung", "Termin morgen", "Willkommensgeschenk für dich",
         "Reaktivieren Sie jetzt", "Losaktivierung"]),
    "account_more": (
        ["Ihr Konto wurde geändert", "Your account settings", "Ihr Kundenkonto",
         "Deine Zugangsdaten", "Hier ist der Code, den Sie angefordert haben",
         "Magic login link", "Just one more step", "E-Mail-Adresse gespeichert"],
        ["Ihre Bestellung", "Termin morgen", "Neue Angebote", "Kontoauszug im Postfach"]),
    "policy_notice": (
        ["Änderungen an unseren Nutzungsbedingungen", "Updates to our Terms of Service",
         "Aktualisierung der Datenschutzerklärung", "Privacy policy update",
         "Neue AGB ab 1. Mai"],
        ["Ihre Bestellung", "Termin morgen", "Neue Angebote"]),
}


@pytest.mark.parametrize("rule", sorted(RULES))
def test_every_rule_has_a_table(rule):
    assert rule in TABLES, f"rule {rule!r} has no true/false table"
    yes, no = TABLES[rule]
    assert len(yes) >= 5 and len(no) >= 3


@pytest.mark.parametrize("rule,subject", [
    (r, s) for r, (yes, _) in sorted(TABLES.items()) for s in yes])
def test_rule_matches_its_true_examples(rule, subject):
    assert RULES[rule][1].search(subject), (rule, subject)


@pytest.mark.parametrize("rule,subject", [
    (r, s) for r, (_, no) in sorted(TABLES.items()) for s in no])
def test_rule_ignores_its_false_examples(rule, subject):
    assert not RULES[rule][1].search(subject), (rule, subject)


@pytest.mark.parametrize("subject,expected", [
    ("Ihre Bestellung ist unterwegs", "orders"),
    ("Terminbestätigung für Dienstag", "appointments"),
    ("Ihre Bewerbung bei Acme", "jobs"),
    ("Ticket-ID 9: Ihre Anfrage", "support"),
    ("Verify your email", "accounts"),
    ("Gratis Versand ab 20 Euro", None),
    ("Hello", None), ("", None)])
def test_message_purpose_is_the_one_clear_purpose(subject, expected):
    assert sk.message_purpose(subject) == expected


def test_overlapping_matches_are_ambiguous_and_not_counted_twice():
    both = "Ihre Anfrage zu Ihrer Bestellung 12"        # support + orders
    assert sk.message_purposes(both) == {"support", "orders"}
    assert sk.message_purpose(both) is None
    ev = sk.purpose_evidence([both, "Ihre Bestellung 7", "Hello"])
    assert (ev.counts, ev.total, ev.ambiguous) == ({"orders": 1}, 3, 1)


@pytest.mark.parametrize("subject,unsub,expected", [
    ("Ihre Bestellung 12", True, "orders"),               # purpose outranks
    ("Spare 20% auf alles", False, "newsletter"),         # marketing look
    ("Wöchentliche Neuigkeiten", True, "newsletter"),     # List-Unsubscribe
    ("Ihre Anfrage zu Ihrer Bestellung", True, "unclassified"),   # ambiguous
    ("Hello", False, "unclassified")])
def test_message_kind(subject, unsub, expected):
    assert sk.message_kind(subject, "p" if unsub else "") == expected


# ------------------------------------------------------------ pick_purpose

def ev(counts, total, ambiguous=0):
    return sk.Evidence(counts, total, ambiguous)


@pytest.mark.parametrize("evidence,expected", [
    (ev({"orders": 3}, 3), ("orders", "clear")),
    (ev({"orders": 2}, 4), ("orders", "clear")),                # exactly half
    (ev({"orders": 3, "accounts": 1}, 4), ("orders", "clear")),  # 3 >= 2x1
    (ev({"orders": 1}, 4), (None, "weak")),                     # below half
    (ev({"orders": 2, "accounts": 2}, 4), (None, "competing")),  # tie
    (ev({"orders": 3, "accounts": 2}, 5), (None, "competing")),  # < 2x
    (ev({}, 3), (None, "none")),
    (ev({}, 3, ambiguous=3), (None, "competing")),              # all overlap
])
def test_pick_purpose(evidence, expected):
    assert sk.pick_purpose(evidence) == expected


# --------------------------------------------------------- company identity

@pytest.mark.parametrize("domain,expected", [
    ("payco.example", "payco.example"),
    ("mail.payco.example", "payco.example"),
    ("a.b.payco.example", "payco.example"),
    ("mail.shop." + "co.uk", "shop." + "co.uk"),
    ("EXAMPLE.com.", "example.com"),
    ("localhost", "localhost"),
    # freemail never identifies a company
    ("gmail.com", None), ("mail.gmx.net", None), ("outlook.de", None),
    ("", None),
    # tenant platforms: the tenant's own host
    ("acme.zendesk.com", "acme.zendesk.com"),
    ("support.acme.zendesk.com", "acme.zendesk.com"),         # nested
    ("a.b.acme.zendesk.com", "acme.zendesk.com"),
    ("ACME.Zendesk.com", "acme.zendesk.com"),
    ("shop.myshopify.com", "shop.myshopify.com"),
    # ... whose own / root hosts identify nobody
    ("zendesk.com", None), ("mail.zendesk.com", None),
    ("support.intercom-mail.com", None),
    # shared platforms never identify a company
    ("stripe.com", None), ("mail.stripe.com", None),
    ("t.shopifyemail.com", None), ("ratepay.de", None),
    ("privaterelay.appleid.com", None),
    ("members.ebay.co.uk", None),
    # the platform's NEIGHBOURS are ordinary companies
    (PLATFORM_PARENT, PLATFORM_PARENT),
    # suffix matching is on whole labels, so look-alikes are not platforms
    ("zendesk.com.attacker.example", "attacker.example"),
    ("acme.zendesk.com.attacker.example", "attacker.example"),
    ("evil" + "zendesk.com", "evil" + "zendesk.com"),
    ("not" + "stripe.com", "not" + "stripe.com"),
    ("stripe.com.evil.example", "evil.example"),
])
def test_company_id(domain, expected):
    assert sk.company_id(domain) == expected


def test_tenants_of_one_platform_are_different_companies():
    a = sk.company_id("help.acme.zendesk.com")
    b = sk.company_id("help.globex.zendesk.com")
    assert a != b and a and b


def test_the_longest_platform_suffix_wins():
    assert sk.platform_of("x.members.ebay.co.uk") == ("members.ebay.co.uk",
                                                      sk.SHARED)
    assert sk.platform_of(PLATFORM_PARENT) is None
    assert sk.platform_of("zendesk.com.attacker.example") is None


# ------------------------------------------------------------- unit kinds

def member(addr, subjects=("Hello",), unsub=False, tags=()):
    return sk.Member(addr, tuple(subjects), unsub, tuple(tags))


def kind(members, user=()):
    v = sk.classify_unit(members, user)
    return v.kind, v.name, v.why


def test_a_clear_purpose_wins_even_over_list_unsubscribe():
    k, _, why = kind([member("a@shop.example", ["Ihre Bestellung 1"] * 3, unsub=True)])
    assert k == "orders" and why == {"r": "purpose", "k": "orders", "n": 3, "of": 3}


def test_an_explicit_category_beats_a_purpose_and_conflicts_go_to_other():
    m = member("a@x.example", ["Ihre Bestellung 1"], tags=("hobby",))
    assert kind([m], {"hobby"})[:2] == ("category", "hobby")
    assert kind([m], set())[0] == "orders"            # not the user's category
    two = member("a@x.example", ["Ihre Bestellung 1"], tags=("hobby", "work"))
    assert kind([two], {"hobby", "work"}) == ("other", "", {"r": "category_conflict"})
    # a small company is never split over a conflict
    a = member("a@x.example", tags=("hobby",))
    b = member("b@x.example", tags=("work",))
    assert kind([a, b], {"hobby", "work"})[0] == "other"
    assert kind([a, b], {"hobby"})[:2] == ("category", "hobby")


def test_weak_or_competing_evidence_is_other_not_a_fallback():
    # 1 of 4 mails about orders: weak. List-Unsubscribe must NOT rescue it.
    weak = member("a@x.example", ["Ihre Bestellung", "Hi", "Hi", "Hi"], unsub=True)
    assert kind([weak])[0] == "other"
    assert kind([weak])[2] == {"r": "weak", "k": "orders", "n": 1, "of": 4}
    mixed = member("a@x.example", ["Ihre Bestellung", "Termin bestätigt"] * 2,
                   unsub=True)
    assert kind([mixed])[0] == "other" and kind([mixed])[2]["r"] == "competing"


def test_no_evidence_falls_back_to_newsletter_then_individuals_then_other():
    assert kind([member("a@x.example", unsub=True)])[0] == "newsletter"
    assert kind([member("a@x.example", ["Spare 30% jetzt"])])[0] == "newsletter"
    assert kind([member("anna@gmail.com")])[0] == "individuals"
    assert kind([member("noreply@gmail.com")])[0] == "other"     # not a person
    assert kind([member("x_at_shop_de_ab12cd@icloud.com")])[0] == "other"
    assert kind([member("a@x.example")])[0] == "other"
    # individuals only when EVERY member writes from a private address
    assert kind([member("anna@gmail.com"), member("a@x.example")])[0] == "other"


def test_freemail_senders_get_no_purpose_kind():
    m = member("anna@gmail.com", ["Ihre Bestellung 7"] * 3)
    assert kind([m])[0] == "individuals"
    assert sk.FREEMAIL_PURPOSES is False
    # a company-domain sender with the same mails does
    assert kind([member("anna@shop.example", ["Ihre Bestellung 7"] * 3)])[0] == "orders"


def test_a_small_company_is_one_unit_judged_by_all_its_mails():
    unit = [member("a@acme.example", ["Ihre Bestellung 1", "Ihre Bestellung 2"]),
            member("b@acme.example", ["Versandbestätigung 9"]),
            member("c@acme.example", ["Hello"])]
    k, _, why = kind(unit)
    assert k == "orders" and why["n"] == 3 and why["of"] == 4


def test_a_small_company_needs_a_clear_majority_a_lone_sender_only_half():
    half = ["Ihre Bestellung 1", "Hallo"]
    assert kind([member("a@x.example", half)])[0] == "orders"       # lone: half
    unit = [member("a@acme.example", half[:1]), member("b@acme.example", half[1:])]
    k, _, why = kind(unit)
    assert k == "other" and why["r"] == "weak"       # one verdict, 2 senders
    three_of_five = [member("a@acme.example", ["Ihre Bestellung 1"] * 3),
                     member("b@acme.example", ["Hallo"] * 2)]
    assert kind(three_of_five)[0] == "orders"                       # 60%
    assert sk.UNIT_CONFIDENCE > sk.CONFIDENCE


# ---------------------------------------- maintainer's policy answers (S1)

@pytest.mark.parametrize("subject,biller", [
    ("Ihre Mobilfunk-Rechnung Mai 2026", False),     # says so itself
    ("Beitragsrechnung zu Versicherungsschein 12", False),
    ("Neuer Kontoauszug, Rechnung im Anhang", False),
    ("Ihre Stromrechnung", False), ("Schlussabrechnung liegt bereit", False),
    ("Ihre Rechnung", True), ("Invoice 2024-17", True),     # a biller's sender
])
def test_regular_bills_are_not_orders(subject, biller):
    assert "orders" not in sk.message_purposes(subject, "b" if biller else "")


@pytest.mark.parametrize("subject", [
    "Ihre Rechnung 2024-17", "Invoice #881", "Your receipt from Acme",
    "Dein Acme eBon vom 01.02."])
def test_receipts_and_invoices_of_purchases_still_are_orders(subject):
    assert sk.message_purposes(subject, "") == {"orders"}


def test_a_bill_from_a_utility_never_makes_the_sender_an_orders_sender():
    mails = ["Ihre Rechnung", "Ihre Rechnung", "Ihre Rechnung"]
    assert kind([member("onlineservice@energie-nord.example", mails)])[0] == "other"
    assert kind([member("rechnung@mobilfunk-sued.example", mails)])[0] == "other"
    assert kind([member("shop@acme.example", mails)])[0] == "orders"
    assert sk.message_kind("Ihre Rechnung", "b") == "unclassified"
    assert sk.message_kind("Ihre Rechnung", "") == "orders"


@pytest.mark.parametrize("sender", [
    "kundenservice@mobilfunk-sued.example", "noreply@energie-nord.example",
    "service@strom-west.example", "info@versicherung-ost.example",
    "x@sparkasse-mitte.example", "post@bank-nord.example",
    "abrechnung@stadtwerke-nord.example", "info@krankenkasse.example"])
def test_billers_are_recognised_by_their_address(sender):
    assert sk.BILLER_RE.search(sender)


@pytest.mark.parametrize("sender", [
    "orders@bigshop-de.example", "shop@acme.example", "billing@cloudbox.example",
    "support@co2-tracker.example", "x@paybank.example"])
def test_shops_and_look_alikes_are_not_billers(sender):
    assert not sk.BILLER_RE.search(sender)


@pytest.mark.parametrize("subject", [
    "Wie war Ihr Aufenthalt bei uns?", "Bitte bewerten Sie Ihre Bestellung",
    "Ihre Meinung ist uns wichtig", "Wir freuen uns über Ihr Feedback",
    "Umfrage zu Ihrem Besuch", "How was your stay?", "Rate your experience",
    "Dein aktueller Punktestand", "Verliere deine Punkte nicht",
    "Dein Cashback ist verfügbar", "Dein Wunschpreis wurde erreicht",
    "Price alert: your item dropped"])
def test_surveys_loyalty_points_and_price_alerts_look_like_newsletters(subject):
    assert sk.PROMO_RE.search(subject)
    assert sk.message_kind(subject, "") == "newsletter"
    assert kind([member("shop@acme.example", [subject])])[0] == "newsletter"


@pytest.mark.parametrize("subject", [
    "[GitHub] A fine-grained personal access token was added",
    "Re: [acme/widget] Fix the date format (Issue #12)",
    "[Kurs] Übung - Dienstag 15:00", "AW: [Forum] Neue Frage",
    "Neue Nachricht zu deinem Beitrag: Thema 12",
    "Mandy hat eine Antwort kommentiert", "New reply to your conversation",
    "jdoe commented on your pull request", "You were mentioned in a thread"])
def test_forum_and_developer_notifications_are_other_even_with_unsubscribe(subject):
    assert sk.NOTIFICATION_RE.search(subject)
    v = sk.classify_unit([member("notifications@forum.example", [subject] * 3,
                                 unsub=True)])
    assert (v.kind, v.why) == ("other", {"r": "notification"})
    assert sk.message_kind(subject, "p") == "unclassified"


@pytest.mark.parametrize("subject", [
    "This week at Acme", "Spare 20% auf alles", "Weekly digest",
    "Ihre Anfrage [Ticket#18475177]"])
def test_ordinary_mail_is_no_notification(subject):
    assert not sk.NOTIFICATION_RE.search(subject) or "Ticket" in subject


def test_a_forum_notification_still_yields_to_a_real_purpose():
    # evidence of a purpose comes first (a GitHub security alert is accounts)
    v = sk.classify_unit([member("noreply@github.com",
                                 ["[GitHub] Please review this sign in"] * 2)])
    assert v.kind == "accounts"


# ------------------------- promo that mentions the account / ticket sellers

@pytest.mark.parametrize("subject,hint", [
    ("Willkommen im GoldClub", "p"), ("Welcome to Acme", "p"),
    ("Sign in to Comet", "p"), ("Wichtige Information zu Ihrem Kundenkonto", "p"),
    ("Willkommen bei Acme - 20% Rabatt zum Start", ""),
    ("Your account is active again - get 30% off", "")])
def test_weak_account_words_in_promotional_mail_are_no_account_evidence(subject, hint):
    assert "accounts" not in sk.message_purposes(subject, hint)


@pytest.mark.parametrize("subject,hint", [
    ("Verify your email address", "p"), ("Dein Login-Code", "p"),
    ("Passwort zurücksetzen", "p"), ("Security alert", "p"),
    ("Welcome to Acme", ""), ("Willkommen bei Globex", ""),
    ("Ihr Konto wurde geändert", ""), ("Sign in to Comet", "")])
def test_credentials_and_security_stay_accounts_and_so_do_plain_welcome_mails(subject, hint):
    assert sk.message_purposes(subject, hint) == {"accounts"}


def test_a_promotional_sender_with_only_weak_account_words_is_a_newsletter():
    v = sk.classify_unit([member("hello@club.example", ["Willkommen im GoldClub"],
                                 unsub=True)])
    assert v.kind == "newsletter"
    v = sk.classify_unit([member("team@tool.example", ["Welcome to Tool"] * 2)])
    assert v.kind == "accounts"                      # no promo signal at all


@pytest.mark.parametrize("sender", [
    "info@onlineticket.example", "shop@ticketshop.example",
    "support@tickets-nord.example"])
def test_ticket_sellers_are_recognised(sender):
    assert "t" in sk.sender_hint(sender)


def test_a_ticket_sellers_order_mail_is_a_booking():
    mails = ["Ihre Bestellung für das Konzert"] * 2
    assert kind([member("info@onlineticket.example", mails)])[0] == "appointments"
    assert kind([member("shop@acme.example", mails)])[0] == "orders"
    assert sk.message_purposes("Ihre Bestellung 7", "t") == {"appointments"}
    assert sk.message_kind("Ihre Bestellung 7", "t") == "appointments"


def test_sender_hint_flags():
    assert sk.sender_hint("rechnung@stadtwerke-nord.example", True) == "bp"
    assert sk.sender_hint("shop@acme.example") == ""


# ----------------------------------------------- what the AI sorting is shown

def test_the_sample_is_the_newest_distinct_subjects_clipped():
    mails = [(1, "old"), (5, "new"), (5, "new"), (4, "mid"), (3, "x" * 500),
             (2, "other")]
    assert sk.sample_subjects(mails) == ("new", "mid", "x" * sk.SUBJECT_CHARS)
    assert sk.sample_subjects([]) == () and sk.sample_subjects([(1, None)]) == ("",)


def test_the_fingerprint_follows_the_evidence_not_the_order():
    a = sk.Member("a@x.example", (), False, (), ("one", "two"))
    b = sk.Member("b@x.example", (), False, (), ("three",))
    assert sk.unit_fp([a, b]) == sk.unit_fp([b, a])
    assert sk.unit_fp([a]) != sk.unit_fp([a, b])                  # who is in it
    assert sk.unit_fp([a]) != sk.unit_fp([a._replace(sample=("one", "new"))])
    assert sk.unit_fp([a]) != sk.unit_fp([a._replace(unsub=True)])
    assert sk.unit_key("", [a]) == "a:a@x.example"
    assert sk.unit_key("x.example", [a, b]) == "co:x.example"


def test_a_cached_ai_answer_applies_only_to_the_evidence_it_saw():
    m = sk.Member("shop@acme.example", (), False, (), ("Hallo",))
    entry = {"kind": "orders", "fp": sk.unit_fp([m])}
    assert sk.ai_kind_for(entry, [m]) == "orders"
    assert sk.ai_kind_for(entry, [m._replace(sample=("Hallo", "neu"))]) is None
    assert sk.ai_kind_for({"kind": "delete everything", "fp": entry["fp"]}, [m]) is None
    assert sk.ai_kind_for(None, [m]) is None
    # a freemail sender never gets a purpose, but may be a newsletter
    f = sk.Member("anna@gmail.com", (), False, (), ("Hallo",))
    assert sk.ai_kind_for({"kind": "orders", "fp": sk.unit_fp([f])}, [f]) is None
    assert sk.ai_kind_for({"kind": "newsletter", "fp": sk.unit_fp([f])}, [f]) == "newsletter"
    assert set(sk.SORT_KINDS) == set(sk.PURPOSES) | {"newsletter", "individuals", "other"}
    assert sk.AI_ELIGIBLE == {"none", "weak", "competing"}   # never a category conflict
