"""Opening an IMAP connection gives up quickly and says what went wrong:
each way a wrong host / port / security choice shows up, against a real
socket on 127.0.0.1 (a closed port, a listener that closes, one that says
nothing, a plain IMAP banner, a TLS server), as the coded error the UI
words in the user's language."""

from __future__ import annotations

import shutil
import socket
import ssl
import subprocess
import threading
import time

import pytest
from fastapi.testclient import TestClient

from backend import config as cfgmod
from backend import mailops
from backend.main import app

client = TestClient(app)


class Listener:
    """A one-shot-per-connection TCP server on 127.0.0.1; `handler(conn)`
    runs in a thread per connection."""

    def __init__(self, handler):
        self.sock = socket.socket()
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(5)
        self.port = self.sock.getsockname()[1]
        self.handler = handler
        self.conns: list[socket.socket] = []
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            self.conns.append(conn)
            threading.Thread(target=self._run, args=(conn,),
                             daemon=True).start()

    def _run(self, conn):
        try:
            self.handler(conn)
        except OSError:
            pass

    def close(self):
        self.sock.close()
        for c in self.conns:
            try:
                c.close()
            except OSError:
                pass


@pytest.fixture
def listener():
    made = []

    def make(handler):
        made.append(Listener(handler))
        return made[-1]
    yield make
    for lis in made:
        lis.close()


def _im(port, security="ssl", **kw):
    return {"host": "127.0.0.1", "port": port, "security": security,
            "user": "u@example.test", "password": "pw", "cafile": "", **kw}


def _fail(im) -> str:
    with pytest.raises(Exception) as err:
        mailops.connect(im)
    return mailops.error_text(err.value, im["host"])


def _closing(conn):
    conn.close()


def _silent(conn):
    time.sleep(5)


def _plain_banner(conn):
    conn.sendall(b"* OK IMAP ready\r\n")
    conn.recv(100)
    time.sleep(1)


def _imap(conn, login_reply=b"NO [AUTHENTICATIONFAILED] Invalid credentials",
          caps=b"IMAP4rev1"):
    """Greeting, then answers CAPABILITY (which imaplib sends on connect)
    and LOGIN."""
    conn.sendall(b"* OK IMAP ready\r\n")
    f = conn.makefile("rb")
    for line in f:
        tag, _, cmd = line.decode().strip().partition(" ")
        tag = tag.encode()
        if cmd.upper().startswith("CAPABILITY"):
            conn.sendall(b"* CAPABILITY " + caps + b"\r\n" + tag
                         + b" OK done\r\n")
        else:
            conn.sendall(tag + b" " + login_reply + b"\r\n")


def _closed_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def test_a_closed_port_is_refused_not_unreachable():
    assert _fail(_im(_closed_port())) == "conn_refused:host=127.0.0.1"


def test_an_unknown_host_is_not_found():
    im = _im(993, host="nonexistent.invalid")
    assert _fail(im) == "host_not_found:host=nonexistent.invalid"


def test_a_silent_listener_times_out_quickly(listener, monkeypatch):
    """SSL/TLS against a port that waits for us: nothing to say but that
    nothing answered."""
    monkeypatch.setattr(mailops, "CONNECT_TIMEOUT", 0.5)
    lis = listener(_silent)
    t0 = time.monotonic()
    assert _fail(_im(lis.port, "ssl")) == "conn_timeout:host=127.0.0.1"
    assert time.monotonic() - t0 < 4


def test_starttls_against_a_port_that_waits_for_tls_or_http(listener,
                                                            monkeypatch):
    """The TCP connect works, then nothing is said: an implicit-TLS port
    (993) waits for a ClientHello, a web server for a request. Not 'check
    your network' - the port answered."""
    monkeypatch.setattr(mailops, "CONNECT_TIMEOUT", 0.5)
    lis = listener(_silent)
    t0 = time.monotonic()
    assert _fail(_im(lis.port, "starttls")) == "tls_mismatch:host=127.0.0.1"
    assert time.monotonic() - t0 < 4


def test_a_tcp_connect_that_times_out_is_conn_timeout(monkeypatch):
    def hang(*a, **kw):
        raise TimeoutError("timed out")
    monkeypatch.setattr(socket, "create_connection", hang)
    for security in ("ssl", "starttls"):
        assert _fail(_im(993, security)) == "conn_timeout:host=127.0.0.1"


def test_the_connect_timeout_is_bounded_and_operations_keep_theirs():
    assert mailops.CONNECT_TIMEOUT <= 15
    assert mailops.OPERATION_TIMEOUT >= 120


def test_ssl_against_a_plain_imap_port_says_try_the_other_security(listener):
    lis = listener(_plain_banner)
    assert _fail(_im(lis.port, "ssl")) == "tls_mismatch:host=127.0.0.1"


