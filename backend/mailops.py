"""IMAP scanning, grouping, drill-down, and move-to-Trash operations.

Talks to Proton Mail Bridge over implicit TLS (the Bridge cert is the CA
file). All state is in memory: STATE holds the group views, INDEX holds
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

from . import config as cfgmod
from . import stats as statsmod
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

STATE_LOCK = threading.Lock()
STATE: dict = {
    "status": "idle", "progress": "", "error": "", "folders": [],
    "groups": {g: {} for g in GROUPINGS},
    "ai": {"status": "idle", "grouping": "", "progress": "", "error": "",
           "usage": None},
    "delete": {"status": "idle", "progress": "", "error": "", "moved": 0},
    "atts": {"status": "idle", "progress": "", "error": "",
             "mails": 0, "size": 0},   # attachment analysis (lazy)
    "trash_count": None,   # mails currently in Trash (None = unknown)
    "notice": None,        # one-shot info for the UI: {key, params} | None
    "undo": [],            # summaries of undoable move jobs (newest last)
    "folders_raw": [],     # raw IMAP folder names (targets for move-to)
    "rules": [],           # saved cleanup rules (mirrored by backend.rules)
}
ACTIONS = ("trash", "archive", "move", "mark_read")
INDEX: dict[str, dict] = {}   # "folder\x00uid" -> per-message metadata
FOLDER_UV: dict[str, int] = {}  # folder -> UIDVALIDITY seen during the scan
UNDO_LOG: list[dict] = []       # {ts,label,count,items:[(folder,msgid)]}
UNDO_MAX = 10

# "Never replied" signal: every address the user has ever written to
# (To/Cc of the Sent folder), merged across scans and persisted — mail
# later deleted from Sent must not flip senders back to "never replied".
REPLIED_PATH = Path(os.environ.get("REPLIED_PATH", "/data/replied.json"))
REPLIED_TO: set[str] = set()
_replied_loaded = False


def load_replied() -> set[str]:
    global _replied_loaded
    if not _replied_loaded:
        try:
            data = json.loads(REPLIED_PATH.read_text())
            REPLIED_TO.update(a for a in data.get("addrs", [])
                              if isinstance(a, str))
        except (OSError, json.JSONDecodeError):
            pass
        _replied_loaded = True
    return REPLIED_TO


def save_replied() -> None:
    try:
        REPLIED_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = REPLIED_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(
            {"ts": int(time.time()), "addrs": sorted(REPLIED_TO)}))
        tmp.chmod(0o600)
        tmp.replace(REPLIED_PATH)
    except OSError:
        log.exception("could not persist replied.json")


class Cancelled(Exception):
    """Raised inside workers when the user cancelled the operation."""


_CANCEL = {"scan": False, "ai": False, "delete": False, "atts": False}


def request_cancel(target: str) -> None:
    if target not in _CANCEL:
        raise RuntimeError("bad cancel target")
    _CANCEL[target] = True


def cancel_requested(target: str) -> bool:
    return _CANCEL[target]


def _undo_summaries() -> list[dict]:
    return [{"ts": u["ts"], "label": u["label"], "count": u["count"],
             "action": u.get("action", "trash")}
            for u in UNDO_LOG]


def clear_ai_marks() -> None:
    with STATE_LOCK:
        for recs in STATE["groups"].values():
            for rec in recs.values():
                rec["ai"] = None


def ikey(folder: str, uid: int) -> str:
    return f"{folder}\x00{uid}"


def categorize(hay: str, localpart: str = "", bulk: bool = False) -> list[str]:
    hay = hay.lower()
    tags = [cat for cat, pats in CATEGORY_RULES if any(p in hay for p in pats)]
    if localpart and AUTOMATED_RE.match(localpart):
        tags.append("automated")
    if bulk:
        tags.append("newsletter")
    return tags


# --------------------------------------------------------------------- imap

def connect(cfg: dict) -> imaplib.IMAP4_SSL:
    im = cfg["imap"]
    ctx = ssl.create_default_context(cafile=im["cafile"] or None)
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


def list_folders(conn: imaplib.IMAP4_SSL) -> list[str]:
    status, data = conn.list()
    names = []
    if status != "OK":
        return names
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
        names.append(name.decode("utf-8", "replace"))
    return names


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


def decode_mime(raw: str) -> str:
    try:
        parts = email.header.decode_header(raw)
        return "".join(
            p.decode(enc or "utf-8", "replace") if isinstance(p, bytes) else p
            for p, enc in parts).strip()
    except Exception:
        return (raw or "").strip()


_UID_RE = re.compile(rb"UID (\d+)")
_SIZE_RE = re.compile(rb"RFC822\.SIZE (\d+)")
_FLAGS_RE = re.compile(rb"FLAGS \(([^)]*)\)")


def scan_folder(conn, folder: str, messages: list, progress_cb) -> None:
    status, _ = conn.select(quote_folder(folder), readonly=True)
    if status != "OK":
        return
    # Cached UIDs are only meaningful for this UIDVALIDITY generation;
    # deletes re-check it (Bridge resets it on resync/re-login).
    FOLDER_UV[folder] = uidvalidity(conn)
    status, data = conn.uid("SEARCH", None, "ALL")
    if status != "OK" or not data or not data[0]:
        return
    uids = data[0].split()
    total = len(uids)
    for start in range(0, total, FETCH_CHUNK):
        if cancel_requested("scan"):
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
                              (msg.get("List-Unsubscribe-Post") or "").lower(),
                "msgid": (msg.get("Message-ID") or "").strip()[:300],
                "size": int(sm.group(1)) if sm else 0,
                "seen": bool(fm and b"\\Seen" in fm.group(1)),
                "ts": ts,
                "date": time.strftime("%Y-%m-%d %H:%M",
                                      time.localtime(ts)) if ts else "",
            })


def scan_sent_recipients(conn, progress_cb=None) -> set[str]:
    """Addresses in To/Cc of the Sent folder (headers only). Sent stays
    excluded from the cleanup views; this pass only feeds REPLIED_TO."""
    target = next((f for f in list_folders(conn)
                   if f.lower() == "sent"), None)
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
        if cancel_requested("scan"):
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
            msg = email.message_from_bytes(item[1])
            for _, addr in getaddresses(
                    msg.get_all("To", []) + msg.get_all("Cc", [])):
                addr = addr.strip().lower()
                if addr and "@" in addr:
                    out.add(addr)
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


def build_groups(messages: list, replied_to: set[str] | None = None) -> dict:
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
            rec["tags"] = categorize(rec.pop("_hay"), localpart, rec["bulk"])
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


def _rating_counts(rec: dict, mail_verdicts: dict) -> dict | None:
    """Per-mail AI rating summary for one group (None if nothing rated)."""
    counts = {"delete_safe": 0, "review": 0, "keep": 0}
    for folder, uids in rec["folders"].items():
        for uid in uids:
            m = INDEX.get(ikey(folder, uid))
            v = mail_verdicts.get(m["msgid"]) if m else None
            if v in counts:
                counts[v] += 1
    return counts if any(counts.values()) else None


def _protected_addrs(plist: list[str]) -> set[str]:
    """Scanned sender addresses matching the protected list (lock held)."""
    if not plist:
        return set()
    addrs = {m["addr"] for m in INDEX.values()}
    return {a for a in addrs if cfgmod.is_protected(a, plist)}


def _group_protected(rec: dict, paddrs: set[str]) -> bool:
    """True if any mail in this group comes from a protected sender
    (lock held). Sender groups reduce to one key check; domain/subject
    groups are protected as soon as they CONTAIN protected mail."""
    if not paddrs:
        return False
    for folder, uids in rec["folders"].items():
        for uid in uids:
            m = INDEX.get(ikey(folder, uid))
            if m and m["addr"] in paddrs:
                return True
    return False


def public_state() -> dict:
    """STATE for the API: group records without the internal UID lists,
    plus the per-mail rating summary each group's mails have accumulated."""
    mail_verdicts = verdictstore.load_mails()
    plist = cfgmod.normalize_protected(
        cfgmod.load_config().get("protected"))
    with STATE_LOCK:
        paddrs = _protected_addrs(plist)
        out = {k: v for k, v in STATE.items() if k != "groups"}
        out["groups"] = {
            g: {k: {**{kk: vv for kk, vv in rec.items() if kk != "folders"},
                    "ratings": _rating_counts(rec, mail_verdicts),
                    "protected": _group_protected(rec, paddrs)}
                for k, rec in recs.items()}
            for g, recs in STATE["groups"].items()}
        return out


