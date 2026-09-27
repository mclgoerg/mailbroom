"""IMAP scanning, grouping, drill-down, and move-to-Trash operations.

Speaks generic IMAP (implicit TLS or STARTTLS); special folders (Trash,
Sent, …) are found via SPECIAL-USE flags (RFC 6154) with a name-table
fallback, so Proton Bridge, Gmail, iCloud & co. all resolve correctly.
All state is in memory: acc.state holds the group views, acc.index holds
per-message metadata keyed by (folder, uid).
"""

from __future__ import annotations

import base64
import email
import email.header
import html as html_mod
import json
import logging
import os
import re
import ssl
import threading
import time
from email.utils import getaddresses, parseaddr
from pathlib import Path

import imaplib
imaplib._MAXLINE = 10_000_000  # bulk FETCH responses exceed the default 1MB

from . import accounts
from . import config as cfgmod
from . import stats as statsmod
from . import tenants
from . import verdictstore

FETCH_CHUNK = 500
MOVE_CHUNK = 500
MAX_SAMPLES = 3
BODY_CHAR_LIMIT = 50_000
GROUPINGS = ("sender", "domain", "subject")

# Order matters: the first matching category becomes the primary tag.
CATEGORY_RULES: list[tuple[str, list[str]]] = [
    ("shipping", ["dhl", "dpd", "ups.com", "fedex", "hermes", "gls-", "gls.",
                  "usps", "royalmail", "postnl", "parcel", "paket",
                  "tracking", "shipment", "lieferung", "zustellung"]),
    ("finance", ["paypal", "klarna", "bank", "sparkasse", "volksbank", "n26",
                 "revolut", "wise.com", "visa", "mastercard", "billing",
                 "invoice", "rechnung", "payment", "mahnung"]),
    ("shopping", ["amazon", "ebay", "zalando", "otto.de", "aliexpress",
                  "etsy", "temu", "shein", "mediamarkt", "saturn", "ikea",
                  "shop", "store", "order", "bestellung"]),
    ("social", ["facebook", "instagram", "twitter", "x.com", "linkedin",
                "tiktok", "reddit", "discord", "pinterest", "snapchat",
                "youtube", "twitch", "whatsapp", "telegram"]),
    ("travel", ["booking.com", "airbnb", "expedia", "bahn.de", "flixbus",
                "lufthansa", "ryanair", "easyjet", "eurowings", "hotel",
                "flight", "reise", "check24"]),
    ("dev/cloud", ["github", "gitlab", "atlassian", "jira", "npmjs", "docker",
                   "aws", "amazonaws", "azure", "hetzner", "cloudflare",
                   "oracle", "proton.me", "protonmail", "google.com",
                   "microsoft", "apple.com"]),
]
AUTOMATED_RE = re.compile(
    r"^(no.?reply|do.?not.?reply|noreply|notification|notifications|"
    r"mailer-daemon|auto[-.])", re.IGNORECASE)

log = logging.getLogger("pmc.mail")

ACTIONS = ("trash", "archive", "move", "mark_read")
UNDO_MAX = 10

# All mutable mail state lives in per-account AccountState objects (see
# backend/accounts.py); every function below takes `acc` (None = default
# account). Legacy module attributes (acc.state, acc.index, …) resolve to the
# DEFAULT account via __getattr__ — single-account callers and the test
# suite keep working unchanged.
_ACC_ALIASES = {
    "STATE": "state", "STATE_LOCK": "lock", "INDEX": "index",
    "FOLDER_UV": "folder_uv", "FOLDER_ROLES": "folder_roles",
    "UNDO_LOG": "undo_log", "REPLIED_TO": "replied",
    "_DELETE_PENDING": "delete_pending", "_CANCEL": "cancel",
}


def __getattr__(name: str):
    if name in _ACC_ALIASES:
        return getattr(accounts.get(), _ACC_ALIASES[name])
    raise AttributeError(name)


# "Never replied" signal: every address the user has ever written to
# (To/Cc of the Sent folder), merged across scans and persisted PER
# ACCOUNT — mail later deleted from Sent must not flip senders back to
# "never replied".
REPLIED_PATH = Path(os.environ.get("REPLIED_PATH", "/data/replied.json"))


def _replied_path(tenant=None) -> Path:
    return (tenant or tenants.current()).file("replied.json", REPLIED_PATH)


def _read_replied_file(tenant=None) -> dict:
    """Raw replied.json, migrating the old single-account shape
    ({ts, addrs}) into {"accounts": {default: {...}}} in memory."""
    try:
        data = json.loads(_replied_path(tenant).read_text())
    except (OSError, json.JSONDecodeError):
        return {"accounts": {}}
    if not isinstance(data, dict):
        return {"accounts": {}}
    if isinstance(data.get("accounts"), dict):
        return data
    if isinstance(data.get("addrs"), list):     # pre-multi-account format
        return {"accounts": {accounts.default_name(): data}}
    return {"accounts": {}}


def _write_replied_file(data: dict, tenant=None) -> None:
    path = _replied_path(tenant)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    tmp.chmod(0o600)
    tmp.replace(path)


def rename_replied_account(old: str, new: str) -> None:
    """Move one account's replied cache to a new account name."""
    try:
        data = _read_replied_file()
        if old in data["accounts"]:
            data["accounts"][new] = data["accounts"].pop(old)
            _write_replied_file(data)
    except OSError:
        log.exception("could not rename replied account")


def load_replied(acc=None) -> set[str]:
    acc = acc or accounts.get()
    if not acc.replied_loaded:
        entry = _read_replied_file(acc.tenant)["accounts"].get(acc.name) or {}
        acc.replied.update(a for a in entry.get("addrs", [])
                           if isinstance(a, str))
        acc.replied_loaded = True
    return acc.replied


def save_replied(acc=None) -> None:
    acc = acc or accounts.get()
    try:
        data = _read_replied_file(acc.tenant)
        data["accounts"][acc.name] = {
            "ts": int(time.time()), "addrs": sorted(acc.replied)}
        _write_replied_file(data, acc.tenant)
    except OSError:
        log.exception("could not persist replied.json")


# ------------------------------------------------------- scan snapshots
# Scan results are cached to disk PER ACCOUNT so restarts and account
# switches show the last data instantly (with its scan timestamp) instead
# of an empty view. Acting on cached data stays safe: every move re-checks
# UIDVALIDITY against the server and refuses when the mailbox changed, and
# undo works by Message-ID.

SNAPSHOT_DIR = Path(os.environ.get("SNAPSHOT_DIR", "/data"))
_SNAP_VERSION = 1


def _snap_path(name: str, tenant=None) -> Path:
    slug = re.sub(r"[^A-Za-z0-9._-]", "_", name)[:40]
    h = __import__("hashlib").sha1(name.encode()).hexdigest()[:8]
    snap_dir = (tenant or tenants.current()).dir(SNAPSHOT_DIR)
    return snap_dir / f"scan_{slug}_{h}.json"


def save_snapshot(acc) -> None:
    """Persist the account's scan state (called after scans/actions)."""
    with acc.lock:
        if acc.state["status"] != "done":
            return
        data = {
            "version": _SNAP_VERSION, "account": acc.name,
            "ts": acc.state.get("scanned_ts") or int(time.time()),
            "folders": acc.state["folders"],
            "folders_raw": acc.state["folders_raw"],
            "folder_uv": acc.folder_uv,
            "folder_roles": acc.folder_roles,
            "trash_count": acc.state["trash_count"],
            "index": list(acc.index.values()),
            "groups": acc.state["groups"],
        }
        blob = json.dumps(data)
    try:
        path = _snap_path(acc.name, acc.tenant)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(blob)
        tmp.chmod(0o600)
        tmp.replace(path)
    except OSError:
        log.exception("[%s] could not persist scan snapshot", acc.name)


def load_snapshot(acc) -> bool:
    """Restore the last scan from disk into an idle, empty account.
    Cached AI verdicts are re-applied like after a real scan."""
    try:
        data = json.loads(_snap_path(acc.name, acc.tenant).read_text())
    except (OSError, json.JSONDecodeError):
        return False
    if not isinstance(data, dict) or data.get("version") != _SNAP_VERSION:
        return False
    try:
        cached = verdictstore.apply_to_groups(data["groups"], acc.name)
        with acc.lock:
            if acc.state["status"] != "idle" or acc.index:
                return False              # never clobber live state
            acc.index.update({ikey(m["folder"], m["uid"]): m
                              for m in data["index"]})
            acc.folder_uv.update(data.get("folder_uv") or {})
            acc.folder_roles.update(data.get("folder_roles") or {})
            acc.state["groups"] = data["groups"]
            acc.state["folders"] = data.get("folders") or []
            acc.state["folders_raw"] = data.get("folders_raw") or []
            acc.state["trash_count"] = data.get("trash_count")
            acc.state["scanned_ts"] = data.get("ts")
            acc.state["status"] = "done"
            acc.state["groups_rev"] += 1
        log.info("[%s] scan snapshot restored: %d mails, %d senders "
                 "(scanned %s), %d cached verdicts", acc.name,
                 len(data["index"]), len(data["groups"].get("sender", {})),
                 time.strftime("%Y-%m-%d %H:%M",
                               time.localtime(data.get("ts") or 0)), cached)
        return True
    except (KeyError, TypeError, AttributeError):
        log.exception("[%s] scan snapshot unusable — ignored", acc.name)
        return False