def test_ssl_against_a_listener_that_closes_says_the_same(listener):
    lis = listener(_closing)
    assert _fail(_im(lis.port, "ssl")) == "tls_mismatch:host=127.0.0.1"


def test_starttls_against_a_server_without_it(listener):
    def no_starttls(conn):
        _imap(conn, caps=b"IMAP4rev1 AUTH=PLAIN")
    lis = listener(no_starttls)
    assert _fail(_im(lis.port, "starttls")) == "tls_mismatch:host=127.0.0.1"


def _smtp_banner(conn):
    conn.sendall(b"220 smtp.example ESMTP ready\r\n")
    time.sleep(1)


def test_starttls_against_an_smtp_banner_is_not_imap(listener):
    lis = listener(_smtp_banner)
    assert _fail(_im(lis.port, "starttls")) == "not_imap:host=127.0.0.1"


def test_starttls_against_a_listener_that_closes(listener):
    lis = listener(_closing)
    assert _fail(_im(lis.port, "starttls")) == "not_imap:host=127.0.0.1"


@pytest.fixture
def tls_server(listener, tmp_path):
    """`serve(handler)` -> (Listener, CA file): a TLS server with a fresh
    self-signed certificate for 127.0.0.1; `handler(tls_conn)` talks IMAP."""
    if not shutil.which("openssl"):
        pytest.skip("needs openssl")
    key, crt = tmp_path / "k.pem", tmp_path / "c.pem"
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days",
         "1", "-subj", "/CN=127.0.0.1", "-addext",
         "subjectAltName=IP:127.0.0.1", "-keyout", str(key), "-out",
         str(crt)], check=True, capture_output=True)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(crt, key)

    def serve(handler):
        def wrapped(conn):
            with ctx.wrap_socket(conn, server_side=True) as tls:
                handler(tls)
        return listener(wrapped), str(crt)
    return serve


def _greet(tls):
    _imap(tls)


def test_an_untrusted_certificate_points_to_the_ca_field(tls_server):
    lis, crt = tls_server(_greet)
    assert _fail(_im(lis.port)) == "cert_failed:host=127.0.0.1"


def test_a_connected_socket_gets_the_long_timeout(tls_server):
    lis, crt = tls_server(_greet)
    im = _im(lis.port, cafile=crt)
    conn = mailops._open(im, mailops.tls_context(im))
    assert conn.sock.gettimeout() == mailops.OPERATION_TIMEOUT


def test_a_refused_sign_in_is_auth_failed(tls_server):
    lis, crt = tls_server(_greet)
    assert _fail(_im(lis.port, cafile=crt)) == "auth_failed"


def test_the_test_connection_endpoint_reports_the_code(monkeypatch):
    port = _closed_port()
    monkeypatch.setattr(cfgmod, "account_imap", lambda name=None: _im(port))
    monkeypatch.setattr(cfgmod, "has_credentials", lambda im: True)
    r = client.post("/api/test_connection")
    assert r.status_code == 502
    assert r.json()["detail"] == "conn_refused:host=127.0.0.1"


def test_midsession_errors_are_not_reclassified_as_not_imap():
    import imaplib
    assert mailops.error_text(imaplib.IMAP4.abort("socket error: EOF"),
                              "h") \
        == "abort: socket error: EOF"


def _acct_cfg(password):
    cfgmod.update_config({"imap": {"host": "127.0.0.1", "port": 1,
                                   "user": "u@example.test",
                                   "password": password}})
    return cfgmod.account_imap("default")


def test_a_test_that_ends_after_the_sign_in_changed_verifies_nothing(
        monkeypatch):
    """Test with password A, cancel, save password B (unverified again),
    then A's test comes back OK: B was never tested."""
    _acct_cfg("A")
    assert cfgmod.account_imap("default")["verified"] is False

    class Conn:
        def logout(self):
            pass

    def slow_ok(im, name=None):
        _acct_cfg("B")                      # saved while the test runs
        return Conn()
    monkeypatch.setattr(mailops, "connect", slow_ok)
    monkeypatch.setattr(mailops, "selectable_folders", lambda c: ["INBOX"])
    r = client.post("/api/test_connection")
    assert r.status_code == 200
    assert cfgmod.account_imap("default")["verified"] is False


def test_an_unchanged_sign_in_is_still_verified_by_its_test(monkeypatch):
    _acct_cfg("A")

    class Conn:
        def logout(self):
            pass
    monkeypatch.setattr(mailops, "connect", lambda im, name=None: Conn())
    monkeypatch.setattr(mailops, "selectable_folders", lambda c: ["INBOX"])
    assert client.post("/api/test_connection").status_code == 200
    assert cfgmod.account_imap("default")["verified"] is True
