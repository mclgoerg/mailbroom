"""Plain words -> filter (aifilter.py, POST /api/ai/filter, rules.validate_filter).

The model is a fake. What matters: WHAT is sent (a sentence, the syntax, tag
names - never mail data), that a query with invalid tokens is never handed
on unflagged, and the refusals (cap, not configured, budget)."""

import inspect
import json
import re
import types

import pytest
from fastapi.testclient import TestClient

from backend import aifilter
from backend import aihelper
from backend import auditlog
from backend import config as cfgmod
from backend import mailops
from backend import rules
from backend.main import app
from conftest import FakeIMAP, make_msg

client = TestClient(app)


# ------------------------------------------------------------ validate_filter

@pytest.mark.parametrize("q", [
    "", "shop sale", "tag:newsletter unread:>90 age:>1y",
    "ai:safe ai:review eng:low is:unsub is:not-unsubscribed has:pinned",
    "att:>10m att:500k age:6m from:a@b.example domain:b.example",
    "TAG:Shipping is:noreply-ever is:new unread:>100"])
def test_valid_filters_have_no_bad_tokens(q):
    assert rules.validate_filter(q) == []


@pytest.mark.parametrize("q,bad", [
    ("size:>5m", ["size:>5m"]),                        # unknown qualifier
    ("age:>xx", ["age:>xx"]),                          # bad value
    ("age:>1w age:>2y", ["age:>1w"]),
    ("unread:>101", ["unread:>101"]),
    ("is:everything", ["is:everything"]),
    ("has:tracker", ["has:tracker"]),
    ("ai:maybe", ["ai:maybe"]),
    ("eng:huge", ["eng:huge"]),
    ("tag:", ["tag:"]),
    ("from:", ["from:"]),
    ("att:>big", ["att:>big"]),
    ("sale http://x.example", ["http://x.example"]),   # looks like a qualifier
    ("-tag:newsletter (tag:shopping) age:>1y",         # mangled qualifiers
     ["-tag:newsletter", "(tag:shopping)"]),
])
def test_bad_tokens_are_reported(q, bad):
    assert rules.validate_filter(q) == bad


def test_a_multi_word_tag_is_matched_by_one_word_of_it():
    names = {"home office", "shopping"}
    assert rules.validate_filter("tag:home", names) == []
    assert rules.validate_filter("tag:office", names) == []
    f = rules.parse_filter("tag:home")
    assert rules.match_group({"key": "a@x.example", "tags": ["home office"],
                              "count": 1}, f)
    assert "one of its words" in aifilter.grammar_text()
    assert aifilter.tag_names({"categories": {"home office": ["desk"]}}
                              ).count("home office") == 1


def test_free_text_is_always_valid():
    assert rules.validate_filter("weekly digest from the club") == []


def test_tag_must_be_a_known_tag_when_names_are_given():
    names = {"newsletter", "shopping", "dev/cloud"}
    assert rules.validate_filter("tag:news tag:dev", names) == []   # substring
    assert rules.validate_filter("tag:gardening", names) == ["tag:gardening"]
    assert rules.validate_filter("tag:gardening") == []             # no list


def test_grammar_covers_every_qualifier_the_parser_understands():
    """The filter grammar the AI is taught must not lag behind parse_filter
    (a later qualifier would silently be unknown to it)."""
    src = inspect.getsource(rules.parse_filter)
    kinds = set(re.findall(r'kind == "(\w+)"', src))
    assert kinds == set(rules._GRAMMAR) == {
        m for m in re.match(r"\^\((.*?)\):", rules._QUAL_RE.pattern)
        .group(1).split("|")}
    for kind in kinds:
        values = set(re.findall(
            rf'kind == "{kind}" and val == "([\w-]+)"', src))
        for tup in re.findall(rf'kind == "{kind}" and val in \(([^)]*)\)',
                              src):
            values |= set(re.findall(r'"([\w-]+)"', tup))
        entry = rules._GRAMMAR[kind]
        if entry["values"] is not None:
            assert values <= set(entry["values"]), kind
        for v in values:
            token = f"{kind}:{v}"
            assert rules.validate_filter(token) == [], token
            assert token in " ".join(
                g["syntax"] for g in rules.FILTER_GRAMMAR) or \
                v in " ".join(g["syntax"] for g in rules.FILTER_GRAMMAR)
    for g in rules.FILTER_GRAMMAR:            # every example is itself valid
        assert rules.validate_filter(g["example"]) == []
        assert g["syntax"].startswith(g["qualifier"] + ":")
        assert g["meaning"]


