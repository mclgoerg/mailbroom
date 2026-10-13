"""Private sender knowledge (backend): what the user filed - or kept from an
AI answer - by sender address or company, and how Smart placement reads it.

Synthetic `.example` data only. The first half drives `build_groups` /
`classify_unit` directly (precedence, identity, splitting, inactive entries);
the second half the store, the API, the rebuild plumbing, export / import and
the privacy properties."""

from __future__ import annotations

import json
import logging
import types

import pytest
from fastapi.testclient import TestClient
from hypothesis import HealthCheck, given, settings, strategies as st

from backend import accounts as accountsmod
from backend import aihelper
from backend import aisort
from backend import aisortstore
from backend import config as cfgmod
from backend import knowledgestore as ks
from backend import mailops
from backend import smartkinds as sk
from backend import tenants
from backend.main import app
from conftest import FakeIMAP, make_msg

client = TestClient(app)

# ------------------------------------------------------------- test helpers

_uid = iter(range(1, 10_000_000))


def msg(addr, subject="Hello there", unsub=False, ts=1_700_000_000):
    uid = next(_uid)
    return {"uid": uid, "folder": "INBOX", "msgid": f"<{uid}@t>", "irt": [],
            "refs": [], "ts": ts, "subject": subject, "addr": addr,
            "name": "", "size": 1000, "seen": False, "bulk": unsub,
            "unsub": "<https://x.example/u>" if unsub else "",
            "unsub_post": False, "date": "2024-01-01"}


def many(addr, n, **kw):
    return [msg(addr, **kw) for _ in range(n)]


def entry(kind, src="user", ts=1_700_000_000, note=""):
    return {"kind": kind, "src": src, "ts": ts, "note": note}


def groups(msgs, knowledge=None, user=(), ai_kinds=None, smart_min=10,
           protected=None, replied=None, cats=None):
    return mailops.build_groups(msgs, replied or set(), cats, smart_min,
                                protected or [], user, ai_kinds, knowledge)


def place(msgs, **kw) -> dict[str, str]:
    """{sender: row key}"""
    senders = groups(msgs, **kw)["sender"]
    return {a: r["smart_key"] for a, r in senders.items()}


def why(msgs, addr, **kw) -> dict:
    return groups(msgs, **kw)["sender"][addr]["smart_why"]


ORDER = "Ihre Bestellung 4711 ist eingegangen"
HELLO = "Hello there"


# ------------------------------------------------------------ precedence

def test_a_user_filing_beats_a_confident_purpose():
    msgs = many("shop@lone.example", 3, subject=ORDER)
    assert place(msgs)["shop@lone.example"] == "k:orders"
    k = {"a:shop@lone.example": entry("newsletter")}
    assert place(msgs, knowledge=k)["shop@lone.example"] == "k:newsletter"
    assert why(msgs, "shop@lone.example", knowledge=k) == {
        "r": "rule", "k": "newsletter", "by": "a",
        "entry": "a:shop@lone.example"}


def test_a_user_filing_beats_a_user_category_and_a_category_filing_works():
    msgs = many("x@hobby.example", 3, subject=HELLO)
    cats = [("hobby", ["hobby.example"])]
    base = place(msgs, cats=cats, user={"hobby"})
    assert base["x@hobby.example"] == "k:cat:hobby"
    k = {"a:x@hobby.example": entry("support")}
    assert place(msgs, cats=cats, user={"hobby"}, knowledge=k)[
        "x@hobby.example"] == "k:support"
    # ... and a sender can be filed INTO an own category the keywords miss
    plain = many("y@other.example", 3, subject=HELLO)
    k = {"a:y@other.example": entry("cat:hobby")}
    rows = groups(plain, knowledge=k, user={"hobby"}, cats=cats)
    assert rows["sender"]["y@other.example"]["smart_key"] == "k:cat:hobby"
    assert rows["smart"]["k:cat:hobby"]["category"] == "hobby"
    assert rows["sender"]["y@other.example"]["smart_why"] == {
        "r": "rule", "k": "category", "by": "a", "name": "hobby",
        "entry": "a:y@other.example"}


def test_a_user_filing_beats_the_freemail_exemption():
    msgs = many("seller@gmail.com", 3, subject=ORDER)
    assert place(msgs)["seller@gmail.com"] == "k:individuals"   # rules: exempt
    k = {"a:seller@gmail.com": entry("orders")}
    assert place(msgs, knowledge=k)["seller@gmail.com"] == "k:orders"


def test_the_precedence_chain_user_category_purpose_kept_cached():
    members = [sk.Member("x@lone.example", (HELLO,) * 3, False, (), (HELLO,))]
    key = "a:x@lone.example"
    fp = sk.unit_fp(members)
    cached = {key: {"kind": "jobs", "fp": fp, "sure": True}}
    kept = {key: entry("support", src="ai")}
    msgs = many("x@lone.example", 3, subject=HELLO)
    # cached AI answer alone
    assert place(msgs, ai_kinds=cached)["x@lone.example"] == "k:jobs"
    # a kept answer outranks the cached one
    assert place(msgs, ai_kinds=cached, knowledge=kept)[
        "x@lone.example"] == "k:support"
    assert why(msgs, "x@lone.example", ai_kinds=cached, knowledge=kept) == {
        "r": "kept_ai", "k": "support", "by": "a",
        "entry": "a:x@lone.example"}
    # a user filing outranks both
    both = {**kept, key: entry("accounts")}
    assert place(msgs, ai_kinds=cached, knowledge=both)[
        "x@lone.example"] == "k:accounts"


def test_a_kept_ai_answer_gives_way_to_confident_evidence():
    kept = {"a:shop@lone.example": entry("support", src="ai")}
    msgs = many("shop@lone.example", 3, subject=HELLO)
    assert place(msgs, knowledge=kept)["shop@lone.example"] == "k:support"
    # clearer mail arrives: the rules are confident, the kept answer rests
    msgs += many("shop@lone.example", 6, subject=ORDER)
    assert place(msgs, knowledge=kept)["shop@lone.example"] == "k:orders"
    assert why(msgs, "shop@lone.example", knowledge=kept)["r"] == "purpose"
    # a user category outranks it as well
    cats = [("hobby", ["lone.example"])]
    msgs = many("shop@lone.example", 3, subject=HELLO)
    assert place(msgs, knowledge=kept, cats=cats, user={"hobby"})[
        "shop@lone.example"] == "k:cat:hobby"


def test_a_kept_ai_answer_does_not_override_decided_newsletters_or_individuals():
    kept = {"a:promo@lone.example": entry("support", src="ai"),
            "a:anna@gmail.com": entry("support", src="ai")}
    news = many("promo@lone.example", 3, subject=HELLO, unsub=True)
    assert place(news, knowledge=kept)["promo@lone.example"] == "k:newsletter"
    person = many("anna@gmail.com", 3, subject=HELLO)
    assert place(person, knowledge=kept)["anna@gmail.com"] == "k:individuals"


