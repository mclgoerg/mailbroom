"""One-click unsubscribe via List-Unsubscribe headers (RFC 2369 / 8058).

Three cases:
- https URI + List-Unsubscribe-Post: One-Click  -> automated HTTPS POST
- mailto: URI                                   -> automated mail via Bridge SMTP
- plain https URI                               -> hand the link to the UI

The HTTPS POST is guarded against SSRF: mails could carry URLs pointing at
private/internal addresses, so the host is resolved once, every address must
be public, the connection goes to that validated IP, and redirects are never
followed.

A whole selection of groups can be unsubscribed at once: that runs as a
background job (one sender at a time - these are outbound requests to
third parties, they must not be fired in parallel), and every outcome is
persisted per sender in unsubstore, so the group list keeps showing what
is already handled after a rescan or a restart.
"""

from __future__ import annotations

import email.header
import http.client
import ipaddress
import logging
import re
import smtplib
import socket
import ssl
import threading
import time
import urllib.parse

from . import accounts
from . import auditlog
from . import config as cfgmod
from . import mailops
from . import smtpout
from . import tenants
from . import unsubstore

log = logging.getLogger("pmc.unsub")

# One bulk run is capped like a rule run: the user selected groups, not
# senders, and a domain grouping can hide hundreds of them.
JOB_CAP = 200

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


def _public_ip(raw: str):
    """The address as ipaddress object if it is a public unicast address,
    else None. IPv4-mapped IPv6 is judged by the IPv4 address inside; the
    list is explicit because `is_global` alone lets multicast through."""
    ip = ipaddress.ip_address(raw.split("%", 1)[0])
    if ip.version == 6 and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    if (ip.is_loopback or ip.is_private or ip.is_link_local
            or (ip.version == 6 and ip.is_site_local)
            or ip.is_multicast or ip.is_reserved or ip.is_unspecified
            or not ip.is_global):
        return None
    return ip


def _resolve_public(host: str, port: int) -> list[str]:
    """Resolve ONCE and return the addresses to connect to; every one of
    them must be public, so no answer of a mixed record can win."""
    if not host:
        raise RuntimeError(mailops.coded(mailops.UNSUB_BAD_URL))
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise RuntimeError(mailops.coded(mailops.UNSUB_UNREACHABLE))
    addrs: list[str] = []
    for info in infos:
        raw = info[4][0]
        if _public_ip(raw) is None:
            raise RuntimeError(mailops.coded(mailops.UNSUB_BLOCKED))
        if raw not in addrs:
            addrs.append(raw)
    if not addrs:
        raise RuntimeError(mailops.coded(mailops.UNSUB_UNREACHABLE))
    return addrs