def rename_snapshot(old: str, new: str) -> None:
    try:
        path = _snap_path(old)
        if path.exists():
            data = json.loads(path.read_text())
            data["account"] = new
            npath = _snap_path(new)
            tmp = npath.with_suffix(".tmp")
            tmp.write_text(json.dumps(data))
            tmp.chmod(0o600)
            tmp.replace(npath)
            path.unlink()
    except (OSError, json.JSONDecodeError):
        log.exception("could not rename scan snapshot")


def drop_snapshot(name: str) -> None:
    try:
        _snap_path(name).unlink()
    except FileNotFoundError:
        pass
    except OSError:
        log.exception("could not drop scan snapshot")


class Cancelled(Exception):
    """Raised inside workers when the user cancelled the operation."""


def request_cancel(target: str, acc=None) -> None:
    acc = acc or accounts.get()
    if target not in acc.cancel:
        raise RuntimeError("bad cancel target")
    acc.cancel[target] = True


def cancel_requested(target: str, acc=None) -> bool:
    return (acc or accounts.get()).cancel[target]


def _undo_summaries(acc) -> list[dict]:
    return [{"ts": u["ts"], "label": u["label"], "count": u["count"],
             "action": u.get("action", "trash")}
            for u in acc.undo_log]


def clear_ai_marks() -> None:
    """Drop in-memory AI marks of EVERY account (verdict cache cleared)."""
    for acc in accounts.all_instantiated():
        with acc.lock:
            for recs in acc.state["groups"].values():
                for rec in recs.values():
                    rec["ai"] = None
            acc.state["groups_rev"] += 1


def ikey(folder: str, uid: int) -> str:
    return f"{folder}\x00{uid}"


def effective_categories(custom: dict | None) -> list[tuple[str, list[str]]]:
    """CATEGORY_RULES with user overrides applied: a custom entry whose name
    matches a built-in category replaces its keywords (empty list disables
    it); unknown names append as new categories."""
    if not custom:
        return CATEGORY_RULES
    out: list[tuple[str, list[str]]] = []
    builtin = {cat for cat, _ in CATEGORY_RULES}
    for cat, pats in CATEGORY_RULES:
        if cat in custom:
            pats = [p for p in custom[cat] if p]
        if pats:
            out.append((cat, pats))
    for cat, pats in custom.items():
        pats = [p for p in pats if p]
        if cat not in builtin and pats:
            out.append((cat, pats))
    return out


def categorize(hay: str, localpart: str = "", bulk: bool = False,
               rules: list[tuple[str, list[str]]] | None = None) -> list[str]:
    hay = hay.lower()
    tags = [cat for cat, pats in (rules or CATEGORY_RULES)
            if any(p in hay for p in pats)]
    if localpart and AUTOMATED_RE.match(localpart):
        tags.append("automated")
    if bulk:
        tags.append("newsletter")
    return tags


# --------------------------------------------------------------------- imap

def connect(im: dict) -> imaplib.IMAP4:
    ctx = ssl.create_default_context(cafile=im["cafile"] or None)
    if (im.get("security") or "ssl") == "starttls":
        conn = imaplib.IMAP4(im["host"], int(im["port"]), timeout=120)
        try:
            conn.starttls(ssl_context=ctx)
        except BaseException:
            try:
                conn.shutdown()
            except Exception:
                pass
            raise
    else:
        conn = imaplib.IMAP4_SSL(im["host"], int(im["port"]),
                                 ssl_context=ctx, timeout=120)
    try:
        conn.login(im["user"], im["password"])
    except BaseException:
        try:
            conn.shutdown()
        except Exception:
            pass
        raise
    return conn


def uidvalidity(conn: imaplib.IMAP4_SSL) -> int:
    """UIDVALIDITY of the currently selected folder (0 if not announced)."""
    try:
        data = conn.response("UIDVALIDITY")[1]
        return int(data[0]) if data and data[0] else 0
    except (TypeError, ValueError, IndexError):
        return 0


_LIST_RE = re.compile(rb'\((?P<flags>[^)]*)\) "(?P<delim>[^"]*)" (?P<name>.+)$')


def list_folders_ex(conn) -> list[tuple[str, set[str]]]:
    """(name, lowercased-flags) per folder from LIST."""
    status, data = conn.list()
    out: list[tuple[str, set[str]]] = []
    if status != "OK":
        return out
    for item in data or []:
        # Literal folder names arrive as tuples from imaplib; skip them
        # rather than crashing the whole scan on one exotic folder name.
        if not item or not isinstance(item, bytes):
            continue
        m = _LIST_RE.match(item)
        if not m:
            continue
        name = m.group("name").strip()
        if name.startswith(b'"') and name.endswith(b'"'):
            name = name[1:-1]
        flags = {f.lower() for f in
                 m.group("flags").decode("utf-8", "replace").split()}
        out.append((name.decode("utf-8", "replace"), flags))
    return out


def list_folders(conn) -> list[str]:
    return [name for name, _ in list_folders_ex(conn)]


# RFC 6154 SPECIAL-USE flags -> folder role.
_ROLE_FLAGS = {"\\trash": "trash", "\\sent": "sent", "\\junk": "junk",
               "\\drafts": "drafts", "\\archive": "archive", "\\all": "all"}

# Fallback for servers without SPECIAL-USE: common provider/localized names
# (compared against the decoded, lowercased folder name).
_ROLE_NAMES: dict[str, set[str]] = {
    "trash": {"trash", "bin", "deleted", "deleted messages", "deleted items",
              "papierkorb", "gelöschte elemente", "gelöschte objekte",
              "corbeille", "[gmail]/trash", "[gmail]/bin",
              "[gmail]/papierkorb"},
    "sent": {"sent", "sent mail", "sent items", "sent messages", "gesendet",
             "gesendete elemente", "gesendete objekte", "[gmail]/sent mail",
             "[gmail]/gesendet"},
    "junk": {"spam", "junk", "junk mail", "junk e-mail", "bulk mail",
             "[gmail]/spam"},
    "drafts": {"drafts", "draft", "entwürfe", "[gmail]/drafts",
               "[gmail]/entwürfe"},
    "archive": {"archive", "archiv", "[gmail]/archive"},
    "all": {"all mail", "[gmail]/all mail", "[gmail]/alle nachrichten",
            "[gmail]/tous les messages"},
}

# Roles that never belong in cleanup scans: trash/junk hold deleted mail,
# sent/drafts are the user's own, "all" would double-count everything.
EXCLUDED_ROLES = ("trash", "junk", "sent", "drafts", "all")


def folder_roles(conn, acc=None) -> dict[str, str]:
    """{role: raw folder name} via SPECIAL-USE flags, name fallback second.
    Also refreshes the account's role cache (used by fetch_message)."""
    acc = acc or accounts.get()
    roles: dict[str, str] = {}
    pairs = list_folders_ex(conn)
    for name, flags in pairs:
        for flag, role in _ROLE_FLAGS.items():
            if flag in flags and role not in roles:
                roles[role] = name
    for name, _ in pairs:
        low = decode_mutf7(name).lower()
        for role, names in _ROLE_NAMES.items():
            if role not in roles and low in names:
                roles[role] = name
    acc.folder_roles.update(roles)
    return roles


def _supports_move(conn) -> bool:
    caps = getattr(conn, "capabilities", ()) or ()
    return any(str(c if isinstance(c, str) else c.decode()).upper() == "MOVE"
               for c in caps)


def _uid_move(conn, uidstr: str, dest: str) -> bool:
    """UID MOVE `uidstr` into raw folder `dest`; falls back to
    COPY + \\Deleted + EXPUNGE for servers without the MOVE capability."""
    if _supports_move(conn):
        status, _ = conn.uid("MOVE", uidstr, quote_folder(dest))
        return status == "OK"
    status, _ = conn.uid("COPY", uidstr, quote_folder(dest))
    if status != "OK":
        return False
    conn.uid("STORE", uidstr, "+FLAGS", r"(\Deleted)")
    try:
        conn.uid("EXPUNGE", uidstr)          # UIDPLUS: only our UIDs
    except Exception:
        conn.expunge()   # last resort: purges every \Deleted in the folder
    return True


def decode_mutf7(name: str) -> str:
    """Decode IMAP modified-UTF-7 folder names for display (RFC 3501 5.1.3)."""
    def repl(m):
        b64 = m.group(1)
        if not b64:
            return "&"
        pad = "=" * (-len(b64) % 4)
        try:
            return base64.b64decode(
                b64.replace(",", "/") + pad).decode("utf-16-be")
        except Exception:
            return m.group(0)
    return re.sub(r"&([^-]*)-", repl, name)