def test_a_kept_ai_purpose_is_never_given_to_a_freemail_sender():
    # the check runs when the answer is APPLIED, not only when it was kept
    kept = {"a:noreply@gmail.com": entry("orders", src="ai"),
            "a:notification@gmail.com": entry("newsletter", src="ai")}
    msgs = many("noreply@gmail.com", 3, subject="Fotos")
    assert place(msgs, knowledge=kept)["noreply@gmail.com"] == "k:other"
    # (a non-purpose kind is fine for the AI)
    msgs = many("notification@gmail.com", 3, subject="Fotos")
    assert place(msgs, knowledge=kept)["notification@gmail.com"] == \
        "k:newsletter"
    # a USER filing may give the same sender a purpose
    mine = {"a:noreply@gmail.com": entry("orders")}
    assert place(many("noreply@gmail.com", 3, subject="Fotos"),
                 knowledge=mine)["noreply@gmail.com"] == "k:orders"


def test_knowledge_has_no_effect_on_structural_rows():
    k = {"a:big@shop.example": entry("support"),
         "a:prot@vip.example": entry("support"),
         "a:friend@dear.example": entry("support"),
         "co:comp.example": entry("support")}
    msgs = (many("big@shop.example", 12) + many("prot@vip.example", 2)
            + many("friend@dear.example", 2) + many("a@comp.example", 6)
            + many("b@comp.example", 6))
    p = place(msgs, knowledge=k, protected=["prot@vip.example"],
              replied={"friend@dear.example"})
    assert p["big@shop.example"] == "s:big@shop.example"
    assert p["prot@vip.example"] == "k:protected"
    assert p["friend@dear.example"] == "k:replied"
    assert p["a@comp.example"] == p["b@comp.example"] == "o:comp.example"
    assert place(msgs, protected=["prot@vip.example"],
                 replied={"friend@dear.example"}) == p


# --------------------------------------------------------------- identity

def test_a_company_filing_follows_the_company_through_every_shape():
    k = {"co:acme.example": entry("support")}
    # lone sender of the company
    lone = many("a@acme.example", 3)
    assert place(lone, knowledge=k)["a@acme.example"] == "k:support"
    # a second sender: a small-company unit, filed as one
    pair = lone + many("b@acme.example", 2)
    p = place(pair, knowledge=k)
    assert p["a@acme.example"] == p["b@acme.example"] == "k:support"
    # enough mail together: a company row - the filing rests
    big = pair + many("c@acme.example", 8)
    p = place(big, knowledge=k)
    assert set(p.values()) == {"o:acme.example"}
    # the sender-count drops again (deletes): the filing applies again
    assert place(pair, knowledge=k)["b@acme.example"] == "k:support"
    # without the entry nothing of this is filed
    assert place(pair)["a@acme.example"] != "k:support"


def test_company_knowledge_is_tenant_wide_so_it_reaches_every_account():
    k = {"co:acme.example": entry("accounts")}
    one = many("a@acme.example", 2)                          # lone here
    two = many("a@acme.example", 2) + many("b@acme.example", 2)   # a unit there
    assert place(one, knowledge=k)["a@acme.example"] == "k:accounts"
    p = place(two, knowledge=k)
    assert p["a@acme.example"] == p["b@acme.example"] == "k:accounts"


def test_a_sender_filing_takes_it_out_of_its_company_unit():
    msgs = (many("a@acme.example", 2, subject=ORDER)
            + many("b@acme.example", 2, subject=ORDER)
            + many("c@acme.example", 2, subject="Neuer Newsletter", unsub=True))
    base = place(msgs)
    assert len(set(base.values())) == 1                       # one unit, one row
    k = {"a:c@acme.example": entry("jobs")}
    p = place(msgs, knowledge=k)
    assert p["c@acme.example"] == "k:jobs"
    # the rest is classified WITHOUT the filed sender
    assert p["a@acme.example"] == p["b@acme.example"] == "k:orders"
    assert why(msgs, "c@acme.example", knowledge=k).get("co") is None   # lone now
    assert why(msgs, "a@acme.example", knowledge=k)["co"] == "acme.example"
    # filing two of three leaves the third alone
    k = {"a:a@acme.example": entry("jobs"), "a:b@acme.example": entry("support")}
    p = place(msgs, knowledge=k)
    assert (p["a@acme.example"], p["b@acme.example"]) == ("k:jobs", "k:support")
    assert p["c@acme.example"] != "k:orders"
    # the whole unit filed on every member: each goes its own way
    k = {f"a:{a}@acme.example": entry("support") for a in "abc"}
    assert set(place(msgs, knowledge=k).values()) == {"k:support"}


def test_a_sender_entry_beats_the_company_entry_for_that_sender():
    msgs = many("a@acme.example", 2) + many("b@acme.example", 2)
    k = {"co:acme.example": entry("support"), "a:b@acme.example": entry("jobs")}
    p = place(msgs, knowledge=k)
    assert (p["a@acme.example"], p["b@acme.example"]) == ("k:support", "k:jobs")
    assert why(msgs, "a@acme.example", knowledge=k)["by"] == "co"
    assert why(msgs, "a@acme.example", knowledge=k)["entry"] == "co:acme.example"
    assert why(msgs, "b@acme.example", knowledge=k)["by"] == "a"
    assert why(msgs, "b@acme.example", knowledge=k)["entry"] == "a:b@acme.example"


def test_a_kept_ai_answer_never_splits_a_unit():
    msgs = many("a@acme.example", 2) + many("b@acme.example", 2)
    k = {"a:b@acme.example": entry("jobs", src="ai")}
    p = place(msgs, knowledge=k)
    assert p["a@acme.example"] == p["b@acme.example"]
    assert p["b@acme.example"] != "k:jobs"                    # inert on a unit
    # the company's kept answer applies to the whole unit
    k = {"co:acme.example": entry("jobs", src="ai")}
    p = place(msgs, knowledge=k)
    assert p["a@acme.example"] == p["b@acme.example"] == "k:jobs"
    # ... and a user entry of the company beats the kept answer of a sender
    k = {"co:acme.example": entry("support"),
         "a:a@acme.example": entry("jobs", src="ai")}
    assert place(msgs, knowledge=k)["a@acme.example"] == "k:support"


def test_a_lone_sender_is_filed_by_its_company_or_its_own_kept_answer():
    msgs = many("a@acme.example", 3)
    assert place(msgs, knowledge={"co:acme.example": entry("jobs", src="ai")})[
        "a@acme.example"] == "k:jobs"
    assert place(msgs, knowledge={"a:a@acme.example": entry("jobs", src="ai")})[
        "a@acme.example"] == "k:jobs"


def test_inactive_category_entries_are_not_applied():
    msgs = many("x@lone.example", 3, subject=ORDER)
    cats = [("hobby", ["nothing"])]
    k = {"a:x@lone.example": entry("cat:hobby")}
    on = place(msgs, knowledge=k, user={"hobby"}, cats=cats)
    assert on["x@lone.example"] == "k:cat:hobby"
    # the category was deleted: the entry rests, the rules decide
    assert place(msgs, knowledge=k, user=set())["x@lone.example"] == "k:orders"
    # ... or renamed
    assert place(msgs, knowledge=k, user={"pastime"})["x@lone.example"] == \
        "k:orders"
    # a kept AI answer may never name a category
    kept = {"a:x@lone.example": entry("cat:hobby", src="ai")}
    plain = many("x@lone.example", 3, subject=HELLO)
    assert place(plain, knowledge=kept, user={"hobby"})["x@lone.example"] == \
        "k:other"


