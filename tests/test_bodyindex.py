"""Opt-in local mail-text search: the keyed word index stores no readable
text, needs MAILBROOM_SECRET_KEY, is built by a cancellable job and kept
current by scans, and answers whole-word searches."""

import sqlite3
import time

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import bodyindex
from backend import config as cfgmod
from backend import mailops
from backend.main import app
from conftest import make_msg, wait_delete_done, wait_scan_done

client = TestClient(app)


@pytest.fixture(autouse=True)
def secret_key(monkeypatch):
    monkeypatch.setenv("MAILBROOM_SECRET_KEY", "test-key-one")


@pytest.fixture
def scanned(bridge):
    bodies = {1: "Your parcel arrives at the Biergarten tomorrow",
              2: "foo and bar and baz", 3: "Café Müller says: only foo here",
              4: "Straße 12, 80331 München", 10: "bar only"}
    for folder in ("INBOX", "Archive"):
        for m in bridge.mailbox[folder]:
            m["body"] = bodies.get(m["uid"], "nothing special")
    cfgmod.update_config({"imap": {"body_search": "local"}})
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    return bridge


def acc():
    return accountsmod.get()


def wait_index(timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        with acc().lock:
            if acc().state["index"]["status"] != "running":
                return dict(acc().state["index"])
        time.sleep(0.01)
    raise TimeoutError("index job did not finish")


def wait_until(cond, timeout=5.0):
    """The scan thread marks the scan done BEFORE it tops up the index, so
    "scan finished" and "index finished" are two separate moments."""
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return
        time.sleep(0.01)
    raise TimeoutError("condition not reached")


def build(rebuild=False):
    bodyindex.start_build(acc(), rebuild=rebuild)
    job = wait_index()
    assert job["status"] == "done", job
    return job


def uids(res):
    return sorted(m["uid"] for m in res["mails"])


def local(q, **kw):
    return mailops.search_local(q, **kw)


# ------------------------------------------------------------------ words

def test_words_are_case_and_accent_insensitive_whole_words():
    assert bodyindex.words("Café MÜLLER, Straße 12!") == \
        {"cafe", "muller", "strasse", "12"}
    assert bodyindex.words("a b x1 ok") == {"x1", "ok"}        # 1-letter dropped
    assert bodyindex.words("") == set() and bodyindex.words(None) == set()
    assert bodyindex.words("snake_case-word") == {"snake", "case", "word"}


def test_words_are_capped_per_mail():
    text = " ".join(f"w{i:05d}" for i in range(bodyindex.MAX_WORDS + 500))
    assert len(bodyindex.words(text)) == bodyindex.MAX_WORDS


# ------------------------------------------------------- config / key gate

def test_local_mode_needs_the_secret_key(bridge, monkeypatch):
    monkeypatch.delenv("MAILBROOM_SECRET_KEY")
    with pytest.raises(ValueError, match="MAILBROOM_SECRET_KEY"):
        cfgmod.update_config({"imap": {"body_search": "local"}})
    assert client.post("/api/config", json={
        "imap": {"body_search": "local"}}).status_code == 400
    assert client.get("/api/config").json()["secret_key_set"] is False
    monkeypatch.setenv("MAILBROOM_SECRET_KEY", "k")
    cfgmod.update_config({"imap": {"body_search": "local"}})
    assert cfgmod.account_imap("default")["body_search"] == "local"
    assert client.get("/api/config").json()["secret_key_set"] is True


def test_build_without_key_or_scan_or_while_busy_is_refused(
        bridge, monkeypatch):
    cfgmod.update_config({"imap": {"body_search": "local"}})
    with pytest.raises(RuntimeError, match="No completed scan"):
        bodyindex.start_build(acc())
    mailops.run_scan()
    acc().state["ai"]["status"] = "running"
    with pytest.raises(RuntimeError, match="busy"):
        bodyindex.start_build(acc())
    acc().state["ai"]["status"] = "idle"
    monkeypatch.delenv("MAILBROOM_SECRET_KEY")
    with pytest.raises(ValueError, match="MAILBROOM_SECRET_KEY"):
        bodyindex.start_build(acc())


# --------------------------------------------------------- build + search

def test_build_indexes_every_scanned_mail_and_search_finds_whole_words(
        scanned):
    assert local("biergarten")["notes"][0]["key"] == "index_missing"
    job = build()
    assert (job["done"], job["total"]) == (5, 5)
    assert bodyindex.info(acc())["docs"] == 5
    assert bodyindex.info(acc())["bytes"] == bodyindex._path(
        acc().name).stat().st_size > 0              # shown in Settings
    res = local("biergarten")
    assert uids(res) == [1] and res["notes"] == []
    assert uids(local("foo")) == [2, 3]
    assert uids(local("foo bar")) == [2]                    # AND
    assert uids(local('"foo baz"')) == [2]                  # phrase -> words
    assert uids(local("BIERGARTEN")) == [1]                 # case
    assert uids(local("cafe muller")) == [3]                # accents
    assert uids(local("strasse")) == [4]                    # ß
    assert uids(local("munchen")) == [4]


def test_no_substring_or_prefix_matching(scanned):
    build()
    assert uids(local("biergart")) == []
    assert uids(local("garten")) == []
    assert uids(local("fo")) == []


def test_merges_with_metadata_hits_without_duplicates(scanned):
    build()
    # "sendung" is in the subjects of uid 1, 2, 10; "foo" is in bodies 2, 3
    res = local("sendung")
    assert uids(res) == [1, 2, 10]
    assert uids(local("foo")) == [2, 3]
    scanned.mailbox["INBOX"][0]["body"] = "sendung"
    build(rebuild=True)
    assert uids(local("sendung")) == [1, 2, 10]             # 1 once


def test_index_files_hold_no_readable_text(scanned):
    build()
    path = bodyindex._path(acc().name)
    assert path.stat().st_mode & 0o777 == 0o600
    raw = path.read_bytes().lower()
    for needle in (b"biergarten", b"parcel", b"tomorrow", b"muller",
                   b"strasse", b"nothing special", b"hello", b"foo"):
        assert needle not in raw
    conn = sqlite3.connect(path)
    kinds = {r[0] for r in conn.execute(
        "SELECT DISTINCT typeof(h) FROM words")}
    assert kinds == {"integer"}
    assert conn.execute("SELECT COUNT(*) FROM words").fetchone()[0] > 5
    conn.close()


def test_results_respect_uidvalidity_and_deletions(scanned):
    build()
    acc().folder_uv["INBOX"] = 99          # folder changed since the scan
    assert uids(local("biergarten")) == []
    acc().folder_uv["INBOX"] = 1
    assert uids(local("biergarten")) == [1]
    mailops.delete_messages([["INBOX", 1]])
    wait_delete_done()
    assert uids(local("biergarten")) == []  # gone from the scan index


# -------------------------------------------------------- keeping it current

def test_scan_tops_up_the_index_with_only_the_new_mails(scanned):
    build()
    scanned.body_fetches.clear()
    scanned.mailbox["INBOX"].append(
        make_msg(50, subject="Fresh", msgid="<f@x>", body="quokka sighting"))
    mailops.start_scan()
    wait_scan_done()
    wait_until(lambda: bodyindex.info(acc())["docs"] == 6)
    wait_index()
    assert scanned.body_fetches == [("INBOX", [50])]
    assert uids(local("quokka")) == [50]


def test_scan_drops_vanished_mails_from_the_index(scanned):
    build()
    scanned.mailbox["INBOX"] = [m for m in scanned.mailbox["INBOX"]
                                if m["uid"] != 1]
    mailops.start_scan()
    wait_scan_done()
    wait_until(lambda: bodyindex.info(acc())["docs"] == 4)
    wait_index()
    assert uids(local("biergarten")) == []


def test_mails_the_index_has_not_seen_yet_are_reported(scanned, monkeypatch):
    build()
    monkeypatch.setattr(bodyindex, "sync_after_scan", lambda a: None)
    scanned.mailbox["INBOX"].append(make_msg(51, body="zebra"))
    mailops.run_scan()
    res = local("biergarten")
    assert res["notes"] == [{"key": "index_behind", "params": {"n": 1}}]
    assert uids(res) == [1]


def test_no_automatic_first_build_and_unfinished_builds_stay_unfinished(
        scanned):
    # mode is local but nothing was built: a scan must not start a build
    mailops.run_scan()
    assert acc().state["index"]["status"] == "idle"
    assert not bodyindex._path(acc().name).exists()
    # a cancelled first build is not "built": scans do not silently resume
    acc().cancel["index"] = True
    acc().state["index"]["status"] = "running"
    bodyindex._run_job(acc(), False)
    assert acc().state["index"]["status"] == "idle"
    assert acc().state["notice"]["key"] == "index_cancelled"
    assert bodyindex.info(acc())["built_ts"] is None
    scanned.body_fetches.clear()
    mailops.run_scan()
    assert scanned.body_fetches == []


def test_scan_is_refused_while_the_index_runs(scanned):
    acc().state["index"]["status"] = "running"
    with pytest.raises(RuntimeError, match="busy"):
        mailops.start_scan()
    acc().state["index"]["status"] = "idle"


# ---------------------------------------------------------------- the key

def test_an_index_built_under_another_key_is_unusable_until_rebuilt(
        scanned, monkeypatch):
    build()
    monkeypatch.setenv("MAILBROOM_SECRET_KEY", "a-different-key")
    res = local("biergarten")
    assert uids(res) == [] and res["notes"][0]["key"] == "index_key"
    assert bodyindex.info(acc())["usable"] is False
    build()                                        # rebuilds under the new key
    assert uids(local("biergarten")) == [1]
    monkeypatch.delenv("MAILBROOM_SECRET_KEY")
    assert local("biergarten")["notes"][0]["key"] == "index_key"


# -------------------------------------------------------------------- API

def test_api_status_build_search_and_delete(scanned):
    r = client.get("/api/index").json()
    assert r["mode"] == "local" and r["secret_key_set"] is True
    assert r["exists"] is False and r["docs"] == 0
    assert client.post("/api/index/build", json={}).status_code == 200
    wait_index()
    r = client.get("/api/index").json()
    assert r["usable"] and r["docs"] == 5 and r["built_ts"]
    assert r["job"]["status"] == "done"
    hits = client.get("/api/search", params={
        "q": "biergarten", "scope": "body"}).json()
    assert [m["uid"] for m in hits["mails"]] == [1]
    assert client.post("/api/index/delete").status_code == 200
    assert client.get("/api/index").json()["exists"] is False


def test_build_endpoint_needs_local_mode(bridge):
    mailops.run_scan()
    cfgmod.update_config({"imap": {"body_search": "server"}})
    assert client.post("/api/index/build", json={}).status_code == 400


def test_delete_is_refused_while_building(scanned):
    acc().state["index"]["status"] = "running"
    assert client.post("/api/index/delete").status_code == 409
    acc().state["index"]["status"] = "idle"


def test_cancel_target_exists(scanned):
    assert client.post("/api/cancel", json={"target": "index"}
                       ).status_code == 200


# ------------------------------------------------------------ lifecycle

def test_leaving_local_mode_wipes_the_index(scanned):
    build()
    assert bodyindex._path(acc().name).exists()
    assert client.post("/api/config", json={
        "imap": {"body_search": "server"}}).status_code == 200
    assert not bodyindex._path(acc().name).exists()


def test_renaming_and_deleting_the_account_carry_the_index_along(
        scanned, tmp_path):
    cfgmod.update_config({"add_account": "second"})
    build()
    old = bodyindex._path("default")
    assert old.exists()
    assert client.post("/api/config", json={
        "rename_account": {"from": "default", "to": "main"}}
    ).status_code == 200
    assert not old.exists() and bodyindex._path("main").exists()
    assert client.post("/api/config", json={
        "delete_account": "main"}).status_code == 200
    assert not bodyindex._path("main").exists()
