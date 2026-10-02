"""Activity digest email: composition from seeded audit entries, period
boundary via last_sent, empty-period skip, the /test endpoint, scheduler
due-logic, the shared SMTP helper (used by both digest and unsubscribe),
tenant/account separation, and config persistence."""

import json
import time

from fastapi.testclient import TestClient

from backend import auditlog
from backend import config as cfgmod
from backend import digest as digestmod
from backend import smtpout
from backend import tenants
from backend import unsub
from backend.main import app

client = TestClient(app)


def _configure_account(user="me@x.example", schedule="off", recipient=""):
    cfgmod.update_config({"account": "default", "imap": {
        "host": "h", "user": user, "password": "pw",
        "digest": {"schedule": schedule, "recipient": recipient}}})


# -------------------------------------------------------------- composition

def test_compose_aggregates_seeded_entries_and_respects_since_boundary():
    auditlog.record("trash", account="default", count=5, size=5000)
    auditlog.record("archive", account="default", count=2)
    auditlog.record("unsubscribe", account="default", count=1,
                    label="a@x.example", outcome="done")
    auditlog.record("unsubscribe", account="default", count=1,
                    label="b@x.example", outcome="link")
    auditlog.record("unsubscribe", account="default", count=1,
                    label="c@x.example", outcome="failed")
    auditlog.record("rule_report", account="default", count=10)
    auditlog.record("rule_execute", account="default", count=3)

    subject, text, html = digestmod.compose("default", 0)
    assert "default" in subject
    for body in (text, html):
        assert f"{digestmod.STRINGS['trash']}" in body and "5" in body
        assert f"{digestmod.STRINGS['archive']}" in body
        assert f"{digestmod.STRINGS['freed']}" in body and "4.9 KB" in body
        assert f"{digestmod.STRINGS['rule_preview']}" in body
        assert f"{digestmod.STRINGS['rule_applied']}" in body
        assert f"{digestmod.STRINGS['unsubscribe_attempts']}" in body
        assert "3" in body                   # unsub attempts count
    assert f"{digestmod.STRINGS['trash']}: 5" in text
    assert f"{digestmod.STRINGS['rule_preview']}: 10" in text
    assert f"{digestmod.STRINGS['rule_applied']}: 3" in text
    assert f"{digestmod.STRINGS['unsub_done']}: 1" in text
    assert f"{digestmod.STRINGS['unsub_link']}: 1" in text
    assert f"{digestmod.STRINGS['unsub_failed']}: 1" in text
    # the HTML part is a real, non-trivial document (branded, no
    # external assets) - not just the text thrown into a <pre>
    assert "<!doctype html>" in html.lower()
    assert "<img" not in html.lower() and "http://" not in html \
        and "https://" not in html


def test_compose_only_counts_entries_after_since_ts():
    auditlog.record("trash", account="default", count=1, size=100)
    cutoff = int(time.time()) + 10          # pretend the digest was just sent
    auditlog.record("trash", account="default", count=9, size=900)
    # Both entries have ~the same real timestamp in a fast test run, so
    # force the boundary explicitly instead of racing the clock.
    entries = auditlog._load_all("default")
    entries[0]["ts"] = cutoff - 100         # old: before the cutoff
    entries[1]["ts"] = cutoff + 100         # new: after the cutoff
    auditlog._rewrite(auditlog._path(), [json.dumps(e) for e in entries])

    subject, text, html = digestmod.compose("default", cutoff)
    assert f"{digestmod.STRINGS['trash']}: 9" in text


def test_compose_ignores_its_own_digest_sent_entries():
    auditlog.record("digest_sent", account="default", label="me@x.example",
                    outcome="ok")
    assert digestmod.compose("default", 0) is None


def test_compose_returns_none_for_an_empty_period():
    assert digestmod.compose("default", 0) is None


# ------------------------------------------------------------- send_digest

def test_send_digest_skips_when_nothing_happened(monkeypatch):
    calls = []
    monkeypatch.setattr(smtpout, "send",
                        lambda *a, **k: calls.append((a, k)))
    _configure_account()
    assert digestmod.send_digest("default") == {"sent": False}
    assert not calls