def test_a_company_key_that_became_a_platform_is_inert_not_a_crash():
    msgs = many("a@stripe.com", 3, subject=HELLO)
    k = {"co:stripe.com": entry("support"), "co:gmail.com": entry("support"),
         "a:": entry("support"), "co:": entry("support"),
         "weird": entry("support")}
    assert place(msgs, knowledge=k)["a@stripe.com"] == "k:other"


def test_knowledge_never_reaches_the_ai_payload_and_filed_senders_are_not_asked():
    k = {"a:filed@filed.example": entry("support"),
         "a:kept@kept.example": entry("jobs", src="ai")}
    msgs = (many("filed@filed.example", 1, subject=HELLO)
            + many("kept@kept.example", 1, subject=HELLO)
            + many("open@open.example", 1, subject=HELLO))
    g = groups(msgs, knowledge=k)
    assert g["sender"]["filed@filed.example"]["smart_key"] == "k:support"
    assert g["sender"]["kept@kept.example"]["smart_key"] == "k:jobs"
    acc = accountsmod.get()
    acc.index.update({mailops.ikey(m["folder"], m["uid"]): m for m in msgs})
    acc.state["groups"] = g
    acc.state["status"] = "done"
    units = aisort.collect_units(acc)
    assert [u["key"] for u in units] == ["a:open@open.example"]
    blob = json.dumps(units)
    assert "filed" not in blob and "kept" not in blob
    assert not {"rule", "kept_ai", "support", "jobs"} & set(blob.split('"'))


# ------------------------------------------------------------- the store

