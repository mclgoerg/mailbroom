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


# ----------------------------------------------- Sent lookup performance

def many_replies(bridge, n):
    """n received mails, each answering a different mail of the user's."""
    for i in range(n):
        bridge.mailbox["Sent"].append(
            make_msg(100 + i, frm="Me <me@self.example>", subject="Re: Plan",
                     msgid=f"<mine{i}@x>", irt="<a1@x>", refs="<a1@x>",
                     date=f"{2 + i % 20:02d}-Mar-2024 10:00:00 +0000"))
        bridge.mailbox["INBOX"].append(
            make_msg(200 + i, frm="Boss <boss@corp.example>",
                     subject="Re: Plan", msgid=f"<theirs{i}@x>",
                     irt=f"<mine{i}@x>", refs=f"<a1@x> <mine{i}@x>",
                     date=f"{3 + i % 20:02d}-Mar-2024 12:00:00 +0000"))


def test_all_reply_ids_go_out_in_one_or_search_bounded_by_date(convo):
    many_replies(convo, 7)
    mailops.run_scan()
    convo.message_id_searches.clear()
    res = convo_of()
    assert sum(1 for m in res["mails"] if m.get("sent")) == 8     # r1 + 7
    assert len(convo.message_id_searches) == 1                   # not 8
    args = convo.message_id_searches[0]
    assert args[0] == "SINCE" and args[1] == "28-Feb-2024"       # 2 days before
    assert args.count("OR") == 7 and args.count("Message-ID") == 8


def test_more_ids_than_one_batch_use_a_few_searches(convo):
    many_replies(convo, 35)
    mailops.run_scan()
    convo.message_id_searches.clear()
    res = convo_of()
    # 36 reply ids, capped at THREAD_SENT_MAX_IDS, 10 per search
    assert sum(1 for m in res["mails"] if m.get("sent")) == \
        mailops.THREAD_SENT_MAX_IDS
    assert len(convo.message_id_searches) == 3


def test_server_without_nested_or_falls_back_to_one_search_per_id(convo):
    many_replies(convo, 3)
    mailops.run_scan()
    convo.reject_or = True
    convo.message_id_searches.clear()
    res = convo_of()
    assert sum(1 for m in res["mails"] if m.get("sent")) == 4
    singles = [a for a in convo.message_id_searches if "OR" not in a]
    assert len(singles) == 4 and res["notes"] == []


def test_ids_that_cannot_be_quoted_use_a_literal_search(convo):
    from backend import accounts
    convo.message_id_searches.clear()
    found = mailops._find_sent_replies(
        accounts.get(), "Sent", ["<grüße@x>", "<r1@x>"], 5)
    assert [m["uid"] for m in found] == [21]          # the quotable id
    kinds = ["or" if "SINCE" in a or "OR" in a or '"<r1@x>"' in a
             else "literal" for a in convo.message_id_searches]
    assert sorted(kinds) == ["literal", "or"]


def test_a_second_open_is_served_from_the_cache_without_imap(
        convo, monkeypatch):
    first = convo_of()
    assert any(m.get("sent") for m in first["mails"])

    def boom(*a, **k):
        raise AssertionError("must not connect again")
    monkeypatch.setattr(mailops, "connect", boom)
    again = convo_of("INBOX", 31)
    assert again["mails"] == first["mails"] and again["notes"] == []


def test_quoting_and_or_nesting_helpers():
    assert mailops._quoted_id("<a@x>") == '"<a@x>"'
    assert mailops._quoted_id('<a"b\\c@x>') == '"<a\\"b\\\\c@x>"'
    assert mailops._quoted_id("<grüße@x>") is None
    assert mailops._or_search_args(['"a"'], None) == [
        "HEADER", "Message-ID", '"a"']
    assert mailops._or_search_args(['"a"', '"b"', '"c"'], 0) == [
        "OR", "HEADER", "Message-ID", '"a"',
        "OR", "HEADER", "Message-ID", '"b"', "HEADER", "Message-ID", '"c"']
    assert mailops._imap_date(1709287200) == "01-Mar-2024"


# ----------------------------------------------- several mails, one login

def count_connections(monkeypatch):
    real = mailops.connect
    calls = []

    def counting(im, name=None):
        calls.append(name)
        return real(im, name)
    monkeypatch.setattr(mailops, "connect", counting)
    return calls


def test_batch_fetch_uses_one_connection_and_one_fetch_per_folder(
        convo, monkeypatch):
    calls = count_connections(monkeypatch)
    convo.body_fetches.clear()
    res = mailops.fetch_messages(
        [["INBOX", 30], ["Sent", 21], ["INBOX", 31]])
    assert len(calls) == 1
    assert [(r["folder"], r["uid"]) for r in res] == \
        [("INBOX", 30), ("Sent", 21), ("INBOX", 31)]            # order kept
    assert all("error" not in r and r["text"] for r in res)
    assert res[1]["subject"] == "Re: Plan"
    assert sorted(convo.body_fetches) == [("INBOX", [30, 31]), ("Sent", [21])]


def test_unknown_mails_do_not_abort_the_batch(convo):
    res = mailops.fetch_messages([["INBOX", 30], ["INBOX", 999],
                                  ["Archive", 12345]])
    assert "text" in res[0]
    assert res[1]["error"] == "unknown message"
    assert res[2]["error"] == "unknown message"


def test_a_mail_the_server_no_longer_has_reports_an_error_only_for_it(convo):
    convo.mailbox["INBOX"] = [m for m in convo.mailbox["INBOX"]
                              if m["uid"] != 31]      # vanished after the scan
    res = mailops.fetch_messages([["INBOX", 30], ["INBOX", 31]])
    assert "text" in res[0] and res[1]["error"] == "fetch failed"


def test_batch_size_and_shape_are_validated(convo):
    with pytest.raises(ValueError, match="at most"):
        mailops.fetch_messages([["INBOX", 30]] * 21)
    with pytest.raises(ValueError, match="pairs"):
        mailops.fetch_messages([["INBOX"]])
    assert mailops.fetch_messages([]) == []


def test_messages_endpoint(convo):
    r = client.post("/api/messages", json={
        "items": [["INBOX", 30], ["Sent", 21]]})
    assert r.status_code == 200
    msgs = r.json()["messages"]
    assert [m["uid"] for m in msgs] == [30, 21] and msgs[0]["text"]
    assert client.post("/api/messages", json={
        "items": [["INBOX", 30]] * 21}).status_code == 422
    assert client.post("/api/messages", json={
        "items": [["INBOX"]]}).status_code == 400
