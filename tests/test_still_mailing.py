"""Unsubscribe watchdog: a sender recorded "done" that keeps delivering mail
more than the grace period after the unsubscribe is "still mailing" - on its
row (and the aggregate rows containing it), under `is:still-mailing` in both
filter parsers, and as a line in the digest."""

import calendar
import json
import time

from backend import accounts as accountsmod
from backend import config as cfgmod
from backend import digest as digestmod
from backend import mailops
from backend import rules as rulesmod
from backend import unsubstore

from conftest import FakeIMAP, make_msg

T = calendar.timegm((2025, 6, 10, 12, 0, 0))     # the unsubscribe
DAY = 86400
ADDR = "news@shop.example"


def _imap_date(ts: int) -> str:
    return time.strftime("%d-%b-%Y %H:%M:%S +0000", time.gmtime(ts))


def _mail(uid, ts, frm=f'"Shop" <{ADDR}>', subject=None):
    return make_msg(uid, frm=frm, subject=subject or f"Offer {uid}",
                    date=_imap_date(ts))


def _install(monkeypatch, mails, name="default"):
    fake = FakeIMAP({"INBOX": mails, "Sent": [], "Trash": []})
    monkeypatch.setattr(mailops, "connect", lambda im, n=None: fake)
    return fake


def _scan_state(monkeypatch, mails, status="done", ts=T, addr=ADDR):
    _install(monkeypatch, mails)
    if status:
        unsubstore.save({addr: {"status": status, "method": "", "detail": "",
                                "error": "", "ts": ts}})
    mailops.run_scan()
    return mailops.public_state()["groups"]["sender"]


def test_boundary_inside_grace_not_flagged(monkeypatch):
    g = _scan_state(monkeypatch, [_mail(1, T + DAY)])
    assert g[ADDR]["still_mailing"] is None


def test_exactly_at_grace_not_flagged(monkeypatch):
    g = _scan_state(monkeypatch,
                    [_mail(1, T + mailops.STILL_MAILING_GRACE)])
    assert g[ADDR]["still_mailing"] is None


def test_one_second_past_grace_flagged(monkeypatch):
    g = _scan_state(monkeypatch, [
        _mail(1, T + mailops.STILL_MAILING_GRACE + 1)])
    sm = g[ADDR]["still_mailing"]
    assert sm == {"n": 1, "senders": 1, "since_ts": T, "addrs": [ADDR]}


def test_mail_before_unsubscribe_not_flagged(monkeypatch):
    g = _scan_state(monkeypatch, [_mail(1, T - DAY), _mail(2, T - 30 * DAY)])
    assert g[ADDR]["still_mailing"] is None


def test_counts_only_late_mails(monkeypatch):
    g = _scan_state(monkeypatch, [
        _mail(1, T - DAY), _mail(2, T + DAY), _mail(3, T + 3 * DAY),
        _mail(4, T + 9 * DAY)])
    assert g[ADDR]["still_mailing"]["n"] == 2


def test_only_done_status_counts(monkeypatch):
    for status in ("link", "failed", "pending"):
        g = _scan_state(monkeypatch, [_mail(1, T + 10 * DAY)],
                        status=status)
        assert g[ADDR]["still_mailing"] is None, status


def test_no_record_no_flag(monkeypatch):
    g = _scan_state(monkeypatch, [_mail(1, T + 10 * DAY)], status=None)
    assert g[ADDR]["still_mailing"] is None


def test_acknowledged_by_hand_counts_as_done(monkeypatch):
    _install(monkeypatch, [_mail(1, int(time.time()) - 5 * DAY)])
    unsubstore.record(ADDR, "done", "confirmed by hand")
    # recorded "now": the 5-day-old mail predates it, so nothing yet ...
    mailops.run_scan()
    g = mailops.public_state()["groups"]["sender"]
    assert g[ADDR]["still_mailing"] is None
    # ... but acknowledging in the past makes the later mail count
    unsubstore.save({ADDR: {"status": "done", "method": "confirmed by hand",
                            "detail": "", "error": "",
                            "ts": int(time.time()) - 20 * DAY}})
    assert mailops.public_state()["groups"]["sender"][ADDR][
        "still_mailing"]["n"] == 1


def test_uses_arrival_time_not_the_date_header(monkeypatch):
    # The Date header is sender-controlled and not stored: a mail whose
    # INTERNALDATE is old stays unflagged whatever it claims.
    msg = _mail(1, T - DAY)
    g = _scan_state(monkeypatch, [msg])
    assert g[ADDR]["still_mailing"] is None