def run_scan() -> None:
    def progress_cb(folder, done, total):
        with STATE_LOCK:
            STATE["progress"] = f"{decode_mutf7(folder)}: {done}/{total}"

    cfg = cfgmod.load_config()
    t0 = time.time()
    log.info("scan started (host %s)", cfg["imap"]["host"])
    try:
        conn = connect(cfg)
        try:
            rules = cfg["excluded_folders"]
            folders = [f for f in list_folders(conn)
                       if not (excluded(f, rules)
                               or excluded(decode_mutf7(f), rules))]
            with STATE_LOCK:
                STATE["folders"] = [decode_mutf7(f) for f in folders]
            messages: list = []
            for folder in folders:
                scan_folder(conn, folder, messages, progress_cb)
            trash_count = folder_message_count(conn, "Trash")
            replied = load_replied()
            new_replied = scan_sent_recipients(conn, progress_cb)
            if new_replied - replied:
                replied |= new_replied
                save_replied()
            groups = build_groups(messages, replied)
            cached = verdictstore.apply_to_groups(groups)
            with STATE_LOCK:
                INDEX.clear()
                for m in messages:
                    INDEX[ikey(m["folder"], m["uid"])] = m
                STATE["groups"] = groups
                STATE["status"] = "done"
                STATE["progress"] = ""
                STATE["trash_count"] = trash_count
                STATE["folders_raw"] = folders
                if cached:
                    STATE["notice"] = {"key": "cached_verdicts",
                                       "params": {"n": cached}}
                STATE["ai"] = {"status": "idle", "grouping": "",
                               "progress": "", "error": "", "usage": None}
            log.info("scan done: %d folders, %d mails, %d senders, "
                     "%d replied-to addrs in %.1fs",
                     len(folders), len(messages), len(groups["sender"]),
                     len(replied), time.time() - t0)
            statsmod.record_scan(len(messages),
                                 sum(m["size"] for m in messages),
                                 len(groups["sender"]))
        finally:
            try:
                conn.logout()
            except Exception:
                pass
    except Cancelled:
        with STATE_LOCK:
            STATE["status"] = "idle"
            STATE["progress"] = ""
            STATE["notice"] = {"key": "scan_cancelled", "params": {}}
    except Exception as exc:
        log.exception("scan failed")
        with STATE_LOCK:
            STATE["status"] = "error"
            STATE["error"] = f"{type(exc).__name__}: {exc}"


