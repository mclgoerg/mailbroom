"""Smart grouping: the long tail of small senders pooled into a few rows.

Pure placement (first match wins, one row per sender), the regex and domain
helpers, stable keys across rescans, per-account threshold, snapshot
restore, live patching by deletes/undo, protected containment, the AI
verdict fingerprint, and the places that must NOT accept "smart" (rules,
block)."""

import json
import types

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import aihelper
from backend import config as cfgmod
from backend import mailops
from backend import rules as rulesmod
from backend import smartkinds
from backend import verdictstore
from backend.main import app
from conftest import FakeIMAP, make_msg, wait_delete_done

client = TestClient(app)
build = mailops.build_smart


# ------------------------------------------------------------ test helpers

_uid = iter(range(1, 10_000_000))


def msg(addr, subject="Hello", unsub=False, folder="INBOX", ts=1_700_000_000,
        seen=False):
    """A scan-shaped mail dict (what build_groups consumes)."""
    uid = next(_uid)
    return {"uid": uid, "folder": folder, "msgid": f"<{uid}@t>", "irt": [],
            "refs": [], "ts": ts, "subject": subject, "addr": addr,
            "name": "", "size": 1000, "seen": seen, "bulk": unsub,
            "unsub": "<https://x.example/u>" if unsub else "",
            "unsub_post": False, "date": "2024-01-01"}


def many(addr, n, **kw):
    return [msg(addr, **kw) for _ in range(n)]


def smart(messages, replied=None, protected=None, smart_min=10, cats=None,
          user=()):
    groups = mailops.build_groups(messages, replied or set(), cats, smart_min,
                                  protected or [], user)
    return groups["smart"]


def placement(rows):
    """{sender: row key} from the member lists / own-row keys."""
    out = {}
    for key, rec in rows.items():
        if rec["kind"] == "sender":
            out[rec["addr"]] = key
        else:
            for a in rec["members"]:
                out[a] = key
    return out


def all_groups(messages, replied=None, protected=None, smart_min=10,
               cats=None, user=()):
    return mailops.build_groups(messages, replied or set(), cats, smart_min,
                                protected or [], user)


def membership(senders):
    """{row key: sorted sender addresses}, derived the way the UI does it:
    group the sender records by their `smart_key`."""
    out: dict[str, list[str]] = {}
    for addr, rec in senders.items():
        out.setdefault(rec["smart_key"], []).append(addr)
    return {k: sorted(v) for k, v in out.items()}


# ---------------------------------------------------------------- helpers

@pytest.mark.parametrize("domain,expected", [
    ("payco.example", "payco.example"),
    ("mail.payco.example", "payco.example"),
    ("a.b.c.payco.example", "payco.example"),
    ("localhost", "localhost"),
    ("EXAMPLE.com.", "example.com"),
])
def test_registrable_domain(domain, expected):
    assert mailops.registrable_domain(domain) == expected


@pytest.mark.parametrize("suffix", sorted(smartkinds.MULTI_SUFFIXES))
def test_registrable_domain_under_a_multi_part_suffix(suffix):
    # one label more than under a plain TLD, for every suffix of the list
    assert mailops.registrable_domain(f"mail.shop.{suffix}") == f"shop.{suffix}"
    assert mailops.registrable_domain(f"shop.{suffix}") == f"shop.{suffix}"


@pytest.mark.parametrize("domain", [
    "gmail.com", "googlemail.com", "outlook.com", "outlook.de",
    "outlook.co.uk", "hotmail.com", "hotmail.fr", "live.com", "msn.com",
    "yahoo.com", "yahoo.co.uk", "ymail.com", "gmx.de", "gmx.net", "gmx.at",
    "web.de", "t-online.de", "icloud.com", "me.com", "mac.com", "proton.me",
    "protonmail.com", "protonmail.ch", "pm.me", "aol.com", "aol.de",
    "mail.de", "freenet.de", "posteo.de", "posteo.net", "mailbox.org",
    "yandex.com", "yandex.ru", "mail.ru", "zoho.com", "fastmail.com",
    "tutanota.com", "tuta.io", "arcor.de", "vodafone.de", "1und1.de",
    "mail.gmx.net"])
def test_freemail_domains(domain):
    assert mailops.is_freemail(domain)


@pytest.mark.parametrize("domain", [
    "payco.example", "bigshop.example", "mail.bigshop.example", "streamco.example",
    "outlooktips.example", "yahooinc.example", "gmxshop.example"])
def test_company_domains_are_not_freemail(domain):
    assert not mailops.is_freemail(domain)


ACCOUNT_YES = [
    "Welcome to Acme", "Willkommen bei Globex", "Please verify your email",
    "Verification code: 123456", "Bitte verifizieren Sie Ihr Konto",
    "Confirm your email address", "Confirm your account",
    "Email address confirmation", "Account confirmation instructions",
    "E-Mail-Adresse bestätigen", "Registrierung bestaetigen",
    "Bestätigen Sie Ihre Anmeldung", "Bestätige deine E-Mail",
    "Identität bestätigen", "Activate your account", "Aktivieren Sie Ihr Konto",
    "Account activation", "Reset your password", "Passwort zurücksetzen",
    "Ihr Kennwort wurde geändert", "Your sign-in code", "Dein Login-Code",
    "Ihr Einmalcode", "One-time code", "Security code", "Sicherheitscode",
    "Login-TAN", "Your login-link for Slack", "Magic link", "Your 2FA settings",
    "Two-factor authentication enabled", "Zwei-Faktor aktiviert",
    "New sign-in to your account", "New device login", "Neue Anmeldung erkannt",
    "Neues Gerät hinzugefügt", "Security alert", "Sicherheitswarnung",
    "Complete your registration", "Thanks, you signed up", "Your code is 99",
    "Ihr Code lautet 1234", "Account created", "Your account is ready",
    "Konto erstellt", "Ihr Konto wurde eingerichtet", "Login attempt blocked",
]

ACCOUNT_NO = [
    "Your order #123 has shipped", "Ihre Bestellung wurde versendet",
    "Order confirmation", "Bestellbestätigung", "Terminbestätigung",
    "Appointment confirmed for Monday", "Buchungsbestätigung Flug",
    "Reaktivieren Sie Ihr Abo", "Ihr Abo wurde deaktiviert",
    "Losaktivierung", "Willkommensgeschenk für Sie", "20% off this week",
    "Your invoice is ready", "Rechnung 2024-001", "Weekly digest",
    "Lunch on Friday?", "Re: Project plan", "Delivery tomorrow",
    "Newsletter Oktober", "Ihre Sendung ist unterwegs",
]


@pytest.mark.parametrize("subject", ACCOUNT_YES)
def test_account_regex_matches(subject):
    assert mailops.ACCOUNT_SUBJECT_RE.search(subject), subject


@pytest.mark.parametrize("subject", ACCOUNT_NO)
def test_account_regex_does_not_match(subject):
    assert not mailops.ACCOUNT_SUBJECT_RE.search(subject), subject


def test_clamp_smart_min():
    assert mailops.clamp_smart_min(10) == 10
    assert mailops.clamp_smart_min(1) == 2
    assert mailops.clamp_smart_min(0) == 2
    assert mailops.clamp_smart_min(500) == 50
    assert mailops.clamp_smart_min("7") == 7
    assert mailops.clamp_smart_min("x") == 10
    assert mailops.clamp_smart_min(None) == 10


# -------------------------------------------------------------- placement

def test_big_sender_keeps_its_own_row_with_sender_tab_data():
    msgs = many("big@shop.example", 10) + many("small@other.example", 2)
    groups = mailops.build_groups(msgs, set(), None, 10, [])
    own = groups["smart"]["s:big@shop.example"]
    base = groups["sender"]["big@shop.example"]
    assert own["kind"] == "sender" and own["addr"] == "big@shop.example"
    for f in ("label", "sub", "count", "size", "unread", "first", "last",
              "tags", "samples", "bulk", "unsub", "folders", "replied",
              "engagement"):
        assert own[f] == base[f], f
    # a copy: patching one grouping never touches the other
    assert own["folders"] is not base["folders"]
    own["folders"]["INBOX"].pop()
    assert len(base["folders"]["INBOX"]) == 10
    # exactly the threshold counts as big, one below does not
    rows = smart(many("edge@shop.example", 9))
    assert "s:edge@shop.example" not in rows