def test_aggregates_for_domain_and_subject_rows(monkeypatch):
    other = "deals@shop.example"
    _scan_state(monkeypatch, [
        _mail(1, T + 5 * DAY, subject="Same"),
        _mail(2, T + 6 * DAY, frm=f'"Deals" <{other}>', subject="Same"),
        _mail(3, T + 7 * DAY, frm='"Pal" <pal@friends.example>',
              subject="Same"),
        _mail(4, T - DAY, frm=f'"Deals" <{other}>', subject="Other")])
    unsubstore.save({other: {"status": "done", "method": "", "detail": "",
                             "error": "", "ts": T + DAY}})
    st = mailops.public_state()["groups"]
    dom = st["domain"]["shop.example"]["still_mailing"]
    assert dom["n"] == 2 and dom["senders"] == 2
    assert dom["since_ts"] == T and dom["addrs"] == [other, ADDR]
    assert st["domain"]["friends.example"]["still_mailing"] is None
    subj = next(r for r in st["subject"].values() if r["label"] == "Same")
    assert subj["still_mailing"]["n"] == 2       # own mails only, not Pal's


def test_trashed_mail_no_longer_counts(monkeypatch):
    fake = _install(monkeypatch, [_mail(1, T + 5 * DAY)])
    unsubstore.save({ADDR: {"status": "done", "method": "", "detail": "",
                            "error": "", "ts": T}})
    mailops.run_scan()
    assert mailops.count_still_mailing(accountsmod.get()) == 1
    fake.mailbox["INBOX"].clear()
    mailops.run_scan()
    assert mailops.count_still_mailing(accountsmod.get()) == 0


def test_records_are_per_account(monkeypatch):
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "h1", "user": "u1", "password": "pw"},
        "two": {"host": "h2", "user": "u2", "password": "pw"}}}))
    fakes = {h: FakeIMAP({"INBOX": [_mail(1, T + 9 * DAY)], "Sent": [],
                          "Trash": []}) for h in ("h1", "h2")}
    monkeypatch.setattr(mailops, "connect",
                        lambda im, n=None: fakes[im["host"]])
    unsubstore.save({ADDR: {"status": "done", "method": "", "detail": "",
                            "error": "", "ts": T}}, "one")
    for name in ("one", "two"):
        mailops.run_scan(accountsmod.get(name))
    one = mailops.public_state(accountsmod.get("one"))["groups"]["sender"]
    two = mailops.public_state(accountsmod.get("two"))["groups"]["sender"]
    assert one[ADDR]["still_mailing"]["n"] == 1
    assert two[ADDR]["still_mailing"] is None
    assert mailops.count_still_mailing(accountsmod.get("two")) == 0


# ------------------------------------------------------------------ filter

def test_filter_parses_and_matches():
    f = rulesmod.parse_filter("is:still-mailing")
    assert f["still_mailing"] is True and f["text"] == []
    assert not rulesmod.parse_filter("")["still_mailing"]
    hit = {"key": "a@x.example", "label": "A", "sub": "", "tags": [],
           "still_mailing": {"n": 1}}
    miss = {**hit, "still_mailing": None}
    assert rulesmod.match_group(hit, f)
    assert not rulesmod.match_group(miss, f)
    assert rulesmod.match_group(miss, rulesmod.parse_filter("a@x"))


def test_purge_rules_refuse_the_qualifier():
    assert rulesmod.purge_unsupported("is:still-mailing") == [
        "is:still-mailing"]


# ------------------------------------------------------------------ digest

def _digest_with_activity(monkeypatch, flagged):
    from backend import auditlog
    auditlog.record("trash", account="default", count=3)
    if flagged:
        _install(monkeypatch, [_mail(1, T + 9 * DAY)])
        unsubstore.save({ADDR: {"status": "done", "method": "", "detail": "",
                                "error": "", "ts": T}})
    else:
        _install(monkeypatch, [_mail(1, T - DAY)])
    mailops.run_scan()
    return digestmod.compose("default", 0)


def test_digest_line_present_when_flagged(monkeypatch):
    subject, text, html = _digest_with_activity(monkeypatch, True)
    label = digestmod.STRINGS["still_mailing"]
    assert f"{label}: 1" in text
    assert label in html


def test_digest_line_absent_when_none(monkeypatch):
    _, text, html = _digest_with_activity(monkeypatch, False)
    assert digestmod.STRINGS["still_mailing"] not in text
    assert digestmod.STRINGS["still_mailing"] not in html


def test_digest_demo_shows_the_line():
    _, text, html = digestmod.compose_demo("default")
    assert digestmod.STRINGS["still_mailing"] in text
    assert digestmod.STRINGS["still_mailing"] in html
