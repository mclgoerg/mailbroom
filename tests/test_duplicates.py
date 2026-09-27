"""Duplicate finder: Message-ID sets, (addr, subject, size) sets, ordering."""

from fastapi.testclient import TestClient

from backend import mailops
from backend.main import app
from conftest import FakeIMAP, make_msg, wait_delete_done

client = TestClient(app)


def _scan(monkeypatch, mailbox):
    fake = FakeIMAP(mailbox)
    monkeypatch.setattr(mailops, "connect", lambda cfg: fake)
    mailops.run_scan()
    assert mailops.STATE["status"] == "done"
    return fake


def test_duplicate_sets(monkeypatch):
    _scan(monkeypatch, {
        "INBOX": [
            # same Message-ID as the Archive copy below
            make_msg(1, frm="a@x.example", subject="Invoice 1",
                     msgid="<dup@x>", size=500,
                     date="10-Jan-2026 10:00:00 +0000"),
            # tuple duplicate pair (different Message-IDs)
            make_msg(2, frm="b@y.example", subject="Hello", size=300,
                     msgid="<b1@y>", date="05-Jan-2026 10:00:00 +0000"),
            make_msg(3, frm="b@y.example", subject="Hello", size=300,
                     msgid="<b2@y>", date="06-Jan-2026 10:00:00 +0000"),
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