def test_each_sender_lands_in_exactly_one_row_and_counts_add_up():
    msgs = (many("big@x.example", 12)
            + many("a@payco.example", 4) + many("b@mail.payco.example", 3)
            + many("c@payco.example", 3)
            + many("pal@gmail.com", 2) + many("news@lone.example", 1,
                                              unsub=True)
            + many("noreply@odd.example", 1) + many("x@odd2.example", 1))
    groups = mailops.build_groups(msgs, set(), None, 10, [])
    rows = groups["smart"]
    assert sum(r["count"] for r in rows.values()) == len(msgs)
    seen: dict = {}
    for rec in rows.values():
        for folder, uids in rec["folders"].items():
            for uid in uids:
                assert (folder, uid) not in seen, "mail in two rows"
                seen[(folder, uid)] = rec["key"]
    assert len(seen) == len(msgs)
    senders = sum(r["n_senders"] for r in rows.values())
    assert senders == len(groups["sender"])


def test_placement_order_first_match_wins():
    protected = ["prot@acme.example"]
    replied = {"friend@acme.example"}
    msgs = (
        # 2 beats 3, 4, 5: protected + replied + company + account mails
        many("prot@acme.example", 3, subject="Verify your email")
        # 3 beats 4 and 5: replied, company, accounts
        + many("friend@acme.example", 3, subject="Welcome")
        # 4: company pool needs the REMAINING small senders to total >= 10
        + many("a@acme.example", 4, subject="Welcome aboard")
        + many("b@acme.example", 4) + many("c@sub.acme.example", 2)
    )
    rows = smart(msgs, replied=replied, protected=protected)
    place = placement(rows)
    assert place["prot@acme.example"] == "k:protected"
    assert place["friend@acme.example"] == "k:replied"
    # prot + friend are placed first, so only a+b+c (10 mails) pool up
    assert place["a@acme.example"] == "o:acme.example"
    assert place["b@acme.example"] == "o:acme.example"
    assert place["c@sub.acme.example"] == "o:acme.example"
    assert rows["o:acme.example"]["kind"] == "company"
    assert rows["o:acme.example"]["n_senders"] == 3


def test_company_pool_is_ahead_of_the_size_rule_and_holds_big_senders():
    # a shop: one big sender + two small ones -> ONE row, at any N
    msgs = (many("auftrag@order.apotheke.example", 31)
            + many("info@mail.apotheke.example", 4)
            + many("kunde@customer.apotheke.example", 1))
    for n in (2, 4, 5, 10, 36):
        rows = smart(msgs, smart_min=n)
        assert list(rows) == ["o:apotheke.example"], n
        assert rows["o:apotheke.example"]["count"] == 36
        assert rows["o:apotheke.example"]["n_senders"] == 3
    # below the domain total's reach the company dissolves again
    rows = smart(msgs, smart_min=50)
    assert "o:apotheke.example" not in rows
    assert placement(rows)["auftrag@order.apotheke.example"] != "o:apotheke.example"


def test_company_needs_two_senders_a_lone_big_sender_keeps_its_row():
    rows = smart(many("news@acme-store.example", 214) + many("x@y.example", 1))
    assert "s:news@acme-store.example" in rows
    assert not [k for k in rows if k.startswith("o:")]


def test_company_total_counts_protected_and_replied_out():
    # protected / replied senders are never pooled by company and their
    # mails do not count towards the pool total
    msgs = (many("a@acme.example", 4) + many("b@acme.example", 4)
            + many("prot@acme.example", 5) + many("friend@acme.example", 5))
    rows = smart(msgs, protected=["prot@acme.example"],
                 replied={"friend@acme.example"})
    place = placement(rows)
    assert place["prot@acme.example"] == "k:protected"
    assert place["friend@acme.example"] == "k:replied"
    assert "o:acme.example" not in rows          # 8 < 10
    msgs += many("c@acme.example", 2)
    rows = smart(msgs, protected=["prot@acme.example"],
                 replied={"friend@acme.example"})
    assert placement(rows)["a@acme.example"] == "o:acme.example"
    assert rows["o:acme.example"]["n_senders"] == 3
    # big protected / replied senders keep their own row, not the pool's
    rows = smart(msgs + many("vip@acme.example", 10)
                 + many("pal@acme.example", 12),
                 protected=["prot@acme.example", "vip@acme.example"],
                 replied={"friend@acme.example", "pal@acme.example"})
    assert "s:vip@acme.example" in rows and "s:pal@acme.example" in rows
    assert rows["o:acme.example"]["n_senders"] == 3


def test_company_row_holds_every_mail_of_its_senders():
    msgs = many("big@acme.example", 20) + many("small@acme.example", 1)
    rows = smart(msgs)
    assert rows["o:acme.example"]["count"] == 21


def test_company_pool_uses_registrable_domain_with_multi_label_suffixes():
    sfx = "co.uk"
    msgs = (many(f"a@shop.hub.{sfx}", 4) + many(f"b@mail.hub.{sfx}", 3)
            + many(f"c@hub.{sfx}", 3)
            # same suffix, different company: must not merge
            + many(f"d@other.{sfx}", 6))
    rows = smart(msgs)
    place = placement(rows)
    assert place[f"a@shop.hub.{sfx}"] == f"o:hub.{sfx}"
    assert place[f"b@mail.hub.{sfx}"] == f"o:hub.{sfx}"
    assert f"o:{sfx}" not in rows
    assert place[f"d@other.{sfx}"] != f"o:{sfx}"
    assert place[f"d@other.{sfx}"] == "k:other"


def test_freemail_domains_are_never_pooled():
    msgs = []
    for i in range(6):
        msgs += many(f"user{i}@gmail.com", 3)
        msgs += many(f"user{i}@outlook.de", 3)
        msgs += many(f"user{i}@mail.gmx.net", 3)
    rows = smart(msgs)
    assert not [k for k in rows if k.startswith("o:")]
    assert {rows[k]["kind"] for k in rows} == {"individuals"}
    assert rows["k:individuals"]["n_senders"] == 18


def test_domain_shortcuts_need_one_exact_domain():
    msgs = (many("a@payco.example", 4) + many("b@payco.example", 3)
            + many("c@payco.example", 3))
    assert smart(msgs)["o:payco.example"]["domain"] == "payco.example"
    msgs = (many("a@payco.example", 4) + many("b@mail.payco.example", 3)
            + many("c@payco.example", 3))
    # one subdomain among the members: @domain protect would miss it
    assert smart(msgs)["o:payco.example"]["domain"] == ""


def test_accounts_needs_half_of_the_senders_mails():
    msgs = (many("hit@svc1.example", 3, subject="Your verification code")
            + many("one@svc2.example", 1, subject="Weekly offers")
            + many("half@svc3.example", 1, subject="Welcome!")
            + many("half@svc3.example", 1, subject="Offers")
            + many("miss@svc4.example", 1, subject="Welcome!")
            + many("miss@svc4.example", 2, subject="Offers"))
    place = placement(smart(msgs))
    assert place["hit@svc1.example"] == "k:accounts"
    assert place["half@svc3.example"] == "k:accounts"        # exactly half
    assert place["miss@svc4.example"] != "k:accounts"        # 1 of 3
    assert place["one@svc2.example"] != "k:accounts"


def test_a_user_category_beats_what_the_mails_are_about():
    cats = mailops.effective_categories({"hobby": ["zzz"]})
    msgs = (many("a@zzz.example", 2, subject="Your order has shipped")
            + many("noreply@dhl.example", 2, subject="Your order has shipped"))
    place = placement(smart(msgs, cats=cats, user={"hobby"}))
    assert place["a@zzz.example"] == "k:cat:hobby"      # explicit, wins
    assert place["noreply@dhl.example"] == "k:orders"   # built-in tag: no part


def test_built_in_categories_no_longer_place_anything():
    # "dhl" tags the sender `shipping` by keyword; nothing says what the mails
    # are, so it is NOT a category row any more (the user did not ask for it)
    place = placement(smart(many("noreply@dhl.example", 2, subject="Hello")))
    assert place["noreply@dhl.example"] == "k:other"
    assert "k:cat:shipping" not in smart(many("noreply@dhl.example", 2))


