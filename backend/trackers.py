"""Tracking detection for the tracker report (Tools -> Trackers).

Runs where mail bodies are already fetched - the local body-index build
(backend/bodyindex.py) - on the parsed message, before the text is
extracted. Nothing is fetched or loaded for it, and nothing here knows a
vendor: the heuristics are generic and the tracker hosts shown are
computed at runtime from the user's own mail.

  * tracking pixel: a remote <img> that is tiny (width AND height <= 3 px,
    attributes or inline style), hidden (display:none, visibility:hidden,
    opacity:0, max-height:0) or whose path / query looks like an open
    beacon (a generic word such as open / track / pixel / beacon next to
    an opaque id). data: and cid: images never count; neither do normal
    content images.
  * click tracking: a link whose URL is a redirect (a path segment such as
    /click or /redirect, /c/<opaque id>, or a query parameter holding an
    encoded http(s) URL).
  * hosts: the registrable domain of the pixel / redirect URLs, at most
    MAX_HOSTS per mail.

What is stored per mail is only two flags and those plain domains
(metadata, like sender domains in the scan snapshot) - no text, no URLs,
no tokens. Never part of any AI payload.
"""

from __future__ import annotations

import os
import re
from collections import Counter
from html.parser import HTMLParser
from urllib.parse import parse_qsl, urlsplit

from . import smartkinds

MAX_HOSTS = 5                 # tracker hosts kept per mail
MAX_TAGS = 4000               # <img>/<a> tags looked at per mail
MAX_HTML = 262_144            # characters of HTML considered per mail
PIXEL_MAX_PX = 3              # a tracking pixel is at most this wide AND high
TOP_HOSTS_PER_GROUP = 3

_CSS_DIM_RE = re.compile(
    r"(?:^|[;\s{])(width|height)\s*:\s*(\d+(?:\.\d+)?)\s*(px)?\s*(?:[;}!]|$)")
_CSS_HIDDEN_RE = re.compile(
    r"(?:^|[;\s{])(?:display\s*:\s*none|visibility\s*:\s*hidden"
    r"|opacity\s*:\s*0(?:\.0+)?|max-height\s*:\s*0(?:px)?)\s*(?:[;}!]|$)")
_BEACON_WORD_RE = re.compile(
    r"(?<![a-z])(?:opens?|track(?:ing)?|pixel|beacon)(?![a-z])")
_OPAQUE_RE = re.compile(r"[A-Za-z0-9_]{16,}")
_UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}"
    r"-[0-9a-fA-F]{12}")
_REDIRECT_SEGMENTS = frozenset({
    "click", "clicks", "redirect", "redir", "trk", "track", "tracking"})
_SHORT_REDIRECT_SEGMENTS = frozenset({"c", "r"})   # /c/<opaque id>


class _Enough(Exception):
    """Work bound reached - stop parsing."""


def _px(value: str | None) -> float | None:
    """A width / height attribute or CSS value in pixels, or None when it
    is not a plain pixel (or unit-less) number - "100%" is not tiny."""
    m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*", value or "")
    return float(m.group(1)) if m else None


def _remote(url: str) -> bool:
    u = url.strip().lower()
    return u.startswith(("http://", "https://", "//"))


def _host(url: str) -> str:
    try:
        netloc = urlsplit(url.strip()).hostname or ""
    except ValueError:
        return ""
    return smartkinds.registrable_domain(netloc) if netloc else ""


def _opaque(text: str) -> bool:
    """An id-like token: a UUID, or 16+ word characters mixing a digit."""
    if _UUID_RE.search(text):
        return True
    return any(any(c.isdigit() for c in tok)
               for tok in _OPAQUE_RE.findall(text))


