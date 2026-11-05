"""One-click unsubscribe cannot be steered to internal addresses: one DNS
lookup, every answer validated, connect to that IP, no redirects, https
only, certificate checked against the host name."""

import datetime
import ipaddress
import socket
import ssl
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from backend import unsub

PUBLIC = "93.184.216.34"


def _answer(*ips):
    return lambda host, port=443, *a, **k: [
        (socket.AF_INET6 if ":" in ip else socket.AF_INET, socket.SOCK_STREAM,
         6, "", (ip, port)) for ip in ips]


@pytest.mark.parametrize("ip", [
    "127.0.0.1", "::1", "10.1.2.3", "192.168.0.9", "172.16.5.5",
    "169.254.169.254", "100.64.0.1", "224.0.0.1", "240.0.0.1", "0.0.0.0",
    "::", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254",
    "fe80::1", "fc00::1", "ff02::1"])
def test_non_public_targets_refused(monkeypatch, ip):
    monkeypatch.setattr(unsub.socket, "getaddrinfo", _answer(ip))
    connected = []
    monkeypatch.setattr(unsub.socket, "create_connection",
                        lambda *a, **k: connected.append(a))
    with pytest.raises(RuntimeError, match="non-public"):
        unsub._post_one_click("https://x.example/u")
    assert not connected


def test_one_private_answer_among_public_ones_refuses(monkeypatch):
    monkeypatch.setattr(unsub.socket, "getaddrinfo",
                        _answer(PUBLIC, "127.0.0.1"))
    connected = []
    monkeypatch.setattr(unsub.socket, "create_connection",
                        lambda *a, **k: connected.append(a))
    with pytest.raises(RuntimeError, match="non-public"):
        unsub._post_one_click("https://x.example/u")
    assert not connected


def test_connects_to_the_validated_ip_with_one_lookup(monkeypatch):
    """DNS answering public first and private afterwards cannot win."""
    answers = iter([[PUBLIC], ["127.0.0.1"], ["127.0.0.1"]])
    lookups = []

    def gai(*a, **k):
        lookups.append(a)
        return _answer(*next(answers))(*a)
    connected = []

    def conn(addr, timeout=None):
        connected.append(addr)
        raise OSError("stop")
    monkeypatch.setattr(unsub.socket, "getaddrinfo", gai)
    monkeypatch.setattr(unsub.socket, "create_connection", conn)
    with pytest.raises(OSError):
        unsub._post_one_click("https://x.example/u")
    assert len(lookups) == 1
    assert connected == [(PUBLIC, 443)]


def test_http_one_click_is_treated_as_a_link():
    hdr = "<http://x.example/u>"
    res = unsub.unsubscribe_addr({}, "a@x.example", hdr, True)
    assert res["status"] == "link"
    # ... and falls to mailto when there is one
    sent = []
    orig = unsub._send_mailto
    unsub._send_mailto = lambda im, uri, name=None: sent.append(uri)
    try:
        res = unsub.unsubscribe_addr(
            {}, "a@x.example", "<http://x.example/u>, <mailto:u@x.example>",
            True)
    finally:
        unsub._send_mailto = orig
    assert res["status"] == "done" and sent == ["mailto:u@x.example"]


# ------------------------------------------------ a real local TLS server

def _cert(tmp_path, name):
    key = ec.generate_private_key(ec.SECP256R1())
    subj = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(subj).issuer_name(subj)
            .public_key(key.public_key()).serial_number(1)
            .not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=1))
            .add_extension(x509.SubjectAlternativeName(
                [x509.DNSName(name)]), False)
            .add_extension(x509.BasicConstraints(ca=True, path_length=None),
                           True)
            .sign(key, hashes.SHA256()))
    cf, kf = tmp_path / f"{name}.pem", tmp_path / f"{name}.key"
    cf.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    kf.write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption()))
    return cf, kf


@pytest.fixture
def server(tmp_path, monkeypatch):
    """-> start(cert_name, reply) -> (port, hits). The host name resolves to
    127.0.0.1 and loopback is declared public ONLY for these tests; the
    client trusts just the server's own certificate."""
    servers = []

    def start(cert_name, status=204, location=None):
        hits = []

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                hits.append((self.path, self.headers["Host"],
                             self.rfile.read(n)))
                self.send_response(status)
                if location:
                    self.send_header("Location", location)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def log_message(self, *a):
                pass
        cf, kf = _cert(tmp_path, cert_name)
        srv = HTTPServer(("127.0.0.1", 0), H)
        sctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        sctx.load_cert_chain(cf, kf)
        srv.socket = sctx.wrap_socket(srv.socket, server_side=True)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        servers.append(srv)
        cctx = ssl.create_default_context(cafile=str(cf))
        monkeypatch.setattr(unsub, "_ssl_context", lambda: cctx)
        monkeypatch.setattr(unsub, "_public_ip",
                            lambda raw: ipaddress.ip_address(raw))
        monkeypatch.setattr(unsub.socket, "getaddrinfo",
                            _answer("127.0.0.1"))
        return srv.server_address[1], hits
    yield start
    for s in servers:
        s.shutdown()
        s.server_close()


def test_one_click_posts_to_the_validated_ip(server):
    port, hits = server("unsub.example")
    unsub._post_one_click(f"https://unsub.example:{port}/o?u=1")
    assert hits == [("/o?u=1", f"unsub.example:{port}",
                     b"List-Unsubscribe=One-Click")]


def test_redirect_is_not_followed_and_counts_as_sent(server):
    # a second server on the redirect target would see a hit if followed
    port2, hits2 = server("other.example")
    port, hits = server("unsub.example", status=302,
                        location=f"https://127.0.0.1:{port2}/internal")
    unsub._post_one_click(f"https://unsub.example:{port}/o")
    assert len(hits) == 1 and hits2 == []


def test_http_error_status_fails(server):
    port, _ = server("unsub.example", status=500)
    with pytest.raises(RuntimeError, match="500"):
        unsub._post_one_click(f"https://unsub.example:{port}/o")


def test_certificate_must_match_the_host_name(server):
    port, hits = server("other.example")
    with pytest.raises(ssl.SSLError):
        unsub._post_one_click(f"https://unsub.example:{port}/o")
    assert hits == []


def test_plain_http_url_refused_for_post():
    with pytest.raises(RuntimeError, match="https"):
        unsub._post_one_click("http://x.example/u")


def test_production_tls_context_verifies_chain_and_name():
    ctx = unsub._ssl_context()
    assert ctx.verify_mode == ssl.CERT_REQUIRED and ctx.check_hostname