def _ssl_context() -> ssl.SSLContext:
    return ssl.create_default_context()     # verifies chain + host name


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """HTTPS to an address we already validated: no second DNS lookup, TLS
    (SNI + certificate check) still against the original host name."""

    def __init__(self, host: str, port: int, ip: str, timeout: float):
        super().__init__(host, port, timeout=timeout, context=_ssl_context())
        self._ip = ip

    def connect(self):
        sock = socket.create_connection((self._ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def _post_one_click(url: str) -> None:
    parts = urllib.parse.urlparse(url)
    if parts.scheme.lower() != "https":
        raise RuntimeError(mailops.coded(mailops.UNSUB_BAD_URL))
    host, port = parts.hostname or "", parts.port or 443
    last: Exception | None = None
    for ip in _resolve_public(host, port):
        conn = _PinnedHTTPSConnection(host, port, ip, 20)
        try:
            conn.request(
                "POST", (parts.path or "/")
                + (f"?{parts.query}" if parts.query else ""),
                body=b"List-Unsubscribe=One-Click",
                headers={"Content-Type": "application/x-www-form-urlencoded",
                         "User-Agent": "inboxrake"})
            status = conn.getresponse().status
        except (OSError, http.client.HTTPException) as exc:
            last = exc          # try the next validated address
            continue
        finally:
            conn.close()
        # Redirects are never followed: a 3xx means the sender's server took
        # the request, and where it points is not ours to chase.
        if status >= 400:
            raise RuntimeError(
                mailops.coded(mailops.UNSUB_HTTP, status=status))
        return
    raise last or RuntimeError(mailops.coded(mailops.UNSUB_UNREACHABLE))


def _send_mailto(im: dict, uri: str, account_name: str | None = None) -> None:
    parsed = urllib.parse.urlparse(uri)
    to_addr = urllib.parse.unquote(parsed.path)
    params = dict(urllib.parse.parse_qsl(parsed.query))
    subject = params.get("subject", "unsubscribe")
    body = params.get("body", "unsubscribe")
    smtpout.send(im, to_addr, subject, body, account_name=account_name)


def classify(exc: Exception, mail: bool = False) -> str:
    """The coded failure of an unsubscribe attempt. Never carries raw
    exception text (the UI words the code; details go to the log). `mail`
    = the attempt was an unsubscribe mail, not an HTTPS POST."""
    if mailops.is_coded(str(exc)):
        return str(exc)
    if isinstance(exc, smtplib.SMTPException) or (
            mail and isinstance(exc, (OSError, RuntimeError))):
        return mailops.UNSUB_MAIL_FAILED
    if isinstance(exc, ssl.SSLError):
        return mailops.UNSUB_TLS
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return mailops.UNSUB_TIMEOUT
    if isinstance(exc, (OSError, http.client.HTTPException)):
        return mailops.UNSUB_UNREACHABLE
    if isinstance(exc, ValueError):          # e.g. "https://[::1/u"
        return mailops.UNSUB_BAD_URL
    return mailops.UNSUB_FAILED


def unsubscribe_addr(im: dict, addr: str, header: str, one_click: bool,
                     account_name: str | None = None) -> dict:
    """Act on ONE sender's List-Unsubscribe header. Never raises - returns
    {"status": "done"|"link"|"failed", "method", "detail", "error"} so a
    bulk run is not aborted by a single dead endpoint."""
    parts = parse_unsub(header, one_click)
    try:
        host = urllib.parse.urlparse(parts["http"] or "").hostname or "-"
    except ValueError:          # e.g. "https://[::1/u" - fails below, too
        host = "-"
    log.info("unsubscribe %r: one_click=%s mailto=%s http_host=%s",
             addr, parts["one_click"], bool(parts["mailto"]), host)
    mailing = False
    try:
        # RFC 8058: one-click is https only; an http URL is a plain link.
        if (parts["http"] and parts["one_click"]
                and parts["http"].lower().startswith("https://")):
            _post_one_click(parts["http"])
            return {"status": "done", "method": "one-click POST",
                    "detail": parts["http"], "error": ""}
        if parts["mailto"]:
            mailing = True
            _send_mailto(im, parts["mailto"], account_name)
            return {"status": "done", "method": "unsubscribe mail sent",
                    "detail": parts["mailto"], "error": ""}
        if parts["http"]:
            # Confirmation pages can't be automated reliably - open in browser.
            return {"status": "link", "method": "open link",
                    "detail": parts["http"], "error": ""}
    except Exception as exc:
        log.warning("unsubscribe %r failed: %s: %s", addr,
                    type(exc).__name__, exc)
        return {"status": "failed", "method": "", "detail": "",
                "error": classify(exc, mail=mailing)}
    return {"status": "failed", "method": "", "detail": "",
            "error": mailops.UNSUB_NO_METHOD}


def unsubscribe(grouping: str, key: str, acc=None) -> dict:
    """Unsubscribe from a group using its newest mail's List-Unsubscribe.
    Synchronous (one sender, triggered from a group's detail view); the
    outcome is recorded like a bulk run's."""
    acc = acc or accounts.get()
    mails = mailops.group_mails(grouping, key, acc=acc)
    with acc.lock:
        rec = acc.state["groups"][grouping].get(key)
        if not rec:
            raise RuntimeError(mailops.coded(mailops.UNSUB_UNKNOWN_GROUP))
        if _pooled(grouping, rec):
            raise RuntimeError(mailops.coded(mailops.UNSUB_POOLED))
        newest = None
        for m in mails:  # newest first
            idx = acc.index.get(mailops.ikey(m["folder"], m["uid"]))
            if idx and idx.get("unsub"):
                newest = dict(idx)
                break
    if not newest:
        raise RuntimeError(mailops.coded(mailops.UNSUB_NO_METHOD))

    res = unsubscribe_addr(cfgmod.account_imap(acc.name), newest["addr"],
                           newest["unsub"], newest["unsub_post"], acc.name)
    if res["status"] == "failed":
        auditlog.record("unsubscribe", account=acc.name, count=1,
                        label=newest["addr"], outcome="failed",
                        error=res["error"])
        raise RuntimeError(res["error"])
    unsubstore.record(newest["addr"], res["status"], res["method"],
                      res["detail"], account=acc.name)
    auditlog.record("unsubscribe", account=acc.name, count=1,
                    label=newest["addr"], outcome=res["status"])
    with acc.lock:
        acc.state["groups_rev"] += 1
    return {"action": res["status"], "method": res["method"],
            "detail": res["detail"], "addr": newest["addr"]}


def acknowledge(addr: str, acc=None) -> dict:
    """Mark a sender whose unsubscribe needed a confirmation page as done
    (the user confirmed it in their browser)."""
    acc = acc or accounts.get()
    entry = unsubstore.record(addr, "done", "confirmed by hand",
                              account=acc.name)
    with acc.lock:
        acc.state["groups_rev"] += 1
    return entry


def forget(addr: str, acc=None) -> dict:
    """Drop a sender's record, so it can be tried again."""
    acc = acc or accounts.get()
    unsubstore.forget(addr, acc.name)
    with acc.lock:
        acc.state["groups_rev"] += 1
    return {"ok": True}


# ----------------------------------------------------------- bulk unsubscribe

def _pooled(grouping: str, rec: dict) -> bool:
    """A pooled Smart row (a company or a bucket of senders), as opposed to a
    big sender's own row: unsubscribing is a per-sender action, so a pool
    never unsubscribes everyone in it at once."""
    return grouping == "smart" and rec.get("kind") not in (None, "sender")


def _targets(grouping: str, keys: list[str], acc) -> tuple[list, int, int, int]:
    """Senders of the selected groups that still need an unsubscribe
    (lock held): -> ([(addr, header, one_click)], skipped_protected,
    skipped_done). Protected senders are left alone exactly like they are
    in bulk trash and rule runs. Pooled Smart rows are skipped (counted)."""
    plist = cfgmod.normalize_protected(cfgmod.load_config().get("protected"))
    handled = {a for a, e in unsubstore.load_account(acc.name).items()
               if e["status"] == "done"}
    recs = acc.state["groups"][grouping]
    targets: dict[str, tuple[str, bool]] = {}
    skipped_protected: set[str] = set()
    skipped_done: set[str] = set()
    pooled = 0
    for key in keys:
        rec = recs.get(key)
        if not rec:
            continue
        if _pooled(grouping, rec):
            pooled += 1
            continue
        for addr, (header, one_click) in \
                mailops.group_unsub_senders(rec, acc).items():
            if addr in targets or addr in skipped_protected \
                    or addr in skipped_done:
                continue
            if cfgmod.is_protected(addr, plist):
                skipped_protected.add(addr)
            elif addr in handled:
                skipped_done.add(addr)
            else:
                targets[addr] = (header, one_click)
    items = [(a, h, oc) for a, (h, oc) in sorted(targets.items())]
    return items, len(skipped_protected), len(skipped_done), pooled


def _run_bulk(acc, items: list) -> None:
    total = len(items)
    t0 = time.time()
    log.info("[%s] bulk unsubscribe started: %d senders", acc.name, total)
    cancelled = False
    try:
        im = cfgmod.account_imap(acc.name)
        for i, (addr, header, one_click) in enumerate(items, 1):
            if mailops.cancel_requested("unsub", acc):
                cancelled = True
                break
            res = unsubscribe_addr(im, addr, header, one_click, acc.name)
            # Persisted per sender, not at the end: a cancel or a crash must
            # not lose the senders that were already dealt with.
            unsubstore.record(addr, res["status"], res["method"],
                              res["detail"], res["error"], acc.name)
            auditlog.record("unsubscribe", account=acc.name, count=1,
                            label=addr, outcome=res["status"],
                            error=res.get("error", ""))
            with acc.lock:
                st = acc.state["unsub"]
                st[{"done": "done", "link": "links",
                    "failed": "failed"}[res["status"]]] += 1
                st["progress"] = f"{i}/{total}"
    except Exception as exc:        # config gone, mailbox unreadable, …
        log.exception("[%s] bulk unsubscribe aborted", acc.name)
        with acc.lock:
            acc.state["unsub"]["error"] = classify(exc)
    with acc.lock:
        st = acc.state["unsub"]
        st["status"] = "error" if st["error"] else "done"
        st["progress"] = ""
        if cancelled:
            acc.state["notice"] = {"key": "unsub_cancelled", "params": {}}
        acc.state["groups_rev"] += 1
        log.info("[%s] bulk unsubscribe %s in %.1fs: %d done, %d need a "
                 "confirmation page, %d failed", acc.name,
                 "cancelled" if cancelled else "finished", time.time() - t0,
                 st["done"], st["links"], st["failed"])


def start_bulk(grouping: str, keys: list[str], acc=None) -> dict:
    """Queue a bulk unsubscribe for the selected groups."""
    acc = acc or accounts.get()
    with acc.lock:
        if acc.state["status"] == "scanning":
            raise RuntimeError("busy: scan running")
        if acc.state["unsub"]["status"] == "running":
            raise RuntimeError("busy: unsubscribe running")
        items, skipped_protected, skipped_done, pooled = _targets(
            grouping, keys, acc)
        capped = max(0, len(items) - JOB_CAP)
        items = items[:JOB_CAP]
        out = {"queued": len(items), "skipped_protected": skipped_protected,
               "skipped_done": skipped_done, "capped": capped}
        if grouping == "smart":
            out["skipped_pooled"] = pooled
        if not items:
            return out
        acc.state["unsub"] = {
            "status": "running", "progress": f"0/{len(items)}", "error": "",
            "total": len(items), "done": 0, "links": 0, "failed": 0,
            "skipped": skipped_protected + skipped_done + capped}
        acc.cancel["unsub"] = False
    threading.Thread(target=tenants.call_in,
                     args=(acc.tenant, _run_bulk, acc, items),
                     daemon=True).start()
    return out