def _tiny_or_hidden(attrs: dict[str, str]) -> bool:
    style = (attrs.get("style") or "").lower()
    if _CSS_HIDDEN_RE.search(style):
        return True
    dims = {m.group(1): float(m.group(2))
            for m in _CSS_DIM_RE.finditer(style)}
    w = dims.get("width", _px(attrs.get("width")))
    h = dims.get("height", _px(attrs.get("height")))
    return (w is not None and h is not None
            and w <= PIXEL_MAX_PX and h <= PIXEL_MAX_PX)


def _beacon_like(url: str) -> bool:
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return False
    path_query = f"{parts.path}?{parts.query}".lower()
    return bool(_BEACON_WORD_RE.search(path_query)) and _opaque(
        f"{parts.path}?{parts.query}")


def _redirect_link(url: str) -> bool:
    if not url.strip().lower().startswith(("http://", "https://")):
        return False
    try:
        parts = urlsplit(url.strip())
        query = parse_qsl(parts.query, keep_blank_values=False)
    except ValueError:
        return False
    segs = [s for s in parts.path.lower().split("/") if s]
    if any(s in _REDIRECT_SEGMENTS for s in segs):
        return True
    for i, s in enumerate(segs[:-1]):
        if s in _SHORT_REDIRECT_SEGMENTS and _opaque(segs[i + 1]):
            return True
    return any(v.strip().lower().startswith(("http://", "https://"))
               for _, v in query)