def test_conflicting_user_categories_go_to_other():
    cats = mailops.effective_categories({"alpha": ["zzz"], "beta": ["yyy"]})
    msgs = many("zzz@yyy.example", 1, subject="Your order has shipped")
    rows = smart(msgs, cats=cats, user={"alpha", "beta"})
    assert placement(rows)["zzz@yyy.example"] == "k:other"
    # ... and a small company is never split to settle the conflict
    cats2 = mailops.effective_categories({"alpha": ["zzz.example"],
                                          "beta": ["yyy.example"]})
    msgs2 = many("a@mixed.example", 1, subject="zzz.example") \
        + many("b@mixed.example", 1, subject="yyy.example")
    place = placement(smart(msgs2, cats=cats2, user={"alpha", "beta"}))
    assert place["a@mixed.example"] == place["b@mixed.example"] == "k:other"


def test_fallback_chain_when_the_mails_say_nothing():
    msgs = (many("promo@plain.example", 1, unsub=True)         # newsletter
            + many("noreply@auto.example", 1)                  # no signal
            + many("no-reply@auto2.example", 1, unsub=True)    # newsletter
            + many("person@gmail.com", 1)                      # individuals
            + many("someone@random.example", 1))               # other
    place = placement(smart(msgs))
    assert place["promo@plain.example"] == "k:newsletter"
    assert place["noreply@auto.example"] == "k:other"
    assert place["no-reply@auto2.example"] == "k:newsletter"
    assert place["person@gmail.com"] == "k:individuals"
    assert place["someone@random.example"] == "k:other"


def test_an_automated_private_address_is_not_an_individual():
    # supporting evidence only: no "notifications" bucket, but a no-reply
    # address on a freemail domain is no person either
    place = placement(smart(many("noreply@gmail.com", 1)))
    assert place["noreply@gmail.com"] == "k:other"
    # Apple "hide my email" relay aliases are not people
    place = placement(smart(many("mails_at_n_shop_de_ab12cd34_x9@icloud.com", 1)))
    assert place["mails_at_n_shop_de_ab12cd34_x9@icloud.com"] == "k:other"


def test_custom_and_overridden_categories_decide_the_category_row():
    cats = mailops.effective_categories({"hobby": ["zzz"], "shipping": []})
    msgs = many("a@zzz.example", 1) + many("noreply@dhl.example", 1)
    rows = smart(msgs, cats=cats, user={"hobby"})
    place = placement(rows)
    assert place["a@zzz.example"] == "k:cat:hobby"
    assert rows["k:cat:hobby"]["category"] == "hobby"
    assert rows["k:cat:hobby"]["label"] == "hobby"
    # shipping disabled by the override: dhl has no category at all
    assert place["noreply@dhl.example"] == "k:other"
    # an explicitly EDITED built-in category counts as the user's own
    cats = mailops.effective_categories({"shipping": ["dhl"]})
    rows = smart(msgs, cats=cats, user={"shipping"})
    assert placement(rows)["noreply@dhl.example"] == "k:cat:shipping"


def test_keys_labels_and_kinds_of_pooled_rows():
    rows = smart(many("a@payco.example", 12 - 6) + many("b@payco.example", 4)
                 + many("x@y.example", 1) + many("p@gmail.com", 1))
    assert rows["o:payco.example"]["label"] == "payco.example"
    assert rows["k:other"]["kind"] == "other"
    assert rows["k:individuals"]["kind"] == "individuals"
    for rec in rows.values():
        assert rec["sub"] in ("", rec.get("addr", "")) or rec["kind"] == "sender"


def test_bucket_records_are_ordinary_group_records():
    msgs = (many("a@lone1.example", 2, unsub=True, seen=True)
            + many("b@lone2.example", 3, unsub=True)
            + [msg("c@lone3.example", unsub=True, folder="Archive")])
    rows = smart(msgs)
    r = rows["k:newsletter"]
    assert (r["count"], r["unread"], r["n_senders"]) == (6, 4, 3)
    assert r["bulk"] and r["unsub"] and r["ai"] is None
    assert set(r["folders"]) == {"INBOX", "Archive"}
    assert sum(len(u) for u in r["folders"].values()) == 6
    assert r["members"] == ["b@lone2.example", "a@lone1.example",
                            "c@lone3.example"]          # by mail count
    assert r["samples"] == r["members"]
    assert r["first"] and r["last"] and r["engagement"] >= 0


def test_members_are_capped_but_n_senders_and_fingerprint_cover_all():
    msgs = []
    for i in range(mailops.SMART_MEMBERS_CAP + 20):
        msgs += many(f"s{i}@rnd{i}.example", 1)
    r = smart(msgs)["k:other"]
    assert len(r["members"]) == mailops.SMART_MEMBERS_CAP
    assert r["n_senders"] == mailops.SMART_MEMBERS_CAP + 20
    assert r["count"] == mailops.SMART_MEMBERS_CAP + 20


def test_sender_records_say_which_smart_row_they_landed_in():
    """The UI never sees UID lists, so it derives a row's membership from
    the sender records it already has: each carries its row's key."""
    msgs = (many("big@shop.example", 12) + many("a@payco.example", 6)
            + many("b@mail.payco.example", 5) + many("p@gmail.com", 1)
            + many("x@one.example", 1) + many("n@news.example", 2, unsub=True)
            + many("me@friend.example", 2))
    groups = all_groups(msgs, replied={"me@friend.example"},
                        protected=["x@one.example"])
    rows, senders = groups["smart"], groups["sender"]
    assert {a: r["smart_key"] for a, r in senders.items()} == {
        "big@shop.example": "s:big@shop.example",
        "a@payco.example": "o:payco.example", "b@mail.payco.example": "o:payco.example",
        "p@gmail.com": "k:individuals", "x@one.example": "k:protected",
        "n@news.example": "k:newsletter", "me@friend.example": "k:replied"}
    derived = membership(senders)
    assert set(derived) == set(rows)               # no empty / unknown rows
    for key, rec in rows.items():
        assert rec["n_senders"] == len(derived[key])
        assert rec["count"] == sum(senders[a]["count"] for a in derived[key])
        if rec["kind"] != "sender":
            assert sorted(rec["members"]) == derived[key]   # uncapped here
        else:
            assert "smart_key" not in rec          # a sender field, not a row's


def test_membership_reaches_senders_beyond_the_members_cap_at_two():
    """>300 members and the lowest threshold (N=2): the pooled row's own
    `members` list is capped, the derived membership is not."""
    n = 2 * mailops.SMART_MEMBERS_CAP + 50
    msgs = []
    for i in range(n):
        msgs += many(f"s{i}@rnd{i}.example", 1)
    msgs += many("pair@twice.example", 2)                  # N=2: big
    msgs += many("a@duo.example", 1) + many("b@duo.example", 1)   # company
    groups = all_groups(msgs, smart_min=2)
    rows, senders = groups["smart"], groups["sender"]
    pool = rows["k:other"]
    assert pool["n_senders"] == n
    assert len(pool["members"]) == mailops.SMART_MEMBERS_CAP
    derived = membership(senders)
    assert derived["k:other"] == sorted(f"s{i}@rnd{i}.example"
                                        for i in range(n))
    assert len(set(derived["k:other"]) - set(pool["members"])) \
        == n - mailops.SMART_MEMBERS_CAP
    assert derived["s:pair@twice.example"] == ["pair@twice.example"]
    assert derived["o:duo.example"] == ["a@duo.example", "b@duo.example"]
    for key, rec in rows.items():                          # counts add up
        assert rec["count"] == sum(senders[a]["count"] for a in derived[key])


def test_stamping_scales_with_the_number_of_senders():
    """5000 senders at N=2: placement + stamping stays far from quadratic
    (a generous wall-clock bound; measured ~0.05 s)."""
    import time
    msgs = []
    for i in range(5000):
        msgs += many(f"s{i}@rnd{i % 700}.example", 1)
    senders = mailops.build_groups(msgs, set(), None, 2, [])["sender"]
    t0 = time.perf_counter()
    rows = build(senders, msgs, 2, [], None, 0)
    took = time.perf_counter() - t0
    assert sum(r["n_senders"] for r in rows.values()) == len(senders)
    assert all("smart_key" in r for r in senders.values())
    assert took < 5, f"build_smart took {took:.2f}s for {len(senders)} senders"


