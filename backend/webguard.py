"""Cross-site protection that needs no login: a Host allow-list (DNS
rebinding) while authentication is off, and a same-origin check on writes
in every mode (CSRF). Pure helpers - the middleware lives in main.py."""

from __future__ import annotations

import ipaddress
import os
from html import escape
from urllib.parse import urlsplit

ENV_ALLOWED = "MAILBROOM_ALLOWED_HOSTS"
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def split_host(raw: str) -> str:
    """Host name of a raw Host header: port stripped, lower-cased; an IPv6
    literal keeps its brackets."""
    raw = (raw or "").strip().lower()
    if raw.startswith("["):
        end = raw.find("]")
        return raw[:end + 1] if end != -1 else raw
    return raw.rsplit(":", 1)[0] if ":" in raw else raw


def _is_ip_literal(host: str) -> bool:
    if host.startswith("[") and host.endswith("]"):
        host = host[1:-1]
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def extra_hosts() -> list[str]:
    """MAILBROOM_ALLOWED_HOSTS entries (comma list), lower-cased."""
    raw = os.environ.get(ENV_ALLOWED, "")
    return [h.strip().lower() for h in raw.split(",") if h.strip()]


def host_allowed(raw_host: str) -> bool:
    host = split_host(raw_host)
    if not host:
        return False
    if host == "localhost" or host.endswith(".localhost") \
            or _is_ip_literal(host):
        return True
    for entry in extra_hosts():
        if entry == "*" or entry == host:
            return True
        if entry.startswith("*.") and host.endswith(entry[1:]) \
                and len(host) > len(entry) - 1:
            return True
    return False


def describe_accepted() -> str:
    extra = extra_hosts()
    base = "localhost, *.localhost and IP addresses"
    if "*" in extra:
        return "any host name (MAILBROOM_ALLOWED_HOSTS=*)"
    return base + (", " + ", ".join(extra) if extra else "")


def blocked_page(host: str) -> str:
    h = escape(split_host(host) or "(none)")
    return (
        "<!doctype html><meta charset=utf-8>"
        "<title>Mailbroom - host not allowed</title>"
        "<body style=\"font-family:sans-serif;max-width:40rem;margin:3rem auto;"
        "padding:0 1rem\">"
        "<h1>Host not allowed</h1>"
        f"<p>Mailbroom has no login set and was reached as "
        f"<code>{h}</code>. To stop other websites from reaching it through "
        "your browser, it only answers to localhost and IP addresses in that "
        "case.</p>"
        "<p>Either add "
        f"<code>MAILBROOM_ALLOWED_HOSTS={h}</code> to the container "
        "environment, or open Mailbroom via localhost and turn on a login "
        "(Settings &rarr; Server).</p></body>")


def cross_site_write(method: str, path: str, headers) -> bool:
    """True when a state-changing /api/ request comes from another site.
    No Sec-Fetch-Site and no Origin (curl, scripts) is allowed."""
    if method not in WRITE_METHODS or not path.startswith("/api/"):
        return False
    site = headers.get("sec-fetch-site")
    if site is not None:
        return site.strip().lower() not in ("same-origin", "none")
    origin = headers.get("origin")
    if origin is None:
        return False
    origin_host = urlsplit(origin).netloc.lower()
    allowed = {(headers.get("host") or "").strip().lower()}
    for part in (headers.get("x-forwarded-host") or "").split(","):
        allowed.add(part.strip().lower())
    allowed.discard("")
    return origin_host not in allowed