def folder_message_count(conn, name: str) -> int | None:
    """Message count of a folder via STATUS (folder stays unselected)."""
    try:
        target = next((f for f in list_folders(conn)
                       if f.lower() == name.lower()), None)
        if not target:
            return None
        status, data = conn.status(quote_folder(target), "(MESSAGES)")
        if status != "OK" or not data or not data[0]:
            return None
        m = re.search(rb"MESSAGES (\d+)", data[0])
        return int(m.group(1)) if m else None
    except Exception:
        return None


def start_scan() -> None:
    with STATE_LOCK:
        if STATE["status"] == "scanning" \
                or STATE["ai"]["status"] == "running" \
                or STATE["delete"]["status"] == "running":
            raise RuntimeError("busy")
        STATE.update(status="scanning", progress="connecting…", error="",
                     notice=None, groups={g: {} for g in GROUPINGS})
        STATE["delete"] = {"status": "idle", "progress": "", "error": "",
                           "moved": 0}
        # Attachment analysis is per-scan; a new scan invalidates it.
        STATE["atts"] = {"status": "idle", "progress": "", "error": "",
                         "mails": 0, "size": 0}
        INDEX.clear()
        FOLDER_UV.clear()
        _CANCEL["scan"] = False
    threading.Thread(target=run_scan, daemon=True).start()