def test_threshold_changes_what_is_big():
    msgs = many("mid@x.example", 5) + many("tiny@y.example", 1)
    assert "s:mid@x.example" not in smart(msgs, smart_min=10)
    assert "s:mid@x.example" in smart(msgs, smart_min=5)
    assert "s:mid@x.example" in smart(msgs, smart_min=2)
    assert "s:tiny@y.example" not in smart(msgs, smart_min=2)
    # out-of-range values are clamped, not trusted
    assert "s:mid@x.example" in smart(msgs, smart_min=-3)


def test_addresses_without_domain_do_not_crash():
    rows = smart(many("weird", 1) + many("", 1))
    assert sum(r["count"] for r in rows.values()) == 2


def test_placement_is_deterministic():
    msgs = (many("a@p.example", 3) + many("b@p.example", 4)
            + many("c@p.example", 5) + many("z@q.example", 1))
    one, two = smart(msgs), smart(list(reversed(msgs)))
    assert placement(one) == placement(two)
    assert {k: r["fp"] for k, r in one.items() if "fp" in r} \
        == {k: r["fp"] for k, r in two.items() if "fp" in r}


# ------------------------------------------------------ scans, state, API

def _tail_box():
    """One big sender, a company pool, accounts mail, a protected-to-be
    sender, and a few singletons."""
    inbox = []
    uid = iter(range(1, 1000))

    def add(addr, n, subject="Hello", **kw):
        for _ in range(n):
            u = next(uid)
            inbox.append(make_msg(u, frm=addr, subject=subject,
                                  msgid=f"<t{u}@t>", **kw))

    add("big@bigshop.example", 12, "Sale")
    add("a@payco.example", 4)
    add("b@mail.payco.example", 3)
    add("c@payco.example", 3)
    add("auth@svc.example", 2, "Your verification code")
    add("vip@lone.example", 2, "Hi")
    add("x@one.example", 1)
    add("y@two.example", 1)
    return inbox