def test_every_grammar_value_parses_to_a_real_condition():
    for g in rules.FILTER_GRAMMAR:
        for v in g["values"] or ():
            tok = f"{g['qualifier']}:{v}"
            assert rules.parse_filter(tok)["text"] == [], tok


def test_the_prompt_teaches_every_qualifier():
    prompt = aifilter.system_prompt("en")
    for g in rules.FILTER_GRAMMAR:
        assert g["syntax"] in prompt
    assert "German" in aifilter.system_prompt("de")
    assert "German" not in aifilter.system_prompt("fr")   # unknown -> English


# ---------------------------------------------------------------- the endpoint

def fake_model(monkeypatch, *answers, tokens=(1000, 200)):
    """Each call answers with the next dict of `answers` (the last repeats)."""
    calls = []

    def create(**kw):
        calls.append(kw)
        answer = answers[min(len(calls), len(answers)) - 1]
        return types.SimpleNamespace(
            stop_reason="end_turn",
            content=[types.SimpleNamespace(type="text",
                                           text=json.dumps(answer))],
            usage=types.SimpleNamespace(input_tokens=tokens[0],
                                        output_tokens=tokens[1]))
    monkeypatch.setattr(aihelper, "ai_client",
                        lambda cfg: types.SimpleNamespace(
                            messages=types.SimpleNamespace(create=create)))
    return calls


def ans(query, unsupported=(), explanation="ok"):
    return {"query": query, "unsupported": list(unsupported),
            "explanation": explanation}


@pytest.fixture
def ai():
    cfgmod.update_config({"ai": {"api_key": "k", "model": "claude-sonnet-5"}})


def post(text="newsletters I never read", lang="en"):
    return client.post("/api/ai/filter", json={"text": text, "lang": lang})


def user_payload(call):
    return json.loads(call["messages"][0]["content"])


def test_happy_path(ai, monkeypatch):
    calls = fake_model(monkeypatch, ans(
        "tag:newsletter unread:>90 age:>1y", explanation="Old newsletters."))
    r = post("newsletters I never read, older than a year")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["query"] == "tag:newsletter unread:>90 age:>1y"
    assert body["unsupported"] == []
    assert body["explanation"] == "Old newsletters."
    assert body["cost"] > 0
    assert len(calls) == 1
    payload = user_payload(calls[0])
    assert payload["sentence"] == "newsletters I never read, older than a year"
    assert "newsletter" in payload["tags"]
    assert "age:>N" in calls[0]["system"]


def test_usage_is_recorded(ai, monkeypatch):
    fake_model(monkeypatch, ans("age:>1y"), tokens=(2000, 100))
    before = cfgmod.load_stats()
    post()
    after = cfgmod.load_stats()
    assert after["runs"] == before["runs"] + 1
    assert after["input_tokens"] == before["input_tokens"] + 2000
    assert after["output_tokens"] == before["output_tokens"] + 100


def test_retry_names_the_invalid_tokens(ai, monkeypatch):
    calls = fake_model(monkeypatch,
                       ans("tag:newsletter size:>5m"),
                       ans("tag:newsletter", ["mails over 5 MB"]))
    body = post().json()
    assert len(calls) == 2
    second = user_payload(calls[1])
    assert second["invalid_tokens"] == ["size:>5m"]
    assert second["previous_query"] == "tag:newsletter size:>5m"
    assert body["query"] == "tag:newsletter"
    assert body["unsupported"] == ["mails over 5 MB"]
    assert cfgmod.load_stats()["runs"] == 1          # one request, both calls
    assert cfgmod.load_stats()["input_tokens"] == 2000


def test_still_invalid_after_the_retry_is_dropped_and_reported(ai,
                                                              monkeypatch):
    calls = fake_model(monkeypatch, ans("tag:newsletter size:>5m age:>1y"))
    body = post().json()
    assert len(calls) == 2                            # exactly one retry
    assert body["query"] == "tag:newsletter age:>1y"
    assert "size:>5m" in body["unsupported"]
    assert rules.validate_filter(body["query"]) == []