# ------------------------------------------------------------------ deletes

def _apply_removal(moved_uids: dict[str, set[int]]) -> dict:
    """Drop moved messages from every grouping and the index (lock held).
    Returns the removed messages' metadata (for the undo log)."""
    # Grab metadata before popping so size/unread stay accurate too.
    meta: dict[str, dict[int, dict]] = {}
    for folder, gone in moved_uids.items():
        for uid in gone:
            m = INDEX.pop(ikey(folder, uid), None)
            if m:
                meta.setdefault(folder, {})[uid] = m
    for recs in STATE["groups"].values():
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
    return meta


def _resolve_dest(conn, action: str, dest: str) -> str:
    """Raw name of the folder an action moves mail into."""
    folders = list_folders(conn)
    if action == "trash":
        name = next((f for f in folders if f.lower() == "trash"), None)
        if not name:
            raise RuntimeError("No Trash folder found on the server")
        return name
    if action == "archive":
        name = next((f for f in folders if f.lower() == "archive"), None)
        if not name:
            raise RuntimeError("No Archive folder found on the server")
        return name
    if dest not in folders:
        raise RuntimeError(f"unknown target folder {decode_mutf7(dest)!r}")
    return dest


def _move_uids(by_folder: dict[str, set[int]], action: str, dest: str,
               progress_cb=None,
               moved_uids: dict[str, set[int]] | None = None,
               ) -> tuple[int, dict, str]:
    """Move UIDs into the action's target folder. `moved_uids` (if given) is
    mutated in place so a mid-run failure still tells the caller what WAS
    moved. Returns (moved, moved_uids, resolved_dest)."""
    cfg = cfgmod.load_config()
    total = sum(len(s) for s in by_folder.values())
    moved = 0
    if moved_uids is None:
        moved_uids = {}
    conn = connect(cfg)
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
            if FOLDER_UV.get(folder) not in (None, 0) and uv \
                    and uv != FOLDER_UV[folder]:
                raise RuntimeError(
                    f"mailbox {decode_mutf7(folder)!r} changed on the server "
                    "(UIDVALIDITY mismatch) — rescan before deleting")
            uids = sorted(uidset)
            for start in range(0, len(uids), MOVE_CHUNK):
                if cancel_requested("delete"):
                    raise Cancelled()
                chunk = uids[start:start + MOVE_CHUNK]
                status, _ = conn.uid("MOVE",
                                     ",".join(str(u) for u in chunk),
                                     quote_folder(trash))
                if status == "OK":
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


def _mark_read(by_folder: dict[str, set[int]], progress_cb=None) -> int:
    """Set \\Seen on the given UIDs; returns how many were flagged."""
    cfg = cfgmod.load_config()
    total = sum(len(s) for s in by_folder.values())
    done = 0
    conn = connect(cfg)
    try:
        for folder, uidset in by_folder.items():
            status, _ = conn.select(quote_folder(folder), readonly=False)
            if status != "OK":
                continue
            uids = sorted(uidset)
            for start in range(0, len(uids), MOVE_CHUNK):
                if cancel_requested("delete"):
                    raise Cancelled()
                chunk = uids[start:start + MOVE_CHUNK]
                status, _ = conn.uid("STORE",
                                     ",".join(str(u) for u in chunk),
                                     "+FLAGS", r"(\Seen)")
                if status == "OK":
                    done += len(chunk)
                    _apply_seen(folder, chunk)
                if progress_cb:
                    progress_cb(done, total)
    finally:
        try:
            conn.logout()
        except Exception:
            pass
    return done


