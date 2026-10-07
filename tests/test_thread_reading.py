"""Conversation reading: the thread's scanned mails plus the user's own
replies found live in Sent (Sent is excluded from scans)."""

import pytest
from fastapi.testclient import TestClient

from backend import mailops
from backend.main import app
from conftest import make_msg

client = TestClient(app)


@pytest.fixture
def convo(bridge):
    """boss writes (INBOX), the user replies (Sent only), boss answers."""
    bridge.mailbox["INBOX"] += [
        make_msg(30, frm="Boss <boss@corp.example>", subject="Plan",
                 msgid="<a1@x>", date="01-Mar-2024 10:00:00 +0000"),
        make_msg(31, frm="Boss <boss@corp.example>", subject="Re: Plan",
                 msgid="<a2@x>", irt="<r1@x>", refs="<a1@x> <r1@x>",
                 date="03-Mar-2024 10:00:00 +0000"),
    ]
    bridge.mailbox["Sent"].append(
        make_msg(21, frm="Me <me@self.example>", subject="Re: Plan",
                 msgid="<r1@x>", irt="<a1@x>", refs="<a1@x>",
                 to="boss@corp.example", date="02-Mar-2024 10:00:00 +0000",
                 seen=True))
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    return bridge


def convo_of(folder="INBOX", uid=30, **kw):
    return mailops.thread_conversation(folder, uid, **kw)


def test_conversation_is_chronological_and_includes_the_users_reply(convo):
    res = convo_of()
    assert [(m["folder"], m["uid"]) for m in res["mails"]] == \
        [("INBOX", 30), ("Sent", 21), ("INBOX", 31)]
    assert [bool(m.get("sent")) for m in res["mails"]] == [False, True, False]
    assert res["label"] == "Plan" and res["notes"] == []
    sent = res["mails"][1]
    assert sent["addr"] == "me@self.example" and sent["subject"] == "Re: Plan"
    assert sent["seen"] is True and sent["pinned"] is False
    # the same conversation from any of its mails
    assert convo_of("INBOX", 31)["mails"] == res["mails"]


def test_the_users_reply_is_not_part_of_the_scanned_groups(convo):
    rec = next(r for r in mailops.STATE["groups"]["thread"].values()
               if r["label"] == "Plan")
    assert rec["count"] == 2 and "Sent" not in rec["folders"]


def test_api_shape_and_unknown_mail(convo):
    r = client.get("/api/thread", params={"folder": "INBOX", "uid": 31})
    assert r.status_code == 200
    body = r.json()
    assert [m["uid"] for m in body["mails"]] == [30, 21, 31]
    assert set(body) == {"key", "label", "mails", "notes"}
    assert client.get("/api/thread", params={
        "folder": "INBOX", "uid": 999}).status_code == 404
    # the user's own Sent mail is not a scanned mail: no thread of its own
    assert client.get("/api/thread", params={
        "folder": "Sent", "uid": 21}).status_code == 404


def test_two_replies_to_the_same_sent_mail_find_it_once(convo):
    convo.mailbox["INBOX"].append(
        make_msg(32, frm="Boss <boss@corp.example>", subject="Re: Plan",
                 msgid="<a3@x>", irt="<r1@x>", refs="<a1@x> <r1@x>",
                 date="04-Mar-2024 10:00:00 +0000"))
    mailops.run_scan()
    res = convo_of()
    assert [m["uid"] for m in res["mails"]] == [30, 21, 31, 32]
    assert sum(1 for m in res["mails"] if m.get("sent")) == 1


def test_no_sent_folder_known_means_no_imap_lookup(convo, monkeypatch):
    from backend import accounts
    accounts.get().folder_roles.pop("sent", None)

    def boom(*a, **k):
        raise AssertionError("must not connect")
    monkeypatch.setattr(mailops, "connect", boom)
    res = convo_of()
    assert [m["uid"] for m in res["mails"]] == [30, 31] and res["notes"] == []


def test_sent_lookup_failure_degrades_to_a_note(convo, monkeypatch):
    def down(*a, **k):
        raise OSError("connection reset")
    monkeypatch.setattr(mailops, "connect", down)
    res = convo_of()
    assert [m["uid"] for m in res["mails"]] == [30, 31]   # scanned mails stay
    assert res["notes"] == [{"key": "sent_unavailable", "params": {}}]


def test_exhausted_budget_degrades_to_a_note(convo):
    res = convo_of(budget=0)
    assert [m["uid"] for m in res["mails"]] == [30, 31]
    assert [n["key"] for n in res["notes"]] == ["sent_unavailable"]


def test_reply_only_mail_is_offered_the_reader_and_shows_its_parent(convo):
    convo.mailbox["INBOX"].append(
        make_msg(40, frm="Pal <pal@x.example>", subject="Re: Lunch",
                 msgid="<p2@x>", irt="<r9@x>", refs="<r9@x>",
                 date="05-Mar-2024 10:00:00 +0000"))
    convo.mailbox["Sent"].append(
        make_msg(22, frm="Me <me@self.example>", subject="Lunch?",
                 msgid="<r9@x>", date="04-Mar-2024 10:00:00 +0000"))
    mailops.run_scan()
    detail = mailops.fetch_message("INBOX", 40)
    assert detail["thread"] == {"count": 1}
    assert [(m["folder"], m["uid"]) for m in convo_of("INBOX", 40)["mails"]] \
        == [("Sent", 22), ("INBOX", 40)]


# --------------------------------------------------- message endpoint

def test_message_reports_a_thread_only_where_there_is_something_to_read(
        convo):
    assert mailops.fetch_message("INBOX", 30)["thread"] == {"count": 2}
    assert mailops.fetch_message("INBOX", 31)["thread"] == {"count": 2}
    # an ordinary, unthreaded mail
    assert mailops.fetch_message("INBOX", 3)["thread"] is None


def test_sent_mails_can_be_opened_but_other_unknown_ones_cannot(convo):
    detail = mailops.fetch_message("Sent", 21)
    assert "Re: Plan" in detail["subject"] and detail["thread"] is None
    with pytest.raises(RuntimeError, match="unknown message"):
        mailops.fetch_message("INBOX", 999)
    with pytest.raises(RuntimeError, match="unknown message"):
        mailops.fetch_message("Archive", 999)
