"""One-click unsubscribe via List-Unsubscribe headers (RFC 2369 / 8058).

Three cases:
- https URI + List-Unsubscribe-Post: One-Click  -> automated HTTPS POST
- mailto: URI                                   -> automated mail via Bridge SMTP
- plain https URI                               -> hand the link to the UI

The HTTPS POST is guarded against SSRF: mails could carry URLs pointing at
private/internal addresses, so targets must resolve to public IPs.

A whole selection of groups can be unsubscribed at once: that runs as a
background job (one sender at a time - these are outbound requests to
third parties, they must not be fired in parallel), and every outcome is
persisted per sender in unsubstore, so the group list keeps showing what
is already handled after a rescan or a restart.
"""

from __future__ import annotations

import email.header
import ipaddress
import logging
import re
import socket
import threading
import time
import urllib.parse
import urllib.request

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
                 "User-Agent": "mailbroom"},
        method="POST")
    with urllib.request.urlopen(req, timeout=20) as res:
        if res.status >= 400:
            raise RuntimeError(f"unsubscribe endpoint returned {res.status}")


def _send_mailto(im: dict, uri: str, account_name: str | None = None) -> None:
    parsed = urllib.parse.urlparse(uri)
    to_addr = urllib.parse.unquote(parsed.path)
    params = dict(urllib.parse.parse_qsl(parsed.query))
    subject = params.get("subject", "unsubscribe")
    body = params.get("body", "unsubscribe")
    smtpout.send(im, to_addr, subject, body, account_name=account_name)


def unsubscribe_addr(im: dict, addr: str, header: str, one_click: bool,
                     account_name: str | None = None) -> dict:
    """Act on ONE sender's List-Unsubscribe header. Never raises - returns
    {"status": "done"|"link"|"failed", "method", "detail", "error"} so a
    bulk run is not aborted by a single dead endpoint."""
    parts = parse_unsub(header, one_click)
    host = urllib.parse.urlparse(parts["http"] or "").hostname or "-"
    log.info("unsubscribe %r: one_click=%s mailto=%s http_host=%s",
             addr, parts["one_click"], bool(parts["mailto"]), host)
    try:
        if parts["http"] and parts["one_click"]:
            _post_one_click(parts["http"])
            return {"status": "done", "method": "one-click POST",
                    "detail": parts["http"], "error": ""}
        if parts["mailto"]:
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
                "error": f"{type(exc).__name__}: {exc}"}
    return {"status": "failed", "method": "", "detail": "",
            "error": "could not parse the List-Unsubscribe header"}


def unsubscribe(grouping: str, key: str, acc=None) -> dict:
    """Unsubscribe from a group using its newest mail's List-Unsubscribe.
    Synchronous (one sender, triggered from a group's detail view); the
    outcome is recorded like a bulk run's."""
    acc = acc or accounts.get()
    mails = mailops.group_mails(grouping, key, acc=acc)
    with acc.lock:
        rec = acc.state["groups"][grouping].get(key)
        if not rec:
            raise RuntimeError("unknown group")
        newest = None
        for m in mails:  # newest first
            idx = acc.index.get(mailops.ikey(m["folder"], m["uid"]))
            if idx and idx.get("unsub"):
                newest = dict(idx)
                break
    if not newest:
        raise RuntimeError("no List-Unsubscribe header in this group")

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

def _targets(grouping: str, keys: list[str], acc) -> tuple[list, int, int]:
    """Senders of the selected groups that still need an unsubscribe
    (lock held): -> ([(addr, header, one_click)], skipped_protected,
    skipped_done). Protected senders are left alone exactly like they are
    in bulk trash and rule runs."""
    plist = cfgmod.normalize_protected(cfgmod.load_config().get("protected"))
    handled = {a for a, e in unsubstore.load_account(acc.name).items()
               if e["status"] == "done"}
    recs = acc.state["groups"][grouping]
    targets: dict[str, tuple[str, bool]] = {}
    skipped_protected: set[str] = set()
    skipped_done: set[str] = set()
    for key in keys:
        rec = recs.get(key)
        if not rec:
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
    return items, len(skipped_protected), len(skipped_done)


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
            acc.state["unsub"]["error"] = f"{type(exc).__name__}: {exc}"
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
        items, skipped_protected, skipped_done = _targets(grouping, keys, acc)
        capped = max(0, len(items) - JOB_CAP)
        items = items[:JOB_CAP]
        out = {"queued": len(items), "skipped_protected": skipped_protected,
               "skipped_done": skipped_done, "capped": capped}
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