def _apply_seen(folder: str, uids: list[int]) -> None:
    """Mark messages read in INDEX and fix unread counters in every view."""
    with STATE_LOCK:
        newly_read: set[int] = set()
        for uid in uids:
            m = INDEX.get(ikey(folder, uid))
            if m and not m["seen"]:
                m["seen"] = True
                newly_read.add(uid)
        if not newly_read:
            return
        for recs in STATE["groups"].values():
            for rec in recs.values():
                hits = sum(1 for u in rec["folders"].get(folder, ())
                           if u in newly_read)
                if hits:
                    rec["unread"] = max(0, rec["unread"] - hits)


# Deletions are queued and processed by one worker at a time: jobs snapshot
# UID sets up front, so running them concurrently could double-move the same
# UIDs and interleave progress reporting. Sequential is just as fast in
# practice (one Bridge connection) and keeps the bookkeeping exact.
_DELETE_PENDING: list[dict] = []   # {by_folder, label}; guarded by STATE_LOCK


def _record_undo(label: str, meta: dict, action: str, dest: str) -> None:
    """Append a move job to the undo log (STATE_LOCK held)."""
    items = [(folder, m["msgid"])
             for folder, by_uid in meta.items()
             for m in by_uid.values() if m.get("msgid")]
    if not items:
        return
    UNDO_LOG.append({"ts": int(time.time()), "label": label, "action": action,
                     "count": len(items), "items": items, "in": dest})
    del UNDO_LOG[:-UNDO_MAX]
    STATE["undo"] = _undo_summaries()


def _delete_worker() -> None:
    while True:
        with STATE_LOCK:
            if not _DELETE_PENDING:
                st = STATE["delete"]
                st["status"] = ("error" if st["error"] and not st["moved"]
                                else "done")
                st["progress"] = ""
                return
            job = _DELETE_PENDING.pop(0)
        by_folder, label = job["by_folder"], job["label"]
        action, dest = job["action"], job["dest"]

        def progress_cb(moved, total):
            with STATE_LOCK:
                base = STATE["delete"]["moved"]
                queued = len(_DELETE_PENDING)
                STATE["delete"]["progress"] = (
                    f"{base + moved}/{base + total}"
                    + (f" (+{queued} job(s) queued)" if queued else ""))

        moved_uids: dict[str, set[int]] = {}
        t0 = time.time()
        log.info("action %r started: %d mails (%s)", action,
                 sum(len(s) for s in by_folder.values()), label)

        def apply_partial():
            """STATE_LOCK held: fold whatever WAS moved into the state."""
            if not moved_uids:
                return
            meta = _apply_removal(moved_uids)
            _record_undo(label, meta, action, resolved[0])
            n = sum(len(s) for s in moved_uids.values())
            STATE["delete"]["moved"] += n
            freed[0] += sum(m["size"] for by_uid in meta.values()
                            for m in by_uid.values())
            freed[1] += n

        resolved = [dest]
        freed = [0, 0]                      # [bytes moved, mails moved]
        try:
            if action == "mark_read":
                done = _mark_read(by_folder, progress_cb)
                with STATE_LOCK:
                    STATE["delete"]["moved"] += done
                statsmod.record_action("mark_read", done, 0)
            else:
                moved, _, resolved[0] = _move_uids(
                    by_folder, action, dest, progress_cb, moved_uids)
                with STATE_LOCK:
                    apply_partial()
            log.info("action %r done: %d mails in %.1fs", action,
                     moved if action != "mark_read" else done,
                     time.time() - t0)
        except Cancelled:
            with STATE_LOCK:
                apply_partial()
                _DELETE_PENDING.clear()
                STATE["notice"] = {"key": "action_cancelled", "params": {}}
        except Exception as exc:
            log.exception("action %r failed after %.1fs", action,
                          time.time() - t0)
            # Fold in whatever DID get moved before the failure, so the state
            # never claims moved mails still exist where they were.
            with STATE_LOCK:
                apply_partial()
                STATE["delete"]["error"] = f"{type(exc).__name__}: {exc}"
        if action != "mark_read" and freed[1]:
            statsmod.record_action(action, freed[1], freed[0])