def excluded(folder: str, rules: list[str]) -> bool:
    low = folder.lower()
    for rule in rules:
        r = rule.lower().strip()
        if not r:
            continue
        if r.endswith("*"):
            if low.startswith(r[:-1]):
                return True
        elif low == r:
            return True
    return False


def quote_folder(name: str) -> str:
    return '"' + name.replace("\\", "\\\\").replace('"', '\\"') + '"'


def decode_mime(raw) -> str:
    # msg.get() returns a Header OBJECT (not str) for malformed/raw-8bit
    # headers, and decode_header may report the bogus charset
    # "unknown-8bit" — both crashed whole scans before. decode_header
    # must see the ORIGINAL object (str()-ing it first loses the bytes).
    if raw is None:
        return ""

    def dec(p, enc):
        if not isinstance(p, bytes):
            return p
        try:
            return p.decode(enc or "utf-8", "replace")
        except LookupError:                  # e.g. "unknown-8bit"
            return p.decode("utf-8", "replace")

    try:
        parts = email.header.decode_header(raw)
        return "".join(dec(p, enc) for p, enc in parts).strip()
    except Exception:
        return str(raw).strip()


_UID_RE = re.compile(rb"UID (\d+)")
_SIZE_RE = re.compile(rb"RFC822\.SIZE (\d+)")
_FLAGS_RE = re.compile(rb"FLAGS \(([^)]*)\)")


def scan_folder(conn, folder: str, messages: list, progress_cb,
                acc=None) -> int:
    """Scan one folder into `messages`; returns how many messages had to
    be SKIPPED because their metadata could not be parsed (real-world
    mail contains arbitrarily broken headers — one bad message must
    never abort a scan)."""
    acc = acc or accounts.get()
    skipped = 0
    status, _ = conn.select(quote_folder(folder), readonly=True)
    if status != "OK":
        return skipped
    # Cached UIDs are only meaningful for this UIDVALIDITY generation;
    # deletes re-check it (servers reset it on resync/re-login).
    acc.folder_uv[folder] = uidvalidity(conn)
    status, data = conn.uid("SEARCH", None, "ALL")
    if status != "OK" or not data or not data[0]:
        return skipped
    uids = data[0].split()
    total = len(uids)
    for start in range(0, total, FETCH_CHUNK):
        if cancel_requested("scan", acc):
            raise Cancelled()
        chunk = uids[start:start + FETCH_CHUNK]
        progress_cb(folder, min(start + FETCH_CHUNK, total), total)
        status, data = conn.uid(
            "FETCH", b",".join(chunk).decode(),
            "(UID FLAGS RFC822.SIZE INTERNALDATE "
            "BODY.PEEK[HEADER.FIELDS (FROM SUBJECT MESSAGE-ID "
            "LIST-UNSUBSCRIBE LIST-UNSUBSCRIBE-POST)])")
        if status != "OK":
            continue
        for item in data or []:
            if not isinstance(item, tuple) or len(item) < 2:
                continue
            meta = item[0]
            m = _UID_RE.search(meta)
            if not m:
                continue
            try:
                sm = _SIZE_RE.search(meta)
                fm = _FLAGS_RE.search(meta)
                ts = 0
                tt = imaplib.Internaldate2tuple(meta)
                if tt:
                    ts = int(time.mktime(tt))
                msg = email.message_from_bytes(item[1])
                name, addr = parseaddr(msg.get("From", ""))
                addr = addr.strip().lower() or "(unparseable sender)"
                messages.append({
                    "uid": int(m.group(1)), "folder": folder, "addr": addr,
                    "name": decode_mime(name) if name else "",
                    "subject": decode_mime(msg.get("Subject", ""))[:150],
                    "bulk": bool(msg.get("List-Unsubscribe")),
                    "unsub": (msg.get("List-Unsubscribe") or "")[:1000],
                    "unsub_post": "one-click" in
                                  (msg.get("List-Unsubscribe-Post")
                                   or "").lower(),
                    "msgid": (msg.get("Message-ID") or "").strip()[:300],
                    "size": int(sm.group(1)) if sm else 0,
                    "seen": bool(fm and b"\\Seen" in fm.group(1)),
                    "ts": ts,
                    "date": time.strftime("%Y-%m-%d %H:%M",
                                          time.localtime(ts)) if ts else "",
                })
            except Exception:
                skipped += 1
                log.warning("[%s] skipping unparseable message uid %s in %r",
                            acc.name, m.group(1).decode(), folder,
                            exc_info=True)
    return skipped


def scan_sent_recipients(conn, progress_cb=None,
                         roles: dict[str, str] | None = None,
                         acc=None) -> set[str]:
    """Addresses in To/Cc of the Sent folder (headers only). Sent stays
    excluded from the cleanup views; this pass only feeds acc.replied."""
    acc = acc or accounts.get()
    target = (roles if roles is not None
              else folder_roles(conn, acc)).get("sent")
    if not target:
        return set()
    status, _ = conn.select(quote_folder(target), readonly=True)
    if status != "OK":
        return set()
    status, data = conn.uid("SEARCH", None, "ALL")
    if status != "OK" or not data or not data[0]:
        return set()
    uids = data[0].split()
    total = len(uids)
    out: set[str] = set()
    for start in range(0, total, FETCH_CHUNK):
        if cancel_requested("scan", acc):
            raise Cancelled()
        if progress_cb:
            progress_cb(target, min(start + FETCH_CHUNK, total), total)
        chunk = uids[start:start + FETCH_CHUNK]
        status, data = conn.uid(
            "FETCH", b",".join(chunk).decode(),
            "(UID BODY.PEEK[HEADER.FIELDS (TO CC)])")
        if status != "OK":
            continue
        for item in data or []:
            if not isinstance(item, tuple) or len(item) < 2:
                continue
            try:
                msg = email.message_from_bytes(item[1])
                for _, addr in getaddresses(
                        msg.get_all("To", []) + msg.get_all("Cc", [])):
                    addr = addr.strip().lower()
                    if addr and "@" in addr:
                        out.add(addr)
            except Exception:
                log.warning("skipping unparseable Sent message",
                            exc_info=True)
    return out


# ------------------------------------------------------------------- groups

_SUBJ_PREFIX_RE = re.compile(r"^\s*((re|fw|fwd|aw|wg)\s*:\s*)+", re.IGNORECASE)


def norm_subject(subject: str) -> str:
    s = _SUBJ_PREFIX_RE.sub("", subject).strip().lower()
    s = re.sub(r"\d+", "#", s)          # merge "Order 123" / "Order 456"
    s = re.sub(r"\s+", " ", s)
    return s[:120] or "(no subject)"


def _rec(groups: dict, grouping: str, key: str, label: str) -> dict:
    return groups[grouping].setdefault(key, {
        "key": key, "label": label, "sub": "", "count": 0, "size": 0,
        "unread": 0, "first": "", "last": "", "tags": [], "samples": [],
        "bulk": False, "unsub": False, "folders": {}, "ai": None,
        "att_size": 0,
        "_senders": set(), "_names": {}, "_hay": "", "_min": 0, "_max": 0})


def build_groups(messages: list, replied_to: set[str] | None = None,
                 categories: list[tuple[str, list[str]]] | None = None,
                 ) -> dict:
    replied_to = replied_to or set()
    groups: dict = {g: {} for g in GROUPINGS}
    for m in messages:
        addr, name, subj = m["addr"], m["name"], m["subject"]
        domain = addr.rsplit("@", 1)[-1] if "@" in addr else addr

        targets = (
            ("sender", addr, name or addr),
            ("domain", domain, domain),
            ("subject", norm_subject(subj), subj or "(no subject)"),
        )
        for grouping, key, label in targets:
            rec = _rec(groups, grouping, key, label)
            rec["count"] += 1
            rec["size"] += m["size"]
            rec["unread"] += 0 if m["seen"] else 1
            if m["ts"]:
                rec["_min"] = min(rec["_min"] or m["ts"], m["ts"])
                rec["_max"] = max(rec["_max"], m["ts"])
            rec["bulk"] = rec["bulk"] or m["bulk"]
            rec["unsub"] = rec["unsub"] or bool(m["unsub"])
            rec["_senders"].add(addr)
            sample = subj if grouping != "subject" else addr
            if sample and sample not in rec["samples"] \
                    and len(rec["samples"]) < MAX_SAMPLES:
                rec["samples"].append(sample)
            if grouping == "sender" and name and name.lower() != addr:
                rec["_names"][name] = rec["_names"].get(name, 0) + 1
            if len(rec["_hay"]) < 600:
                rec["_hay"] += f" {addr} {name} {subj}"
            rec["folders"].setdefault(m["folder"], []).append(m["uid"])

    day = lambda ts: time.strftime("%Y-%m-%d", time.localtime(ts)) if ts else ""
    for grouping, recs in groups.items():
        for rec in recs.values():
            senders = rec.pop("_senders")
            nsenders = len(senders)
            rec["replied"] = any(a in replied_to for a in senders)
            localpart = rec["key"].split("@", 1)[0] if grouping == "sender" else ""
            rec["tags"] = categorize(rec.pop("_hay"), localpart, rec["bulk"],
                                     categories)
            names = rec.pop("_names")
            rec["first"] = day(rec.pop("_min"))
            rec["last"] = day(rec.pop("_max"))
            if grouping == "sender":
                # GitHub-style senders vary the display name per mail; show
                # the most frequent one, not whichever came first.
                if names:
                    rec["label"] = max(names, key=names.get)
                rec["sub"] = rec["key"] if rec["label"] != rec["key"] else ""
            else:
                rec["sub"] = f"{nsenders} sender{'s' if nsenders != 1 else ''}"
    return groups