@pytest.fixture
def tail(monkeypatch):
    fake = FakeIMAP({"INBOX": _tail_box(), "Sent": [], "Trash": [],
                     "Spam": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    return fake


def smart_state():
    return mailops.public_state()["groups"]["smart"]


def test_scan_builds_smart_rows_and_state_ships_fields_not_english(tail):
    rows = smart_state()
    assert set(rows) == {"s:big@bigshop.example", "o:payco.example",
                         "k:accounts", "k:other"}
    for key in ("o:payco.example", "k:accounts", "k:other"):
        r = rows[key]
        assert r["sub"] == ""                      # the UI words it
        assert r["kind"] and r["n_senders"] >= 1 and r["members"]
        assert "folders" not in r                  # UIDs stay server-side
    assert rows["k:other"]["n_senders"] == 3
    assert rows["o:payco.example"]["members"] == [
        "a@payco.example", "b@mail.payco.example", "c@payco.example"]
    # smart is just another grouping for the group endpoints
    mails = client.get("/api/group", params={
        "grouping": "smart", "key": "o:payco.example"}).json()
    assert len(mails) == 10


def test_keys_are_stable_across_rescans(tail):
    before = set(smart_state())
    mailops.run_scan()
    mailops.run_scan()
    assert set(smart_state()) == before


def test_threshold_setting_roundtrip_and_recompute_without_scan(tail):
    assert client.get("/api/config").json()["accounts"]["default"][
        "smart_min"] == 10
    acc = accountsmod.get()
    rev = acc.state["groups_rev"]
    r = client.post("/api/config", json={"imap": {"smart_min": 2}})
    assert r.status_code == 200
    assert r.json()["accounts"]["default"]["smart_min"] == 2
    rows = smart_state()
    assert "s:vip@lone.example" in rows          # 2 mails >= 2
    assert acc.state["groups_rev"] > rev
    assert acc.state["scanned_ts"]               # no scan was needed
    # clamped to 2..50 on the way in
    client.post("/api/config", json={"imap": {"smart_min": 1}})
    assert cfgmod.load_config()["accounts"]["default"]["smart_min"] == 2
    client.post("/api/config", json={"imap": {"smart_min": 999}})
    assert cfgmod.load_config()["accounts"]["default"]["smart_min"] == 50
    client.post("/api/config", json={"imap": {"smart_min": 10}})
    assert "s:vip@lone.example" not in smart_state()


def test_sender_records_are_restamped_when_the_threshold_moves(tail):
    senders = mailops.STATE["groups"]["sender"]
    assert senders["vip@lone.example"]["smart_key"] == "k:other"
    assert "smart_key" in mailops.public_state()["groups"]["sender"][
        "vip@lone.example"]                         # shipped to the UI
    client.post("/api/config", json={"imap": {"smart_min": 2}})
    senders = mailops.STATE["groups"]["sender"]
    assert senders["vip@lone.example"]["smart_key"] == "s:vip@lone.example"
    assert "smart_key" not in smart_state()["s:vip@lone.example"]
    client.post("/api/config", json={"imap": {"smart_min": 10}})
    assert mailops.STATE["groups"]["sender"]["vip@lone.example"][
        "smart_key"] == "k:other"
    assert "smart_key" not in smart_state()["s:big@bigshop.example"]


def test_unrelated_settings_save_does_not_rebuild(tail):
    acc = accountsmod.get()
    rows = acc.state["groups"]["smart"]
    rev = acc.state["groups_rev"]
    client.post("/api/config", json={"imap": {"body_search": "disabled"}})
    assert acc.state["groups"]["smart"] is rows
    assert acc.state["groups_rev"] == rev


def test_threshold_is_per_account(monkeypatch):
    cfgmod.update_config({"add_account": "second"})
    cfgmod.update_config({"account": "second", "imap": {"smart_min": 3}})
    cfg = cfgmod.load_config()["accounts"]
    assert cfg["second"]["smart_min"] == 3
    assert cfg[next(iter(cfg))]["smart_min"] == 10


def test_protecting_a_sender_moves_it_into_the_protected_bucket(tail):
    assert placement(smart_state())["x@one.example"] == "k:other"
    r = client.post("/api/protect", json={"entry": "x@one.example"})
    assert r.status_code == 200
    rows = smart_state()
    assert placement(rows)["x@one.example"] == "k:protected"
    assert rows["k:protected"]["protected"] is True
    assert rows["k:other"]["protected"] is False
    client.post("/api/protect", json={"entry": "x@one.example", "on": False})
    assert placement(smart_state())["x@one.example"] == "k:other"


def test_protecting_several_senders_is_one_save_and_one_rebuild(tail):
    acc = accountsmod.get()
    rev = acc.state["groups_rev"]
    r = client.post("/api/protect", json={
        "entries": ["x@one.example", "y@two.example", "X@One.example"]})
    assert r.status_code == 200
    assert r.json()["protected"] == ["x@one.example", "y@two.example"]
    assert acc.state["groups_rev"] == rev + 1                # one rebuild
    place = placement(smart_state())
    assert place["x@one.example"] == place["y@two.example"] == "k:protected"
    r = client.post("/api/protect", json={
        "entries": ["x@one.example", "y@two.example"], "on": False})
    assert r.json()["protected"] == []
    assert placement(smart_state())["x@one.example"] == "k:other"
    # the single form still works, and nothing at all is an error
    assert client.post("/api/protect", json={"entry": "a@b.c"}).status_code == 200
    assert client.post("/api/protect", json={"entries": []}).status_code == 400
    assert client.post("/api/protect", json={"entries": [" "]}).status_code == 400
    assert client.post("/api/protect", json={}).status_code == 400


def test_protected_bucket_is_skipped_by_delete_unless_forced(tail):
    client.post("/api/protect", json={"entry": "x@one.example"})
    with pytest.raises(ValueError, match="protected"):
        mailops.delete_groups("smart", ["k:protected"])
    assert not tail.mailbox["Trash"]
    # a protected sender no longer blocks the big bucket it used to sit in
    r = mailops.delete_groups("smart", ["k:other"])
    assert r["queued"] == 3 and r["skipped"] == 0
    wait_delete_done()
    assert {m["uid"] for m in tail.mailbox["Trash"]}
    assert "x@one.example" in mailops.STATE["groups"]["sender"]


def test_own_row_of_a_protected_sender_is_protected(tail):
    client.post("/api/protect", json={"entry": "big@bigshop.example"})
    assert smart_state()["s:big@bigshop.example"]["protected"] is True
    with pytest.raises(ValueError, match="protected"):
        mailops.delete_groups("smart", ["s:big@bigshop.example"])


def test_delete_a_bucket_patches_every_grouping_and_undo_restores(tail):
    other = mailops.STATE["groups"]["smart"]["k:other"]
    n = other["count"]
    assert n == 4
    r = mailops.delete_groups("smart", ["k:other"])
    assert r["queued"] == n
    wait_delete_done()
    assert len(tail.mailbox["Trash"]) == n
    st = mailops.STATE["groups"]
    # the bucket is gone, its senders are gone from the other groupings,
    # and nothing else reshuffled (no rebuild on deletes)
    assert "k:other" not in st["smart"]
    for a in ("x@one.example", "y@two.example", "vip@lone.example"):
        assert a not in st["sender"]
    assert set(st["smart"]) == {"s:big@bigshop.example", "o:payco.example",
                                "k:accounts"}
    assert st["smart"]["o:payco.example"]["count"] == 10
    res = mailops.undo_last()
    assert res["restored"] == n


def test_partial_removal_updates_counts_without_reshuffling(tail):
    # drop one mail of the pool: the pool keeps its row even though it now
    # totals fewer than the threshold
    rec = mailops.STATE["groups"]["smart"]["o:payco.example"]
    folder, uids = next(iter(rec["folders"].items()))
    with mailops.STATE_LOCK:
        mailops._apply_removal({folder: {uids[0]}}, accountsmod.get())
    rows = smart_state()
    assert rows["o:payco.example"]["count"] == 9
    assert rows["o:payco.example"]["kind"] == "company"
    sender_rows = mailops.STATE["groups"]["sender"]
    assert sum(s["count"] for k, s in sender_rows.items()
               if k.endswith("payco.example")) == 9


def test_own_row_deletes_like_the_sender_tab(tail):
    r = mailops.delete_groups("smart", ["s:big@bigshop.example"])
    assert r["queued"] == 12
    wait_delete_done()
    assert "big@bigshop.example" not in mailops.STATE["groups"]["sender"]
    assert "s:big@bigshop.example" not in mailops.STATE["groups"]["smart"]


# ----------------------------------------------------------------- snapshot

def test_snapshot_roundtrip_keeps_smart_without_rebuilding(tail):
    acc = accountsmod.get()
    before = smart_state()
    accountsmod.reset()
    acc2 = accountsmod.get()
    assert mailops.load_snapshot(acc2)
    assert mailops.public_state(acc2)["groups"]["smart"].keys() == before.keys()
    assert acc2.smart_sig == acc.smart_sig


def test_snapshot_without_smart_keys_is_rebuilt_on_restore(tail):
    """Snapshots written before sender records carried `smart_key` (same
    placement rules, same threshold) are re-derived; stamped ones are not."""
    acc = accountsmod.get()
    path = mailops._snap_path(acc.name)
    data = json.loads(path.read_text())
    data["groups"]["smart"]["k:other"]["n_senders"] = 99      # a marker
    path.write_text(json.dumps(data))
    accountsmod.reset()
    acc2 = accountsmod.get()
    assert mailops.load_snapshot(acc2)
    assert mailops.public_state(acc2)["groups"]["smart"]["k:other"][
        "n_senders"] == 99                          # stamped: kept as saved

    for rec in data["groups"]["sender"].values():
        rec.pop("smart_key")
    path.write_text(json.dumps(data))
    accountsmod.reset()
    acc3 = accountsmod.get()
    assert mailops.load_snapshot(acc3)
    state = mailops.public_state(acc3)["groups"]
    assert state["smart"]["k:other"]["n_senders"] == 3      # re-derived
    assert {a: r["smart_key"] for a, r in state["sender"].items()
            if r["smart_key"] == "k:other"} .keys() == {
        "vip@lone.example", "x@one.example", "y@two.example"}


def test_snapshot_without_smart_is_rebuilt_on_restore(tail):
    acc = accountsmod.get()
    want = set(smart_state())
    path = mailops._snap_path(acc.name)
    data = json.loads(path.read_text())
    assert data["version"] == mailops._SNAP_VERSION      # no version bump
    data["groups"].pop("smart")
    data.pop("smart_sig")
    path.write_text(json.dumps(data))

    accountsmod.reset()
    acc2 = accountsmod.get()
    assert mailops.load_snapshot(acc2)
    rows = mailops.public_state(acc2)["groups"]["smart"]
    assert set(rows) == want
    assert rows["o:payco.example"]["count"] == 10
    # and it really acts on them: restored (unscanned) state deletes fine
    mailops.delete_groups("smart", ["o:payco.example"], acc=acc2)
    wait_delete_done()
    assert len(tail.mailbox["Trash"]) == 10


def test_snapshot_built_with_another_threshold_is_rebuilt(tail):
    acc = accountsmod.get()
    path = mailops._snap_path(acc.name)
    data = json.loads(path.read_text())
    data["smart_sig"] = [30, [], mailops.SMART_RULES_VERSION]   # was 30
    data["groups"]["smart"] = {}
    path.write_text(json.dumps(data))
    accountsmod.reset()
    acc2 = accountsmod.get()
    assert mailops.load_snapshot(acc2)
    assert "s:big@bigshop.example" in \
        mailops.public_state(acc2)["groups"]["smart"]


# ------------------------------------------------------ AI verdict cache

def _fake_ai(monkeypatch, sent, verdict="delete_safe", on_call=None):
    """Canned AI client; `on_call` runs while the request is "out"."""
    def create(**kw):
        payload = json.loads(kw["messages"][0]["content"])
        sent.append((kw.get("system"), payload))
        if on_call:
            on_call()
        verdicts = [{"key": g["key"], "verdict": verdict, "reason": "t"}
                    for g in payload["groups"]]
        return types.SimpleNamespace(
            stop_reason="end_turn",
            content=[types.SimpleNamespace(
                type="text", text=json.dumps({"verdicts": verdicts}))],
            usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: types.SimpleNamespace(
        messages=types.SimpleNamespace(create=create)))


def test_verdict_cache_stores_a_member_fingerprint(tail, monkeypatch):
    cfgmod.update_config({"ai": {"api_key": "k"}})
    sent: list = []
    _fake_ai(monkeypatch, sent)
    aihelper._run_ai("smart")
    system, payload = sent[0]
    assert "pool many small senders" in system
    keys = {g["key"] for g in payload["groups"]}
    assert "k:other" in keys
    for g in payload["groups"]:       # same payload shape as other groupings
        assert set(g) <= {"key", "label", "count", "total_size_kb", "unread",
                          "first", "last", "tags", "samples", "replied",
                          "protected"}
    stored = verdictstore.load_account("default")["smart"]
    assert stored["k:other"]["fp"] == \
        mailops.STATE["groups"]["smart"]["k:other"]["fp"]
    assert "fp" not in stored["s:big@bigshop.example"]
    # same members after a rescan: the verdict is still applied
    mailops.run_scan()
    assert smart_state()["k:other"]["ai"]["verdict"] == "delete_safe"


def test_the_group_review_asks_for_low_reasoning_effort(tail, monkeypatch):
    cfgmod.update_config({"ai": {"api_key": "k"}})
    seen = []

    def create(**kw):
        seen.append(kw["output_config"].get("effort"))
        payload = json.loads(kw["messages"][0]["content"])
        return types.SimpleNamespace(
            stop_reason="end_turn",
            content=[types.SimpleNamespace(type="text", text=json.dumps({
                "verdicts": [{"key": g["key"], "verdict": "review", "reason": "t"}
                             for g in payload["groups"]]}))],
            usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: types.SimpleNamespace(
        messages=types.SimpleNamespace(create=create)))
    aihelper._run_ai("smart")
    assert seen and set(seen) == {"low"} == {aihelper.REVIEW_EFFORT}


def test_verdict_is_dropped_when_the_members_changed(tail, monkeypatch):
    cfgmod.update_config({"ai": {"api_key": "k"}})
    _fake_ai(monkeypatch, [])
    aihelper._run_ai("smart")
    assert smart_state()["k:other"]["ai"]
    # a new tiny sender joins the bucket
    tail.mailbox["INBOX"].append(make_msg(
        900, frm="new@brandnew.example", subject="Hi", msgid="<n900@t>"))
    mailops.run_scan()
    rec = smart_state()["k:other"]
    assert rec["n_senders"] == 4 and rec["ai"] is None
    assert "k:other" not in verdictstore.load_account("default")["smart"]
    # unrelated rows keep theirs
    assert smart_state()["s:big@bigshop.example"]["ai"]


def test_rerate_is_dropped_when_the_members_changed_in_flight(tail,
                                                              monkeypatch):
    """Re-rate (#106) x pooled rows (#105): the model call is out while the
    user protects one of the bucket's senders. The verdict was made on the
    OLD members, so it must not be attached to the re-derived row (nor stored
    under its new fingerprint) - exactly like a cached verdict. A row whose
    members did not change takes the re-rated verdict."""
    cfgmod.update_config({"ai": {"api_key": "k"}})
    _fake_ai(monkeypatch, [])
    aihelper._run_ai("smart")                        # rate everything once
    assert smart_state()["k:other"]["ai"]["verdict"] == "delete_safe"
    old_fp = smart_state()["k:other"]["fp"]
    assert smart_state()["o:payco.example"]["ai"]["verdict"] == "delete_safe"

    sent: list = []
    _fake_ai(monkeypatch, sent, verdict="keep", on_call=lambda: client.post(
        "/api/protect", json={"entry": "x@one.example"}))
    aihelper._run_ai("smart", keys={"k:other", "o:payco.example"}, rerate=True)

    assert {g["key"] for g in sent[0][1]["groups"]} \
        == {"k:other", "o:payco.example"}                # both really re-sent
    assert mailops.STATE["ai"]["status"] == "done", mailops.STATE["ai"]
    other = mailops.STATE["groups"]["smart"]["k:other"]
    assert other["fp"] != old_fp and other["n_senders"] == 2
    assert other["ai"] is None                       # not the old members' call
    stored = verdictstore.load_account("default")["smart"]
    assert "k:other" not in stored
    # ...a rescan must not resurrect it either
    mailops.run_scan()
    assert smart_state()["k:other"]["ai"] is None
    # the unchanged company row did take its second opinion, fingerprint kept
    paypal = mailops.STATE["groups"]["smart"]["o:payco.example"]
    assert paypal["ai"]["verdict"] == "keep"
    assert stored["o:payco.example"] == {"verdict": "keep", "reason": "t",
                                     "fp": paypal["fp"]}


def test_fingerprint_unit_apply_to_groups():
    rec = {"key": "k:other", "ai": None, "fp": "aaaa"}
    verdictstore.save("smart", {"k:other": {"verdict": "keep", "reason": "r",
                                            "fp": "aaaa"}})
    groups = {"smart": {"k:other": rec}}
    assert verdictstore.apply_to_groups(groups) == 1
    assert rec["ai"]["verdict"] == "keep"
    other = {"key": "k:other", "ai": None, "fp": "bbbb"}
    assert verdictstore.apply_to_groups({"smart": {"k:other": other}}) == 0
    assert other["ai"] is None
    assert "k:other" not in verdictstore.load_account().get("smart", {})
    # rows without a fingerprint (every other grouping) are unaffected
    verdictstore.save("sender", {"a@b.c": {"verdict": "keep", "reason": "r"}})
    plain = {"key": "a@b.c", "ai": None}
    assert verdictstore.apply_to_groups({"sender": {"a@b.c": plain}}) == 1


def test_threshold_change_keeps_verdicts_of_unchanged_pools(tail, monkeypatch):
    cfgmod.update_config({"ai": {"api_key": "k"}})
    _fake_ai(monkeypatch, [])
    aihelper._run_ai("smart")
    client.post("/api/config", json={"imap": {"smart_min": 5}})
    rows = smart_state()
    assert rows["o:payco.example"]["ai"]            # same member set -> kept
    assert rows["k:accounts"]["ai"]


# ------------------------------------------------- places that say no

def test_rules_reject_smart_but_keep_domain(tail):
    with pytest.raises(ValueError, match="bad grouping"):
        rulesmod.create_rule({"name": "n", "grouping": "smart", "query": ""})
    rule = rulesmod.create_rule({"name": "d", "grouping": "domain",
                                 "query": "domain:payco.example",
                                 "action": "trash"})
    assert rule["grouping"] == "domain"
    with pytest.raises(ValueError, match="bad grouping"):
        rulesmod.update_rule(rule["id"], {"grouping": "smart"})
    r = client.post("/api/rules", json={"name": "n", "grouping": "smart",
                                        "query": "x", "action": "trash"})
    assert r.status_code == 400


def test_block_stays_sender_or_domain(tail):
    r = client.post("/api/block", json={"grouping": "smart",
                                        "key": "s:big@bigshop.example"})
    assert r.status_code == 400
    r = client.post("/api/block", json={"grouping": "domain",
                                        "key": "payco.example"})
    assert r.status_code == 200


def test_domain_grouping_and_export_still_work(tail):
    groups = mailops.public_state()["groups"]
    assert "payco.example" in groups["domain"]
    csv = client.get("/api/export", params={"grouping": "smart"}).text
    assert "k:other" in csv and "o:payco.example" in csv
    assert client.get("/api/export", params={"grouping": "nope"}
                      ).status_code == 400


def test_pin_group_works_on_pooled_rows(tail):
    r = client.post("/api/pin_group", json={"grouping": "smart",
                                            "key": "k:other"})
    assert r.status_code == 200 and r.json()["changed"] == 4
    assert smart_state()["k:other"]["pinned"] == 4


def test_snapshot_built_with_older_placement_rules_is_rebuilt(tail):
    acc = accountsmod.get()
    path = mailops._snap_path(acc.name)
    data = json.loads(path.read_text())
    data["smart_sig"][2] = mailops.SMART_RULES_VERSION - 1
    data["groups"]["smart"] = {"k:stale": data["groups"]["smart"]["k:other"]}
    path.write_text(json.dumps(data))
    accountsmod.reset()
    acc2 = accountsmod.get()
    assert mailops.load_snapshot(acc2)
    rows = mailops.public_state(acc2)["groups"]["smart"]
    assert "k:stale" not in rows and "o:payco.example" in rows


# ================================================ what the mails are about

def kinds_of(rows):
    return {k: r["kind"] for k, r in rows.items()}


def test_senders_are_placed_by_what_their_mails_are_about():
    msgs = (many("a@shop-a.example", 3, subject="Ihre Bestellung 1")
            + many("b@clinic.example", 2, subject="Terminbestätigung")
            + many("c@corp.example", 1, subject="Ihre Bewerbung bei Corp")
            + many("d@desk.example", 2, subject="Ihre Anfrage (Ticket: 7)")
            + many("e@login.example", 2, subject="Verify your email")
            + many("f@spam.example", 1, subject="Hello", unsub=True)
            + many("g@gmail.com", 1, subject="Hi")
            + many("h@plain.example", 1, subject="Hi"))
    place = placement(smart(msgs))
    assert place == {
        "a@shop-a.example": "k:orders", "b@clinic.example": "k:appointments",
        "c@corp.example": "k:jobs", "d@desk.example": "k:support",
        "e@login.example": "k:accounts", "f@spam.example": "k:newsletter",
        "g@gmail.com": "k:individuals", "h@plain.example": "k:other"}
    rows = smart(msgs)
    for key, label in (("k:orders", "Orders & deliveries"),
                       ("k:appointments", "Appointments & bookings"),
                       ("k:jobs", "Job applications"),
                       ("k:support", "Support & inquiries"),
                       ("k:accounts", "Accounts & security")):
        assert rows[key]["label"] == label and rows[key]["kind"] == key[2:]
    assert not [k for k in rows if k == "k:notifications"]


def test_every_kind_has_a_fallback_label():
    for kind in ("protected", "replied", "orders", "appointments", "jobs",
                 "support", "accounts", "newsletter", "individuals", "other"):
        assert mailops.SMART_KIND_LABELS[kind]
    assert "notifications" not in mailops.SMART_KIND_LABELS


def test_a_small_company_is_placed_as_one_unit_by_all_its_mails():
    # three senders of one company, 7 mails (< N): they stay TOGETHER, the
    # kind comes from the distribution of ALL their mails
    msgs = (many("orders@acme.example", 3, subject="Ihre Bestellung 1")
            + many("ship@acme.example", 2, subject="Versandbestätigung 2")
            + many("hello@acme.example", 2, subject="Hallo"))
    rows = smart(msgs)
    place = placement(rows)
    assert {place[a] for a in ("orders@acme.example", "ship@acme.example",
                               "hello@acme.example")} == {"k:orders"}
    assert rows["k:orders"]["n_senders"] == 3
    # no dominant theme: the whole company goes to Other, not split up
    msgs = (many("orders@mix.example", 2, subject="Ihre Bestellung 1")
            + many("clinic@mix.example", 2, subject="Terminbestätigung")
            + many("login@mix.example", 2, subject="Verify your email"))
    place = placement(smart(msgs))
    assert {place[a] for a in ("orders@mix.example", "clinic@mix.example",
                               "login@mix.example")} == {"k:other"}


def test_a_big_company_is_still_one_row_whatever_its_mails_say():
    msgs = (many("orders@big.example", 8, subject="Ihre Bestellung 1")
            + many("login@big.example", 4, subject="Verify your email"))
    rows = smart(msgs)
    assert set(rows) == {"o:big.example"} and rows["o:big.example"]["count"] == 12


def test_why_is_stamped_on_every_sender_record():
    msgs = (many("big@shop.example", 12)
            + many("a@co.example", 6, subject="Hi") + many("b@co.example", 5)
            + many("o1@acme.example", 2, subject="Ihre Bestellung 1")
            + many("o2@acme.example", 1, subject="Ihre Bestellung 2")
            + many("n@news.example", 1, subject="Hi", unsub=True)
            + many("p@gmail.com", 1) + many("x@one.example", 1)
            + many("w@weak.example", 4, subject="Ihre Bestellung 1")
            + many("w@weak.example", 6, subject="Hello")
            + many("me@friend.example", 2) + many("pr@vip.example", 1))
    groups = all_groups(msgs, replied={"me@friend.example"},
                        protected=["pr@vip.example"], smart_min=11)
    why = {a: r["smart_why"] for a, r in groups["sender"].items()}
    assert why["big@shop.example"] == {"r": "own"}
    assert why["a@co.example"] == {"r": "company", "co": "co.example"}
    assert why["o1@acme.example"] == {"r": "purpose", "k": "orders", "n": 3,
                                      "of": 3, "co": "acme.example"}
    assert why["o2@acme.example"] == why["o1@acme.example"]
    assert why["n@news.example"] == {"r": "newsletter"}
    assert why["p@gmail.com"] == {"r": "individual"}
    assert why["x@one.example"] == {"r": "none"}
    assert why["w@weak.example"]["r"] == "weak"
    assert why["me@friend.example"] == {"r": "replied"}
    assert why["pr@vip.example"] == {"r": "protected"}
    # own rows keep the stamps off the ROW (they belong to the sender record)
    assert "smart_why" not in groups["smart"]["s:big@shop.example"]


# ------------------------------------------------------------ mail platforms

def test_shared_platform_addresses_are_never_company_pooled():
    # three unrelated merchants behind one payment platform: NOT one "company"
    msgs = (many("receipts+acct_1@stripe.com", 5, subject="Your receipt from Acme")
            + many("receipts+acct_2@stripe.com", 5, subject="Your receipt from Globex")
            + many("receipts+acct_3@stripe.com", 5, subject="Your receipt from Initech"))
    rows = smart(msgs)
    assert set(rows) == {"k:orders"}            # placed by kind, not "stripe.com"
    assert rows["k:orders"]["n_senders"] == 3


def test_tenant_platform_hosts_are_the_company():
    msgs = (many("a@acme.zendesk.com", 6, subject="Re: Ihre Anfrage")
            + many("b@help.acme.zendesk.com", 6, subject="Re: Ihre Anfrage")
            + many("c@globex.zendesk.com", 6, subject="Re: Ihre Anfrage")
            + many("d@globex.zendesk.com", 6, subject="Re: Ihre Anfrage"))
    rows = smart(msgs)
    assert set(rows) == {"o:acme.zendesk.com", "o:globex.zendesk.com"}
    assert rows["o:acme.zendesk.com"]["label"] == "acme.zendesk.com"
    # one tenant's pool never swallows another's
    assert rows["o:acme.zendesk.com"]["n_senders"] == 2
    # the platform's own root host identifies nobody
    msgs = many("x@zendesk.com", 6) + many("y@mail.zendesk.com", 6)
    assert not [k for k in smart(msgs) if k.startswith("o:")]


def test_look_alike_platform_suffixes_are_ordinary_companies():
    msgs = (many("a@zendesk.com.attacker.example", 6)
            + many("b@acme.zendesk.com.attacker.example", 6))
    assert set(smart(msgs)) == {"o:attacker.example"}      # not a tenant host


def test_nested_subdomains_of_a_normal_company_still_pool():
    msgs = (many("a@bigshop-de.example", 4) + many("b@marketplace.bigshop-de.example", 4)
            + many("c@mail.bigshop-de.example", 4))
    assert set(smart(msgs)) == {"o:bigshop-de.example"}


# --------------------------------------------- summaries, re-tagging, restore

def _acme_box():
    inbox, uid = [], iter(range(1, 1000))

    def add(addr, n, subject, **kw):
        for _ in range(n):
            u = next(uid)
            inbox.append(make_msg(u, frm=addr, subject=subject,
                                  msgid=f"<a{u}@t>", **kw))
    add("orders@acme.example", 6, "Ihre Bestellung 1")
    add("login@acme.example", 3, "Verify your email")
    add("news@acme.example", 3, "Wochenangebote", unsub="<https://x.example/u>")
    add("misc@acme.example", 2, "Hallo")
    add("lone@solo.example", 1, "Ihre Bestellung 9")
    return inbox


@pytest.fixture
def acme(monkeypatch):
    fake = FakeIMAP({"INBOX": _acme_box(), "Sent": [], "Trash": [], "Spam": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    return fake


def test_a_company_row_summarises_what_its_mails_are(acme):
    row = smart_state()["o:acme.example"]
    assert row["kind"] == "company" and row["n_senders"] == 4
    assert row["purposes"] == {"orders": 6, "accounts": 3, "newsletter": 3,
                               "unclassified": 2}
    assert list(row["purposes"]) == ["orders", "accounts", "newsletter",
                                     "unclassified"]            # by size
    assert "purposes" not in smart_state()["k:orders"]          # companies only


def test_the_summary_follows_deletes_but_the_placement_stays(acme):
    mailops.delete_groups("sender", ["orders@acme.example"])
    wait_delete_done()
    row = smart_state()["o:acme.example"]
    assert row["purposes"] == {"accounts": 3, "newsletter": 3, "unclassified": 2}
    assert row["count"] == 8
    # the senders follow what is left; WHERE the rest sits does not move
    assert row["n_senders"] == 3
    assert sorted(row["members"]) == ["login@acme.example", "misc@acme.example",
                                      "news@acme.example"]
    assert mailops.STATE["groups"]["sender"]["login@acme.example"][
        "smart_key"] == "o:acme.example"


def test_a_category_edit_re_tags_and_rebuilds_without_a_rescan(acme):
    acc = accountsmod.get()
    scanned = acc.state["scanned_ts"]
    assert placement(smart_state())["lone@solo.example"] == "k:orders"
    r = client.post("/api/config", json={"categories": {"hobby": ["solo.example"]}})
    assert r.status_code == 200
    assert acc.state["scanned_ts"] == scanned                    # no scan
    assert "hobby" in acc.state["groups"]["sender"]["lone@solo.example"]["tags"]
    rows = smart_state()
    assert rows["k:cat:hobby"]["category"] == "hobby"
    assert placement(rows)["lone@solo.example"] == "k:cat:hobby"
    # editing a BUILT-IN category counts as the user's own
    client.post("/api/config", json={"categories": {"shopping": ["acme"]}})
    assert placement(smart_state())["lone@solo.example"] == "k:orders"
    # removing it again puts the sender back, still without a scan
    client.post("/api/config", json={"categories": {}})
    assert "hobby" not in acc.state["groups"]["sender"]["lone@solo.example"]["tags"]
    assert "k:cat:hobby" not in smart_state()
    assert acc.state["scanned_ts"] == scanned


def test_unchanged_categories_do_not_rebuild(acme):
    acc = accountsmod.get()
    client.post("/api/config", json={"categories": {"hobby": ["solo.example"]}})
    rows, rev = acc.state["groups"]["smart"], acc.state["groups_rev"]
    client.post("/api/config", json={"categories": {"hobby": ["solo.example"]}})
    assert acc.state["groups"]["smart"] is rows and acc.state["groups_rev"] == rev


def test_the_snapshot_signature_covers_the_categories(acme):
    acc = accountsmod.get()
    client.post("/api/config", json={"categories": {"hobby": ["solo.example"]}})
    path = mailops._snap_path(acc.name)
    data = json.loads(path.read_text())
    mailops.save_snapshot(acc)
    data = json.loads(path.read_text())
    assert len(data["smart_sig"]) == 5 and data["smart_sig"][2] == \
        mailops.SMART_RULES_VERSION
    # categories edited while the app was down: restore re-tags and rebuilds
    cfgmod.update_config({"categories": {}})
    accountsmod.reset()
    acc2 = accountsmod.get()
    assert mailops.load_snapshot(acc2)
    assert "k:cat:hobby" not in mailops.public_state(acc2)["groups"]["smart"]
    assert "hobby" not in acc2.state["groups"]["sender"]["lone@solo.example"]["tags"]


def test_snapshot_built_before_what_the_mails_are_about_is_rebuilt(acme):
    acc = accountsmod.get()
    path = mailops._snap_path(acc.name)
    data = json.loads(path.read_text())
    data["smart_sig"] = [10, [], 2]                    # the old 3-part form
    data["groups"]["smart"] = {"k:notifications": data["groups"]["smart"]["k:orders"]}
    path.write_text(json.dumps(data))
    accountsmod.reset()
    acc2 = accountsmod.get()
    assert mailops.load_snapshot(acc2)
    rows = mailops.public_state(acc2)["groups"]["smart"]
    assert "k:notifications" not in rows and "o:acme.example" in rows


def test_an_imported_config_re_places_the_senders(acme):
    assert placement(smart_state())["lone@solo.example"] == "k:orders"
    r = client.post("/api/import_config", json={"config": {
        "protected": ["lone@solo.example"]}})
    assert r.status_code == 200
    assert placement(smart_state())["lone@solo.example"] == "k:protected"


def test_deleting_senders_of_a_pool_keeps_the_row_honest(tail, monkeypatch):
    """Partial deletes (the sender list makes them possible): the row's
    senders, count and fingerprint follow, its AI verdict - made on other
    members - goes (also from the cache), nothing else moves."""
    cfgmod.update_config({"ai": {"api_key": "k"}})
    _fake_ai(monkeypatch, [])
    aihelper._run_ai("smart")
    other = smart_state()["k:other"]
    assert other["ai"] and other["n_senders"] == 3
    old_fp = other["fp"]
    paypal_ai = smart_state()["o:payco.example"]["ai"]
    mailops.delete_groups("sender", ["x@one.example"])
    wait_delete_done()
    row = smart_state()["k:other"]
    assert row["n_senders"] == 2 and row["count"] == 3
    assert sorted(row["members"]) == ["vip@lone.example", "y@two.example"]
    assert row["samples"] == row["members"] and row["fp"] != old_fp
    assert row["ai"] is None                                # other members now
    assert "k:other" not in verdictstore.load_account("default")["smart"]
    assert smart_state()["o:payco.example"]["ai"] == paypal_ai  # untouched
    # placement is stable: the stamps of the senders that are left stay put
    senders = mailops.STATE["groups"]["sender"]
    assert senders["y@two.example"]["smart_key"] == "k:other"
    assert "x@one.example" not in senders


def test_fewer_mails_of_the_same_senders_keep_the_verdict(tail, monkeypatch):
    cfgmod.update_config({"ai": {"api_key": "k"}})
    _fake_ai(monkeypatch, [])
    aihelper._run_ai("smart")
    rec = mailops.STATE["groups"]["smart"]["o:payco.example"]
    folder, uids = next(iter(rec["folders"].items()))
    fp = rec["fp"]
    with mailops.STATE_LOCK:
        mailops._apply_removal({folder: {uids[0]}}, accountsmod.get())
    row = smart_state()["o:payco.example"]
    assert row["fp"] == fp and row["ai"]["verdict"] == "delete_safe"
    assert row["n_senders"] == 3


# ------------------------------------------------ unsubscribe stays per sender

def _unsub_box():
    inbox, uid = [], iter(range(1, 1000))
    hdr = "<https://x.example/u>"

    def add(addr, n, subject="Weekly news"):
        for _ in range(n):
            u = next(uid)
            inbox.append(make_msg(u, frm=addr, subject=subject, unsub=hdr,
                                  msgid=f"<u{u}@t>"))
    add("news@bigshop.example", 12)                  # own row (>= 10)
    add("a@acme.example", 4)
    add("b@acme.example", 4)
    add("c@acme.example", 4)                         # company row (12 mails)
    add("p@promo-one.example", 1)
    add("q@promo-two.example", 1)                    # k:newsletter pool
    return inbox


@pytest.fixture
def unsubbable(monkeypatch):
    from backend import unsub
    fake = FakeIMAP({"INBOX": _unsub_box(), "Sent": [], "Trash": [], "Spam": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    posted = []
    monkeypatch.setattr(unsub, "_post_one_click", lambda url: posted.append(url))
    mailops.run_scan()
    assert mailops.STATE["status"] == "done"
    return posted


def test_bulk_unsubscribe_in_smart_covers_own_rows_and_skips_pools(unsubbable):
    from backend import unsubstore
    from conftest import wait_unsub_done
    assert {"s:news@bigshop.example", "o:acme.example", "k:newsletter"} \
        <= set(smart_state())
    r = client.post("/api/unsubscribe_bulk", json={"grouping": "smart", "keys": [
        "s:news@bigshop.example", "o:acme.example", "k:newsletter"]})
    assert r.status_code == 200
    assert r.json() == {"queued": 1, "skipped_protected": 0, "skipped_done": 0,
                        "capped": 0, "skipped_pooled": 2}
    wait_unsub_done()
    # only the big sender was unsubscribed - not one of the pooled senders
    assert set(unsubstore.load_account("default")) == {"news@bigshop.example"}


def test_bulk_unsubscribe_of_only_pools_does_nothing(unsubbable):
    from backend import unsubstore
    r = client.post("/api/unsubscribe_bulk", json={"grouping": "smart",
                                                   "keys": ["o:acme.example"]})
    assert r.json() == {"queued": 0, "skipped_protected": 0, "skipped_done": 0,
                        "capped": 0, "skipped_pooled": 1}
    assert not unsubstore.load_account("default") and not unsubbable


def test_single_group_unsubscribe_refuses_a_pooled_row(unsubbable):
    from backend import unsubstore
    r = client.post("/api/unsubscribe", json={"grouping": "smart",
                                              "key": "o:acme.example"})
    assert r.status_code == 500 and "pooled" in r.json()["detail"]
    assert not unsubstore.load_account("default") and not unsubbable
    # an own row (one sender) and the sender's own detail still work
    r = client.post("/api/unsubscribe", json={"grouping": "smart",
                                              "key": "s:news@bigshop.example"})
    assert r.status_code == 200
    r = client.post("/api/unsubscribe", json={"grouping": "sender",
                                              "key": "a@acme.example"})
    assert r.status_code == 200
    assert set(unsubstore.load_account("default")) == {
        "news@bigshop.example", "a@acme.example"}
