"""One-click unsubscribe via List-Unsubscribe headers (RFC 2369 / 8058).

Three cases:
- https URI + List-Unsubscribe-Post: One-Click  -> automated HTTPS POST
- mailto: URI                                   -> automated mail via Bridge SMTP
- plain https URI                               -> hand the link to the UI

The HTTPS POST is guarded against SSRF: mails could carry URLs pointing at
private/internal addresses, so targets must resolve to public IPs.
"""

from __future__ import annotations

import email.header
import ipaddress
import logging
import re
import smtplib
import socket
import ssl
import urllib.parse
import urllib.request

from . import config as cfgmod
from . import mailops

log = logging.getLogger("pmc.unsub")

_URI_RE = re.compile(r"<([^>]+)>")


def _decode_words(value: str) -> str:
    if not value or "=?" not in value:
        return value or ""
    try:
        return str(email.header.make_header(
            email.header.decode_header(value)))
    except Exception:
        return value


def parse_unsub(header: str, one_click: bool) -> dict:
    """-> {"mailto": str|None, "http": str|None, "one_click": bool}"""
    mailto = http = None
    for uri in _URI_RE.findall(_decode_words(header) or ""):
        u = uri.strip()
        low = u.lower()
        if low.startswith("mailto:") and mailto is None:
            mailto = u
        elif low.startswith(("http://", "https://")) and http is None:
            http = u
    return {"mailto": mailto, "http": http, "one_click": one_click}


def _assert_public_host(url: str) -> None:
    host = urllib.parse.urlparse(url).hostname or ""
    if not host:
        raise RuntimeError("unsubscribe URL has no host")
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError as exc:
        raise RuntimeError(f"cannot resolve {host!r}: {exc}")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            raise RuntimeError(
                f"unsubscribe URL resolves to a non-public address ({ip})")


def _post_one_click(url: str) -> None:
    _assert_public_host(url)
    req = urllib.request.Request(
        url, data=b"List-Unsubscribe=One-Click",
        headers={"Content-Type": "application/x-www-form-urlencoded",
                 "User-Agent": "proton-mail-cleaner"},
        method="POST")
    with urllib.request.urlopen(req, timeout=20) as res:
        if res.status >= 400:
            raise RuntimeError(f"unsubscribe endpoint returned {res.status}")


def _send_mailto(cfg: dict, uri: str) -> None:
    parsed = urllib.parse.urlparse(uri)
    to_addr = urllib.parse.unquote(parsed.path)
    params = dict(urllib.parse.parse_qsl(parsed.query))
    subject = params.get("subject", "unsubscribe")
    body = params.get("body", "unsubscribe")
    im = cfg["imap"]
    sender = im["user"]
    msg = (f"From: {sender}\r\nTo: {to_addr}\r\nSubject: {subject}\r\n"
           f"\r\n{body}\r\n")
    ctx = ssl.create_default_context(cafile=im["cafile"] or None)
    port = int(im.get("smtp_port") or 1025)
    try:
        smtp = smtplib.SMTP_SSL(im["host"], port, timeout=30, context=ctx)
    except (ssl.SSLError, OSError):
        smtp = smtplib.SMTP(im["host"], port, timeout=30)
        smtp.starttls(context=ctx)
    try:
        smtp.login(im["user"], im["password"])
        smtp.sendmail(sender, [to_addr], msg.encode())
    finally:
        try:
            smtp.quit()
        except Exception:
            pass


def unsubscribe(grouping: str, key: str) -> dict:
    """Unsubscribe from a group using its newest mail's List-Unsubscribe."""
    cfg = cfgmod.load_config()
    mails = mailops.group_mails(grouping, key)
    with mailops.STATE_LOCK:
        rec = mailops.STATE["groups"][grouping].get(key)
        if not rec:
            raise RuntimeError("unknown group")
        newest = None
        for m in mails:  # newest first
            idx = mailops.INDEX.get(mailops.ikey(m["folder"], m["uid"]))
            if idx and idx.get("unsub"):
                newest = dict(idx)
                break
    if not newest:
        raise RuntimeError("no List-Unsubscribe header in this group")

    parts = parse_unsub(newest["unsub"], newest["unsub_post"])
    host = urllib.parse.urlparse(parts["http"] or "").hostname or "-"
    log.info("unsubscribe %r: one_click=%s mailto=%s http_host=%s",
             key, parts["one_click"], bool(parts["mailto"]), host)
    if parts["http"] and parts["one_click"]:
        _post_one_click(parts["http"])
        return {"action": "done", "method": "one-click POST",
                "detail": parts["http"]}
    if parts["mailto"]:
        _send_mailto(cfg, parts["mailto"])
        return {"action": "done", "method": "unsubscribe mail sent",
                "detail": parts["mailto"]}
    if parts["http"]:
        # Confirmation pages can't be automated reliably — open in browser.
        return {"action": "link", "method": "open link",
                "detail": parts["http"]}
    raise RuntimeError("could not parse the List-Unsubscribe header")
