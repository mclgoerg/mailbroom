"""AI sorting of the senders the rules left in Smart's Other row.

The model is a fake: what matters is WHAT is sent (metadata only, a few
subjects), WHO may be sorted (only Other units the rules were unsure about),
that the answer is only ever a placement from a fixed set of kinds, that it
is cached by evidence and removable, and that cost / cancel are respected."""

import json
import time
import types

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import aihelper
from backend import aisort
from backend import aisortstore
from backend import config as cfgmod
from backend import mailops
from backend import smartkinds as sk
from backend.main import app
from conftest import FakeIMAP, make_msg

client = TestClient(app)


def box(extra=()):
    inbox, uid = [], iter(range(1, 5000))

    def add(addr, n, subject="Hello there", **kw):
        for i in range(n):
            u = next(uid)
            inbox.append(make_msg(u, frm=addr, subject=subject if isinstance(
                subject, str) else subject[i % len(subject)], msgid=f"<s{u}@t>",
                **kw))
    add("mystery@one.example", 1, "Hello there")                  # none
    add("mixed@two.example", 4, ["Ihre Bestellung 1", "Hi", "Hi", "Hi"])  # weak
    add("a@duo.example", 1, "Quick question")
    add("b@duo.example", 1, "Catch up soon")                      # a small company
    add("noreply@gmail.com", 1, "Hello there")                    # freemail, none
    add("prot@vip.example", 1, "Hello there")                     # protected
    add("friend@dear.example", 1, "Hello there")                  # replied
    add("forum@board.example", 3, "[Forum] Neue Frage", unsub="<https://x/u>")
    add("big@shop.example", 12, "Sale")                           # own row
    for fn in extra:
        fn(add)
    return inbox