def test_send_digest_sends_and_records_last_sent_and_audit(monkeypatch):
    calls = []
    monkeypatch.setattr(smtpout, "send",
                        lambda im, to, subj, text, html=None,
                        account_name=None: calls.append((to, subj, text)))
    _configure_account(recipient="digest@elsewhere.example")
    auditlog.record("trash", account="default", count=1, size=100)

    before = int(time.time())
    result = digestmod.send_digest("default")
    assert result == {"sent": True}
    assert calls[0][0] == "digest@elsewhere.example"
    assert digestmod.last_sent("default") >= before

    entries = auditlog.load("default", 0, 10)["entries"]
    assert entries[0]["action"] == "digest_sent"
    assert entries[0]["label"] == "digest@elsewhere.example"

    # last_sent advanced -> composing again right away finds nothing new
    assert digestmod.compose("default", digestmod.last_sent("default")) \
        is None


def test_send_digest_falls_back_to_the_accounts_own_address(monkeypatch):
    calls = []
    monkeypatch.setattr(smtpout, "send",
                        lambda im, to, subj, text, html=None,
                        account_name=None: calls.append(to))
    _configure_account(user="me@x.example", recipient="")
    auditlog.record("trash", account="default", count=1, size=100)
    digestmod.send_digest("default")
    assert calls == ["me@x.example"]


def test_send_digest_raises_without_any_recipient(monkeypatch):
    monkeypatch.setattr(smtpout, "send", lambda *a, **k: None)
    _configure_account(user="", recipient="")
    auditlog.record("trash", account="default", count=1, size=100)
    try:
        digestmod.send_digest("default")
        assert False, "should have raised"
    except ValueError as exc:
        assert "recipient" in str(exc)


def test_test_send_never_advances_last_sent(monkeypatch):
    monkeypatch.setattr(smtpout, "send", lambda *a, **k: None)
    _configure_account(recipient="digest@elsewhere.example")
    auditlog.record("trash", account="default", count=1, size=100)

    assert digestmod.send_digest("default", test=True) == {"sent": True}
    assert digestmod.last_sent("default") == 0     # untouched

    # a REAL digest afterwards still sees the same (full) period
    assert digestmod.send_digest("default") == {"sent": True}
    assert digestmod.last_sent("default") > 0


# --------------------------------------------------------------- /api/test

def test_api_digest_test_endpoint(monkeypatch):
    calls = []
    monkeypatch.setattr(smtpout, "send",
                        lambda *a, **k: calls.append(a))
    _configure_account(recipient="digest@elsewhere.example")
    r = client.post("/api/digest/test")
    assert r.status_code == 200
    assert r.json() == {"sent": False}        # nothing happened yet
    assert not calls

    auditlog.record("trash", account="default", count=1, size=100)
    r = client.post("/api/digest/test")
    assert r.status_code == 200
    assert r.json() == {"sent": True}
    assert calls


def test_api_digest_test_unknown_account_404():
    assert client.post("/api/digest/test?account=nope").status_code == 400


# ------------------------------------------------------------ due logic

def test_due_logic():
    now = time.time()
    assert not digestmod.due("acct", "off", now)
    # due() reads last_sent() from disk - seed it directly.
    digestmod._record_sent("acct", int(now) - 25 * 3600)
    assert digestmod.due("acct", "daily", now)
    assert not digestmod.due("acct", "weekly", now)
    digestmod._record_sent("acct", int(now) - 8 * 86400)
    assert digestmod.due("acct", "weekly", now)
    assert digestmod.due("new-acct", "daily", now)   # never sent -> due


def test_tick_sends_due_digests_and_skips_busy_accounts(monkeypatch):
    calls = []
    monkeypatch.setattr(smtpout, "send",
                        lambda *a, **k: calls.append(a))
    _configure_account(schedule="daily")
    auditlog.record("trash", account="default", count=1, size=100)
    digestmod._tick()
    assert calls                                    # due + not busy -> sent
    assert digestmod.last_sent("default") > 0

    calls.clear()
    from backend import accounts as accountsmod
    auditlog.record("trash", account="default", count=1, size=100)
    # force it due again, then mark the account busy
    digestmod._record_sent("default", int(time.time()) - 25 * 3600)
    acc = accountsmod.get("default")
    with acc.lock:
        acc.state["status"] = "scanning"
    digestmod._tick()
    assert not calls                                # busy -> skipped


# -------------------------------------------------- shared SMTP helper

