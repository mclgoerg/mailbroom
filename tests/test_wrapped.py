"""Your year in mail: the pure aggregation, the stats + audit integration
and the /api/wrapped endpoint (account-scoped, metadata only)."""

import calendar
import json
import time

from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import auditlog
from backend import config as cfgmod
from backend import mailops
from backend import rules as rulesmod
from backend import stats as statsmod
from backend import wrapped
from backend.main import app

from conftest import FakeIMAP, make_msg

client = TestClient(app)
NOW = calendar.timegm((2026, 6, 15, 12, 0, 0))


def ts(y, mo, d, h=12, mi=0):
    return calendar.timegm((y, mo, d, h, mi, 0))


def mail(addr, when, name="", seen=False, size=1000, uid=[0]):
    uid[0] += 1
    return {"uid": uid[0], "folder": "INBOX", "addr": addr, "name": name,
            "subject": "SECRET-SUBJECT", "size": size, "seen": seen,
            "ts": when}


def run(mails, year=2026, tz=0, actions=None, audit=None, rules=None):
    return wrapped.compute(mails, year, tz, NOW, actions or {}, audit or [],
                           rules or {})


def entry(action, ts_, count=1, outcome="ok", actor="user"):
    return {"ts": ts_, "account": "default", "actor": actor,
            "action": action, "count": count, "bytes": 0, "label": "",
            "outcome": outcome, "error": ""}


def test_basic_totals_and_peaks():
    mails = [mail("a@x.example", ts(2026, 3, 2, 9), "Ann", seen=True),
             mail("a@x.example", ts(2026, 3, 9, 9), "Ann"),
             mail("b@y.example", ts(2026, 3, 10, 18), size=9000),
             mail("c@z.example", ts(2026, 5, 4, 9)),
             mail("old@x.example", ts(2025, 5, 4, 9))]
    r = run(mails)
    assert r["received"] == {"mails": 4, "bytes": 12000, "senders": 3,
                             "read": 1, "new_senders": 3}
    assert r["loudest_month"] == {"month": 3, "mails": 3}
    assert r["busiest_hour"] == {"hour": 9, "mails": 3}
    assert r["busiest_weekday"]["mails"] >= 2
    assert r["biggest"] == {"label": "b@y.example", "addr": "b@y.example",
                            "bytes": 9000}
    assert r["top_senders"][0] == {"label": "Ann", "addr": "a@x.example",
                                   "mails": 2, "bytes": 2000}
    assert r["years"] == [2025, 2026] and r["partial"] is True
    assert run(mails, 2025)["partial"] is False


def test_default_year_is_newest_with_mail():
    assert run([mail("a@x.example", ts(2024, 2, 2))], year=None)["year"] == 2024
    assert run([], year=None)["year"] == 2026


def test_time_zone_moves_a_mail_across_new_year():
    late = ts(2025, 12, 31, 23, 30)          # UTC
    mails = [mail("a@x.example", late)]
    assert run(mails, 2025, tz=0)["received"]["mails"] == 1
    assert run(mails, 2026, tz=0)["received"]["mails"] == 0
    # one hour east of UTC it already is 00:30 on 1 January 2026
    assert run(mails, 2025, tz=60)["received"]["mails"] == 0
    assert run(mails, 2026, tz=60)["received"]["mails"] == 1
    assert run(mails, 2026, tz=60)["busiest_hour"]["hour"] == 0
    # and 2025-12-31 23:30 UTC-1 stays in 2025
    assert run(mails, 2025, tz=-60)["received"]["mails"] == 1


def test_new_sender_means_first_mail_ever_in_the_year():
    mails = [mail("old@x.example", ts(2025, 1, 1)),
             mail("old@x.example", ts(2026, 1, 1)),
             mail("new@x.example", ts(2026, 2, 1))]
    r = run(mails)
    assert r["received"]["senders"] == 2
    assert r["received"]["new_senders"] == 1


def test_ghost_needs_ten_mails_and_zero_read():
    ghost = [mail("g@x.example", ts(2026, 1, d)) for d in range(1, 11)]
    nine = [mail("n@x.example", ts(2026, 2, d)) for d in range(1, 10)]
    one_read = [mail("r@x.example", ts(2026, 3, d), seen=(d == 4))
                for d in range(1, 12)]
    r = run(ghost + nine + one_read)
    assert r["ghosts"]["count"] == 1
    assert [g["addr"] for g in r["ghosts"]["top"]] == ["g@x.example"]
    # a mail read in ANOTHER year does not save the sender
    other = [mail("o@x.example", ts(2025, 1, 1), seen=True)] + [
        mail("o@x.example", ts(2026, 1, d)) for d in range(1, 11)]
    assert run(other)["ghosts"]["count"] == 1


def test_top_ordering_and_ties_are_deterministic():
    mails = []
    for addr, n in (("c@x.example", 2), ("a@x.example", 2),
                    ("b@x.example", 2), ("big@x.example", 5),
                    ("d@x.example", 1), ("e@x.example", 1),
                    ("f@x.example", 1)):
        mails += [mail(addr, ts(2026, 1, 1 + i)) for i in range(n)]
    first = run(mails)["top_senders"]
    assert [s["addr"] for s in first] == [
        "big@x.example", "a@x.example", "b@x.example", "c@x.example",
        "d@x.example"]
    assert run(list(reversed(mails)))["top_senders"] == first