def _start_delete(by_folder: dict[str, set[int]], label: str,
                  action: str = "trash", dest: str = "") -> None:
    """Enqueue a background mail action (STATE_LOCK held by caller)."""
    if action not in ACTIONS:
        raise ValueError("bad action")
    if action == "move" and not dest:
        raise ValueError("move needs a target folder")
    if STATE["status"] == "scanning":
        raise RuntimeError("busy: scan running")
    # Drop UIDs already sitting in queued jobs so overlapping selections
    # (e.g. a sender group, then its whole domain) don't get moved twice.
    queued: dict[str, set[int]] = {}
    for job in _DELETE_PENDING:
        for f, s in job["by_folder"].items():
            queued.setdefault(f, set()).update(s)
    by_folder = {f: s - queued.get(f, set()) for f, s in by_folder.items()}
    by_folder = {f: s for f, s in by_folder.items() if s}
    if not by_folder:
        return
    _DELETE_PENDING.append({"by_folder": by_folder, "label": label,
                            "action": action, "dest": dest})
    if STATE["delete"]["status"] != "running":
        STATE["delete"] = {"status": "running", "progress": "queued…",
                           "error": "", "moved": 0}
        _CANCEL["delete"] = False
        threading.Thread(target=_delete_worker, daemon=True).start()


def delete_groups(grouping: str, keys: list[str],
                  action: str = "trash", dest: str = "",
                  force: bool = False) -> dict:
    skipped = 0
    with STATE_LOCK:
        if STATE["status"] != "done":
            raise RuntimeError("No completed scan")
        # Server-side UID bookkeeping: client input only selects keys.
        recs = STATE["groups"][grouping]
        jobs = {k: recs[k] for k in keys if k in recs}
        # Safety floor: trashing protected groups needs an explicit force
        # (the UI sends it only after a dedicated per-group confirmation).
        if jobs and action == "trash" and not force:
            plist = cfgmod.normalize_protected(
                cfgmod.load_config().get("protected"))
            paddrs = _protected_addrs(plist)
            prot = [k for k, rec in jobs.items()
                    if _group_protected(rec, paddrs)]
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
        _start_delete(by_folder, label, action, dest)
    return {"ok": True, "queued": sum(len(s) for s in by_folder.values()),
            "skipped": skipped}


def delete_messages(items: list, action: str = "trash",
                    dest: str = "") -> dict:
    """Act on individual messages ([folder, uid] pairs)."""
    with STATE_LOCK:
        if STATE["status"] != "done":
            raise RuntimeError("No completed scan")
        by_folder: dict[str, set[int]] = {}
        for it in items:
            if not (isinstance(it, (list, tuple)) and len(it) == 2):
                continue
            folder, uid = str(it[0]), int(it[1])
            if ikey(folder, uid) in INDEX:   # only messages we know about
                by_folder.setdefault(folder, set()).add(uid)
        if not by_folder:
            raise RuntimeError("no known messages selected")
        n = sum(len(s) for s in by_folder.values())
        _start_delete(by_folder, f"{n} selected mails", action, dest)
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