def _rating_counts(rec: dict, mail_verdicts: dict, acc) -> dict | None:
    """Per-mail AI rating summary for one group (None if nothing rated)."""
    counts = {"delete_safe": 0, "review": 0, "keep": 0}
    for folder, uids in rec["folders"].items():
        for uid in uids:
            m = acc.index.get(ikey(folder, uid))
            v = mail_verdicts.get(m["msgid"]) if m else None
            if v in counts:
                counts[v] += 1
    return counts if any(counts.values()) else None


def _protected_addrs(plist: list[str], acc) -> set[str]:
    """Scanned sender addresses matching the protected list (lock held)."""
    if not plist:
        return set()
    addrs = {m["addr"] for m in acc.index.values()}
    return {a for a in addrs if cfgmod.is_protected(a, plist)}


def _group_protected(rec: dict, paddrs: set[str], acc) -> bool:
    """True if any mail in this group comes from a protected sender
    (lock held). Sender groups reduce to one key check; domain/subject
    groups are protected as soon as they CONTAIN protected mail."""
    if not paddrs:
        return False
    for folder, uids in rec["folders"].items():
        for uid in uids:
            m = acc.index.get(ikey(folder, uid))
            if m and m["addr"] in paddrs:
                return True
    return False


def public_state(acc=None) -> dict:
    """One account's state for the API: group records without the internal
    UID lists, plus each group's per-mail rating summary."""
    acc = acc or accounts.get()
    mail_verdicts = verdictstore.load_mails()
    plist = cfgmod.normalize_protected(
        cfgmod.load_config().get("protected"))
    with acc.lock:
        paddrs = _protected_addrs(plist, acc)
        out = {k: v for k, v in acc.state.items() if k != "groups"}
        out["account"] = acc.name
        out["groups"] = {
            g: {k: {**{kk: vv for kk, vv in rec.items() if kk != "folders"},
                    "ratings": _rating_counts(rec, mail_verdicts, acc),
                    "protected": _group_protected(rec, paddrs, acc)}
                for k, rec in recs.items()}
            for g, recs in acc.state["groups"].items()}
        return out


def public_status(acc=None) -> dict:
    """Small live-update payload: everything EXCEPT the (big) group lists.
    SSE clients watch groups_rev and refetch the full state only when it
    moves — that keeps the stream at a few KB/s instead of ~700 KB/s."""
    acc = acc or accounts.get()
    with acc.lock:
        out = json.loads(json.dumps(
            {k: v for k, v in acc.state.items() if k != "groups"}))
        out["account"] = acc.name
        return out


def run_scan(acc=None) -> None:
    acc = acc or accounts.get()

    def progress_cb(folder, done, total):
        with acc.lock:
            acc.state["progress"] = f"{decode_mutf7(folder)}: {done}/{total}"

    cfg = cfgmod.load_config()
    im = cfg["accounts"][acc.name]
    t0 = time.time()
    log.info("[%s] scan started (host %s)", acc.name, im["host"])
    try:
        conn = connect(im)
        try:
            rules = im.get("excluded_folders") or []
            roles = folder_roles(conn, acc)
            # Special folders are excluded by ROLE (works for any provider's
            # names); the user's name/wildcard rules still apply on top.
            role_excluded = {roles[r] for r in EXCLUDED_ROLES if r in roles}
            folders = [f for f in list_folders(conn)
                       if f not in role_excluded
                       and not (excluded(f, rules)
                                or excluded(decode_mutf7(f), rules))]
            with acc.lock:
                acc.state["folders"] = [decode_mutf7(f) for f in folders]
            messages: list = []
            skipped = 0
            for folder in folders:
                skipped += scan_folder(conn, folder, messages,
                                       progress_cb, acc)
            trash_count = folder_message_count(conn, roles.get("trash"))
            replied = load_replied(acc)
            new_replied = scan_sent_recipients(conn, progress_cb, roles, acc)
            if new_replied - replied:
                replied |= new_replied
                save_replied(acc)
            groups = build_groups(messages, replied,
                                  effective_categories(cfg.get("categories")))
            cached = verdictstore.apply_to_groups(groups, acc.name)
            with acc.lock:
                acc.index.clear()
                for m in messages:
                    acc.index[ikey(m["folder"], m["uid"])] = m
                acc.state["groups"] = groups
                acc.state["status"] = "done"
                acc.state["progress"] = ""
                acc.state["trash_count"] = trash_count
                acc.state["folders_raw"] = folders
                if cached:
                    acc.state["notice"] = {"key": "cached_verdicts",
                                       "params": {"n": cached}}
                acc.state["ai"] = {"status": "idle", "grouping": "",
                               "progress": "", "error": "", "usage": None}
                acc.state["scanned_ts"] = int(time.time())
                acc.state["groups_rev"] += 1
            log.info("[%s] scan done: %d folders, %d mails, %d senders, "
                     "%d replied-to addrs%s in %.1fs",
                     acc.name, len(folders), len(messages),
                     len(groups["sender"]), len(replied),
                     f", {skipped} unparseable SKIPPED" if skipped else "",
                     time.time() - t0)
            statsmod.record_scan(len(messages),
                                 sum(m["size"] for m in messages),
                                 len(groups["sender"]), acc.name)
            save_snapshot(acc)
        finally:
            try:
                conn.logout()
            except Exception:
                pass
    except Cancelled:
        with acc.lock:
            acc.state["status"] = "idle"
            acc.state["progress"] = ""
            acc.state["notice"] = {"key": "scan_cancelled", "params": {}}
    except Exception as exc:
        log.exception("scan failed")
        with acc.lock:
            acc.state["status"] = "error"
            acc.state["error"] = f"{type(exc).__name__}: {exc}"


def folder_message_count(conn, target: str | None) -> int | None:
    """Message count of a raw folder via STATUS (folder stays unselected)."""
    try:
        if not target:
            return None
        status, data = conn.status(quote_folder(target), "(MESSAGES)")
        if status != "OK" or not data or not data[0]:
            return None
        m = re.search(rb"MESSAGES (\d+)", data[0])
        return int(m.group(1)) if m else None
    except Exception:
        return None


def start_scan(acc=None) -> None:
    acc = acc or accounts.get()
    with acc.lock:
        if acc.state["status"] == "scanning" \
                or acc.state["ai"]["status"] == "running" \
                or acc.state["delete"]["status"] == "running" \
                or acc.state["atts"]["status"] == "running":
            raise RuntimeError("busy")
        acc.state.update(status="scanning", progress="connecting…", error="",
                     notice=None, groups={g: {} for g in GROUPINGS},
                     scanned_ts=None)
        acc.state["groups_rev"] += 1
        acc.state["delete"] = {"status": "idle", "progress": "", "error": "",
                           "moved": 0}
        # Attachment analysis is per-scan; a new scan invalidates it.
        acc.state["atts"] = {"status": "idle", "progress": "", "error": "",
                         "mails": 0, "size": 0}
        acc.index.clear()
        acc.folder_uv.clear()
        acc.folder_roles.clear()
        acc.cancel["scan"] = False
    threading.Thread(target=tenants.call_in, args=(acc.tenant, run_scan, acc),
                     daemon=True).start()


# ------------------------------------------------------------------ deletes