def test_empty_year():
    r = run([mail("a@x.example", ts(2025, 1, 1))], year=2026)
    assert r["received"]["mails"] == 0 and r["top_senders"] == []
    assert r["loudest_month"] is None and r["biggest"] is None
    assert r["ghosts"] == {"count": 0, "top": []}
    assert r["cleanup"]["top_rule"] is None


def test_cleanup_from_stats_and_audit():
    actions = {"2026-01": {"trash": 5, "archive": 2, "purge": 3,
                           "purged_bytes": 3000},
               "2026-02": {"trash": 1, "purge": 0},
               "2025-12": {"trash": 99}}
    audit = [entry("unsubscribe", ts(2026, 2, 1), outcome="done"),
             entry("unsubscribe", ts(2026, 2, 2), outcome="failed"),
             entry("unsubscribe", ts(2026, 2, 3), outcome="link"),
             entry("unsubscribe", ts(2025, 2, 2)),
             entry("rule_execute", ts(2026, 3, 1), 7, actor="rule:r1"),
             entry("rule_execute", ts(2026, 3, 2), 4, actor="rule:r2"),
             entry("rule_execute", ts(2026, 3, 3), 5, actor="rule:r2"),
             entry("rule_execute", ts(2026, 3, 4), 0, actor="rule:r1"),
             entry("rule_report", ts(2026, 3, 5), 50, actor="rule:r1")]
    c = run([], actions=actions, audit=audit,
            rules={"r1": "Old newsletters"})["cleanup"]
    assert c["trashed"] == 6 and c["archived"] == 2 and c["purged"] == 3
    assert c["freed_bytes"] == 3000
    assert c["unsubscribes"] == 1 and c["rule_runs"] == 3
    # r2 moved most (9) but no longer exists
    assert c["top_rule"] == {"name": "", "deleted": True, "mails": 9}
    c = run([], audit=audit, rules={"r1": "A", "r2": "B"})["cleanup"]
    assert c["top_rule"] == {"name": "B", "deleted": False, "mails": 9}


def test_response_carries_the_basis_note():
    assert "mailbox now" in run([])["note"]


def test_response_carries_no_subject():
    mails = [mail("a@x.example", ts(2026, 1, d)) for d in range(1, 12)]
    assert "SECRET-SUBJECT" not in json.dumps(run(mails))


# ------------------------------------------------------------ the endpoint

def _imap_date(when: int) -> str:
    return time.strftime("%d-%b-%Y %H:%M:%S +0000", time.gmtime(when))


def _two_accounts(monkeypatch):
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "host-one", "user": "u1", "password": "pw"},
        "two": {"host": "host-two", "user": "u2", "password": "pw"}}}))
    fakes = {
        "host-one": FakeIMAP({"INBOX": [
            make_msg(1, frm="Ann <ann@a.example>", subject="Hello one",
                     date=_imap_date(ts(2026, 1, 2))),
            make_msg(2, frm="Ann <ann@a.example>", subject="Again one",
                     date=_imap_date(ts(2025, 1, 2)))],
            "Sent": [], "Trash": []}),
        "host-two": FakeIMAP({"INBOX": [
            make_msg(1, frm="bob@b.example", subject="Hello two",
                     date=_imap_date(ts(2026, 1, 2)))],
            "Sent": [], "Trash": []}),
    }
    monkeypatch.setattr(mailops, "connect",
                        lambda im, name=None: fakes[im["host"]])


def _scan(name):
    acc = accountsmod.get(name)
    mailops.run_scan(acc)
    return acc


def test_endpoint_is_account_scoped_and_metadata_only(monkeypatch):
    _two_accounts(monkeypatch)
    _scan("one")
    _scan("two")
    statsmod.record_action("trash", 4, 400, "one")
    auditlog.record("unsubscribe", account="one", count=1, label="x@a.example",
                    outcome="done")
    auditlog.record("unsubscribe", account="two", count=1, label="x@b.example",
                    outcome="done")
    one = client.get("/api/wrapped?year=2026&account=one").json()
    two = client.get("/api/wrapped?year=2026&account=two").json()
    assert one["received"]["mails"] == 1 and two["received"]["mails"] == 1
    assert one["top_senders"][0]["addr"] == "ann@a.example"
    assert two["top_senders"][0]["addr"] == "bob@b.example"
    assert one["years"] == [2025, 2026] and two["years"] == [2026]
    # the tallies are booked "now": ask for the current year, per account
    now_year = time.gmtime().tm_year
    c1 = client.get(f"/api/wrapped?year={now_year}&account=one").json()
    c2 = client.get(f"/api/wrapped?year={now_year}&account=two").json()
    assert c1["cleanup"]["trashed"] == 4 and c2["cleanup"]["trashed"] == 0
    assert c1["cleanup"]["unsubscribes"] == 1
    assert c2["cleanup"]["unsubscribes"] == 1
    for body in (one, two):
        assert "Hello" not in json.dumps(body)
    # default year = newest with mail; tz is validated
    assert client.get("/api/wrapped?account=one").json()["year"] == 2026
    assert client.get("/api/wrapped?tz=99999").status_code == 422