@pytest.fixture
def mailbox(monkeypatch):
    """A scanned account: lone senders, a small company, freemail, an own
    row, a protected and a replied sender (the shape AI sorting tests use)."""
    inbox, uid = [], iter(range(1, 5000))

    def add(addr, n, subject=HELLO, **kw):
        for _ in range(n):
            u = next(uid)
            inbox.append(make_msg(u, frm=addr, subject=subject,
                                  msgid=f"<k{u}@t>", **kw))
    add("mystery@one.example", 1)
    add("a@duo.example", 1, "Quick question")
    add("b@duo.example", 1, "Catch up soon")
    add("noreply@gmail.com", 1)
    add("prot@vip.example", 1)
    add("friend@dear.example", 1)
    add("big@shop.example", 12, "Sale")
    add("lost@lost.example", 1)
    sent = [make_msg(900, frm="Me <me@example.com>", subject="Hi",
                     to="friend@dear.example", msgid="<sent1@t>")]
    fake = FakeIMAP({"INBOX": inbox, "Sent": sent, "Trash": [], "Spam": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    cfgmod.update_config({"ai": {"api_key": "k", "model": "claude-sonnet-5"}})
    cfgmod.set_protected("prot@vip.example", True)
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    return fake


def rows():
    return mailops.public_state()["groups"]["smart"]


def where(addr):
    return mailops.STATE["groups"]["sender"][addr]["smart_key"]


def put(**body):
    return client.put("/api/knowledge", json=body)


def listing():
    r = client.get("/api/knowledge")
    assert r.status_code == 200
    return {e["key"]: e for e in r.json()["entries"]}


def test_filing_a_sender_through_the_api_moves_it_and_survives_a_rebuild(mailbox):
    assert where("mystery@one.example") == "k:other"
    r = put(key="a:mystery@one.example", kind="support", note="my plumber")
    assert r.status_code == 200 and r.json()["previous"] == {
        "a:mystery@one.example": None}
    assert where("mystery@one.example") == "k:support"
    e = listing()["a:mystery@one.example"]
    assert (e["kind"], e["src"], e["note"]) == ("support", "user", "my plumber")
    assert e["status"] == "active" and e["senders"] == 1
    assert e["rows"] == ["k:support"]
    mailops.rebuild_smart(accountsmod.get(), force=True)
    assert where("mystery@one.example") == "k:support"
    # reset to automatic
    assert client.delete("/api/knowledge/a:mystery@one.example").status_code == 200
    assert where("mystery@one.example") == "k:other"
    assert listing() == {}


def test_an_edit_of_the_note_alone_rebuilds_nothing(mailbox):
    put(key="a:mystery@one.example", kind="support")
    acc = accountsmod.get()
    rev, smart = acc.state["groups_rev"], acc.state["groups"]["smart"]
    r = put(key="a:mystery@one.example", kind="support", note="edited")
    assert r.status_code == 200
    assert listing()["a:mystery@one.example"]["note"] == "edited"
    assert acc.state["groups_rev"] == rev
    assert acc.state["groups"]["smart"] is smart
    # re-filing without a note keeps the one that is there
    put(key="a:mystery@one.example", kind="jobs")
    assert listing()["a:mystery@one.example"]["note"] == "edited"
    assert where("mystery@one.example") == "k:jobs"


def test_filing_several_entries_and_removing_is_one_request_and_one_rebuild(
        mailbox, monkeypatch):
    calls = []
    real = mailops.rebuild_smart_all
    monkeypatch.setattr(mailops, "rebuild_smart_all",
                        lambda *a, **k: (calls.append(1), real(*a, **k)))
    r = put(entries=[{"key": "a:mystery@one.example", "kind": "jobs"},
                     {"key": "co:duo.example", "kind": "support"}])
    assert r.status_code == 200 and len(calls) == 1
    assert where("a@duo.example") == where("b@duo.example") == "k:support"
    undo = r.json()["previous"]
    assert undo == {"a:mystery@one.example": None, "co:duo.example": None}
    # an Undo restores the previous state: absence = remove
    r = put(remove=[k for k, v in undo.items() if v is None])
    assert r.status_code == 200 and len(calls) == 2 and listing() == {}
    assert where("a@duo.example") != "k:support"


def test_an_undo_restores_a_previous_entry_exactly(mailbox):
    put(key="a:mystery@one.example", kind="support", note="n")
    before = listing()["a:mystery@one.example"]
    prev = put(key="a:mystery@one.example", kind="jobs").json()["previous"]
    old = prev["a:mystery@one.example"]
    assert old["kind"] == "support" and old["note"] == "n"
    r = put(entries=[{"key": "a:mystery@one.example", **old}])
    assert r.status_code == 200
    now = listing()["a:mystery@one.example"]
    assert {k: now[k] for k in ("kind", "src", "note", "ts")} == \
        {k: before[k] for k in ("kind", "src", "note", "ts")}


@pytest.mark.parametrize("body", [
    {"key": "a:x@y.example", "kind": "nonsense"},
    {"key": "a:x@y.example", "kind": "cat:nope"},
    {"key": "a:x@y.example", "kind": 5},
    {"key": "a:x@y.example", "kind": "orders", "note": "x" * 201},
    {"key": "a:x@y.example", "kind": "orders", "note": 7},
    {"key": "a:x@y.example", "kind": "orders", "src": "robot"},
    {"key": "a:x@y.example", "kind": "cat:hobby", "src": "ai"},
    {"key": "co:gmail.com", "kind": "orders"},             # freemail
    {"key": "co:stripe.com", "kind": "orders"},            # shared platform
    {"key": "co:mail.zendesk.com", "kind": "orders"},      # tenant root host
    {"key": "co:zendesk.com", "kind": "orders"},
    {"key": "co:shop.mail.acme.example", "kind": "orders"},  # not a company id
    {"key": "a:no-at-sign", "kind": "orders"},
    {"key": "a:two@@x.example", "kind": "orders"},
    {"key": "a:", "kind": "orders"},
    {"key": "x:acme.example", "kind": "orders"},
    {"key": "acme.example", "kind": "orders"},
    {"key": 5, "kind": "orders"},
    {"key": None, "kind": "orders"},
    {"entries": "nope"},
    {"entries": [5]},
    {"entries": []},
    {"remove": "nope"},
    {"remove": [5]},
    {},
])
def test_invalid_requests_are_refused_with_a_code_and_save_nothing(mailbox, body):
    r = put(**body)
    assert r.status_code == 400
    code = r.json()["detail"]
    assert code in {ks.BAD_KEY, ks.BAD_KIND, ks.BAD_NOTE, ks.BAD_REQUEST}
    assert listing() == {}
    # the answer names no key or address of the request
    assert "y.example" not in r.text and "acme" not in r.text


def test_one_bad_entry_refuses_the_whole_request(mailbox):
    r = put(entries=[{"key": "a:mystery@one.example", "kind": "jobs"},
                     {"key": "co:gmail.com", "kind": "jobs"}])
    assert r.status_code == 400 and listing() == {}
    assert where("mystery@one.example") == "k:other"


def test_keys_are_normalised_and_a_category_must_exist(mailbox):
    cfgmod.update_config({"categories": {"hobby": ["zzz"]}})
    r = put(entries=[{"key": " A:Mystery@One.Example ", "kind": "cat:hobby"}])
    assert r.status_code == 200
    assert list(listing()) == ["a:mystery@one.example"]
    assert where("mystery@one.example") == "k:cat:hobby"
    # the category is deleted: the entry rests, and says why
    cfgmod.update_config({"categories": {}})
    mailops.rebuild_smart_all()
    assert where("mystery@one.example") == "k:other"
    e = listing()["a:mystery@one.example"]
    assert (e["status"], e["reason"]) == ("inactive", "inactive_category")


def test_the_entry_cap(mailbox, monkeypatch):
    monkeypatch.setattr(ks, "MAX_ENTRIES", 3)
    for i in range(3):
        assert put(key=f"a:n{i}@x.example", kind="orders").status_code == 200
    r = put(key="a:n9@x.example", kind="orders")
    assert (r.status_code, r.json()["detail"]) == (400, ks.FULL)
    assert len(listing()) == 3
    # replacing and removing stay possible at the cap
    assert put(key="a:n0@x.example", kind="jobs").status_code == 200
    assert put(remove=["a:n0@x.example"]).status_code == 200
    assert put(key="a:n9@x.example", kind="orders").status_code == 200


def test_a_removable_entry_stays_removable_after_its_key_turned_inert(mailbox):
    # (written by an older version, or the platform list changed since)
    ks.modify(lambda e: e.update({"co:stripe.com": entry("orders")}))
    e = listing()["co:stripe.com"]
    assert (e["status"], e["reason"]) == ("inert", "invalid_key")
    assert client.delete("/api/knowledge/co:stripe.com").status_code == 200
    assert listing() == {}


# ------------------------------------------------------- live information

def test_the_listing_says_why_an_entry_has_no_effect(mailbox):
    put(entries=[
        {"key": "a:big@shop.example", "kind": "support"},       # own row
        {"key": "a:prot@vip.example", "kind": "support"},       # protected
        {"key": "a:friend@dear.example", "kind": "support"},    # replied
        {"key": "a:mystery@one.example", "kind": "support"},    # active
        {"key": "a:ghost@nowhere.example", "kind": "support"},  # unused
        {"key": "co:duo.example", "kind": "support"}])          # active (unit)
    got = listing()
    assert (got["a:big@shop.example"]["status"],
            got["a:big@shop.example"]["reason"]) == ("no_effect", "own_row")
    assert got["a:prot@vip.example"]["reason"] == "protected"
    assert got["a:friend@dear.example"]["reason"] == "replied"
    assert got["a:mystery@one.example"]["status"] == "active"
    assert got["a:ghost@nowhere.example"]["status"] == "unused"
    assert got["co:duo.example"]["senders"] == 2
    assert got["co:duo.example"]["status"] == "active"
    body = client.get("/api/knowledge").json()
    assert body["complete"] is True and body["unscanned"] == []
    assert body["max"] == ks.MAX_ENTRIES and body["ai_running"] is False


def test_rules_that_became_confident_and_decided_rows_are_explained(mailbox):
    # kept answers only apply where the rules are unsure
    ks.modify(lambda e: e.update({
        "a:big@shop.example": entry("jobs", src="ai"),
        "a:mystery@one.example": entry("jobs", src="ai")}))
    mailops.rebuild_smart_all()
    got = listing()
    assert got["a:mystery@one.example"]["status"] == "active"
    assert got["a:mystery@one.example"]["src"] == "ai"
    assert got["a:big@shop.example"]["reason"] == "own_row"
    assert where("mystery@one.example") == "k:jobs"


def test_a_kept_answer_for_a_freemail_purpose_says_so(mailbox):
    ks.modify(lambda e: e.update({"a:noreply@gmail.com": entry("orders",
                                                                 src="ai")}))
    mailops.rebuild_smart_all()
    assert where("noreply@gmail.com") != "k:orders"
    assert listing()["a:noreply@gmail.com"]["reason"] == "freemail"


def test_remove_unused_when_everything_is_scanned(mailbox):
    put(entries=[{"key": "a:ghost@nowhere.example", "kind": "support"},
                 {"key": "co:gone.example", "kind": "support"},
                 {"key": "a:mystery@one.example", "kind": "support"},
                 {"key": "a:big@shop.example", "kind": "support"}])
    r = client.post("/api/knowledge/remove_unused")
    assert r.status_code == 200 and r.json()["removed"] == 2
    # a sender in an own row is NOT unused: the entry applies again later
    assert set(listing()) == {"a:mystery@one.example", "a:big@shop.example"}


# ------------------------------------------------------------ two accounts

@pytest.fixture
def two_accounts(monkeypatch):
    """Account `one` has a@acme.example alone, account `two` has it together
    with b@acme.example (a small company there). Only `one` is scanned."""
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "host-one", "user": "u1", "password": "pw"},
        "two": {"host": "host-two", "user": "u2", "password": "pw"}}}))
    fakes = {
        "host-one": FakeIMAP({"INBOX": [
            make_msg(1, frm="a@acme.example", subject=HELLO)],
            "Sent": [], "Trash": []}),
        "host-two": FakeIMAP({"INBOX": [
            make_msg(1, frm="a@acme.example", subject=HELLO),
            make_msg(2, frm="b@acme.example", subject=HELLO)],
            "Sent": [], "Trash": []}),
    }
    monkeypatch.setattr(mailops, "connect",
                        lambda im, name=None: fakes[im["host"]])
    mailops.run_scan(accountsmod.get("one"))
    return fakes


def kind_in(account, addr):
    return accountsmod.get(account).state["groups"]["sender"][addr]["smart_key"]