def _apply_removal(moved_uids: dict[str, set[int]], acc) -> dict:
    """Drop moved messages from every grouping and the index (lock held).
    Returns the removed messages' metadata (for the undo log)."""
    # Grab metadata before popping so size/unread stay accurate too.
    meta: dict[str, dict[int, dict]] = {}
    for folder, gone in moved_uids.items():
        for uid in gone:
            m = acc.index.pop(ikey(folder, uid), None)
            if m:
                meta.setdefault(folder, {})[uid] = m
    for recs in acc.state["groups"].values():
        for key in list(recs):
            rec = recs[key]
            removed_n = removed_size = removed_unread = removed_att = 0
            for folder, gone in moved_uids.items():
                uids = rec["folders"].get(folder)
                if not uids:
                    continue
                kept = []
                for u in uids:
                    if u in gone:
                        removed_n += 1
                        m = meta.get(folder, {}).get(u)
                        if m:
                            removed_size += m["size"]
                            removed_unread += 0 if m["seen"] else 1
                            removed_att += m.get("att_size", 0)
                    else:
                        kept.append(u)
                if kept:
                    rec["folders"][folder] = kept
                else:
                    rec["folders"].pop(folder)
            rec["count"] -= removed_n
            rec["size"] = max(0, rec["size"] - removed_size)
            rec["unread"] = max(0, rec["unread"] - removed_unread)
            rec["att_size"] = max(0, rec.get("att_size", 0) - removed_att)
            if rec["count"] <= 0:
                recs.pop(key)
    acc.state["groups_rev"] += 1
    return meta


def _resolve_dest(conn, action: str, dest: str) -> str:
    """Raw name of the folder an action moves mail into (via folder role)."""
    if action in ("trash", "archive"):
        name = folder_roles(conn).get(action)
        if not name:
            raise RuntimeError(
                f"No {action.capitalize()} folder found on the server")
        return name
    if dest not in list_folders(conn):
        raise RuntimeError(f"unknown target folder {decode_mutf7(dest)!r}")
    return dest


def _move_uids(by_folder: dict[str, set[int]], action: str, dest: str,
               acc, progress_cb=None,
               moved_uids: dict[str, set[int]] | None = None,
               ) -> tuple[int, dict, str]:
    """Move UIDs into the action's target folder. `moved_uids` (if given) is
    mutated in place so a mid-run failure still tells the caller what WAS
    moved. Returns (moved, moved_uids, resolved_dest)."""
    total = sum(len(s) for s in by_folder.values())
    moved = 0
    if moved_uids is None:
        moved_uids = {}
    conn = connect(cfgmod.account_imap(acc.name))
    try:
        trash = _resolve_dest(conn, action, dest)
        for folder, uidset in by_folder.items():
            if folder == trash:
                continue   # moving into itself is a no-op
            status, _ = conn.select(quote_folder(folder), readonly=False)
            if status != "OK":
                continue
            # UIDVALIDITY changed since the scan -> our UIDs may point at
            # different messages now. Refuse rather than trash blindly.
            uv = uidvalidity(conn)
            if acc.folder_uv.get(folder) not in (None, 0) and uv \
                    and uv != acc.folder_uv[folder]:
                raise RuntimeError(
                    f"mailbox {decode_mutf7(folder)!r} changed on the server "
                    "(UIDVALIDITY mismatch) — rescan before deleting")
            uids = sorted(uidset)
            for start in range(0, len(uids), MOVE_CHUNK):
                if cancel_requested("delete", acc):
                    raise Cancelled()
                chunk = uids[start:start + MOVE_CHUNK]
                if _uid_move(conn, ",".join(str(u) for u in chunk), trash):
                    moved += len(chunk)
                    moved_uids.setdefault(folder, set()).update(chunk)
                if progress_cb:
                    progress_cb(moved, total)
    finally:
        try:
            conn.logout()
        except Exception:
            pass
    return moved, moved_uids, trash


def _mark_read(by_folder: dict[str, set[int]], acc,
               progress_cb=None) -> int:
    """Set \\Seen on the given UIDs; returns how many were flagged."""
    total = sum(len(s) for s in by_folder.values())
    done = 0
    conn = connect(cfgmod.account_imap(acc.name))
    try:
        for folder, uidset in by_folder.items():
            status, _ = conn.select(quote_folder(folder), readonly=False)
            if status != "OK":
                continue
            uids = sorted(uidset)
            for start in range(0, len(uids), MOVE_CHUNK):
                if cancel_requested("delete", acc):
                    raise Cancelled()
                chunk = uids[start:start + MOVE_CHUNK]
                status, _ = conn.uid("STORE",
                                     ",".join(str(u) for u in chunk),
                                     "+FLAGS", r"(\Seen)")
                if status == "OK":
                    done += len(chunk)
                    _apply_seen(folder, chunk, acc)
                if progress_cb:
                    progress_cb(done, total)
    finally:
        try:
            conn.logout()
        except Exception:
            pass
    return done


def _apply_seen(folder: str, uids: list[int], acc) -> None:
    """Mark messages read in acc.index and fix unread counters in every view."""
    with acc.lock:
        newly_read: set[int] = set()
        for uid in uids:
            m = acc.index.get(ikey(folder, uid))
            if m and not m["seen"]:
                m["seen"] = True
                newly_read.add(uid)
        if not newly_read:
            return
        for recs in acc.state["groups"].values():
            for rec in recs.values():
                hits = sum(1 for u in rec["folders"].get(folder, ())
                           if u in newly_read)
                if hits:
                    rec["unread"] = max(0, rec["unread"] - hits)
        acc.state["groups_rev"] += 1


# Deletions are queued and processed by one worker at a time: jobs snapshot
# UID sets up front, so running them concurrently could double-move the same
# UIDs and interleave progress reporting. Sequential is just as fast in
# practice (one Bridge connection) and keeps the bookkeeping exact.


def _record_undo(label: str, meta: dict, action: str, dest: str,
                 acc) -> None:
    """Append a move job to the undo log (acc.lock held)."""
    items = [(folder, m["msgid"])
             for folder, by_uid in meta.items()
             for m in by_uid.values() if m.get("msgid")]
    if not items:
        return
    acc.undo_log.append({"ts": int(time.time()), "label": label,
                         "action": action, "count": len(items),
                         "items": items, "in": dest})
    del acc.undo_log[:-UNDO_MAX]
    acc.state["undo"] = _undo_summaries(acc)


def _delete_worker(acc) -> None:
    while True:
        with acc.lock:
            done_persist = None      # None = queue not empty, keep working
            if not acc.delete_pending:
                st = acc.state["delete"]
                st["status"] = ("error" if st["error"] and not st["moved"]
                                else "done")
                st["progress"] = ""
                acc.inflight = {}
                done_persist = st["status"] == "done" and st["moved"] > 0
            else:
                job = acc.delete_pending.pop(0)
                acc.inflight = job["by_folder"]
        if done_persist is not None:
            if done_persist:         # groups/index changed — cache them
                save_snapshot(acc)
            return
        by_folder, label = job["by_folder"], job["label"]
        action, dest = job["action"], job["dest"]

        def progress_cb(moved, total):
            with acc.lock:
                base = acc.state["delete"]["moved"]
                queued = len(acc.delete_pending)
                acc.state["delete"]["progress"] = (
                    f"{base + moved}/{base + total}"
                    + (f" (+{queued} job(s) queued)" if queued else ""))

        moved_uids: dict[str, set[int]] = {}
        t0 = time.time()
        log.info("action %r started: %d mails (%s)", action,
                 sum(len(s) for s in by_folder.values()), label)

        def apply_partial():
            """acc.lock held: fold whatever WAS moved into the state."""
            if not moved_uids:
                return
            meta = _apply_removal(moved_uids, acc)
            _record_undo(label, meta, action, resolved[0], acc)
            n = sum(len(s) for s in moved_uids.values())
            acc.state["delete"]["moved"] += n
            freed[0] += sum(m["size"] for by_uid in meta.values()
                            for m in by_uid.values())
            freed[1] += n

        resolved = [dest]
        freed = [0, 0]                      # [bytes moved, mails moved]
        try:
            if action == "mark_read":
                done = _mark_read(by_folder, acc, progress_cb)
                with acc.lock:
                    acc.state["delete"]["moved"] += done
                statsmod.record_action("mark_read", done, 0, acc.name)
            else:
                moved, _, resolved[0] = _move_uids(
                    by_folder, action, dest, acc, progress_cb, moved_uids)
                with acc.lock:
                    apply_partial()
            log.info("action %r done: %d mails in %.1fs", action,
                     moved if action != "mark_read" else done,
                     time.time() - t0)
        except Cancelled:
            with acc.lock:
                apply_partial()
                acc.delete_pending.clear()
                acc.state["notice"] = {"key": "action_cancelled", "params": {}}
        except Exception as exc:
            log.exception("action %r failed after %.1fs", action,
                          time.time() - t0)
            # Fold in whatever DID get moved before the failure, so the state
            # never claims moved mails still exist where they were.
            with acc.lock:
                apply_partial()
                acc.state["delete"]["error"] = f"{type(exc).__name__}: {exc}"
        if action != "mark_read" and freed[1]:
            statsmod.record_action(action, freed[1], freed[0], acc.name)


