"""Headers with raw 8-bit bytes (sent without RFC 2047 encoding) make the
email package return Header objects instead of str. A scan used to skip
such mails entirely (Message-ID / List-Unsubscribe .strip() / slicing) or
file them under "(unparseable sender)" (From). They must scan normally."""

import email

from backend import mailops
from conftest import make_msg


def test_header_text_handles_str_none_and_raw_8bit_header_objects():
    assert mailops.header_text(None) == ""
    assert mailops.header_text("plain") == "plain"
    raw = "Message-ID: <grüße@x.example>\r\n\r\n".encode()
    header = email.message_from_bytes(raw).get("Message-ID")
    assert not isinstance(header, str)            # the premise of the bug
    assert mailops.header_text(header) == "<grüße@x.example>"
    assert mailops.header_text(header).strip()[:300] == "<grüße@x.example>"


def raw_mail(uid, **kw):
    return make_msg(uid, **kw)


def scan_with(bridge, *extra):
    bridge.mailbox["INBOX"] += list(extra)
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    return {m["uid"]: m for m in mailops.INDEX.values()}


def test_mail_with_a_raw_utf8_message_id_is_scanned_not_skipped(bridge):
    idx = scan_with(bridge, raw_mail(
        40, frm="Shop <news@shop.example>", subject="Hallo",
        msgid="<grüße-1@shop.example>"))
    assert 40 in idx
    assert idx[40]["msgid"] == "<grüße-1@shop.example>"
    assert len(mailops.INDEX) == 5 + 1            # nothing was skipped


def test_raw_utf8_sender_is_parsed_not_filed_as_unparseable(bridge):
    idx = scan_with(bridge, raw_mail(
        41, frm="\"Müller, Hans\" <hans@büro.example>", subject="Termin"))
    m = idx[41]
    assert m["addr"] == "hans@büro.example"
    assert m["name"].startswith("Müller")
    assert "(unparseable sender)" not in mailops.STATE["groups"]["sender"]
    assert "hans@büro.example" in mailops.STATE["groups"]["sender"]


def test_raw_utf8_list_unsubscribe_headers_are_kept(bridge):
    idx = scan_with(bridge, raw_mail(
        42, frm="Letter <l@news.example>", subject="Update",
        unsub="<https://news.example/abmelden/ü>", unsub_post=True))
    m = idx[42]
    assert m["bulk"] is True and m["unsub_post"] is True
    assert m["unsub"] == "<https://news.example/abmelden/ü>"


def test_raw_8bit_message_ids_still_thread(bridge):
    idx = scan_with(
        bridge,
        raw_mail(50, frm="a@x.example", subject="Frage", msgid="<ä1@x>",
                 date="01-Mar-2024 10:00:00 +0000"),
        raw_mail(51, frm="b@x.example", subject="Re: Frage", msgid="<ä2@x>",
                 irt="<ä1@x>", refs="<ä1@x>",
                 date="02-Mar-2024 10:00:00 +0000"))
    assert idx[51]["irt"] == ["<ä1@x>"] and idx[51]["refs"] == ["<ä1@x>"]
    thread = next(r for r in mailops.STATE["groups"]["thread"].values()
                  if r["label"] == "Frage")
    assert thread["count"] == 2


def test_raw_8bit_recipients_in_sent_count_as_replied_to(bridge):
    bridge.mailbox["Sent"].append(make_msg(
        60, frm="Me <me@self.example>", subject="Hi",
        to="Jörg Müller <jörg@büro.example>", seen=True))
    mailops.run_scan()
    assert "jörg@büro.example" in mailops.REPLIED_TO


def test_normal_mail_is_unaffected(bridge):
    idx = scan_with(bridge, raw_mail(
        43, frm='"Plain" <plain@x.example>', subject="ASCII only",
        msgid="<plain@x.example>"))
    assert idx[43]["addr"] == "plain@x.example"
    assert idx[43]["msgid"] == "<plain@x.example>"
