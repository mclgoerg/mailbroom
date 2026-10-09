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


def smart(messages, replied=None, protected=None, smart_min=10, cats=None):
    groups = mailops.build_groups(messages, replied or set(), cats, smart_min,
                                  protected or [])
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


# ---------------------------------------------------------------- helpers

@pytest.mark.parametrize("domain,expected", [
    ("paypal.de", "paypal.de"),
    ("mail.paypal.de", "paypal.de"),
    ("a.b.c.paypal.de", "paypal.de"),
    ("shop.example.co.uk", "example.co.uk"),
    ("example.co.uk", "example.co.uk"),
    ("mail.rakuten.co.jp", "rakuten.co.jp"),
    ("localhost", "localhost"),
    ("EXAMPLE.com.", "example.com"),
])
def test_registrable_domain(domain, expected):
    assert mailops.registrable_domain(domain) == expected


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
    "paypal.de", "amazon.com", "mail.example.co.uk", "livestream.com",
    "outlooktips.com", "yahooinc.example", "gmxshop.de"])
def test_company_domains_are_not_freemail(domain):
    assert not mailops.is_freemail(domain)


ACCOUNT_YES = [
    "Welcome to Dropbox", "Willkommen bei Spotify", "Please verify your email",
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
            + many("a@paypal.de", 4) + many("b@mail.paypal.de", 3)
            + many("c@paypal.de", 3)
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
    # DocMorris: one big sender + two small ones -> ONE row, at any N
    msgs = (many("auftrag@order.docmorris.de", 31)
            + many("info@mail.docmorris.de", 4)
            + many("kunde@customer.docmorris.de", 1))
    for n in (2, 4, 5, 10, 36):
        rows = smart(msgs, smart_min=n)
        assert list(rows) == ["o:docmorris.de"], n
        assert rows["o:docmorris.de"]["count"] == 36
        assert rows["o:docmorris.de"]["n_senders"] == 3
    # below the domain total's reach the company dissolves again
    rows = smart(msgs, smart_min=50)
    assert "o:docmorris.de" not in rows
    assert placement(rows)["auftrag@order.docmorris.de"] != "o:docmorris.de"


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
    msgs = (many("a@shop.example.co.uk", 4) + many("b@mail.example.co.uk", 3)
            + many("c@example.co.uk", 3)
            # same suffix, different company: must not merge
            + many("d@other.co.uk", 6))
    rows = smart(msgs)
    place = placement(rows)
    assert place["a@shop.example.co.uk"] == "o:example.co.uk"
    assert place["b@mail.example.co.uk"] == "o:example.co.uk"
    assert "o:co.uk" not in rows
    assert place["d@other.co.uk"] != "o:co.uk"
    assert place["d@other.co.uk"] == "k:other"


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
    msgs = (many("a@paypal.de", 4) + many("b@paypal.de", 3)
            + many("c@paypal.de", 3))
    assert smart(msgs)["o:paypal.de"]["domain"] == "paypal.de"
    msgs = (many("a@paypal.de", 4) + many("b@mail.paypal.de", 3)
            + many("c@paypal.de", 3))
    # one subdomain among the members: @domain protect would miss it
    assert smart(msgs)["o:paypal.de"]["domain"] == ""


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


def test_accounts_beats_category_and_category_beats_newsletter():
    msgs = (many("noreply@dhl.example", 2, subject="Verify your email")
            + many("noreply@dhlexpress.example", 2, subject="Your parcel",
                   unsub=True)
            + many("info@paypal-like.example", 2, subject="Offers",
                   unsub=True))
    place = placement(smart(msgs))
    assert place["noreply@dhl.example"] == "k:accounts"
    # category tag (shipping) before List-Unsubscribe and automated local part
    assert place["noreply@dhlexpress.example"] == "k:cat:shipping"
    # "paypal" -> finance
    assert place["info@paypal-like.example"] == "k:cat:finance"


def test_kind_order_after_categories():
    msgs = (many("promo@plain.example", 1, unsub=True)         # newsletter
            + many("noreply@auto.example", 1)                  # automated
            + many("no-reply@auto2.example", 1, unsub=True)    # 7 before 8
            + many("person@gmail.com", 1)                      # individuals
            + many("someone@random.example", 1))               # other
    place = placement(smart(msgs))
    assert place["promo@plain.example"] == "k:newsletter"
    assert place["noreply@auto.example"] == "k:notifications"
    assert place["no-reply@auto2.example"] == "k:newsletter"
    assert place["person@gmail.com"] == "k:individuals"
    assert place["someone@random.example"] == "k:other"


def test_unsub_and_automated_gmail_sender_prefers_notifications_over_individuals():
    # a freemail address with an automated local part: rule 8 before 9
    place = placement(smart(many("noreply@gmail.com", 1)))
    assert place["noreply@gmail.com"] == "k:notifications"


def test_custom_and_overridden_categories_decide_the_category_row():
    cats = mailops.effective_categories({"hobby": ["zzz"], "shipping": []})
    msgs = many("a@zzz.example", 1) + many("noreply@dhl.example", 1)
    rows = smart(msgs, cats=cats)
    place = placement(rows)
    assert place["a@zzz.example"] == "k:cat:hobby"
    assert rows["k:cat:hobby"]["category"] == "hobby"
    assert rows["k:cat:hobby"]["label"] == "hobby"
    # shipping disabled by the override: dhl falls through to automated
    assert place["noreply@dhl.example"] == "k:notifications"


def test_keys_labels_and_kinds_of_pooled_rows():
    rows = smart(many("a@paypal.de", 12 - 6) + many("b@paypal.de", 4)
                 + many("x@y.example", 1) + many("p@gmail.com", 1))
    assert rows["o:paypal.de"]["label"] == "paypal.de"
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
    add("a@paypal.de", 4)
    add("b@mail.paypal.de", 3)
    add("c@paypal.de", 3)
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
    assert set(rows) == {"s:big@bigshop.example", "o:paypal.de",
                         "k:accounts", "k:other"}
    for key in ("o:paypal.de", "k:accounts", "k:other"):
        r = rows[key]
        assert r["sub"] == ""                      # the UI words it
        assert r["kind"] and r["n_senders"] >= 1 and r["members"]
        assert "folders" not in r                  # UIDs stay server-side
    assert rows["k:other"]["n_senders"] == 3
    assert rows["o:paypal.de"]["members"] == [
        "a@paypal.de", "b@mail.paypal.de", "c@paypal.de"]
    # smart is just another grouping for the group endpoints
    mails = client.get("/api/group", params={
        "grouping": "smart", "key": "o:paypal.de"}).json()
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
    assert set(st["smart"]) == {"s:big@bigshop.example", "o:paypal.de",
                                "k:accounts"}
    assert st["smart"]["o:paypal.de"]["count"] == 10
    res = mailops.undo_last()
    assert res["restored"] == n


def test_partial_removal_updates_counts_without_reshuffling(tail):
    # drop one mail of the pool: the pool keeps its row even though it now
    # totals fewer than the threshold
    rec = mailops.STATE["groups"]["smart"]["o:paypal.de"]
    folder, uids = next(iter(rec["folders"].items()))
    with mailops.STATE_LOCK:
        mailops._apply_removal({folder: {uids[0]}}, accountsmod.get())
    rows = smart_state()
    assert rows["o:paypal.de"]["count"] == 9
    assert rows["o:paypal.de"]["kind"] == "company"
    sender_rows = mailops.STATE["groups"]["sender"]
    assert sum(s["count"] for k, s in sender_rows.items()
               if k.endswith("paypal.de")) == 9


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
    assert rows["o:paypal.de"]["count"] == 10
    # and it really acts on them: restored (unscanned) state deletes fine
    mailops.delete_groups("smart", ["o:paypal.de"], acc=acc2)
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

def _fake_ai(monkeypatch, sent):
    def create(**kw):
        payload = json.loads(kw["messages"][0]["content"])
        sent.append((kw.get("system"), payload))
        verdicts = [{"key": g["key"], "verdict": "delete_safe", "reason": "t"}
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
    assert rows["o:paypal.de"]["ai"]            # same member set -> kept
    assert rows["k:accounts"]["ai"]


# ------------------------------------------------- places that say no

def test_rules_reject_smart_but_keep_domain(tail):
    with pytest.raises(ValueError, match="bad grouping"):
        rulesmod.create_rule({"name": "n", "grouping": "smart", "query": ""})
    rule = rulesmod.create_rule({"name": "d", "grouping": "domain",
                                 "query": "domain:paypal.de",
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
                                        "key": "paypal.de"})
    assert r.status_code == 200


def test_domain_grouping_and_export_still_work(tail):
    groups = mailops.public_state()["groups"]
    assert "paypal.de" in groups["domain"]
    csv = client.get("/api/export", params={"grouping": "smart"}).text
    assert "k:other" in csv and "o:paypal.de" in csv
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
    assert "k:stale" not in rows and "o:paypal.de" in rows