def _start_delete(by_folder: dict[str, set[int]], label: str, acc,
                  action: str = "trash", dest: str = "") -> None:
    """Enqueue a background mail action (acc.lock held by caller)."""
    if action not in ACTIONS:
        raise ValueError("bad action")
    if action == "move" and not dest:
        raise ValueError("move needs a target folder")
    if acc.state["status"] == "scanning":
        raise RuntimeError("busy: scan running")
    # Drop UIDs already sitting in queued jobs — or in the job the worker is
    # processing right now — so overlapping selections (e.g. a sender group,
    # then its whole domain) don't get moved twice.
    queued: dict[str, set[int]] = {}
    for job in [*acc.delete_pending, {"by_folder": acc.inflight}]:
        for f, s in job["by_folder"].items():
            queued.setdefault(f, set()).update(s)
    by_folder = {f: s - queued.get(f, set()) for f, s in by_folder.items()}
    by_folder = {f: s for f, s in by_folder.items() if s}
    if not by_folder:
        return
    acc.delete_pending.append({"by_folder": by_folder, "label": label,
                            "action": action, "dest": dest})
    if acc.state["delete"]["status"] != "running":
        acc.state["delete"] = {"status": "running", "progress": "queued…",
                           "error": "", "moved": 0}
        acc.cancel["delete"] = False
        threading.Thread(target=tenants.call_in,
                         args=(acc.tenant, _delete_worker, acc),
                         daemon=True).start()


def delete_groups(grouping: str, keys: list[str],
                  action: str = "trash", dest: str = "",
                  force: bool = False, acc=None) -> dict:
    acc = acc or accounts.get()
    skipped = 0
    with acc.lock:
        if acc.state["status"] != "done":
            raise RuntimeError("No completed scan")
        # Server-side UID bookkeeping: client input only selects keys.
        recs = acc.state["groups"][grouping]
        jobs = {k: recs[k] for k in keys if k in recs}
        # Safety floor: trashing protected groups needs an explicit force
        # (the UI sends it only after a dedicated per-group confirmation).
        if jobs and action == "trash" and not force:
            plist = cfgmod.normalize_protected(
                cfgmod.load_config().get("protected"))
            paddrs = _protected_addrs(plist, acc)
            prot = [k for k, rec in jobs.items()
                    if _group_protected(rec, paddrs, acc)]
            for k in prot:
                jobs.pop(k)
            skipped = len(prot)
            if skipped:
                log.info("delete: skipped %d protected group(s): %s",
                         skipped, ", ".join(prot[:5]))
            if not jobs:
                raise ValueError("all selected groups are protected")
        by_folder: dict[str, set[int]] = {}
        for rec in jobs.values():
            for folder, uids in rec["folders"].items():
                by_folder.setdefault(folder, set()).update(uids)
        if not by_folder:
            raise RuntimeError("no known groups selected")
        labels = [jobs[k]["label"] for k in list(jobs)[:3]]
        label = ", ".join(labels) + ("…" if len(jobs) > 3 else "")
        _start_delete(by_folder, label, acc, action, dest)
    return {"ok": True, "queued": sum(len(s) for s in by_folder.values()),
            "skipped": skipped}


def delete_messages(items: list, action: str = "trash",
                    dest: str = "", acc=None) -> dict:
    """Act on individual messages ([folder, uid] pairs)."""
    acc = acc or accounts.get()
    with acc.lock:
        if acc.state["status"] != "done":
            raise RuntimeError("No completed scan")
        by_folder: dict[str, set[int]] = {}
        for it in items:
            if not (isinstance(it, (list, tuple)) and len(it) == 2):
                continue
            folder, uid = str(it[0]), int(it[1])
            if ikey(folder, uid) in acc.index:   # only messages we know about
                by_folder.setdefault(folder, set()).add(uid)
        if not by_folder:
            raise RuntimeError("no known messages selected")
        n = sum(len(s) for s in by_folder.values())
        _start_delete(by_folder, f"{n} selected mails", acc, action, dest)
    return {"ok": True, "queued": sum(len(s) for s in by_folder.values())}


# ------------------------------------------------------------- attachments

def _bs_tokenize(s: bytes):
    """Tokens of an IMAP parenthesized list: '(', ')', str, int or None."""
    i, n = 0, len(s)
    while i < n:
        c = s[i:i + 1]
        if c in b" \r\n":
            i += 1
        elif c in b"()":
            yield c.decode()
            i += 1
        elif c == b'"':
            j, out = i + 1, bytearray()
            while j < n and s[j:j + 1] != b'"':
                if s[j:j + 1] == b"\\":
                    j += 1
                out += s[j:j + 1]
                j += 1
            yield bytes(out).decode("utf-8", "replace")
            i = j + 1
        else:
            j = i
            while j < n and s[j:j + 1] not in b' ()"\r\n':
                j += 1
            atom = s[i:j].decode("utf-8", "replace")
            if atom.upper() == "NIL":
                yield None
            elif atom.isdigit():
                yield int(atom)
            else:
                yield atom
            i = j


def _bs_parse(tokens) -> list:
    out: list = []
    for tok in tokens:
        if tok == "(":
            out.append(_bs_parse(tokens))
        elif tok == ")":
            return out
        else:
            out.append(tok)
    return out


def _bs_param(params, key: str) -> str:
    """Value of `key` in a ("k1" "v1" "k2" "v2") parameter list."""
    if isinstance(params, list):
        for k, v in zip(params[::2], params[1::2]):
            if isinstance(k, str) and k.lower() == key:
                return v if isinstance(v, str) else ""
    return ""


def _bs_attachments(node, out: list) -> None:
    """Collect {name, size} of attachment parts from a parsed BODYSTRUCTURE."""
    if not isinstance(node, list) or not node:
        return
    if isinstance(node[0], list):                      # multipart container
        for child in node:
            _bs_attachments(child, out)
        return
    if len(node) < 7 or not isinstance(node[0], str):
        return
    size = node[6] if isinstance(node[6], int) else 0
    name = _bs_param(node[2], "name")
    dispo, dispo_name = "", ""
    for ext in node[7:]:
        if isinstance(ext, list) and ext and isinstance(ext[0], str) \
                and ext[0].lower() in ("attachment", "inline"):
            dispo = ext[0].lower()
            if len(ext) > 1:
                dispo_name = _bs_param(ext[1], "filename")
    fname = dispo_name or name
    # Attachment = explicitly disposed as one, or a named non-text part
    # (many senders skip the disposition but do set a filename).
    if size and (dispo == "attachment"
                 or (fname and node[0].lower() != "text")):
        out.append({"name": decode_mime(fname or "(unnamed)")[:120],
                    "size": size})


_BS_UID_RE = re.compile(rb"UID (\d+)")


def _run_atts(acc) -> None:
    """Annotate the index with attachment lists via BODYSTRUCTURE
    (read-only)."""
    t0 = time.time()
    try:
        with acc.lock:
            folders = list(acc.state["folders_raw"])
            per_folder = {f: sorted(
                m["uid"] for m in acc.index.values() if m["folder"] == f)
                for f in folders}
        conn = connect(cfgmod.account_imap(acc.name))
        try:
            for folder in folders:
                uids = per_folder.get(folder) or []
                if not uids:
                    continue
                status, _ = conn.select(quote_folder(folder), readonly=True)
                if status != "OK":
                    continue
                uv = uidvalidity(conn)
                if acc.folder_uv.get(folder) not in (None, 0) and uv \
                        and uv != acc.folder_uv[folder]:
                    log.warning("attachments: skipping %r (UIDVALIDITY "
                                "changed since scan)", folder)
                    continue
                total = len(uids)
                for start in range(0, total, FETCH_CHUNK):
                    if cancel_requested("atts", acc):
                        raise Cancelled()
                    with acc.lock:
                        acc.state["atts"]["progress"] = (
                            f"{decode_mutf7(folder)}: "
                            f"{min(start + FETCH_CHUNK, total)}/{total}")
                    chunk = uids[start:start + FETCH_CHUNK]
                    status, data = conn.uid(
                        "FETCH", ",".join(str(u) for u in chunk),
                        "(UID BODYSTRUCTURE)")
                    if status != "OK":
                        continue
                    # Re-join literal fragments imaplib splits into tuples,
                    # then parse one record per UID.
                    buf = bytearray()
                    for item in data or []:
                        if isinstance(item, tuple):
                            for part in item:
                                buf += part if isinstance(part, bytes) else b""
                        elif isinstance(item, bytes):
                            buf += item
                    for rec_m in re.finditer(
                            rb"UID (\d+) BODYSTRUCTURE ", buf):
                        uid = int(rec_m.group(1))
                        depth, j = 0, rec_m.end()
                        start_j = j
                        while j < len(buf):
                            if buf[j:j + 1] == b"(":
                                depth += 1
                            elif buf[j:j + 1] == b")":
                                depth -= 1
                                if depth == 0:
                                    break
                            elif buf[j:j + 1] == b'"':
                                j += 1
                                while j < len(buf) and buf[j:j+1] != b'"':
                                    if buf[j:j + 1] == b"\\":
                                        j += 1
                                    j += 1
                            j += 1
                        blob = bytes(buf[start_j:j + 1])
                        try:
                            parsed = _bs_parse(_bs_tokenize(blob))
                            atts: list = []
                            if parsed:
                                _bs_attachments(parsed[0], atts)
                        except Exception:
                            continue
                        if not atts:
                            continue
                        with acc.lock:
                            m = acc.index.get(ikey(folder, uid))
                            if m is not None:
                                m["atts"] = atts
                                m["att_size"] = sum(a["size"] for a in atts)
        finally:
            try:
                conn.logout()
            except Exception:
                pass

        with acc.lock:
            # Aggregate per group so the att:>… filter has data to work on.
            for recs in acc.state["groups"].values():
                for rec in recs.values():
                    rec["att_size"] = sum(
                        (acc.index.get(ikey(f, u)) or {}).get("att_size", 0)
                        for f, uids in rec["folders"].items() for u in uids)
            n = sum(1 for m in acc.index.values() if m.get("att_size"))
            size = sum(m.get("att_size", 0) for m in acc.index.values())
            acc.state["atts"] = {"status": "done", "progress": "", "error": "",
                             "mails": n, "size": size}
            acc.state["groups_rev"] += 1
        log.info("attachment analysis done: %d mails with attachments, "
                 "%s total, %.1fs", n, size, time.time() - t0)
        save_snapshot(acc)
    except Cancelled:
        with acc.lock:
            acc.state["atts"].update(status="idle", progress="")
            acc.state["notice"] = {"key": "atts_cancelled", "params": {}}
    except Exception as exc:
        log.exception("attachment analysis failed")
        with acc.lock:
            acc.state["atts"].update(status="error", progress="",
                                 error=f"{type(exc).__name__}: {exc}")