def test_smtp_helper_is_shared_by_unsub_and_digest(monkeypatch):
    calls = []
    monkeypatch.setattr(
        smtpout, "send",
        lambda im, to, subj, text, html=None, account_name=None:
        calls.append((to, subj, text, html)))

    im = {"user": "me@x.example", "host": "h", "smtp_host": "",
          "smtp_port": 465, "smtp_security": "ssl", "cafile": "",
          "oauth": None, "password": "pw"}
    unsub._send_mailto(im, "mailto:unsub@shop.example?subject=stop&body=bye")
    assert calls[0][0] == "unsub@shop.example"
    assert calls[0][1] == "stop"
    assert calls[0][3] is None               # unsub never sends HTML
    calls.clear()

    _configure_account(recipient="digest@elsewhere.example")
    auditlog.record("trash", account="default", count=1, size=100)
    digestmod.send_digest("default")
    assert calls[0][0] == "digest@elsewhere.example"


def test_smtp_send_builds_multipart_alternative_when_html_given(monkeypatch):
    import email

    sent = {}

    class FakeSMTP:
        def __init__(self, *a, **k):
            pass

        def login(self, user, password):
            pass

        def sendmail(self, frm, to, msg):
            sent["raw"] = msg

        def quit(self):
            pass

    monkeypatch.setattr(smtpout.smtplib, "SMTP_SSL", FakeSMTP)
    im = {"user": "me@x.example", "host": "h", "smtp_host": "",
          "smtp_port": 465, "smtp_security": "ssl", "cafile": "",
          "oauth": None, "password": "pw"}
    smtpout.send(im, "you@x.example", "Subject line", "plain body",
                 "<html><body>html body</body></html>")
    parsed = email.message_from_bytes(sent["raw"])
    assert parsed.is_multipart()
    parts = {p.get_content_type(): p.get_payload(decode=True).decode()
             for p in parsed.walk() if not p.is_multipart()}
    assert parts["text/plain"].strip() == "plain body"
    assert "html body" in parts["text/html"]


def test_smtp_send_stays_plain_text_without_html(monkeypatch):
    sent = {}

    class FakeSMTP:
        def __init__(self, *a, **k):
            pass

        def login(self, user, password):
            pass

        def sendmail(self, frm, to, msg):
            sent["raw"] = msg

        def quit(self):
            pass

    monkeypatch.setattr(smtpout.smtplib, "SMTP_SSL", FakeSMTP)
    im = {"user": "me@x.example", "host": "h", "smtp_host": "",
          "smtp_port": 465, "smtp_security": "ssl", "cafile": "",
          "oauth": None, "password": "pw"}
    smtpout.send(im, "you@x.example", "Subject line", "plain body")
    assert b"plain body" in sent["raw"]
    assert b"multipart" not in sent["raw"].lower()


# --------------------------------------------------------- account lifecycle

def test_rename_account_follows():
    _configure_account()
    digestmod._record_sent("default", 12345)
    client.post("/api/config", json={
        "rename_account": {"from": "default", "to": "renamed"}})
    assert digestmod.last_sent("default") == 0
    assert digestmod.last_sent("renamed") == 12345


def test_delete_account_drops_its_last_sent(monkeypatch):
    cfgmod.update_config({"add_account": "two"})
    digestmod._record_sent("default", 111)
    digestmod._record_sent("two", 222)
    client.post("/api/config", json={"delete_account": "two"})
    assert digestmod.last_sent("default") == 111
    assert digestmod.last_sent("two") == 0


# ------------------------------------------------------- config persistence

def test_digest_settings_persist_through_config_api():
    r = client.post("/api/config", json={"account": "default", "imap": {
        "host": "h", "digest": {"schedule": "weekly",
                                "recipient": "me@elsewhere.example"}}})
    assert r.status_code == 200
    saved = r.json()["accounts"]["default"]["digest"]
    assert saved == {"schedule": "weekly", "recipient": "me@elsewhere.example"}

    # invalid schedule is silently rejected, not stored
    r = client.post("/api/config", json={"account": "default", "imap": {
        "digest": {"schedule": "hourly"}}})
    assert r.json()["accounts"]["default"]["digest"]["schedule"] == "weekly"


def test_digest_defaults_to_off_for_a_pre_digest_saved_config():
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "default": {"host": "h", "user": "u", "password": "pw"}}}))
    cfg = cfgmod.load_config()
    assert cfg["accounts"]["default"]["digest"] == \
        {"schedule": "off", "recipient": ""}


# ------------------------------------------------------------ tenant isolation

def test_last_sent_is_isolated_per_tenant():
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        digestmod._record_sent("default", 999)
    assert digestmod.last_sent("default") == 0      # default tenant untouched
    with tenants.use(alice):
        assert digestmod.last_sent("default") == 999