class _Scanner(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.pixel = False
        self.click = False
        self.hosts: list[str] = []
        self._tags = 0

    def _add_host(self, url: str) -> None:
        host = _host(url)
        if host and host not in self.hosts and len(self.hosts) < MAX_HOSTS:
            self.hosts.append(host)

    def handle_starttag(self, tag, attrs):
        if tag not in ("img", "a"):
            return
        self._tags += 1
        if self._tags > MAX_TAGS:
            raise _Enough()
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "img":
            src = a.get("src", "")
            if src and _remote(src) and (
                    _tiny_or_hidden(a) or _beacon_like(src)):
                self.pixel = True
                self._add_host("https:" + src.strip()
                               if src.strip().startswith("//") else src)
        elif _redirect_link(a.get("href", "")):
            self.click = True
            self._add_host(a["href"])

    handle_startendtag = handle_starttag


def scan_html(html: str) -> dict:
    """{"pixel": bool, "click": bool, "hosts": [registrable domains]} of
    one HTML body. Tolerant of broken markup, bounded work per mail."""
    p = _Scanner()
    try:
        p.feed((html or "")[:MAX_HTML])
        p.close()
    except _Enough:
        pass
    except Exception:                      # pathological markup: use what we saw
        pass
    return {"pixel": p.pixel, "click": p.click, "hosts": p.hosts}


def scan_message(msg) -> dict:
    """scan_html over the first text/html part of a parsed message."""
    for part in msg.walk():
        if part.get_content_type() != "text/html":
            continue
        try:
            raw = part.get_payload(decode=True) or b""
            html = raw.decode(part.get_content_charset() or "utf-8",
                              "replace")
        except Exception:
            continue
        return scan_html(html)
    return {"pixel": False, "click": False, "hosts": []}


# ---------------------------------------------------- per-account results

_MAP_CACHE: dict[str, tuple[tuple, dict]] = {}


def _sig(path) -> tuple | None:
    try:
        st = os.stat(path)
    except OSError:
        return None
    return (st.st_mtime_ns, st.st_size)


def tracker_map(acc) -> dict[tuple[str, int, int], tuple[bool, bool, tuple]]:
    """{(folder, uid, uidvalidity): (pixel, click, hosts)} of the mails the
    body index has checked; {} without a usable index. Cached per index
    file version, so building state stays cheap."""
    from . import bodyindex, secretbox
    path = bodyindex._path(acc.name, acc.tenant)
    sig = _sig(path)
    if sig is None or not secretbox.enabled():
        _MAP_CACHE.pop(str(path), None)
        return {}
    hit = _MAP_CACHE.get(str(path))
    if hit and hit[0] == sig:
        return hit[1]
    idx, _ = bodyindex.open_index(acc.name, acc.tenant)
    if idx is None:
        return {}
    try:
        rows = idx.tracker_rows()
    finally:
        idx.close()
    out = {(f, u, uv): (bool(p), bool(c), tuple(h.split(",")) if h else ())
           for f, u, uv, p, c, h in rows}
    _MAP_CACHE[str(path)] = (_sig(path) or sig, out)
    return out


def group_trackers(rec: dict, tmap: dict, acc) -> dict | None:
    """A group's tracker summary {checked, pixel, click, hosts[top 3]}, or
    None when none of its mails was checked (lock held)."""
    checked = pixel = click = 0
    hosts: Counter = Counter()
    for folder, uids in rec["folders"].items():
        uv = acc.folder_uv.get(folder, 0)
        for uid in uids:
            row = tmap.get((folder, uid, uv))
            if row is None:
                continue
            checked += 1
            pixel += row[0]
            click += row[1]
            hosts.update(row[2])
    if not checked:
        return None
    top = sorted(hosts.items(), key=lambda kv: (-kv[1], kv[0]))
    return {"checked": checked, "pixel": pixel, "click": click,
            "hosts": [h for h, _ in top[:TOP_HOSTS_PER_GROUP]]}


def report(acc, limit: int = 20) -> dict:
    """The data of Tools -> Trackers: coverage, totals, the senders that
    track most and the hosts they use."""
    from . import bodyindex
    from .mailops import ikey
    info = bodyindex.info(acc)
    tmap = tracker_map(acc)
    out = {"usable": info["usable"], "reason": info["reason"],
           "docs": info["docs"], "checked": 0, "pixel": 0, "click": 0,
           "any": 0, "senders": 0, "top_senders": [], "top_hosts": []}
    if not tmap:
        return out
    per: dict[str, dict] = {}
    hosts: dict[str, dict] = {}
    with acc.lock:
        sender_groups = acc.state["groups"].get("sender", {})
        for (folder, uid, uv), (pixel, click, hs) in tmap.items():
            if acc.folder_uv.get(folder, 0) != uv:
                continue
            m = acc.index.get(ikey(folder, uid))
            if not m:
                continue
            out["checked"] += 1
            out["pixel"] += pixel
            out["click"] += click
            tracked = pixel or click
            out["any"] += tracked
            s = per.setdefault(m["addr"], {
                "key": m["addr"], "checked": 0, "tracked": 0, "pixel": 0,
                "click": 0, "hosts": Counter()})
            s["checked"] += 1
            s["tracked"] += tracked
            s["pixel"] += pixel
            s["click"] += click
            s["hosts"].update(hs)
            for h in hs:
                e = hosts.setdefault(h, {"host": h, "mails": 0,
                                         "senders": set()})
                e["mails"] += 1
                e["senders"].add(m["addr"])
        labels = {k: g["label"] for k, g in sender_groups.items()}
    tracking = [s for s in per.values() if s["tracked"]]
    out["senders"] = len(tracking)
    tracking.sort(key=lambda s: (-s["tracked"], -s["tracked"] / s["checked"],
                                 s["key"]))
    out["top_senders"] = [
        {"key": s["key"], "label": labels.get(s["key"], s["key"]),
         "checked": s["checked"], "tracked": s["tracked"],
         "pixel": s["pixel"], "click": s["click"],
         "hosts": [h for h, _ in sorted(
             s["hosts"].items(), key=lambda kv: (-kv[1], kv[0]))
             [:TOP_HOSTS_PER_GROUP]]}
        for s in tracking[:limit]]
    out["top_hosts"] = [
        {"host": e["host"], "mails": e["mails"], "senders": len(e["senders"])}
        for e in sorted(hosts.values(),
                        key=lambda e: (-e["mails"], -len(e["senders"]),
                                       e["host"]))[:limit]]
    return out