def start_att_scan(acc=None) -> None:
    acc = acc or accounts.get()
    with acc.lock:
        if acc.state["status"] != "done":
            raise RuntimeError("scan first")
        if acc.state["status"] == "scanning" \
                or acc.state["atts"]["status"] == "running" \
                or acc.state["delete"]["status"] == "running":
            raise RuntimeError("busy")
        acc.state["atts"] = {"status": "running", "progress": "starting…",
                         "error": "", "mails": 0, "size": 0}
        acc.cancel["atts"] = False
    threading.Thread(target=tenants.call_in,
                     args=(acc.tenant, _run_atts, acc),
                     daemon=True).start()


def attachments_list(limit: int = 300, acc=None) -> list[dict]:
    """Mails with attachments, largest first."""
    acc = acc or accounts.get()
    with acc.lock:
        out = [{"uid": m["uid"], "folder": m["folder"], "date": m["date"],
                "ts": m["ts"], "subject": m["subject"], "addr": m["addr"],
                "size": m["size"], "seen": m["seen"], "ai": None,
                "att_size": m["att_size"], "atts": m["atts"]}
               for m in acc.index.values() if m.get("att_size")]
    out.sort(key=lambda m: -m["att_size"])
    return out[:limit]


def index_stats(acc=None) -> dict:
    """Live numbers from the scanned index: totals, unread/newsletter
    share, per-year and per-month histograms, category breakdown, top
    domains by size and senders by count, AI coverage, replied share."""
    mail_verdicts = verdictstore.load_mails()
    years: dict[str, dict] = {}
    months: dict[str, dict] = {}
    domains: dict[str, dict] = {}
    categories: dict[str, dict] = {}
    total_size = unread = bulk = oldest = 0
    rated = {"delete_safe": 0, "review": 0, "keep": 0}
    ai_groups = {"delete_safe": 0, "review": 0, "keep": 0, "unrated": 0}
    replied_senders = 0
    top_senders: list[dict] = []

    acc = acc or accounts.get()
    with acc.lock:
        mails = list(acc.index.values())
        for m in mails:
            total_size += m["size"]
            unread += 0 if m["seen"] else 1
            bulk += 1 if m["bulk"] else 0
            if m["ts"]:
                oldest = m["ts"] if not oldest else min(oldest, m["ts"])
            lt = time.localtime(m["ts"]) if m["ts"] else None
            year = time.strftime("%Y", lt) if lt else "unknown"
            y = years.setdefault(year, {"count": 0, "size": 0})
            y["count"] += 1
            y["size"] += m["size"]
            if lt:
                mo = months.setdefault(time.strftime("%Y-%m", lt),
                                       {"count": 0, "size": 0})
                mo["count"] += 1
                mo["size"] += m["size"]
            dom = m["addr"].rsplit("@", 1)[-1]
            d = domains.setdefault(dom, {"count": 0, "size": 0})
            d["count"] += 1
            d["size"] += m["size"]
            v = mail_verdicts.get(m["msgid"])
            if v in rated:
                rated[v] += 1

        sender_groups = list(acc.state["groups"]["sender"].values())
        for g in sender_groups:
            if g.get("replied"):
                replied_senders += 1
            verdict = g["ai"]["verdict"] if g.get("ai") else "unrated"
            ai_groups[verdict] = ai_groups.get(verdict, 0) + 1
            for tag in g["tags"]:
                c = categories.setdefault(tag, {"count": 0, "size": 0})
                c["count"] += g["count"]
                c["size"] += g["size"]
        top_senders = [
            {"key": g["key"], "label": g["label"], "count": g["count"],
             "size": g["size"]}
            for g in sorted(sender_groups, key=lambda g: -g["count"])[:10]]

    top = sorted(domains.items(), key=lambda kv: -kv[1]["size"])[:10]
    return {
        "mails": len(mails), "size": total_size,
        "unread": unread, "bulk": bulk,
        "oldest": time.strftime("%Y-%m-%d", time.localtime(oldest))
                  if oldest else "",
        "senders": len(sender_groups),
        "replied_senders": replied_senders,
        "ai_groups": ai_groups,
        "rated_mails": rated,
        "years": [{"year": y, **v} for y, v in sorted(years.items())],
        "months": [{"month": k, **v}
                   for k, v in sorted(months.items())][-12:],
        "categories": sorted(
            [{"tag": k, **v} for k, v in categories.items()],
            key=lambda c: -c["count"]),
        "top_domains": [{"domain": k, **v} for k, v in top],
        "top_senders": top_senders,
    }


# -------------------------------------------------------------- duplicates

def duplicates_list(limit: int = 200, acc=None) -> list[dict]:
    """Duplicate sets from the scanned index: same Message-ID anywhere, or
    (for mails without a usable Message-ID match) the same exact
    (sender, subject, size) tuple. Newest mail first inside each set;
    'wasted' is what deleting all but the newest would free."""
    acc = acc or accounts.get()
    with acc.lock:
        mails = list(acc.index.values())
    by_msgid: dict[str, list] = {}
    for m in mails:
        if m["msgid"]:
            by_msgid.setdefault(m["msgid"], []).append(m)
    sets = [v for v in by_msgid.values() if len(v) > 1]
    in_set = {id(m) for s in sets for m in s}
    by_tuple: dict[tuple, list] = {}
    for m in mails:
        if id(m) in in_set or not m["subject"] or not m["size"]:
            continue
        by_tuple.setdefault((m["addr"], m["subject"], m["size"]),
                            []).append(m)
    sets += [v for v in by_tuple.values() if len(v) > 1]

    out = []
    for s in sets:
        s = sorted(s, key=lambda m: -m["ts"])
        out.append({
            "wasted": sum(m["size"] for m in s[1:]),
            "mails": [{"uid": m["uid"], "folder": m["folder"],
                       "date": m["date"], "ts": m["ts"],
                       "subject": m["subject"], "addr": m["addr"],
                       "size": m["size"], "seen": m["seen"], "ai": None}
                      for m in s]})
    out.sort(key=lambda x: -x["wasted"])
    return out[:limit]


# ----------------------------------------------------------- undo & trash

def undo_last(index: int = -1, acc=None) -> dict:
    """Restore a recorded move job (found by Message-ID in its target)."""
    acc = acc or accounts.get()
    with acc.lock:
        if not acc.undo_log:
            raise RuntimeError("nothing to undo")
        if not -len(acc.undo_log) <= index < len(acc.undo_log):
            raise RuntimeError("bad undo index")
        if acc.state["delete"]["status"] == "running":
            raise RuntimeError("busy: an action is running")
        entry = acc.undo_log.pop(index)
        acc.state["undo"] = _undo_summaries(acc)

    restored = 0
    conn = connect(cfgmod.account_imap(acc.name))
    try:
        trash = entry.get("in") or folder_roles(conn, acc).get("trash")
        if not trash:
            raise RuntimeError("No Trash folder found on the server")
        status, _ = conn.select(quote_folder(trash), readonly=False)
        if status != "OK":
            raise RuntimeError(
                f"cannot open {decode_mutf7(trash)!r}")
        # Find each message in Trash by Message-ID, batch moves per target.
        by_target: dict[str, list[bytes]] = {}
        for folder, msgid in entry["items"]:
            if not msgid:
                continue
            status, data = conn.uid("SEARCH", None, "HEADER", "Message-ID",
                                    f'"{msgid}"')
            if status == "OK" and data and data[0]:
                by_target.setdefault(folder, []).extend(data[0].split())
        for folder, uids in by_target.items():
            for start in range(0, len(uids), MOVE_CHUNK):
                chunk = uids[start:start + MOVE_CHUNK]
                if _uid_move(conn, b",".join(chunk).decode(), folder):
                    restored += len(chunk)
    finally:
        try:
            conn.logout()
        except Exception:
            pass

    log.info("undo: restored %d/%d mails (%s)", restored, entry["count"],
             entry["label"])
    with acc.lock:
        if acc.state["trash_count"] is not None:
            acc.state["trash_count"] = max(0, acc.state["trash_count"] - restored)
        acc.state["notice"] = {"key": "restored", "params": {
            "restored": restored, "of": entry["count"],
            "label": entry["label"]}}
    return {"restored": restored, "of": entry["count"]}


