"""Host allow-list (no login) and cross-site write refusal (all modes)."""

import pytest
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def _get(host, path="/api/auth", **headers):
    return client.get(path, headers={"Host": host, **headers})


@pytest.fixture
def no_extra(monkeypatch):
    monkeypatch.delenv("MAILBROOM_ALLOWED_HOSTS", raising=False)


@pytest.mark.parametrize("host", [
    "localhost", "localhost:8765", "LOCALHOST:8765", "app.localhost",
    "127.0.0.1:8765", "127.0.0.1", "[::1]", "[::1]:8765", "192.168.1.20:8765",
])
def test_default_hosts_allowed(no_extra, host):
    assert _get(host).status_code == 200


@pytest.mark.parametrize("host", ["nas.lan", "nas.lan:8765", "evil.example",
                                  "localhost.evil.example", ""])
def test_other_hosts_denied(no_extra, host):
    r = _get(host)
    assert r.status_code == 403
    assert r.json()["detail"] == "host_not_allowed"


def test_denied_page_is_escaped_html(no_extra):
    r = client.get("/", headers={"Host": "<b>x</b>.example"})
    assert r.status_code == 403
    assert r.headers["content-type"].startswith("text/html")
    assert "<b>x" not in r.text and "&lt;b&gt;x" in r.text
    assert "MAILBROOM_ALLOWED_HOSTS=" in r.text


def test_env_exact_wildcard_and_star(monkeypatch):
    monkeypatch.setenv("MAILBROOM_ALLOWED_HOSTS",
                       "nas.lan, *.home.example")
    assert _get("NAS.lan:8765").status_code == 200
    assert _get("a.home.example").status_code == 200
    assert _get("a.b.home.example").status_code == 200
    assert _get("home.example").status_code == 403
    assert _get("evilhome.example").status_code == 403
    assert _get("other.lan").status_code == 403
    monkeypatch.setenv("MAILBROOM_ALLOWED_HOSTS", "*")
    assert _get("anything.example").status_code == 200


def test_x_forwarded_host_does_not_pass_the_host_check(no_extra):
    r = _get("evil.example", **{"X-Forwarded-Host": "localhost"})
    assert r.status_code == 403


def _set_password():
    r = client.post("/api/config", headers={"Host": "localhost"}, json={
        "auth": {"mode": "password", "password": "s3cret"}})
    assert r.status_code == 200


def test_host_check_skipped_when_a_login_is_set(no_extra):
    _set_password()
    c = TestClient(app)
    r = c.get("/api/auth", headers={"Host": "nas.lan"})
    assert r.status_code == 200 and r.json()["mode"] == "password"


# ------------------------------------------------------ cross-site writes

def _post(**headers):
    return client.post("/api/logout", headers=headers)


@pytest.mark.parametrize("site,code", [
    ("same-origin", 200), ("none", 200), ("cross-site", 403),
    ("same-site", 403)])
def test_sec_fetch_site(site, code):
    r = _post(**{"Sec-Fetch-Site": site})
    assert r.status_code == code
    if code == 403:
        assert r.json()["detail"] == "cross_site_request"


def test_sec_fetch_site_wins_over_matching_origin():
    r = _post(**{"Sec-Fetch-Site": "cross-site",
                 "Origin": "http://testserver"})
    assert r.status_code == 403


def test_origin_must_match_host_or_forwarded_host():
    assert _post(Origin="http://testserver").status_code == 200
    assert _post(Origin="https://evil.example").status_code == 403
    assert _post(Origin="null").status_code == 403
    assert _post(Origin="https://mail.example",
                 **{"X-Forwarded-Host": "mail.example"}).status_code == 200
    assert _post(Origin="https://evil.example",
                 **{"X-Forwarded-Host": "mail.example"}).status_code == 403


def test_no_origin_headers_allowed_and_gets_unaffected():
    assert _post().status_code == 200
    r = client.get("/api/auth", headers={"Sec-Fetch-Site": "cross-site",
                                         "Origin": "https://evil.example"})
    assert r.status_code == 200


def test_form_post_from_foreign_origin_is_refused():
    r = client.post("/api/config", data={"x": "1"},
                    headers={"Origin": "https://evil.example"})
    assert r.status_code == 403


def test_cross_site_guard_applies_with_a_login(no_extra):
    _set_password()
    c = TestClient(app)
    r = c.post("/api/login", json={"password": "s3cret"},
               headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    r = c.post("/api/login", json={"password": "s3cret"},
               headers={"Origin": "http://testserver"})
    assert r.status_code == 200
