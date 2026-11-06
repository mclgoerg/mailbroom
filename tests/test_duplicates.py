"""Duplicate finder: Message-ID sets, (addr, subject, size) sets for mails
without a Message-ID, ordering."""

from fastapi.testclient import TestClient

from backend import mailops
from backend.main import app
from conftest import FakeIMAP, make_msg, wait_delete_done

client = TestClient(app)


def _scan(monkeypatch, mailbox):
    fake = FakeIMAP(mailbox)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    assert mailops.STATE["status"] == "done"
    return fake


def _idless(uid, **kw):
    """A mail whose Message-ID header is empty (no usable id)."""
    return {**make_msg(uid, **kw), "msgid": ""}


def test_duplicate_sets(monkeypatch):
    _scan(monkeypatch, {
        "INBOX": [
            # same Message-ID as the Archive copy below
            make_msg(1, frm="a@x.example", subject="Invoice 1",
                     msgid="<dup@x>", size=500,
                     date="10-Jan-2026 10:00:00 +0000"),
            # tuple duplicate pair (neither copy has a Message-ID)
            _idless(2, frm="b@y.example", subject="Hello", size=300,
                    date="05-Jan-2026 10:00:00 +0000"),
            _idless(3, frm="b@y.example", subject="Hello", size=300,
                    date="06-Jan-2026 10:00:00 +0000"),
            # not a duplicate of anything
            make_msg(4, frm="c@z.example", subject="Unique", size=999),
        ],
        "Archive": [
            make_msg(10, frm="a@x.example", subject="Invoice 1",
                     msgid="<dup@x>", size=500,
                     date="01-Jan-2026 10:00:00 +0000"),
        ],
        "Trash": [], "Spam": [],
    })

    sets = client.get("/api/duplicates").json()
    assert len(sets) == 2
    # sorted by reclaimable size: msgid set (500) before tuple set (300)
    assert sets[0]["wasted"] == 500 and sets[1]["wasted"] == 300
    # newest first inside a set
    a = sets[0]["mails"]
    assert [m["folder"] for m in a] == ["INBOX", "Archive"]
    b = sets[1]["mails"]
    assert [m["uid"] for m in b] == [3, 2]

    # "all but newest" then trash via the normal per-mail action
    items = [[m["folder"], m["uid"]] for s in sets for m in s["mails"][1:]]
    r = client.post("/api/delete_messages", json={"items": items})
    assert r.json()["queued"] == 2
    wait_delete_done()
    assert client.get("/api/duplicates").json() == []


def test_no_false_positives(monkeypatch):
    _scan(monkeypatch, {
        "INBOX": [
            # same subject but different sizes -> not a duplicate
            make_msg(1, frm="a@x.example", subject="Report", size=100,
                     msgid="<r1@x>"),
            make_msg(2, frm="a@x.example", subject="Report", size=200,
                     msgid="<r2@x>"),
            # empty subject never forms tuple sets
            make_msg(3, frm="a@x.example", subject="", size=100,
                     msgid="<e1@x>"),
            make_msg(4, frm="a@x.example", subject="", size=100,
                     msgid="<e2@x>"),
        ],
        "Trash": [], "Spam": [],
    })
    assert client.get("/api/duplicates").json() == []


def test_distinct_message_ids_are_never_paired(monkeypatch):
    """Two monthly statements: same sender, subject and size, but each has
    its own Message-ID - two mails, not a duplicate (and so never offered
    to "Select all but newest")."""
    _scan(monkeypatch, {
        "INBOX": [
            make_msg(1, frm="bank@bank.example", subject="Your statement",
                     size=4321, msgid="<stmt-09@bank.example>",
                     date="01-Sep-2026 08:00:00 +0000"),
            make_msg(2, frm="bank@bank.example", subject="Your statement",
                     size=4321, msgid="<stmt-10@bank.example>",
                     date="01-Oct-2026 08:00:00 +0000")],
        "Trash": [], "Spam": []})
    assert mailops.duplicates_list() == []


def test_same_message_id_in_two_folders_is_paired(monkeypatch):
    _scan(monkeypatch, {
        "INBOX": [make_msg(1, subject="Once", msgid="<one@x.example>",
                           date="02-Oct-2026 08:00:00 +0000")],
        "Archive": [make_msg(7, subject="Once", msgid="<one@x.example>",
                             date="01-Oct-2026 08:00:00 +0000")],
        "Trash": [], "Spam": []})
    (s,) = mailops.duplicates_list()
    assert [(m["folder"], m["uid"]) for m in s["mails"]] \
        == [("INBOX", 1), ("Archive", 7)]


def test_two_idless_copies_are_paired(monkeypatch):
    _scan(monkeypatch, {
        "INBOX": [_idless(1, subject="Notice", size=640,
                          date="02-Oct-2026 08:00:00 +0000"),
                  _idless(2, subject="Notice", size=640,
                          date="01-Oct-2026 08:00:00 +0000")],
        "Trash": [], "Spam": []})
    (s,) = mailops.duplicates_list()
    assert [m["uid"] for m in s["mails"]] == [1, 2]


def test_an_idless_mail_is_not_paired_with_one_that_has_an_id(monkeypatch):
    _scan(monkeypatch, {
        "INBOX": [_idless(1, subject="Notice", size=640),
                  make_msg(2, subject="Notice", size=640,
                           msgid="<n2@shop.example>")],
        "Trash": [], "Spam": []})
    assert mailops.duplicates_list() == []