def test_a_made_up_tag_counts_as_invalid(ai, monkeypatch):
    calls = fake_model(monkeypatch, ans("tag:gardening age:>1y"),
                       ans("age:>1y"))
    body = post().json()
    assert user_payload(calls[1])["invalid_tokens"] == ["tag:gardening"]
    assert body["query"] == "age:>1y"


def test_the_text_cap(ai, monkeypatch):
    calls = fake_model(monkeypatch, ans("age:>1y"))
    assert post("x" * 300).status_code == 200
    r = post("x" * 301)
    assert r.status_code == 400 and r.json()["detail"] == "aifilter_text_too_long"
    r = post("y" * 5000)                                  # also past the model
    assert r.status_code == 422 or r.json()["detail"] == "aifilter_text_too_long"
    assert len(calls) == 1                                # nothing was sent


def test_empty_text(ai, monkeypatch):
    calls = fake_model(monkeypatch, ans("age:>1y"))
    for text in ("", "   \n\t "):
        r = post(text)
        assert r.status_code == 400
        assert r.json()["detail"] == "aifilter_text_empty"
    assert calls == []


def test_not_configured(monkeypatch):
    calls = fake_model(monkeypatch, ans("age:>1y"))
    r = post()
    assert r.status_code == 400
    assert r.json()["detail"] == "aifilter_not_configured"
    assert calls == []


def test_budget_exhausted(ai, monkeypatch):
    calls = fake_model(monkeypatch, ans("age:>1y"))
    cfgmod.update_config({"ai": {"budget_usd": 0.001}})
    cfgmod.record_usage(cfgmod.load_config()["ai"], 1_000_000, 0)
    r = post()
    assert r.status_code == 400
    assert r.json()["detail"] == "aifilter_budget"
    assert calls == []


def test_needs_no_scan_and_changes_nothing(ai, monkeypatch):
    fake_model(monkeypatch, ans("age:>1y"))
    assert mailops.public_state()["status"] != "done"
    assert post().status_code == 200
    assert auditlog.load()["total"] == 0               # nothing to record


def test_the_sentence_is_never_logged(ai, monkeypatch, caplog):
    fake_model(monkeypatch, ans("age:>1y"))
    caplog.set_level("DEBUG")
    post("my very private wish about moonbeams")
    assert "moonbeams" not in caplog.text


def test_unknown_language_falls_back_to_english(ai, monkeypatch):
    calls = fake_model(monkeypatch, ans("age:>1y"))
    post(lang="xx")
    assert user_payload(calls[0])["language"] == "English"
    post(lang="de")
    assert user_payload(calls[1])["language"] == "German"


# --------------------------------------------------------------- the payload

def test_nothing_of_the_mailbox_is_sent(ai, monkeypatch):
    """With a scanned mailbox loaded, the whole request (system prompt and
    payload) holds none of its addresses, domains or subjects - and the
    user's custom category NAMES, but not their keywords."""
    subjects = ["Quarterly bulletin zeta", "Your parcel omega is here"]
    inbox = [make_msg(1, frm='"Zed Corp" <zed@zeta-corp.example>',
                      subject=subjects[0], unsub="<https://zeta-corp.example/u>"),
             make_msg(2, frm="omega@parcels-omega.example",
                      subject=subjects[1])]
    fake = FakeIMAP({"INBOX": inbox, "Trash": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    cfgmod.update_config({"categories": {
        "gardening": ["secretkeyword", "tulipword"]}})
    mailops.run_scan()
    assert mailops.STATE["status"] == "done"
    calls = fake_model(monkeypatch, ans("tag:gardening"))
    assert post("my plants").status_code == 200
    sent = json.dumps(calls[0], default=str)
    for needle in ("zed@zeta-corp.example", "zeta-corp", "Zed Corp",
                   "omega@parcels-omega", "parcels-omega", *subjects,
                   "zeta", "omega", "secretkeyword", "tulipword",
                   "me@example.com", "imap"):
        assert needle not in sent, needle
    assert user_payload(calls[0])["tags"].count("gardening") == 1
    assert set(user_payload(calls[0])) == {"sentence", "tags", "language"}


def test_tag_names_are_names_only():
    cfg = {"categories": {"gardening": ["tulip"], "shipping": ["mycourier"]}}
    names = aifilter.tag_names(cfg)
    assert "gardening" in names and "shipping" in names
    assert "newsletter" in names and "automated" in names
    assert "tulip" not in names and "mycourier" not in names
