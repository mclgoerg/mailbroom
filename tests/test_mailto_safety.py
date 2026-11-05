"""A List-Unsubscribe mailto: comes from a third party and must become one
plain mail to one address - no extra headers, no extra recipients."""

import email

import pytest

from backend import mailops, smtpout, unsub

IM = {"host": "smtp.example", "smtp_host": "", "smtp_port": 465,
      "smtp_security": "ssl", "user": "me@mail.example", "password": "pw",
      "cafile": "", "oauth": None}


@pytest.fixture
def sent(monkeypatch):
    out = []

    class FakeSMTP:
        def __init__(self, *a, **k):
            pass

        def login(self, user, password):
            pass

        def sendmail(self, frm, to, msg):
            out.append((to, msg))

        def quit(self):
            pass
    monkeypatch.setattr(smtpout.smtplib, "SMTP_SSL", FakeSMTP)
    return out


def _go(uri):
    return unsub.unsubscribe_addr(
        IM, "list@x.example", f"<{uri}>", False)


def test_normal_mailto_is_sent_as_one_plain_mail(sent):
    res = _go("mailto:unsub@list.example?subject=Remove%20me&body=Please")
    assert res["status"] == "done"
    (to, raw), = sent
    assert to == ["unsub@list.example"]
    msg = email.message_from_bytes(raw)
    assert msg["Subject"] == "Remove me" and msg["Bcc"] is None
    assert msg.get_payload().strip() == "Please"


def test_a_body_may_hold_plain_newlines_but_never_headers(sent):
    res = _go("mailto:u@list.example?body=line1%0D%0Aline2%0Aline3")
    assert res["status"] == "done"
    msg = email.message_from_bytes(sent[0][1])
    assert list(msg.keys()) == ["From", "To", "Subject"]
    assert "line1" in msg.get_payload() and "line3" in msg.get_payload()


@pytest.mark.parametrize("uri", [
    "mailto:u@list.example?subject=hi%0D%0ABcc:%20spy@evil.example",
    "mailto:u@list.example?subject=hi%0Aspy",
    "mailto:u@list.example?subject=hi%0Dspy",
    "mailto:u@list.example?subject=a%00b",
    "mailto:u@list.example?subject=a%1Bb",
    "mailto:u@list.example?body=a%00b",
    "mailto:u@list.example%0D%0ABcc:spy@evil.example",
    "mailto:u@list.example,spy@evil.example",
    "mailto:u@list.example;spy@evil.example",
    "mailto:u@list.example%20spy@evil.example",
    "mailto:%3Cu@list.example%3E",
    "mailto:Name%20%3Cu@list.example%3E",
    "mailto:noat",
    "mailto:",
])
def test_unsafe_mailto_is_refused_and_nothing_is_sent(sent, uri):
    res = _go(uri)
    assert res["status"] == "failed"
    assert res["error"] == mailops.MAILTO_UNSAFE
    assert sent == []


def test_http_link_next_to_unsafe_mailto_is_not_affected(sent):
    res = unsub.unsubscribe_addr(
        IM, "l@x.example", "<https://x.example/u>", False)
    assert res["status"] == "link" and sent == []


def test_html_mail_path_is_unchanged(sent):
    smtpout.send(IM, "you@x.example", "Digest", "plain\nbody", "<b>x</b>")
    assert len(sent) == 1