def trash_list(limit: int = 1000, acc=None) -> dict:
    """Live Trash contents (Trash stays out of the cleanup index). The
    returned uv must be sent back on restore so we never MOVE stale UIDs."""
    acc = acc or accounts.get()
    conn = connect(cfgmod.account_imap(acc.name))
    try:
        trash = folder_roles(conn, acc).get("trash")
        if not trash:
            raise RuntimeError("No Trash folder found on the server")
        messages: list = []
        scan_folder(conn, trash, messages, lambda *a: None, acc)
    finally:
        try:
            conn.logout()
        except Exception:
            pass
    messages.sort(key=lambda m: -m["ts"])
    with acc.lock:
        acc.state["trash_count"] = len(messages)
    return {"folder": trash, "uv": acc.folder_uv.get(trash, 0),
            "total": len(messages),
            "mails": [{"uid": m["uid"], "folder": trash, "date": m["date"],
                       "ts": m["ts"], "subject": m["subject"],
                       "addr": m["addr"], "size": m["size"],
                       "seen": m["seen"], "ai": None}
                      for m in messages[:limit]]}


def trash_restore(uids: list[int], dest: str, uv: int = 0,
                  acc=None) -> dict:
    """Move mails out of Trash into `dest` (raw folder name)."""
    acc = acc or accounts.get()
    with acc.lock:
        if acc.state["delete"]["status"] == "running":
            raise RuntimeError("busy: a deletion is running")
    restored = 0
    conn = connect(cfgmod.account_imap(acc.name))
    try:
        folders = list_folders(conn)
        trash = folder_roles(conn, acc).get("trash")
        if not trash:
            raise RuntimeError("No Trash folder found on the server")
        if dest not in folders:
            raise RuntimeError(f"unknown target folder {decode_mutf7(dest)!r}")
        if dest == trash:
            raise RuntimeError("target is the Trash folder itself")
        status, _ = conn.select(quote_folder(trash), readonly=False)
        if status != "OK":
            raise RuntimeError("cannot open Trash")
        if uv and uidvalidity(conn) not in (0, uv):
            raise RuntimeError("Trash changed on the server — reload it "
                               "before restoring")
        clean = sorted({int(u) for u in uids})
        for start in range(0, len(clean), MOVE_CHUNK):
            chunk = clean[start:start + MOVE_CHUNK]
            if _uid_move(conn, ",".join(str(u) for u in chunk), dest):
                restored += len(chunk)
    finally:
        try:
            conn.logout()
        except Exception:
            pass
    log.info("trash restore: %d mails -> %r", restored, decode_mutf7(dest))
    with acc.lock:
        if acc.state["trash_count"] is not None:
            acc.state["trash_count"] = max(0, acc.state["trash_count"] - restored)
        acc.state["notice"] = {"key": "trash_restored", "params": {
            "n": restored, "dest": decode_mutf7(dest)}}
    return {"restored": restored}


def empty_trash(acc=None) -> dict:
    """Permanently delete everything in Trash."""
    acc = acc or accounts.get()
    with acc.lock:
        if acc.state["delete"]["status"] == "running":
            raise RuntimeError("busy: a deletion is running")
        acc.undo_log.clear()
        acc.state["undo"] = []

    conn = connect(cfgmod.account_imap(acc.name))
    try:
        trash = folder_roles(conn, acc).get("trash")
        if not trash:
            raise RuntimeError("No Trash folder found on the server")
        status, data = conn.select(quote_folder(trash), readonly=False)
        if status != "OK":
            raise RuntimeError("cannot open Trash")
        count = int(data[0]) if data and data[0] else 0
        if count:
            conn.store("1:*", "+FLAGS", r"(\Deleted)")
            conn.expunge()
    finally:
        try:
            conn.logout()
        except Exception:
            pass

    log.info("emptied Trash: %d mails permanently deleted", count)
    with acc.lock:
        acc.state["trash_count"] = 0
        acc.state["notice"] = {"key": "emptied_trash", "params": {"count": count}}
    return {"deleted": count}


def search_mails(query: str, limit: int = 500, acc=None) -> list[dict]:
    """Substring search over the scanned index (subject + sender)."""
    acc = acc or accounts.get()
    q = query.strip().lower()
    if len(q) < 2:
        return []
    out = []
    with acc.lock:
        for m in acc.index.values():
            if q in m["subject"].lower() or q in m["addr"] \
                    or q in m["name"].lower():
                out.append({"uid": m["uid"], "folder": m["folder"],
                            "date": m["date"], "ts": m["ts"],
                            "subject": m["subject"], "addr": m["addr"],
                            "size": m["size"], "seen": m["seen"]})
    out.sort(key=lambda m: -m["ts"])
    return out[:limit]


# ---------------------------------------------------------------- drilldown

def group_mails(grouping: str, key: str,
                with_msgid: bool = False, acc=None) -> list[dict]:
    acc = acc or accounts.get()
    mail_verdicts = verdictstore.load_mails()
    with acc.lock:
        rec = acc.state["groups"][grouping].get(key)
        if not rec:
            return []
        out = []
        for folder, uids in rec["folders"].items():
            for uid in uids:
                m = acc.index.get(ikey(folder, uid))
                if m:
                    entry = {"uid": m["uid"], "folder": folder,
                             "date": m["date"], "ts": m["ts"],
                             "subject": m["subject"], "addr": m["addr"],
                             "size": m["size"], "seen": m["seen"],
                             "ai": mail_verdicts.get(m["msgid"]) or None}
                    if with_msgid:
                        entry["msgid"] = m["msgid"]
                    out.append(entry)
    out.sort(key=lambda m: -m["ts"])
    return out


def group_label(grouping: str, key: str, acc=None) -> str:
    acc = acc or accounts.get()
    with acc.lock:
        rec = acc.state["groups"][grouping].get(key)
        return rec["label"] if rec else key


_TAG_STRIP_RE = re.compile(
    r"<(style|script|head)[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)


def extract_text(msg) -> str:
    plain = htmlp = None
    for part in msg.walk():
        if part.get_content_maintype() == "multipart":
            continue
        ct = part.get_content_type()
        if ct == "text/plain" and plain is None:
            plain = part
        elif ct == "text/html" and htmlp is None:
            htmlp = part
    part = plain or htmlp
    if part is None:
        return "(no text content)"
    payload = part.get_payload(decode=True) or b""
    text = payload.decode(part.get_content_charset() or "utf-8", "replace")
    if part.get_content_type() == "text/html":
        text = _TAG_STRIP_RE.sub(" ", text)
        text = re.sub(r"<br\s*/?>|</p>|</div>|</tr>", "\n", text,
                      flags=re.IGNORECASE)
        text = re.sub(r"<[^>]+>", " ", text)
        text = html_mod.unescape(text)
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    return text.strip()[:BODY_CHAR_LIMIT]


def fetch_message(folder: str, uid: int, acc=None) -> dict:
    acc = acc or accounts.get()
    # Trash mails are never in the index (excluded from scans) but the Trash
    # browser still needs to open them. Compare against the trash ROLE
    # (trash_list populated acc.folder_roles); the literal stays as fallback.
    if ikey(folder, uid) not in acc.index \
            and folder != acc.folder_roles.get("trash") \
            and folder.lower() != "trash":
        raise RuntimeError("unknown message")
    conn = connect(cfgmod.account_imap(acc.name))
    try:
        status, _ = conn.select(quote_folder(folder), readonly=True)
        if status != "OK":
            raise RuntimeError(f"cannot open folder {folder!r}")
        status, data = conn.uid("FETCH", str(uid), "(BODY.PEEK[])")
        if status != "OK" or not data or not isinstance(data[0], tuple):
            raise RuntimeError("fetch failed")
        msg = email.message_from_bytes(data[0][1])
    finally:
        try:
            conn.logout()
        except Exception:
            pass
    return {
        "from": decode_mime(msg.get("From", "")),
        "to": decode_mime(msg.get("To", "")),
        "date": msg.get("Date", ""),
        "subject": decode_mime(msg.get("Subject", "")),
        "text": extract_text(msg),
    }