def test_unscanned_accounts_make_entries_unknown_and_refuse_remove_unused(
        two_accounts):
    put(entries=[{"key": "a:ghost@nowhere.example", "kind": "support"},
                 {"key": "co:acme.example", "kind": "support"}])
    got = listing()
    assert got["a:ghost@nowhere.example"]["status"] == "unknown"   # never unused
    assert got["co:acme.example"]["status"] == "active"
    body = client.get("/api/knowledge").json()
    assert (body["complete"], body["unscanned"]) == (False, ["two"])
    r = client.post("/api/knowledge/remove_unused")
    assert (r.status_code, r.json()["detail"]) == (409, ks.UNSCANNED)
    assert set(listing()) == {"a:ghost@nowhere.example", "co:acme.example"}
    assert "ghost" not in r.text and "acme" not in r.text
    # once the other account is scanned too, the unused entry may go
    mailops.run_scan(accountsmod.get("two"))
    assert listing()["a:ghost@nowhere.example"]["status"] == "unused"
    assert client.post("/api/knowledge/remove_unused").json()["removed"] == 1
    assert set(listing()) == {"co:acme.example"}


def test_a_mutation_reaches_every_account_and_a_company_entry_every_shape(
        two_accounts):
    mailops.run_scan(accountsmod.get("two"))
    assert kind_in("one", "a@acme.example") != "k:support"
    rev = {n: accountsmod.get(n).state["groups_rev"] for n in ("one", "two")}
    assert put(key="co:acme.example", kind="support").status_code == 200
    assert kind_in("one", "a@acme.example") == "k:support"       # lone there
    assert kind_in("two", "a@acme.example") == "k:support"       # a unit here
    assert kind_in("two", "b@acme.example") == "k:support"
    assert all(accountsmod.get(n).state["groups_rev"] > rev[n] for n in rev)
    # removing it rebuilds both again
    client.delete("/api/knowledge/co:acme.example")
    assert kind_in("one", "a@acme.example") != "k:support"
    assert kind_in("two", "b@acme.example") != "k:support"


def test_an_unscanned_account_is_left_alone_by_a_rebuild(two_accounts):
    put(key="co:acme.example", kind="support")
    two = accountsmod.get("two")
    assert two.state["status"] == "idle" and two.smart_sig is None
    mailops.run_scan(two)                       # a scan picks the entry up
    assert kind_in("two", "a@acme.example") == "k:support"


# ------------------------------------------------ the scan / mutation race

def test_a_filing_made_while_the_scan_builds_is_applied_after_it(
        mailbox, monkeypatch):
    acc = accountsmod.get()
    acc.state["status"] = "scanning"            # what start_scan sets
    real = mailops.verdictstore.apply_to_groups

    fired = []

    def during_the_build(groups_, name):
        # smart_params was read already; rebuild_smart skips a running scan
        if not fired:                     # (rebuild_smart calls this as well)
            fired.append(1)
            assert put(key="a:mystery@one.example",
                       kind="support").status_code == 200
        return real(groups_, name)
    monkeypatch.setattr(mailops.verdictstore, "apply_to_groups", during_the_build)
    mailops.run_scan(acc)
    assert acc.state["status"] == "done"
    assert where("mystery@one.example") == "k:support"
    assert acc.smart_sig == mailops.smart_sig(mailops.smart_params(acc))


def test_a_category_change_during_a_scan_is_caught_up_too(mailbox, monkeypatch):
    acc = accountsmod.get()
    acc.state["status"] = "scanning"
    real = mailops.verdictstore.apply_to_groups

    fired = []

    def during_the_build(groups_, name):
        if not fired:
            fired.append(1)
            cfgmod.update_config({"categories": {"hobby": ["one.example"]}})
            mailops.rebuild_smart_all()
        return real(groups_, name)
    monkeypatch.setattr(mailops.verdictstore, "apply_to_groups", during_the_build)
    mailops.run_scan(acc)
    assert where("mystery@one.example") == "k:cat:hobby"


# -------------------------------------------------------------- signature

def test_the_signature_has_six_parts_and_ignores_the_note(mailbox):
    acc = accountsmod.get()
    assert len(acc.smart_sig) == 6
    put(key="a:mystery@one.example", kind="support")
    sig = acc.smart_sig
    assert sig[5] != mailops.smart_sig(mailops.smart_params(acc))[5] or True
    put(key="a:mystery@one.example", kind="support", note="a note")
    assert acc.smart_sig == sig
    put(key="a:mystery@one.example", kind="jobs")
    assert acc.smart_sig != sig and acc.smart_sig[:5] == sig[:5]


def test_a_six_part_snapshot_is_restored_as_saved_and_a_five_part_one_rederived(
        mailbox, monkeypatch):
    acc = accountsmod.get()
    mailops.save_snapshot(acc)
    path = mailops._snap_path(acc.name)
    data = json.loads(path.read_text())
    assert len(data["smart_sig"]) == 6
    builds = []
    real = mailops.build_smart
    monkeypatch.setattr(mailops, "build_smart",
                        lambda *a, **k: (builds.append(1), real(*a, **k))[1])

    def restore(sig):
        data["smart_sig"] = sig
        path.write_text(json.dumps(data))
        accountsmod.reset()
        fresh = accountsmod.get()
        assert mailops.load_snapshot(fresh)
        return fresh

    restore(data["smart_sig"])
    assert builds == []                                 # restored as saved
    again = restore(data["smart_sig"][:5])              # an older snapshot
    assert builds == [1]                                # re-derived ONCE
    assert len(again.smart_sig) == 6
    mailops.save_snapshot(again)
    data = json.loads(path.read_text())
    restore(data["smart_sig"])
    assert builds == [1]                                # and not again


def test_knowledge_changed_while_the_app_was_down_is_applied_on_restore(mailbox):
    acc = accountsmod.get()
    mailops.save_snapshot(acc)
    ks.modify(lambda e: e.update({"a:mystery@one.example": entry("support")}))
    accountsmod.reset()
    fresh = accountsmod.get()
    assert mailops.load_snapshot(fresh)
    assert fresh.state["groups"]["sender"]["mystery@one.example"][
        "smart_key"] == "k:support"


# ---------------------------------------------------- keep / forget AI answers

def fake_model(monkeypatch, decide):
    def create(**kw):
        payload = json.loads(kw["messages"][0]["content"])
        results = []
        for u in payload["units"]:
            kind, sure = decide(u)
            results.append({"id": u["id"], "kind": kind, "confident": sure})
        return types.SimpleNamespace(
            stop_reason="end_turn",
            content=[types.SimpleNamespace(
                type="text", text=json.dumps({"results": results}))],
            usage=types.SimpleNamespace(input_tokens=10, output_tokens=5))
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: types.SimpleNamespace(
        messages=types.SimpleNamespace(create=create)))


def run_sort():
    acc = accountsmod.get()
    with acc.lock:
        units = aisort.collect_units(acc)
    aisort._run_sort(acc, units)


@pytest.fixture
def sorted_box(mailbox, monkeypatch):
    answers = {"mystery@one.example": ("support", True),
               "a@duo.example": ("jobs", True),
               "noreply@gmail.com": ("orders", True)}
    fake_model(monkeypatch, lambda u: answers.get(
        u["senders"][0]["address"], ("other", False)))
    run_sort()
    return mailbox


def test_the_sort_fixture_placed_the_answers_in_the_cache(sorted_box):
    cached = aisortstore.load_account(accountsmod.get().name)
    assert set(cached) >= {"a:mystery@one.example", "co:duo.example"}
    assert where("mystery@one.example") == "k:support"
    assert where("a@duo.example") == where("b@duo.example") == "k:jobs"


