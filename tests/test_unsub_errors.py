"""Every unsubscribe failure reaches the user as a stable code the UI words
in their language - never raw exception text - and a failed single
unsubscribe is a handled 4xx whose detail is that code."""

import re
import smtplib
import socket
import ssl

import pytest
from fastapi.testclient import TestClient

from backend import errortext, mailops, unsub
from backend.main import app
from conftest import FakeIMAP, make_msg

client = TestClient(app)
IM = {"host": "smtp.example", "smtp_host": "", "smtp_port": 465,
      "smtp_security": "ssl", "user": "me@mail.example", "password": "pw",
      "cafile": "", "oauth": None}
ONE_CLICK = "<https://x.example/u>"
CODE = re.compile(r"[a-z_]+(:status=\d+)?")


def _fail(monkeypatch, exc, header=ONE_CLICK, one_click=True):
    def boom(*a, **k):
        raise exc
    monkeypatch.setattr(unsub, "_post_one_click", boom)
    monkeypatch.setattr(unsub, "_send_mailto", boom)
    return unsub.unsubscribe_addr(IM, "a@x.example", header, one_click)


@pytest.mark.parametrize("exc,code", [
    (ssl.SSLCertVerificationError("hostname mismatch"), mailops.UNSUB_TLS),
    (ssl.SSLError("handshake"), mailops.UNSUB_TLS),
    (TimeoutError("timed out"), mailops.UNSUB_TIMEOUT),
    (socket.timeout("t"), mailops.UNSUB_TIMEOUT),
    (ConnectionRefusedError("no"), mailops.UNSUB_UNREACHABLE),
    (OSError("Network is unreachable"), mailops.UNSUB_UNREACHABLE),
    (ValueError("Invalid IPv6 URL"), mailops.UNSUB_BAD_URL),
    (RuntimeError("some surprise at /home/me/secret.py"),
     mailops.UNSUB_FAILED),
    (KeyError("x"), mailops.UNSUB_FAILED),
])
def test_http_failure_classes(monkeypatch, exc, code):
    res = _fail(monkeypatch, exc)
    assert res["status"] == "failed" and res["error"] == code


@pytest.mark.parametrize("exc", [
    smtplib.SMTPAuthenticationError(535, b"bad"),
    smtplib.SMTPRecipientsRefused({}), ConnectionRefusedError("smtp"),
    TimeoutError("smtp"), RuntimeError("OAuth not connected")])
def test_mail_failures(monkeypatch, exc):
    res = _fail(monkeypatch, exc, "<mailto:u@list.example>", False)
    assert res["error"] == mailops.UNSUB_MAIL_FAILED


def test_a_coded_refusal_passes_through(monkeypatch):
    res = _fail(monkeypatch, ValueError(mailops.MAILTO_UNSAFE),
                "<mailto:u@list.example>", False)
    assert res["error"] == mailops.MAILTO_UNSAFE


def test_blocked_address_and_http_status_and_no_method(monkeypatch):
    monkeypatch.setattr(unsub.socket, "getaddrinfo",
                        lambda host, port=0, *a, **k: [
                            (2, 1, 6, "", ("10.0.0.5", port))])
    res = unsub.unsubscribe_addr(IM, "a@x.example", ONE_CLICK, True)
    assert res["error"] == mailops.UNSUB_BLOCKED

    class Resp:
        status = 503

    class Conn:
        def __init__(self, *a, **k):
            pass

        def request(self, *a, **k):
            pass

        def getresponse(self):
            return Resp()

        def close(self):
            pass
    monkeypatch.setattr(unsub.socket, "getaddrinfo",
                        lambda host, port=0, *a, **k: [
                            (2, 1, 6, "", ("93.184.216.34", port))])
    monkeypatch.setattr(unsub, "_PinnedHTTPSConnection", Conn)
    res = unsub.unsubscribe_addr(IM, "a@x.example", ONE_CLICK, True)
    assert res["error"] == "unsub_http:status=503"

    res = unsub.unsubscribe_addr(IM, "a@x.example", "garbage", False)
    assert res["error"] == mailops.UNSUB_NO_METHOD


def test_every_unsub_code_has_english_text_and_no_raw_words():
    for code in mailops.UNSUB_CODES:
        assert code in errortext.TEXT
    assert errortext.describe("unsub_http:status=503") == \
        "The sender's unsubscribe page answered with error 503."


# ------------------------------------------------------------- the API

@pytest.fixture
def server(monkeypatch):
    fake = FakeIMAP({"INBOX": [
        make_msg(1, frm="News <news@shop.example>",
                 unsub="<mailto:u@list.example?subject=a%0D%0ABcc:x@y.example>"),
        make_msg(2, frm="Other <o@other.example>",
                 unsub="<https://other.example/u>", unsub_post=True),
        make_msg(3, frm="Plain <p@plain.example>")],
        "Trash": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    return fake


def _post(key):
    return client.post("/api/unsubscribe",
                       json={"grouping": "sender", "key": key})


def test_api_refusal_is_a_4xx_with_the_code_as_detail(server):
    r = _post("news@shop.example")
    assert r.status_code == 400 and r.json()["detail"] == "mailto_unsafe"


def test_api_no_header_is_a_coded_4xx(server):
    r = _post("p@plain.example")
    assert r.status_code == 400 and r.json()["detail"] == "unsub_no_method"


def test_api_unknown_group_is_coded(server):
    r = _post("nobody@nowhere.example")
    assert r.status_code == 400 and r.json()["detail"] == "unsub_unknown_group"


def test_api_unexpected_failure_hides_the_exception(server, monkeypatch):
    def boom(*a, **k):
        raise KeyError("/srv/secret/path")
    monkeypatch.setattr(unsub, "unsubscribe_addr", boom)
    r = _post("other@other.example".replace("other@", "o@"))
    assert r.status_code == 500 and r.json()["detail"] == "unsub_failed"
    assert "secret" not in r.text


def test_api_http_failure_code_with_status(server, monkeypatch):
    def boom(url):
        raise RuntimeError(mailops.coded(mailops.UNSUB_HTTP, status=410))
    monkeypatch.setattr(unsub, "_post_one_click", boom)
    r = _post("o@other.example")
    assert r.status_code == 400 and r.json()["detail"] == "unsub_http:status=410"
    assert CODE.fullmatch(r.json()["detail"])
