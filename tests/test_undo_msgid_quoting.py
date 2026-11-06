"""Undo looks mails up by Message-ID. The id is mail data: quotes, quote
escapes and header-search look-alikes must neither break the search nor
change what it matches."""

import imaplib

from backend import mailops
from conftest import make_msg, wait_delete_done

QUOTE = '<a"b@x.example>'
INJECT = '" ALL HEADER Message-ID "'
BACKSLASH = "<c\\d@x.example>"
UNICODE = "<ü@x.example>"


def _search_conn(msgs):
    from conftest import FakeIMAP
    fake = FakeIMAP({"INBOX": msgs})
    fake.select("INBOX")
    return fake


def test_search_matches_only_the_exact_id():
    fake = _search_conn([make_msg(1, msgid=QUOTE), make_msg(2, msgid=INJECT),
                         make_msg(3, msgid=BACKSLASH),
                         make_msg(4, msgid=UNICODE),
                         make_msg(5, msgid="<plain@x.example>")])
    assert mailops._search_message_id(fake, QUOTE) == [b"1"]
    assert mailops._search_message_id(fake, INJECT) == [b"2"]
    assert mailops._search_message_id(fake, BACKSLASH) == [b"3"]
    assert mailops._search_message_id(fake, UNICODE) == [b"4"]   # literal
    assert mailops._search_message_id(fake, "<nope@x.example>") == []


def test_a_message_id_the_server_refuses_finds_nothing():
    class Conn:
        literal = None

        def uid(self, *a):
            raise imaplib.IMAP4.error("SEARCH BAD")

    assert mailops._search_message_id(Conn(), "<a@x.example>") == []
    assert mailops._search_message_id(Conn(), "a\0b") == []


def test_present_check_skips_what_it_cannot_search():
    fake = _search_conn([make_msg(1, msgid=QUOTE)])
    present = mailops._present_in_targets(
        fake, [("INBOX", QUOTE), ("INBOX", INJECT), ("INBOX", "a\0b")])
    assert present == {("INBOX", QUOTE)}


def test_undo_restores_odd_ids_and_leaves_bystanders(bridge):
    inbox = bridge.mailbox["INBOX"]
    inbox[0]["msgid"] = QUOTE
    inbox[1]["msgid"] = INJECT
    bridge.mailbox["Trash"].append(
        make_msg(30, msgid="<bystander@x.example>", seen=True))
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    mailops.delete_groups("sender", ["noreply@dhl.example",
                                     "news@shop.example"])
    assert wait_delete_done()["moved"] == 4
    assert {m["uid"] for m in bridge.mailbox["Trash"]} >= {30}

    r = mailops.undo_last()
    assert r["restored"] == 4, r
    assert {m["msgid"] for m in bridge.mailbox["INBOX"]} >= {
        QUOTE, INJECT, "<m4@shop.example>"}
    # The look-alike id did not drag the unrelated Trash mail along.
    assert [m["msgid"] for m in bridge.mailbox["Trash"]] == [
        "<bystander@x.example>"]


def test_search_is_exact_although_servers_match_substrings():
    fake = _search_conn([make_msg(1, msgid="<old1@bank.example>"),
                         make_msg(2, msgid="bank.example"),
                         make_msg(3, msgid="<OLD3@Bank.example>"),
                         make_msg(4, msgid="@")])
    assert mailops._search_message_id(fake, "bank.example") == [b"2"]
    assert mailops._search_message_id(fake, "@") == [b"4"]
    assert mailops._search_message_id(fake, "<old1@bank.example>") == [b"1"]


def test_undo_with_crafted_short_ids_restores_exactly_the_entry(bridge):
    inbox = bridge.mailbox["INBOX"]
    inbox[0]["msgid"] = "bank.example"
    inbox[1]["msgid"] = "@"
    bridge.mailbox["Trash"] += [
        make_msg(30 + i, msgid=f"<old{i}@bank.example>", seen=True)
        for i in range(3)]
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    mailops.delete_groups("sender", ["noreply@dhl.example",
                                     "news@shop.example"])
    assert wait_delete_done()["moved"] == 4
    r = mailops.undo_last()
    assert r["restored"] == 4, r
    assert {m["msgid"] for m in bridge.mailbox["INBOX"]} >= {
        "bank.example", "@", "<m4@shop.example>"}
    assert sorted(m["uid"] for m in bridge.mailbox["Trash"]) == [30, 31, 32]


def test_non_ascii_id_retries_without_charset():
    fake = _search_conn([make_msg(1, msgid=UNICODE)])
    real = fake.uid

    def picky(cmd, *args):
        if "CHARSET" in args:
            raise imaplib.IMAP4.error("SEARCH BAD [BADCHARSET]")
        return real(cmd, *args)

    fake.uid = picky
    assert mailops._search_message_id(fake, UNICODE) == [b"1"]


def _no_for(fake, bad_ids):
    """Server answering NO to searches for the given ids only."""
    real = fake.uid

    def uid(cmd, *args):
        if cmd == "SEARCH" and "HEADER" in args:
            lit = fake.literal.decode() if fake.literal else None
            quoted = [a.strip('"').replace('\\"', '"') for a in args[-1:]]
            if (lit or quoted[0]) in bad_ids:
                return "NO", [b"search error: can't search that criteria"]
        return real(cmd, *args)

    fake.uid = uid


def test_a_no_for_one_id_skips_only_that_id(bridge):
    inbox = bridge.mailbox["INBOX"]
    inbox[0]["msgid"] = "<odd1@x.example>"
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    mailops.delete_groups("sender", ["noreply@dhl.example",
                                     "news@shop.example"])
    assert wait_delete_done()["moved"] == 4
    _no_for(bridge, {"<odd1@x.example>"})
    r = mailops.undo_last()
    assert r["restored"] == 3 and r["of"] == 4, r
    assert [m["msgid"] for m in bridge.mailbox["Trash"]] == [
        "<odd1@x.example>"]
    assert mailops.STATE["undo"] == []          # consumed, like an unfindable mail


def test_non_ascii_id_with_no_for_both_charset_tries_is_skipped():
    fake = _search_conn([make_msg(1, msgid=UNICODE),
                         make_msg(2, msgid="<ok@x.example>")])
    _no_for(fake, {UNICODE})
    assert mailops._search_message_id(fake, UNICODE) == []
    assert mailops._search_message_id(fake, "<ok@x.example>") == [b"2"]


def test_a_no_for_every_search_raises():
    fake = _search_conn([make_msg(1, msgid="<a@x.example>")])
    real = fake.uid
    fake.uid = lambda cmd, *a: (("NO", [b"try later"]) if cmd == "SEARCH"
                                else real(cmd, *a))
    import pytest
    with pytest.raises(imaplib.IMAP4.error):
        mailops._search_message_id(fake, "<a@x.example>")