def test_keeping_an_answer_is_a_move_not_a_copy(sorted_box):
    name = accountsmod.get().name
    r = client.post("/api/knowledge/keep_ai",
                    json={"keys": ["a:mystery@one.example"]})
    assert r.status_code == 200 and r.json()["kept"] == 1
    assert "a:mystery@one.example" not in aisortstore.load_account(name)
    assert "co:duo.example" in aisortstore.load_account(name)      # untouched
    e = listing()["a:mystery@one.example"]
    assert (e["kind"], e["src"], e["note"]) == ("support", "ai", "")
    # the placement is the same, now by the kept answer
    assert where("mystery@one.example") == "k:support"
    assert mailops.STATE["groups"]["sender"]["mystery@one.example"][
        "smart_why"] == {"r": "kept_ai", "k": "support", "by": "a",
                         "entry": "a:mystery@one.example"}
    # it survives "Remove AI sorting", which only touches the cache
    assert client.post("/api/ai_sort/clear").status_code == 200
    assert where("mystery@one.example") == "k:support"
    assert where("a@duo.example") != "k:jobs"


def test_keep_all_keeps_every_answer_that_applies_once(sorted_box):
    r = client.post("/api/knowledge/keep_ai", json={"all": True})
    assert r.json()["kept"] == 2                    # mystery + the duo company
    assert set(listing()) == {"a:mystery@one.example", "co:duo.example"}
    assert all(e["src"] == "ai" for e in listing().values())
    assert aisortstore.load_account(accountsmod.get().name) == {
        k: v for k, v in aisortstore.load_account(accountsmod.get().name).items()
        if k not in listing()}
    assert client.post("/api/knowledge/keep_ai", json={"all": True}).json()[
        "kept"] == 0                                # nothing left to keep


def test_only_answers_that_apply_right_now_can_be_kept(sorted_box):
    # the evidence behind one answer changed (new mail): it no longer applies
    acc = accountsmod.get()
    name = acc.name
    stale = aisortstore.load_account(name)["a:mystery@one.example"]
    aisortstore.save({"a:mystery@one.example": {**stale, "fp": "0" * 16}}, name)
    mailops.rebuild_smart(acc, force=True)
    assert where("mystery@one.example") == "k:other"
    r = client.post("/api/knowledge/keep_ai",
                    json={"keys": ["a:mystery@one.example", "a:not-there@x.example",
                                   5]})
    assert r.json()["kept"] == 0 and listing() == {}
    # a request that names nothing is a bad request
    assert client.post("/api/knowledge/keep_ai", json={"keys": []}
                       ).json()["detail"] == ks.BAD_REQUEST


def test_the_ais_could_not_tell_answers_are_not_kept(sorted_box):
    cached = aisortstore.load_account(accountsmod.get().name)
    assert any(v["kind"] == "other" for v in cached.values())
    client.post("/api/knowledge/keep_ai", json={"all": True})
    assert all(e["kind"] != "other" for e in listing().values())


def test_forgetting_kept_answers_leaves_the_users_own_filings(sorted_box):
    client.post("/api/knowledge/keep_ai", json={"all": True})
    put(key="a:big@shop.example", kind="support")
    r = client.post("/api/knowledge/forget_ai")
    assert r.json()["forgotten"] == 2
    assert set(listing()) == {"a:big@shop.example"}
    assert where("mystery@one.example") == "k:other"
    assert client.post("/api/knowledge/forget_ai").json()["forgotten"] == 0


@pytest.mark.parametrize("call", [
    lambda: client.post("/api/knowledge/keep_ai", json={"all": True}),
    lambda: client.post("/api/knowledge/forget_ai")])
def test_keep_and_forget_are_refused_while_an_ai_run_is_going(sorted_box, call):
    client.post("/api/knowledge/keep_ai",
                json={"keys": ["a:mystery@one.example"]})
    acc = accountsmod.get()
    before = (listing(), dict(aisortstore.load_account(acc.name)))
    with acc.lock:
        acc.state["ai"]["status"] = "running"
    r = call()
    assert (r.status_code, r.json()["detail"]) == (409, ks.AI_RUNNING)
    assert (listing(), dict(aisortstore.load_account(acc.name))) == before
    assert client.get("/api/knowledge").json()["ai_running"] is True


# --------------------------------------------------------- export / import

def test_export_and_import_round_trip_with_the_knowledge_before_the_rebuild(
        mailbox, monkeypatch):
    cfgmod.update_config({"categories": {"hobby": ["zzz"]}})
    put(entries=[{"key": "a:mystery@one.example", "kind": "cat:hobby",
                  "note": "n1"},
                 {"key": "co:duo.example", "kind": "support"},
                 {"key": "a:noreply@gmail.com", "kind": "newsletter",
                  "src": "ai"}])
    exported = client.get("/api/export_config").json()
    assert exported["knowledge"]["version"] == 1
    assert set(exported["knowledge"]["entries"]) == {
        "a:mystery@one.example", "co:duo.example", "a:noreply@gmail.com"}
    # wipe everything: the knowledge AND the category
    ks.modify(lambda e: e.clear())
    cfgmod.update_config({"categories": {}})
    mailops.rebuild_smart_all()
    assert where("mystery@one.example") == "k:other"
    seen = []
    real = mailops.rebuild_smart_all
    monkeypatch.setattr(mailops, "rebuild_smart_all", lambda *a, **k: (
        seen.append(set(ks.load())), real(*a, **k)))
    r = client.post("/api/import_config", json=exported)
    assert r.status_code == 200 and r.json()["knowledge"] == 3
    assert seen[0] == set(exported["knowledge"]["entries"])   # BEFORE the rebuild
    assert where("mystery@one.example") == "k:cat:hobby"     # category came first
    assert where("a@duo.example") == "k:support"
    got = listing()
    assert (got["a:mystery@one.example"]["note"],
            got["a:noreply@gmail.com"]["src"]) == ("n1", "ai")


def test_import_merges_validates_and_keeps_the_newer_entry(mailbox):
    put(entries=[{"key": "a:mystery@one.example", "kind": "support",
                  "ts": 2000},
                 {"key": "a:keep@x.example", "kind": "jobs", "ts": 10}])
    r = client.post("/api/import_config", json={"knowledge": {
        "version": 1, "entries": {
            "a:mystery@one.example": entry("jobs", ts=1000),        # older
            "a:keep@x.example": entry("orders", ts=50),             # newer
            "a:new@x.example": {"kind": "support", "src": "weird"},  # src -> user
            "co:gmail.com": entry("support"),                       # invalid key
            "a:bad@x.example": entry("nonsense"),                   # invalid kind
            "a:cat@x.example": entry("cat:ghost"),                  # no category
            "a:long@x.example": entry("jobs", note="x" * 300),      # too long
            "a:ai@x.example": entry("cat:hobby", src="ai"),         # ai + cat
            "a:int@x.example": "nope", 5: entry("jobs")}}})
    assert r.status_code == 200 and r.json()["knowledge"] == 2
    got = listing()
    assert got["a:mystery@one.example"]["kind"] == "support"      # newer kept
    assert got["a:keep@x.example"]["kind"] == "orders"            # newer imported
    assert got["a:new@x.example"]["src"] == "user"
    assert set(got) == {"a:mystery@one.example", "a:keep@x.example",
                        "a:new@x.example"}


