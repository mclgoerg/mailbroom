"""Optional server-side body search: per-account setting gate, UID SEARCH
BODY via IMAP literals (quotes/umlauts/emoji), UTF-8 charset fallback,
merge with metadata hits, UIDVALIDITY skip, time budget, config migration."""

import json

import pytest
from fastapi.testclient import TestClient

from backend import config as cfgmod
from backend import mailops
from backend.main import app

client = TestClient(app)


@pytest.fixture
def scanned(bridge):
    """Bridge with a finished scan; bodies set per mail (uid 1,2,3 INBOX,
    10 Archive)."""
    bodies = {1: "Your parcel arrives at the Biergarten tomorrow",
              2: "foo and bar and baz", 3: "only foo here", 10: "bar only"}
    for folder in ("INBOX", "Archive"):
        for m in bridge.mailbox[folder]:
            m["body"] = bodies.get(m["uid"], "nothing special")
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    return bridge


def body(q, **kw):
    return mailops.search_body(q, **kw)


def uids(res):
    return [m["uid"] for m in res["mails"]]


# ------------------------------------------------------------------ basics

def test_body_hit_that_metadata_search_misses(scanned):
    assert mailops.search_mails("biergarten") == []
    res = body("biergarten")
    assert uids(res) == [1] and res["notes"] == []
    # the term went out as a literal after CHARSET UTF-8
    args, term = scanned.body_searches[0]
    assert args == ("CHARSET", "UTF-8", "BODY") and term == "biergarten"


def test_merge_and_dedupe_with_metadata_hits(scanned):
    # "sendung" matches uids 1, 2 (+10 in Archive) by subject; a body hit
    # on uid 1 must not duplicate it.
    scanned.mailbox["INBOX"][0]["body"] = "Sendung mit Biergarten"
    meta = {m["uid"] for m in mailops.search_mails("sendung")}
    assert meta == {1, 2, 10}
    res = body("sendung")
    assert sorted(uids(res)) == [1, 2, 10]
    assert len(uids(res)) == len(set(uids(res)))
    # newest first
    ts = [m["ts"] for m in res["mails"]]
    assert ts == sorted(ts, reverse=True)


def test_terms_are_anded_and_phrases_kept_whole(scanned):
    assert uids(body("foo bar")) == [2]
    assert sorted(uids(body("foo"))) == [2, 3]
    scanned.mailbox["INBOX"][1]["body"] = "foo bar baz"
    assert uids(body('"foo bar"')) == [2]
    assert uids(body('"bar foo"')) == []


def test_only_mails_in_the_index_are_returned(scanned):
    scanned.mailbox["INBOX"].append(
        {**scanned.mailbox["INBOX"][0], "uid": 99,
         "msgid": "<new@x>", "body": "Biergarten again"})
    assert uids(body("biergarten")) == [1]       # 99 is unknown to the scan


def test_result_cap(scanned):
    for m in scanned.mailbox["INBOX"]:
        m["body"] = "pattern"
    assert len(body("pattern", limit=2)["mails"]) == 2


def test_no_scan_yet_only_metadata_and_no_connection(bridge):
    res = body("anything")
    assert res == {"mails": [], "notes": []}
    assert bridge.body_searches == []


# ------------------------------------------------------------- escaping

@pytest.mark.parametrize("term", ['it"s', "back\\slash", "Grüße",
                                  "party 🎉", "naïve café"])
def test_term_goes_out_verbatim_as_a_literal(scanned, term):
    scanned.mailbox["INBOX"][2]["body"] = f"xx {term} yy"
    res = body(f'"{term}"' if " " in term else term)
    assert uids(res) == [3]
    assert scanned.body_searches[0][1] == term


# ------------------------------------------------------ charset fallback

def test_charset_rejected_retries_plain_once_and_notes_it(scanned):
    scanned.reject_charset = True
    res = body("biergarten")
    assert uids(res) == [1]
    assert [n["key"] for n in res["notes"]] == ["charset_fallback"]
    charset_tries = [a for a, _ in scanned.body_searches if "CHARSET" in a]
    assert len(charset_tries) == 1       # remembered for the other folders


def test_charset_rejected_and_8bit_term_skips_folders_with_a_note(scanned):
    scanned.reject_charset = True
    res = body("Grüße")
    assert res["mails"] == []
    keys = [n["key"] for n in res["notes"]]
    assert keys.count("folder_failed") == 2          # INBOX + Archive
    assert "charset_fallback" not in keys


# ----------------------------------------------- uidvalidity / budget

def test_uidvalidity_mismatch_skips_only_that_folder(scanned):
    scanned.uv["INBOX"] = 7                          # changed since the scan
    res = body("bar")
    assert uids(res) == [10]                         # Archive still searched
    assert res["notes"] == [{"key": "stale_folder",
                             "params": {"folder": "INBOX"}}]


def test_timeout_returns_partial_results_with_a_note(scanned):
    scanned.body_search_error = TimeoutError("timed out")
    res = body("sendung")                            # matches by subject
    assert sorted(uids(res)) == [1, 2, 10]           # metadata hits kept
    assert [n["key"] for n in res["notes"]] == ["partial"]
    assert len(scanned.body_searches) == 1           # gave up on the rest


def test_exhausted_budget_is_partial_without_searching(scanned):
    res = body("biergarten", budget=0)
    assert [n["key"] for n in res["notes"]] == ["partial"]
    assert scanned.body_searches == []


# ------------------------------------------------------ API / setting

def test_api_scope_and_response_shape(scanned):
    r = client.get("/api/search", params={"q": "biergarten"}).json()
    assert r == {"mails": [], "notes": []}           # meta scope unchanged
    r = client.get("/api/search",
                   params={"q": "biergarten", "scope": "body"}).json()
    assert [m["uid"] for m in r["mails"]] == [1]
    assert client.get("/api/search", params={
        "q": "x", "scope": "nope"}).status_code == 422


def test_body_scope_rejected_when_disabled_for_the_account(scanned):
    cfgmod.update_config({"imap": {"body_search": "disabled"}})
    res = client.get("/api/search",
                     params={"q": "biergarten", "scope": "body"})
    assert res.status_code == 400 and "disabled" in res.json()["detail"]
    assert scanned.body_searches == []
    # metadata search is untouched
    assert client.get("/api/search", params={"q": "sendung"}
                      ).json()["mails"]


def test_setting_default_validation_and_masked_config():
    assert cfgmod.load_config()["accounts"]["default"]["body_search"] \
        == "server"
    cfgmod.update_config({"imap": {"body_search": "bogus"}})
    assert cfgmod.account_imap("default")["body_search"] == "server"
    cfgmod.update_config({"imap": {"body_search": "disabled"}})
    assert client.get("/api/config").json()["accounts"]["default"][
        "body_search"] == "disabled"


def test_old_config_without_the_key_reads_as_server(tmp_path):
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "default": {"host": "h", "user": "u"},
        "junk": {"host": "h", "user": "u", "body_search": 5}}}))
    accs = cfgmod.load_config()["accounts"]
    assert accs["default"]["body_search"] == "server"
    assert accs["junk"]["body_search"] == "server"