@pytest.fixture
def mailbox(monkeypatch):
    sent = [make_msg(900, frm="Me <me@example.com>", subject="Hi", to="friend@dear.example",
                     msgid="<sent1@t>")]
    fake = FakeIMAP({"INBOX": box(), "Sent": sent, "Trash": [], "Spam": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    cfgmod.update_config({"ai": {"api_key": "k", "model": "claude-sonnet-5"}})
    cfgmod.set_protected("prot@vip.example", True)
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    return fake


def sender(addr):
    return mailops.STATE["groups"]["sender"][addr]


def smart_rows():
    return mailops.public_state()["groups"]["smart"]


def fake_model(monkeypatch, decide, tokens=(1000, 200)):
    """decide(unit payload) -> (kind, confident). Records every call."""
    calls = []

    def create(**kw):
        payload = json.loads(kw["messages"][0]["content"])
        calls.append({"system": kw["system"], "units": payload["units"]})
        results = []
        for u in payload["units"]:
            kind, sure = decide(u)
            results.append({"id": u["id"], "kind": kind, "confident": sure})
        return types.SimpleNamespace(
            stop_reason="end_turn",
            content=[types.SimpleNamespace(
                type="text", text=json.dumps({"results": results}))],
            usage=types.SimpleNamespace(input_tokens=tokens[0],
                                        output_tokens=tokens[1]))
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: types.SimpleNamespace(
        messages=types.SimpleNamespace(create=create)))
    return calls


def first_addr(u):
    return u["senders"][0]["address"]


def run_sort():
    acc = accountsmod.get()
    with acc.lock:
        units = aisort.collect_units(acc)
    aisort._run_sort(acc, units)
    return mailops.STATE


# ------------------------------------------------------------ who may be sorted

def test_only_units_the_rules_were_unsure_about_are_offered(mailbox):
    acc = accountsmod.get()
    with acc.lock:
        units = aisort.collect_units(acc)
    keys = {u["key"] for u in units}
    assert keys == {"a:mystery@one.example", "a:mixed@two.example",
                    "co:duo.example", "a:noreply@gmail.com"}
    # never: own rows, protected, replied-to, forum notifications
    for addr in ("big@shop.example", "prot@vip.example", "friend@dear.example",
                 "forum@board.example"):
        assert not any(addr in u["addrs"] for u in units)
    assert sender("forum@board.example")["smart_why"] == {"r": "notification"}
    duo = next(u for u in units if u["key"] == "co:duo.example")
    assert sorted(duo["addrs"]) == ["a@duo.example", "b@duo.example"]


def test_what_is_sent_is_metadata_only_and_a_few_subjects(mailbox):
    acc = accountsmod.get()
    with acc.lock:
        units = aisort.collect_units(acc)
    mixed = next(u for u in units if u["key"] == "a:mixed@two.example")
    assert mixed["payload"] == {
        "company": "", "more_senders": 0, "senders": [{
            "address": "mixed@two.example", "name": mixed["payload"]["senders"][0]["name"],
            "mails": 4, "offers_unsubscribe": False,
            "subjects": ["Hi", "Ihre Bestellung 1"]}]}       # distinct (same date: by text), <= 3
    duo = next(u for u in units if u["key"] == "co:duo.example")
    assert duo["payload"]["company"] == "duo.example"
    assert {s["address"] for s in duo["payload"]["senders"]} == {
        "a@duo.example", "b@duo.example"}
    for u in units:                           # nothing but these fields
        assert set(u["payload"]) == {"company", "senders", "more_senders"}
        for s in u["payload"]["senders"]:
            assert set(s) == {"address", "name", "mails", "offers_unsubscribe",
                              "subjects"}
            assert len(s["subjects"]) <= sk.SAMPLE_SUBJECTS


def test_a_big_company_unit_lists_a_few_senders_and_counts_the_rest(monkeypatch):
    def many(add):
        for i in range(9):
            add(f"s{i}@wide.example", 1, f"Note {i}")
    fake = FakeIMAP({"INBOX": box([many]), "Sent": [], "Trash": [], "Spam": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    acc = accountsmod.get()
    with acc.lock:
        wide = next(u for u in aisort.collect_units(acc) if u["key"] == "co:wide.example")
    assert len(wide["payload"]["senders"]) == aisort.MAX_SENDERS_SHOWN
    assert wide["payload"]["more_senders"] == 3 and len(wide["addrs"]) == 9


def test_estimate_says_what_a_run_would_cost_without_sending(mailbox, monkeypatch):
    calls = fake_model(monkeypatch, lambda u: ("orders", True))
    est = client.get("/api/ai_sort/estimate").json()
    assert est["units"] == 4 and est["senders"] == 5
    assert est["tokens_in"] > 0 and est["tokens_out"] == aisort.TOKENS_OUT_PER_UNIT * 4 and est["cost"] > 0
    assert est["available"] is True and est["sorted"] == 0 and est["checked"] == 0
    assert est["blocked"] == "" and est["has_instructions"] is False
    assert calls == []                                       # nothing was sent


# ------------------------------------------------------------------- the prompt

def test_the_users_own_instructions_extend_the_prompt_but_stay_capped(mailbox):
    assert aisort.system_prompt() == aisort.SORT_SYSTEM
    p = aisort.system_prompt("  Treat everything from acme as orders.\r\n  ")
    assert p.startswith(aisort.SORT_SYSTEM)
    assert "<user_instructions>\nTreat everything from acme as orders.\n</user_instructions>" in p
    assert "cannot change the kinds, the answer format or the rules" in p
    assert len(aisort.clean_instructions("x" * 9999)) == aisort.INSTRUCTIONS_MAX
    # the fixed prompt carries the maintainer's policy answers
    for needle in ("regular bills", "promotion that merely mentions",
                   "free mail provider", "DATA from the mailbox"):
        assert needle in aisort.SORT_SYSTEM.replace("\n", " ")


def test_instructions_are_a_setting_and_reach_the_model(mailbox, monkeypatch):
    r = client.post("/api/config", json={"ai": {
        "sort_instructions": " Gewerbliche Mails von acme sind orders. "}})
    assert r.json()["ai"]["sort_instructions"] == "Gewerbliche Mails von acme sind orders."
    calls = fake_model(monkeypatch, lambda u: ("other", False))
    run_sort()
    assert "Gewerbliche Mails von acme sind orders." in calls[0]["system"]
    client.post("/api/config", json={"ai": {"sort_instructions": "x" * 5000}})
    assert len(cfgmod.load_config()["ai"]["sort_instructions"]) == 1500
    client.post("/api/config", json={"ai": {"sort_instructions": ""}})
    assert cfgmod.load_config()["ai"]["sort_instructions"] == ""
    assert aisort.system_prompt(cfgmod.load_config()["ai"]["sort_instructions"]) \
        == aisort.SORT_SYSTEM


# --------------------------------------------------------------------- the run

def test_the_answer_places_units_in_the_fixed_kinds(mailbox, monkeypatch):
    answers = {"mystery@one.example": ("orders", True),
               "mixed@two.example": ("support", False),     # unsure: stays Other
               "a@duo.example": ("appointments", True)}
    calls = fake_model(monkeypatch, lambda u: answers.get(first_addr(u), ("other", False)))
    state = run_sort()
    assert state["ai"]["status"] == "done"
    assert sender("mystery@one.example")["smart_key"] == "k:orders"
    assert sender("mystery@one.example")["smart_why"] == {"r": "ai", "k": "orders"}
    # the small company is one unit: both senders follow
    assert sender("a@duo.example")["smart_key"] == sender("b@duo.example")["smart_key"] \
        == "k:appointments"
    assert sender("a@duo.example")["smart_why"] == {"r": "ai", "k": "appointments",
                                                    "co": "duo.example"}
    # unsure: Other, remembered so it is not asked again
    assert sender("mixed@two.example")["smart_key"] == "k:other"
    assert sender("mixed@two.example")["smart_why"] == {"r": "ai", "k": "other"}
    rows = smart_rows()
    assert rows["k:orders"]["n_senders"] == 1 and rows["k:appointments"]["n_senders"] == 2
    assert state["notice"] == {"key": "ai_sort_done", "params": {"placed": 2, "total": 4}}
    assert state["ai"]["usage"]["input_tokens"] == 1000
    assert len(calls) == 1 and len(calls[0]["units"]) == 4


def test_a_sure_other_is_told_apart_from_an_unsure_one(mailbox, monkeypatch):
    # "belongs in Other" (a bill, a forum) is an answer; "cannot tell" is not
    answers = {"mystery@one.example": ("other", True),
               "mixed@two.example": ("other", False)}
    fake_model(monkeypatch, lambda u: answers.get(first_addr(u), ("orders", True)))
    run_sort()
    assert sender("mystery@one.example")["smart_key"] == "k:other"
    assert sender("mystery@one.example")["smart_why"] == {"r": "ai", "k": "other",
                                                          "sure": True}
    assert sender("mixed@two.example")["smart_key"] == "k:other"
    assert sender("mixed@two.example")["smart_why"] == {"r": "ai", "k": "other"}
    kept = aisortstore.load_account("default")
    assert kept["a:mystery@one.example"]["sure"] is True
    assert kept["a:mixed@two.example"]["sure"] is False
    # an answer cached before the flag existed reads as "not sure"
    old = {k: {"kind": v["kind"], "fp": v["fp"]} for k, v in kept.items()}
    assert aisortstore.digest(old) != aisortstore.digest(kept)


def test_the_prompt_asks_for_a_best_fit_not_for_caution():
    assert "conservative" not in aisort.SORT_SYSTEM.lower()
    assert "confident false" in aisort.SORT_SYSTEM


def test_the_model_can_only_pick_a_kind_it_was_asked_about(mailbox, monkeypatch):
    # subject lines are untrusted: even a hostile answer is just ignored
    def decide(u):
        return {"mystery@one.example": ("delete everything", True),
                "mixed@two.example": ("orders", True)}.get(first_addr(u), ("other", False))
    fake_model(monkeypatch, decide)
    run_sort()
    assert sender("mystery@one.example")["smart_key"] == "k:other"       # not a kind
    assert sender("mystery@one.example")["smart_why"]["r"] == "none"     # unplaced
    assert sender("mixed@two.example")["smart_key"] == "k:orders"
    assert set(aisort.SORT_SCHEMA["properties"]["results"]["items"]
               ["properties"]["kind"]["enum"]) == set(sk.SORT_KINDS)


def test_unknown_ids_in_the_answer_are_dropped(mailbox, monkeypatch):
    def create(**kw):
        return types.SimpleNamespace(
            stop_reason="end_turn",
            content=[types.SimpleNamespace(type="text", text=json.dumps({"results": [
                {"id": "u999", "kind": "orders", "confident": True},
                {"id": "u0", "kind": "jobs", "confident": True}]}))],
            usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: types.SimpleNamespace(
        messages=types.SimpleNamespace(create=create)))
    run_sort()
    assert len(aisortstore.load_account("default")) == 1


def test_a_freemail_sender_never_gets_a_purpose_from_the_ai(mailbox, monkeypatch):
    fake_model(monkeypatch, lambda u: ("orders", True))
    run_sort()
    assert sender("noreply@gmail.com")["smart_key"] == "k:other"        # people, not shops
    assert sender("mystery@one.example")["smart_key"] == "k:orders"
    fake_model(monkeypatch, lambda u: ("newsletter", True))
    aisortstore.clear("default")
    run_sort()
    assert sender("noreply@gmail.com")["smart_key"] == "k:newsletter"   # a non-purpose kind is fine


def test_protected_replied_and_forum_senders_are_never_moved(mailbox, monkeypatch):
    fake_model(monkeypatch, lambda u: ("orders", True))
    run_sort()
    assert sender("prot@vip.example")["smart_key"] == "k:protected"
    assert sender("friend@dear.example")["smart_key"] == "k:replied"
    assert sender("forum@board.example")["smart_key"] == "k:other"
    assert sender("big@shop.example")["smart_key"] == "s:big@shop.example"


# --------------------------------------------------------------------- caching

def test_a_second_run_only_asks_about_what_is_still_unanswered(mailbox, monkeypatch):
    calls = fake_model(monkeypatch, lambda u: ("orders", True))
    run_sort()
    assert len(calls) == 1
    acc = accountsmod.get()
    with acc.lock:
        assert aisort.collect_units(acc) == []
    assert client.get("/api/ai_sort/estimate").json()["units"] == 0
    assert client.post("/api/ai_sort").json() == {"units": 0, "senders": 0}
    assert len(calls) == 1                                    # nothing billed again


def test_the_answer_survives_a_rescan_and_goes_when_the_evidence_changes(mailbox, monkeypatch):
    fake_model(monkeypatch, lambda u: ("orders", True))
    run_sort()
    mailops.run_scan()
    assert sender("mystery@one.example")["smart_key"] == "k:orders"     # same evidence
    # a new mail with a different subject: the AI never saw it
    mailbox.mailbox["INBOX"].append(make_msg(
        7000, frm="mystery@one.example", subject="Completely different",
        msgid="<new1@t>", date="27-Sep-2026 12:00:00 +0000"))
    mailops.run_scan()
    assert sender("mystery@one.example")["smart_key"] == "k:other"
    assert sender("mystery@one.example")["smart_why"]["r"] in sk.AI_ELIGIBLE
    # ... and it is offered again
    acc = accountsmod.get()
    with acc.lock:
        assert any(u["key"] == "a:mystery@one.example"
                   for u in aisort.collect_units(acc))


def test_the_answer_comes_back_after_a_restart(mailbox, monkeypatch):
    acc = accountsmod.get()
    mailops.save_snapshot(acc)                     # saved BEFORE the sorting
    fake_model(monkeypatch, lambda u: ("orders", True))
    run_sort()
    accountsmod.reset()
    acc2 = accountsmod.get()
    assert mailops.load_snapshot(acc2)             # the signature differs -> re-derived
    assert mailops.public_state(acc2)["groups"]["sender"][
        "mystery@one.example"]["smart_key"] == "k:orders"
    mailops.save_snapshot(acc2)                    # and an up-to-date snapshot is kept as is
    accountsmod.reset()
    acc3 = accountsmod.get()
    assert mailops.load_snapshot(acc3)
    assert acc3.smart_sig == acc2.smart_sig and len(acc3.smart_sig) == 6


def test_remove_ai_sorting_puts_everyone_back(mailbox, monkeypatch):
    fake_model(monkeypatch, lambda u: ("orders", True))
    run_sort()
    assert sender("mystery@one.example")["smart_key"] == "k:orders"
    assert client.get("/api/ai_sort/estimate").json()["sorted"] >= 1
    assert client.post("/api/ai_sort/clear").json() == {"cleared": 4}
    assert sender("mystery@one.example")["smart_key"] == "k:other"
    assert aisortstore.load_account("default") == {}
    assert client.post("/api/ai_sort/clear").json() == {"cleared": 0}
    assert client.get("/api/ai_sort/estimate").json()["sorted"] == 0


# ------------------------------------------------------- key, budget, cancel

def test_without_a_key_nothing_starts(mailbox, monkeypatch):
    raw = cfgmod.load_config()
    raw["ai"]["api_key"] = ""
    cfgmod._write_tenant_config(raw)
    cfg = cfgmod.masked_config(cfgmod.load_config())
    assert cfg["ai"]["available"] is False                # the UI hides the button
    calls = fake_model(monkeypatch, lambda u: ("orders", True))
    r = client.post("/api/ai_sort")
    assert r.status_code == 400 and "no API key" in r.json()["detail"]
    assert calls == []
    assert client.get("/api/ai_sort/estimate").json()["available"] is False


def test_it_needs_a_finished_scan_and_no_other_ai_job(mailbox, monkeypatch):
    fake_model(monkeypatch, lambda u: ("orders", True))
    acc = accountsmod.get()
    acc.state["ai"]["status"] = "running"
    assert client.post("/api/ai_sort").status_code == 409
    acc.state["ai"]["status"] = "idle"
    acc.state["status"] = "idle"
    assert client.post("/api/ai_sort").status_code == 409
    acc.state["status"] = "done"


def test_a_monthly_budget_stops_a_run_between_batches(monkeypatch):
    monkeypatch.setattr(aisort, "SORT_PARALLEL", 1)      # a wave = one batch
    def many(add):
        for i in range(90):
            add(f"s{i}@lone{i}.example", 1, f"Note {i}")
    fake = FakeIMAP({"INBOX": box([many]), "Sent": [], "Trash": [], "Spam": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    cfgmod.update_config({"ai": {"api_key": "k", "budget_usd": 1.0}})
    mailops.run_scan()
    calls = fake_model(monkeypatch, lambda u: ("orders", True),
                       tokens=(2_000_000, 100))               # $4 per batch at $2/M
    state = run_sort()
    assert len(calls) == 1                                    # the 2nd batch was refused
    assert state["notice"]["key"] == "ai_sort_budget"
    assert state["notice"]["params"]["done"] == aisort.SORT_BATCH
    assert len(aisortstore.load_account("default")) == aisort.SORT_BATCH
    # what was learned still applies
    assert sum(1 for r in mailops.STATE["groups"]["sender"].values()
               if (r.get("smart_why") or {}).get("r") == "ai") == aisort.SORT_BATCH - 1
    # (one of the 40 is the freemail sender: its purpose answer is not applied)


def test_cancel_keeps_what_was_sorted_so_far(monkeypatch):
    monkeypatch.setattr(aisort, "SORT_PARALLEL", 1)
    def many(add):
        for i in range(90):
            add(f"s{i}@lone{i}.example", 1, f"Note {i}")
    fake = FakeIMAP({"INBOX": box([many]), "Sent": [], "Trash": [], "Spam": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    cfgmod.update_config({"ai": {"api_key": "k"}})
    mailops.run_scan()
    acc = accountsmod.get()
    calls = []

    def decide(u):
        if not calls:
            calls.append(1)
            acc.cancel["ai"] = True                          # the user pressed cancel
        return ("orders", True)
    fake_model(monkeypatch, decide)
    state = run_sort()
    assert state["notice"]["key"] == "ai_sort_cancelled"
    assert len(aisortstore.load_account("default")) == aisort.SORT_BATCH


def test_a_provider_error_is_reported_and_keeps_earlier_answers(monkeypatch, mailbox):
    n = {"calls": 0}

    def create(**kw):
        n["calls"] += 1
        raise RuntimeError("provider down")
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: types.SimpleNamespace(
        messages=types.SimpleNamespace(create=create)))
    state = run_sort()
    assert state["ai"]["status"] == "error" and "provider down" in state["ai"]["error"]
    assert aisortstore.load_account("default") == {}


# ------------------------------------------------------------- the API as a whole

def test_the_endpoint_runs_in_the_background_and_reports_through_the_state(mailbox, monkeypatch):
    fake_model(monkeypatch, lambda u: ("orders", True))
    r = client.post("/api/ai_sort")
    assert r.status_code == 200 and r.json() == {"units": 4, "senders": 5}
    for _ in range(100):
        if mailops.STATE["ai"]["status"] != "running":
            break
        time.sleep(0.05)
    assert mailops.STATE["ai"]["status"] == "done"
    assert mailops.STATE["notice"]["key"] == "ai_sort_done"
    assert smart_rows()["k:orders"]["n_senders"] >= 1


# ----------------------------------------------------------------------- the store

def test_the_store_keeps_valid_entries_per_account(tmp_path):
    aisortstore.save({"a:x@y.z": {"kind": "orders", "fp": "f1"}}, "one")
    aisortstore.save({"a:q@y.z": {"kind": "jobs", "fp": "f2"}}, "two")
    assert aisortstore.load_account("one") == {"a:x@y.z": {"kind": "orders", "fp": "f1"}}
    aisortstore.rename_account("one", "uno")
    assert "a:x@y.z" in aisortstore.load_account("uno") and not aisortstore.load_account("one")
    aisortstore.drop(["a:x@y.z"], "uno")
    assert aisortstore.load_account("uno") == {}
    # malformed entries are ignored, not trusted
    aisortstore._persist({"accounts": {"two": {"a:q@y.z": {"kind": 5, "fp": "f"},
                                               "a:ok@y.z": {"kind": "jobs", "fp": "g"}}}})
    assert set(aisortstore.load_account("two")) == {"a:ok@y.z"}
    assert aisortstore.digest({}) == aisortstore.digest({})
    assert aisortstore.digest({"a": {"kind": "x", "fp": "1"}}) != aisortstore.digest({})


# ------------------------------------------------ robustness (from the review)

def test_a_failing_rebuild_never_leaves_the_job_running(mailbox, monkeypatch):
    fake_model(monkeypatch, lambda u: ("orders", True))

    def boom(*a, **k):
        raise RuntimeError("disk full")
    monkeypatch.setattr(mailops, "rebuild_smart", boom)
    state = run_sort()
    assert state["ai"]["status"] == "done"                  # not stuck at "running"
    assert state["notice"]["key"] == "ai_sort_done"
    assert len(aisortstore.load_account("default")) == 4    # the paid-for answers stay
    # ... also when the provider failed AND the rebuild does
    aisortstore.clear("default")

    def create(**kw):
        raise RuntimeError("provider down")
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: types.SimpleNamespace(
        messages=types.SimpleNamespace(create=create)))
    state = run_sort()
    assert state["ai"]["status"] == "error"
    assert mailops.STATE["ai"]["status"] == "error"      # reported, not stuck


def test_garbage_answers_cost_a_batch_but_not_the_run(monkeypatch):
    monkeypatch.setattr(aisort, "SORT_PARALLEL", 1)      # the fake counts calls
    def many(add):
        for i in range(90):
            add(f"s{i}@lone{i}.example", 1, f"Note {i}")
    fake = FakeIMAP({"INBOX": box([many]), "Sent": [], "Trash": [], "Spam": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    cfgmod.update_config({"ai": {"api_key": "k"}})
    mailops.run_scan()
    n = {"calls": 0}
    garbage = ['{}', '[]', '{"results": "orders"}',
               '{"results": [1, "x", null, {"id": 5}]}', '{}']

    def create(**kw):
        n["calls"] += 1
        payload = json.loads(kw["messages"][0]["content"])
        if n["calls"] == 1:
            text = json.dumps({"results": [{"id": u["id"], "kind": "orders",
                                            "confident": True} for u in payload["units"]]})
        else:
            text = garbage[n["calls"] % len(garbage)]
        return types.SimpleNamespace(
            stop_reason="end_turn",
            content=[types.SimpleNamespace(type="text", text=text)],
            usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: types.SimpleNamespace(
        messages=types.SimpleNamespace(create=create)))
    state = run_sort()
    # the first batch is kept, the unusable ones are skipped, the run finishes
    assert len(aisortstore.load_account("default")) == aisort.SORT_BATCH
    assert state["ai"]["status"] == "done"
    assert n["calls"] == 3


@pytest.mark.parametrize("answer", ['{}', '[]', '{"results": "orders"}',
                                    '{"results": [1, "x", null, {"id": 5}]}',
                                    '{"results": [{"id": "u0"}]}'])
def test_a_well_formed_but_wrong_shaped_answer_is_skipped_not_fatal(
        mailbox, monkeypatch, answer):
    def create(**kw):
        return types.SimpleNamespace(
            stop_reason="end_turn",
            content=[types.SimpleNamespace(type="text", text=answer)],
            usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: types.SimpleNamespace(
        messages=types.SimpleNamespace(create=create)))
    state = run_sort()
    assert state["ai"]["status"] == "done"
    assert aisortstore.load_account("default") == {}
    assert sender("mystery@one.example")["smart_key"] == "k:other"


def test_remove_is_refused_while_a_sort_is_running(mailbox, monkeypatch):
    fake_model(monkeypatch, lambda u: ("orders", True))
    run_sort()
    entries = dict(aisortstore.load_account("default"))
    accountsmod.get().state["ai"]["status"] = "running"
    r = client.post("/api/ai_sort/clear")
    assert r.status_code == 409
    assert aisortstore.load_account("default") == entries      # nothing was undone
    accountsmod.get().state["ai"]["status"] = "done"
    assert client.post("/api/ai_sort/clear").status_code == 200


def test_answers_about_vanished_senders_are_pruned(mailbox, monkeypatch):
    aisortstore.save({"a:ghost@gone.example": {"kind": "orders", "fp": "x"},
                      "co:vanished.example": {"kind": "jobs", "fp": "y"}}, "default")
    fake_model(monkeypatch, lambda u: ("orders", True))
    run_sort()
    keys = set(aisortstore.load_account("default"))
    assert "a:ghost@gone.example" not in keys and "co:vanished.example" not in keys
    assert "a:mystery@one.example" in keys and "co:duo.example" in keys


def test_deleting_an_account_forgets_its_ai_answers(mailbox):
    cfgmod.update_config({"add_account": "second"})
    aisortstore.save({"a:x@y.z": {"kind": "orders", "fp": "f"}}, "second")
    aisortstore.save({"a:q@y.z": {"kind": "jobs", "fp": "g"}}, "default")
    r = client.post("/api/config", json={"delete_account": "second"})
    assert r.status_code == 200
    assert aisortstore.load_account("second") == {}
    assert aisortstore.load_account("default") == {"a:q@y.z": {"kind": "jobs", "fp": "g"}}
    cfgmod.update_config({"add_account": "third"})
    aisortstore.save({"a:x@y.z": {"kind": "orders", "fp": "f"}}, "third")
    client.post("/api/config", json={"rename_account": {"from": "third", "to": "fourth"}})
    assert "a:x@y.z" in aisortstore.load_account("fourth")


def test_placed_and_only_looked_at_are_counted_apart(mailbox, monkeypatch):
    answers = {"mystery@one.example": ("orders", True),
               "mixed@two.example": ("support", False)}
    fake_model(monkeypatch, lambda u: answers.get(first_addr(u), ("other", False)))
    run_sort()
    est = client.get("/api/ai_sort/estimate").json()
    # mystery (1 sender) is placed; the rest were looked at and stay Other
    assert (est["sorted"], est["checked"]) == (1, 4)


def test_the_estimate_says_so_when_the_monthly_budget_is_used_up(mailbox):
    cfgmod.update_config({"ai": {"budget_usd": 0.01}})
    cfgmod.record_usage(cfgmod.load_config()["ai"], 5_000_000, 0)
    est = client.get("/api/ai_sort/estimate").json()
    assert est["blocked"] and est["available"] is True
    assert client.post("/api/ai_sort").status_code == 400


def test_one_cleaner_and_one_limit_for_the_instructions():
    assert aisort.clean_instructions is cfgmod.clean_sort_instructions
    assert aisort.INSTRUCTIONS_MAX == cfgmod.SORT_INSTRUCTIONS_MAX == 1500
    assert aihelper.ai_call is aihelper._ai_call



# ------------------------------------------------ speed: effort and parallelism

def lone_units(monkeypatch, n):
    def many(add):
        for i in range(n):
            add(f"s{i}@lone{i}.example", 1, f"Note {i}")
    fake = FakeIMAP({"INBOX": box([many]), "Sent": [], "Trash": [], "Spam": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    cfgmod.update_config({"ai": {"api_key": "k"}})
    mailops.run_scan()


def test_the_call_asks_for_low_effort_and_sends_no_thinking_setting(mailbox, monkeypatch):
    seen = []

    def create(**kw):
        seen.append(kw)
        payload = json.loads(kw["messages"][0]["content"])
        return types.SimpleNamespace(
            stop_reason="end_turn",
            content=[types.SimpleNamespace(type="text", text=json.dumps({"results": [
                {"id": u["id"], "kind": "other", "confident": False}
                for u in payload["units"]]}))],
            usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: types.SimpleNamespace(
        messages=types.SimpleNamespace(create=create)))
    run_sort()
    assert seen and all(c["output_config"]["effort"] == "low" for c in seen)
    assert all("thinking" not in c for c in seen)            # effort is the one lever
    assert all(c["output_config"]["format"]["type"] == "json_schema" for c in seen)
    assert aisort.SORT_EFFORT == "low"


def test_a_model_without_effort_support_is_asked_again_without_it(mailbox, monkeypatch):
    import anthropic
    import httpx
    seen = []

    def create(**kw):
        seen.append(kw["output_config"])
        if "effort" in kw["output_config"]:
            raise anthropic.BadRequestError(
                "effort is not supported for this model",
                response=httpx.Response(400, request=httpx.Request("POST", "http://x")),
                body=None)
        payload = json.loads(kw["messages"][0]["content"])
        return types.SimpleNamespace(
            stop_reason="end_turn",
            content=[types.SimpleNamespace(type="text", text=json.dumps({"results": [
                {"id": u["id"], "kind": "orders", "confident": True}
                for u in payload["units"]]}))],
            usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: types.SimpleNamespace(
        messages=types.SimpleNamespace(create=create)))
    state = run_sort()
    assert state["ai"]["status"] == "done"
    assert [("effort" in c) for c in seen[:2]] == [True, False]     # tried, then retried
    assert sender("mystery@one.example")["smart_key"] == "k:orders"


def test_other_errors_are_not_swallowed_by_the_effort_fallback(mailbox, monkeypatch):
    def create(**kw):
        raise RuntimeError("provider down")
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: types.SimpleNamespace(
        messages=types.SimpleNamespace(create=create)))
    assert run_sort()["ai"]["status"] == "error"


def test_batches_are_asked_a_few_at_a_time(monkeypatch):
    import threading
    lone_units(monkeypatch, 130)                        # 134 units = 4 batches
    lock = threading.Lock()
    live = {"now": 0, "peak": 0, "calls": 0, "first": None, "last": None, "units": 0}

    def create(**kw):
        with lock:
            live["now"] += 1
            live["calls"] += 1
            live["peak"] = max(live["peak"], live["now"])
            live["first"] = live["first"] or time.time()
        time.sleep(0.15)                                # long enough to overlap
        payload = json.loads(kw["messages"][0]["content"])
        with lock:
            live["now"] -= 1
            live["last"] = time.time()
            live["units"] += len(payload["units"])
        return types.SimpleNamespace(
            stop_reason="end_turn",
            content=[types.SimpleNamespace(type="text", text=json.dumps({"results": [
                {"id": u["id"], "kind": "orders", "confident": True}
                for u in payload["units"]]}))],
            usage=types.SimpleNamespace(input_tokens=10, output_tokens=5))
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: types.SimpleNamespace(
        messages=types.SimpleNamespace(create=create)))
    state = run_sort()
    assert live["calls"] == 4 and live["peak"] == aisort.SORT_PARALLEL == 3
    assert live["last"] - live["first"] < 4 * 0.15      # not one after the other
    assert state["ai"]["status"] == "done"
    assert state["ai"]["usage"]["input_tokens"] == 40   # every batch is counted
    assert state["notice"]["params"]["total"] == live["units"] > 130   # none skipped


def test_one_failing_batch_in_a_wave_keeps_what_the_others_learned(monkeypatch):
    lone_units(monkeypatch, 90)                         # 3 batches = one wave
    n = {"calls": 0}
    import threading
    lock = threading.Lock()

    def create(**kw):
        with lock:
            n["calls"] += 1
            mine = n["calls"]
        payload = json.loads(kw["messages"][0]["content"])
        if mine == 2:
            raise RuntimeError("one call failed")
        return types.SimpleNamespace(
            stop_reason="end_turn",
            content=[types.SimpleNamespace(type="text", text=json.dumps({"results": [
                {"id": u["id"], "kind": "orders", "confident": True}
                for u in payload["units"]]}))],
            usage=types.SimpleNamespace(input_tokens=10, output_tokens=5))
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: types.SimpleNamespace(
        messages=types.SimpleNamespace(create=create)))
    state = run_sort()
    assert state["ai"]["status"] == "error" and "one call failed" in state["ai"]["error"]
    kept = aisortstore.load_account("default")
    assert 0 < len(kept) < 94                           # the two good batches stay
    assert state["ai"]["status"] != "running"