def _run_atts() -> None:
    """Annotate INDEX with attachment lists via BODYSTRUCTURE (read-only)."""
    cfg = cfgmod.load_config()
    t0 = time.time()
    try:
        with STATE_LOCK:
            folders = list(STATE["folders_raw"])
            per_folder = {f: sorted(
                m["uid"] for m in INDEX.values() if m["folder"] == f)
                for f in folders}
        conn = connect(cfg)
        try:
            for folder in folders:
                uids = per_folder.get(folder) or []
                if not uids:
                    continue
                status, _ = conn.select(quote_folder(folder), readonly=True)
                if status != "OK":
                    continue
                uv = uidvalidity(conn)
                if FOLDER_UV.get(folder) not in (None, 0) and uv \
                        and uv != FOLDER_UV[folder]:
                    log.warning("attachments: skipping %r (UIDVALIDITY "
                                "changed since scan)", folder)
                    continue
                total = len(uids)
                for start in range(0, total, FETCH_CHUNK):
                    if cancel_requested("atts"):
                        raise Cancelled()
                    with STATE_LOCK:
                        STATE["atts"]["progress"] = (
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
                        with STATE_LOCK:
                            m = INDEX.get(ikey(folder, uid))
                            if m is not None:
                                m["atts"] = atts
                                m["att_size"] = sum(a["size"] for a in atts)
        finally:
            try:
                conn.logout()
            except Exception:
                pass

        with STATE_LOCK:
            # Aggregate per group so the att:>… filter has data to work on.
            for recs in STATE["groups"].values():
                for rec in recs.values():
                    rec["att_size"] = sum(
                        (INDEX.get(ikey(f, u)) or {}).get("att_size", 0)
                        for f, uids in rec["folders"].items() for u in uids)
            n = sum(1 for m in INDEX.values() if m.get("att_size"))
            size = sum(m.get("att_size", 0) for m in INDEX.values())
            STATE["atts"] = {"status": "done", "progress": "", "error": "",
                             "mails": n, "size": size}
        log.info("attachment analysis done: %d mails with attachments, "
                 "%s total, %.1fs", n, size, time.time() - t0)
    except Cancelled:
        with STATE_LOCK:
            STATE["atts"].update(status="idle", progress="")
            STATE["notice"] = {"key": "atts_cancelled", "params": {}}
    except Exception as exc:
        log.exception("attachment analysis failed")
        with STATE_LOCK:
            STATE["atts"].update(status="error", progress="",
                                 error=f"{type(exc).__name__}: {exc}")


def start_att_scan() -> None:
    with STATE_LOCK:
        if STATE["status"] != "done":
            raise RuntimeError("scan first")
        if STATE["status"] == "scanning" \
                or STATE["atts"]["status"] == "running" \
                or STATE["delete"]["status"] == "running":
            raise RuntimeError("busy")
        STATE["atts"] = {"status": "running", "progress": "starting…",
                         "error": "", "mails": 0, "size": 0}
        _CANCEL["atts"] = False
    threading.Thread(target=_run_atts, daemon=True).start()


def attachments_list(limit: int = 300) -> list[dict]:
    """Mails with attachments, largest first."""
    with STATE_LOCK:
        out = [{"uid": m["uid"], "folder": m["folder"], "date": m["date"],
                "ts": m["ts"], "subject": m["subject"], "addr": m["addr"],
                "size": m["size"], "seen": m["seen"], "ai": None,
                "att_size": m["att_size"], "atts": m["atts"]}
               for m in INDEX.values() if m.get("att_size")]
    out.sort(key=lambda m: -m["att_size"])
    return out[:limit]


def index_stats() -> dict:
    """Live numbers from the scanned index: per-year histogram and the
    domains hogging the most space."""
    with STATE_LOCK:
        mails = list(INDEX.values())
    years: dict[str, dict] = {}
    domains: dict[str, dict] = {}
    total_size = 0
    for m in mails:
        total_size += m["size"]
        year = time.strftime("%Y", time.localtime(m["ts"])) if m["ts"] \
            else "unknown"
        y = years.setdefault(year, {"count": 0, "size": 0})
        y["count"] += 1
        y["size"] += m["size"]
        dom = m["addr"].rsplit("@", 1)[-1]
        d = domains.setdefault(dom, {"count": 0, "size": 0})
        d["count"] += 1
        d["size"] += m["size"]
    top = sorted(domains.items(), key=lambda kv: -kv[1]["size"])[:10]
    return {
        "mails": len(mails), "size": total_size,
        "years": [{"year": y, **v} for y, v in sorted(years.items())],
        "top_domains": [{"domain": k, **v} for k, v in top],
    }


# -------------------------------------------------------------- duplicates

def duplicates_list(limit: int = 200) -> list[dict]:
    """Duplicate sets from the scanned index: same Message-ID anywhere, or
    (for mails without a usable Message-ID match) the same exact
    (sender, subject, size) tuple. Newest mail first inside each set;
    'wasted' is what deleting all but the newest would free."""
    with STATE_LOCK:
        mails = list(INDEX.values())
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

def undo_last(index: int = -1) -> dict:
    """Restore a recorded move job (found by Message-ID in its target)."""
    with STATE_LOCK:
        if not UNDO_LOG:
            raise RuntimeError("nothing to undo")
        if not -len(UNDO_LOG) <= index < len(UNDO_LOG):
            raise RuntimeError("bad undo index")
        if STATE["delete"]["status"] == "running":
            raise RuntimeError("busy: an action is running")
        entry = UNDO_LOG.pop(index)
        STATE["undo"] = _undo_summaries()

    cfg = cfgmod.load_config()
    restored = 0
    conn = connect(cfg)
    try:
        trash = entry.get("in") or next(
            (f for f in list_folders(conn) if f.lower() == "trash"), None)
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
                status, _ = conn.uid("MOVE", b",".join(chunk).decode(),
                                     quote_folder(folder))
                if status == "OK":
                    restored += len(chunk)
    finally:
        try:
            conn.logout()
        except Exception:
            pass

    log.info("undo: restored %d/%d mails (%s)", restored, entry["count"],
             entry["label"])
    with STATE_LOCK:
        if STATE["trash_count"] is not None:
            STATE["trash_count"] = max(0, STATE["trash_count"] - restored)
        STATE["notice"] = {"key": "restored", "params": {
            "restored": restored, "of": entry["count"],
            "label": entry["label"]}}
    return {"restored": restored, "of": entry["count"]}


def empty_trash() -> dict:
    """Permanently delete everything in Trash."""
    with STATE_LOCK:
        if STATE["delete"]["status"] == "running":
            raise RuntimeError("busy: a deletion is running")
        UNDO_LOG.clear()
        STATE["undo"] = []

    cfg = cfgmod.load_config()
    conn = connect(cfg)
    try:
        trash = next((f for f in list_folders(conn)
                      if f.lower() == "trash"), None)
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
    with STATE_LOCK:
        STATE["trash_count"] = 0
        STATE["notice"] = {"key": "emptied_trash", "params": {"count": count}}
    return {"deleted": count}


def search_mails(query: str, limit: int = 500) -> list[dict]:
    """Substring search over the scanned index (subject + sender)."""
    q = query.strip().lower()
    if len(q) < 2:
        return []
    out = []
    with STATE_LOCK:
        for m in INDEX.values():
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
                with_msgid: bool = False) -> list[dict]:
    mail_verdicts = verdictstore.load_mails()
    with STATE_LOCK:
        rec = STATE["groups"][grouping].get(key)
        if not rec:
            return []
        out = []
        for folder, uids in rec["folders"].items():
            for uid in uids:
                m = INDEX.get(ikey(folder, uid))
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


def group_label(grouping: str, key: str) -> str:
    with STATE_LOCK:
        rec = STATE["groups"][grouping].get(key)
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


def fetch_message(folder: str, uid: int) -> dict:
    if ikey(folder, uid) not in INDEX:
        raise RuntimeError("unknown message")
    cfg = cfgmod.load_config()
    conn = connect(cfg)
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