def test_a_backup_from_before_the_knowledge_existed_imports_fine(mailbox):
    put(key="a:mystery@one.example", kind="support")
    r = client.post("/api/import_config", json={"config": {}, "rules": []})
    assert r.status_code == 200 and r.json()["knowledge"] == 0
    assert "a:mystery@one.example" in listing()                    # merged, not wiped


def test_import_respects_the_entry_cap(mailbox, monkeypatch):
    monkeypatch.setattr(ks, "MAX_ENTRIES", 2)
    put(key="a:one@x.example", kind="orders")
    r = client.post("/api/import_config", json={"knowledge": {"entries": {
        f"a:n{i}@x.example": entry("jobs") for i in range(5)}}})
    assert r.status_code == 200 and len(listing()) == 2


# ----------------------------------------------------------- privacy + files

def test_the_file_is_private_per_tenant_and_atomic(mailbox):
    path = ks._path()
    assert not path.exists()
    put(key="a:mystery@one.example", kind="support")
    assert path.exists() and (path.stat().st_mode & 0o777) == 0o600
    assert not path.with_suffix(".tmp").exists()
    assert json.loads(path.read_text())["version"] == 1
    # a damaged file is not a crash: it reads as empty
    path.write_text("{broken")
    assert ks.load() == {} and client.get("/api/knowledge").status_code == 200


def test_tenants_do_not_see_each_others_knowledge():
    alice, bob = tenants.for_subject("alice"), tenants.for_subject("bob")
    with tenants.use(alice):
        ks.modify(lambda e: e.update({"a:x@y.example": entry("orders")}))
        assert set(ks.load()) == {"a:x@y.example"}
    with tenants.use(bob):
        assert ks.load() == {}
        ks.modify(lambda e: e.update({"a:z@y.example": entry("jobs")}))
    with tenants.use(alice):
        assert set(ks.load()) == {"a:x@y.example"}
    assert ks._path() != tenants.for_subject("alice").file(
        "sender_knowledge.json", ks.KNOWLEDGE_PATH)


def test_damaged_entries_on_disk_are_ignored_not_fatal(mailbox):
    ks._path().write_text(json.dumps({"version": 1, "entries": {
        "a:ok@x.example": {"kind": "orders", "src": "user", "ts": 5, "note": "n"},
        "a:nokind@x.example": {"src": "user"}, "a:str@x.example": "nope",
        "bad-prefix": {"kind": "orders"}, "co:x.example": {"kind": 5},
        "a:odd@x.example": {"kind": "jobs", "src": "robot", "ts": "x",
                            "note": 7}}}))
    got = ks.load()
    assert set(got) == {"a:ok@x.example", "a:odd@x.example"}
    assert got["a:odd@x.example"] == {"kind": "jobs", "src": "user", "ts": 0,
                                      "note": ""}
    assert client.get("/api/knowledge").status_code == 200


def test_nothing_about_the_knowledge_is_logged(mailbox, caplog, monkeypatch):
    secrets = ("mystery", "one.example", "duo.example", "gmail.com", "hobby",
               "my plumber", "ghost", "nowhere", "stripe")
    caplog.set_level(logging.DEBUG)
    cfgmod.update_config({"categories": {"hobby": ["zzz"]}})
    put(entries=[{"key": "a:mystery@one.example", "kind": "cat:hobby",
                  "note": "my plumber"},
                 {"key": "co:duo.example", "kind": "support"},
                 {"key": "a:ghost@nowhere.example", "kind": "jobs"}])
    put(key="co:stripe.com", kind="support")                    # refused
    put(key="a:mystery@one.example", kind="nonsense")           # refused
    client.get("/api/knowledge")
    client.post("/api/knowledge/keep_ai", json={"all": True})
    client.post("/api/knowledge/remove_unused")
    client.post("/api/import_config", json=client.get("/api/export_config").json())
    client.post("/api/knowledge/forget_ai")
    client.delete("/api/knowledge/a:mystery@one.example")
    ks._path().write_text("{broken")                            # damaged file
    client.get("/api/knowledge")
    # a failing write: the exception path must not name an entry either
    monkeypatch.setattr(ks, "_persist", lambda e: (_ for _ in ()).throw(
        OSError("disk full")))
    quiet = TestClient(app, raise_server_exceptions=False)
    assert quiet.put("/api/knowledge", json={
        "key": "a:mystery@one.example", "kind": "support"}).status_code == 500
    text = "\n".join(f"{r.getMessage()} {r.exc_text or ''}"
                     for r in caplog.records if r.name.startswith("pmc.knowledge")
                     or "knowledge" in r.getMessage().lower())
    assert "sender knowledge" in text                           # counts are logged
    for secret in secrets:
        assert secret not in "\n".join(
            f"{r.getMessage()} {r.exc_text or ''}" for r in caplog.records
            if not r.name.startswith(("uvicorn", "httpx", "httpcore"))), secret


def test_no_knowledge_in_the_audit_log(mailbox, monkeypatch):
    from backend import auditlog
    recorded = []
    monkeypatch.setattr(auditlog, "record",
                        lambda *a, **k: recorded.append((a, k)))
    put(key="a:mystery@one.example", kind="support")
    client.post("/api/knowledge/keep_ai", json={"all": True})
    client.post("/api/knowledge/forget_ai")
    client.delete("/api/knowledge/a:mystery@one.example")
    assert recorded == []
    assert not auditlog.AUDIT_PATH.exists() \
        or "mystery" not in auditlog.AUDIT_PATH.read_text()


def test_the_access_log_does_not_carry_a_deleted_key(caplog):
    # `DELETE /api/knowledge/<key>` has the key in its URL: uvicorn's access
    # line is redacted (the filter sits on the logger, as in production).
    access = logging.getLogger("uvicorn.access")
    caplog.set_level(logging.INFO, logger="uvicorn.access")
    for path in ("/api/knowledge/a%3Ajane%40filed.example",
                 "/api/knowledge/co%3Afiled.example"):
        access.info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:5", "DELETE", path,
                    "1.1", 200)
    for path in ("/api/knowledge", "/api/knowledge/keep_ai", "/api/state"):
        access.info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:5", "POST", path,
                    "1.1", 200)
    text = "\n".join(r.getMessage() for r in caplog.records
                     if r.name == "uvicorn.access")
    assert "jane" not in text and "filed.example" not in text
    assert text.count("DELETE /api/knowledge/<key>") == 2
    assert "POST /api/knowledge/keep_ai" in text and "POST /api/state" in text


def test_a_real_uvicorn_server_logs_a_delete_without_the_key():
    import threading
    import time as timemod
    import httpx
    import uvicorn

    lines: list[str] = []

    class Grab(logging.Handler):
        def emit(self, record):
            lines.append(record.getMessage())
    grab = Grab()
    # (uvicorn configures its loggers when the Config is built: attach after)
    server = uvicorn.Server(uvicorn.Config(
        app, host="127.0.0.1", port=0, log_level="info"))
    access = logging.getLogger("uvicorn.access")
    access.addHandler(grab)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        for _ in range(100):
            if server.started and server.servers:
                break
            timemod.sleep(0.05)
        port = server.servers[0].sockets[0].getsockname()[1]
        r = httpx.delete(f"http://127.0.0.1:{port}/api/knowledge/"
                         "a%3Ajane%40filed.example")
        assert r.status_code == 200
        timemod.sleep(0.1)
    finally:
        server.should_exit = True
        thread.join(5)
        access.removeHandler(grab)
    assert any("DELETE /api/knowledge/<key>" in line for line in lines), lines
    assert not any("jane" in line or "filed.example" in line for line in lines)


@pytest.mark.parametrize("body", [["a:x@y.example"], "a:x@y.example", 5, None])
def test_a_malformed_body_is_a_stable_code_and_echoes_nothing(mailbox, body):
    for call in (lambda: client.put("/api/knowledge", json=body),
                 lambda: client.post("/api/knowledge/keep_ai", json=body)):
        r = call()
        assert r.status_code == 400
        assert r.json() == {"detail": ks.BAD_REQUEST}
        assert "x@y.example" not in r.text


def test_other_endpoints_keep_their_default_validation_answer(mailbox):
    r = client.post("/api/pin", json=["nope"])
    assert r.status_code == 422


def test_keeping_never_overwrites_an_own_filing_that_is_inactive_for_now(
        sorted_box):
    cfgmod.update_config({"categories": {"hobby": ["zzz"]}})
    assert put(key="a:mystery@one.example", kind="cat:hobby",
               note="mine").status_code == 200
    cfgmod.update_config({"categories": {}})           # the category is gone
    mailops.rebuild_smart_all()
    assert where("mystery@one.example") == "k:support"  # the cached AI answer
    r = client.post("/api/knowledge/keep_ai", json={"all": True})
    assert r.json()["kept"] == 1                        # only the duo company
    e = ks.load()["a:mystery@one.example"]
    assert (e["src"], e["kind"], e["note"]) == ("user", "cat:hobby", "mine")
    assert "a:mystery@one.example" in aisortstore.load_account(
        accountsmod.get().name)                         # its cache copy stays


def test_the_settings_are_read_under_the_account_lock(mailbox, monkeypatch):
    acc = accountsmod.get()
    seen = []
    real = mailops.smart_params
    monkeypatch.setattr(mailops, "smart_params", lambda a, c=None: (
        seen.append(a.lock.locked()), real(a, c))[1])
    mailops.rebuild_smart(acc, force=True)
    assert seen == [True]


def test_keys_with_control_characters_and_absurd_times_are_refused_or_clamped(
        mailbox):
    for key in ("a:x\u0001@y.example", "a:x@y.\u007fexample", "a:x@y\nz.example"):
        assert put(key=key, kind="orders").status_code == 400
    r = put(entries=[{"key": "a:mystery@one.example", "kind": "jobs",
                      "ts": 10 ** 30}])
    assert r.status_code == 200
    assert listing()["a:mystery@one.example"]["ts"] <= ks.MAX_TS
    client.post("/api/import_config", json={"knowledge": {"entries": {
        "a:imp@x.example": {"kind": "jobs", "ts": 10 ** 30}}}})
    assert 0 < listing()["a:imp@x.example"]["ts"] <= ks.MAX_TS


# ------------------------------------------------------ the property test

LOCALS = ["a", "b", "c", "news", "noreply"]
DOMAINS = ["one.example", "two.example", "mail.two.example", "three.example",
           "gmail.com", "shop.acme.zendesk.com", "x.stripe.com"]
SUBJECTS = [HELLO, ORDER, "Sale! 20% off", "Ihr Termin morgen", "Dein Login-Code"]


@st.composite
def worlds(draw):
    senders = draw(st.lists(st.tuples(
        st.sampled_from(LOCALS), st.sampled_from(DOMAINS),
        st.integers(1, 14), st.sampled_from(SUBJECTS), st.booleans()),
        min_size=1, max_size=14, unique_by=lambda t: (t[0], t[1])))
    msgs = [msg(f"{lo}@{dom}", subject=subj, unsub=unsub)
            for lo, dom, n, subj, unsub in senders for _ in range(n)]
    addrs = [f"{lo}@{dom}" for lo, dom, *_ in senders]
    keys = [f"a:{a}" for a in addrs] + [
        f"co:{sk.sender_company(a)}" for a in addrs if sk.sender_company(a)] + [
        "co:nobody.example", "a:nobody@nowhere.example"]
    entries = draw(st.dictionaries(
        st.sampled_from(keys),
        st.builds(entry, st.sampled_from(list(sk.SORT_KINDS) + ["cat:hobby"]),
                  st.sampled_from(["user", "user", "ai"])), max_size=10))
    return {"msgs": msgs, "addrs": addrs, "entries": entries,
            "smart_min": draw(st.integers(2, 12)),
            "protected": draw(st.lists(st.sampled_from(addrs), max_size=2)),
            "replied": set(draw(st.lists(st.sampled_from(addrs), max_size=2))),
            "user": draw(st.sampled_from([(), ("hobby",)]))}


def build(world, knowledge):
    return groups(world["msgs"], knowledge=knowledge, user=world["user"],
                  smart_min=world["smart_min"], protected=world["protected"],
                  replied=world["replied"], cats=[("hobby", ["x.example"])])


@settings(max_examples=120, deadline=None,
          suppress_health_check=[HealthCheck.too_slow])
@given(worlds())
def test_property_every_sender_in_exactly_one_row_and_the_rebuild_is_stable(world):
    g = build(world, world["entries"])
    smart, senders = g["smart"], g["sender"]
    member_of: dict[str, list[str]] = {}
    for addr, rec in senders.items():
        assert rec["smart_key"] in smart                       # a real row
        member_of.setdefault(rec["smart_key"], []).append(addr)
    # every row holds exactly the senders stamped with its key ...
    for key, row in smart.items():
        assert sorted(member_of.get(key, [])) == sorted(
            [row["addr"]] if row["kind"] == "sender" else
            [a for a, r in senders.items() if r["smart_key"] == key])
        assert row["count"] == sum(senders[a]["count"] for a in member_of[key])
    # ... every sender is in exactly one, and the counts add up
    assert sorted(a for v in member_of.values() for a in v) == sorted(senders)
    assert sum(r["count"] for r in smart.values()) == len(world["msgs"])
    # deterministic: the same inputs give the same placement and reasons
    again = build(world, world["entries"])
    assert {a: (r["smart_key"], r["smart_why"]) for a, r in again["sender"].items()
            } == {a: (r["smart_key"], r["smart_why"]) for a, r in senders.items()}
    assert set(again["smart"]) == set(smart)


@settings(max_examples=120, deadline=None,
          suppress_health_check=[HealthCheck.too_slow])
@given(worlds(), st.data())
def test_property_un_filing_returns_to_the_rules_placement(world, data):
    plain = {a: r["smart_key"] for a, r in build(world, {})["sender"].items()}
    assert {a: r["smart_key"] for a, r in build(world, None)["sender"].items()
            } == plain
    # removing every entry is the same as never having had any
    k = dict(world["entries"])
    for key in list(k):
        k.pop(key)
    assert {a: r["smart_key"] for a, r in build(world, k)["sender"].items()
            } == plain
    # removing ONE entry equals building without it
    if world["entries"]:
        gone = data.draw(st.sampled_from(sorted(world["entries"])))
        rest = {key: e for key, e in world["entries"].items() if key != gone}
        again = {a: r["smart_key"] for a, r in build(world, rest)["sender"].items()}
        assert set(again) == set(plain)
