"""Opt-in LOCAL mail-text search: a keyed word index.

Server-side body search (mailops.search_body) asks the IMAP server on every
query and can be slow on remote providers. This module is the alternative:
one pass over the mails builds a small local index, after which a search is
instant and works for any provider.

What is stored (per account, SQLite, next to the scan snapshots):
  * NO readable mail text. For every mail only keyed hashes of its distinct
    words: HMAC-SHA256(key, word) cut to 64 bits, where the key derives from
    MAILBROOM_SECRET_KEY (plus a random per-index salt). Without that key a
    leaked volume backup shows document handles and opaque numbers only.
  * Document handles (folder, uid, UIDVALIDITY) - the same handles the scan
    snapshot already holds.
The index therefore requires MAILBROOM_SECRET_KEY, and an index built under
another key is unusable (it reports as such and must be rebuilt).

Consequence of hashing: a search matches WHOLE WORDS (case- and accent-
insensitive, several words are ANDed) - no substring, prefix or phrase
matching. Per mail at most TEXT_CAP characters of text are considered.

Built by an explicit, cancellable job (Settings -> "Build index"), then kept
current by every scan (new mails added, vanished ones dropped). Turning the
mode off, or deleting the account, removes the file.
"""

from __future__ import annotations

import email
import hashlib
import hmac
import logging
import os
import re
import sqlite3
import threading
import time
import unicodedata
from pathlib import Path

from . import accounts
from . import secretbox
from . import tenants

log = logging.getLogger("pmc.bodyindex")

SCHEMA_VERSION = 1
TEXT_CAP = 20_000            # characters of a mail's text that are indexed
FETCH_BYTES = 262_144        # leading bytes fetched per mail (text parts come first)
FETCH_BATCH = 20             # mails per FETCH
MAX_WORDS = 2000             # distinct words kept per mail
_WORD_RE = re.compile(r"[^\W_]{2,40}")

# Why an index cannot be used (reported to the UI as translatable notes).
MISSING = "index_missing"
KEY_CHANGED = "index_key"


# ------------------------------------------------------------------ words

def words(text: str) -> set[str]:
    """Distinct normalized words of `text`: casefolded, accents stripped
    (ß -> ss, é -> e), 2-40 letters/digits."""
    folded = unicodedata.normalize("NFKD", (text or "").casefold())
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    out: set[str] = set()
    for w in _WORD_RE.findall(folded):
        out.add(w)
        if len(out) >= MAX_WORDS:
            break
    return out


def _hash_word(key: bytes, word: str) -> int:
    d = hmac.new(key, word.encode("utf-8"), hashlib.sha256).digest()
    return int.from_bytes(d[:8], "big", signed=True)


# ---------------------------------------------------------------- storage

def _dir() -> Path:
    from . import mailops
    return tenants.current().dir(mailops.SNAPSHOT_DIR)


def _path(name: str, tenant=None) -> Path:
    from . import mailops
    slug = re.sub(r"[^A-Za-z0-9._-]", "_", name)[:40]
    h = hashlib.sha1(name.encode()).hexdigest()[:8]
    return (tenant or tenants.current()).dir(mailops.SNAPSHOT_DIR) \
        / f"bodyindex_{slug}_{h}.db"


class Index:
    """One open index file plus its derived key."""

    def __init__(self, conn: sqlite3.Connection, key: bytes):
        self.conn = conn
        self.key = key

    def close(self) -> None:
        self.conn.close()

    def meta(self, k: str) -> str | None:
        row = self.conn.execute("SELECT v FROM meta WHERE k=?",
                                (k,)).fetchone()
        return row[0] if row else None

    def set_meta(self, k: str, v: str) -> None:
        self.conn.execute("INSERT INTO meta(k, v) VALUES(?, ?) "
                          "ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, v))

    def doc_count(self) -> int:
        return self.conn.execute("SELECT COUNT(*) FROM docs").fetchone()[0]

    def known(self) -> dict[tuple[str, int, int], int]:
        return {(f, u, uv): i for i, f, u, uv in self.conn.execute(
            "SELECT id, folder, uid, uv FROM docs")}

    def add(self, folder: str, uid: int, uv: int, ws: set[str]) -> None:
        cur = self.conn.execute(
            "INSERT OR IGNORE INTO docs(folder, uid, uv) VALUES(?,?,?)",
            (folder, uid, uv))
        if not cur.rowcount:
            return
        doc = cur.lastrowid
        self.conn.executemany(
            "INSERT OR IGNORE INTO words(h, d) VALUES(?, ?)",
            [(_hash_word(self.key, w), doc) for w in ws])

    def remove(self, doc_ids: list[int]) -> None:
        for start in range(0, len(doc_ids), 500):
            chunk = doc_ids[start:start + 500]
            marks = ",".join("?" * len(chunk))
            self.conn.execute(f"DELETE FROM words WHERE d IN ({marks})", chunk)
            self.conn.execute(f"DELETE FROM docs WHERE id IN ({marks})", chunk)

    def query(self, terms: list[str]) -> set[tuple[str, int, int]]:
        """Handles of the mails that contain EVERY word of `terms`."""
        hashes = sorted({_hash_word(self.key, w) for w in terms})
        if not hashes:
            return set()
        sql = " INTERSECT ".join("SELECT d FROM words WHERE h=?"
                                 for _ in hashes)
        return {(f, u, uv) for f, u, uv in self.conn.execute(
            f"SELECT folder, uid, uv FROM docs WHERE id IN ({sql})", hashes)}


def _derive(salt: bytes) -> bytes | None:
    secret = secretbox.derive_key("bodyindex")
    return None if secret is None else hmac.new(
        secret, salt, hashlib.sha256).digest()


def _init(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS docs(
            id INTEGER PRIMARY KEY, folder TEXT NOT NULL,
            uid INTEGER NOT NULL, uv INTEGER NOT NULL,
            UNIQUE(folder, uid, uv));
        CREATE TABLE IF NOT EXISTS words(
            h INTEGER NOT NULL, d INTEGER NOT NULL,
            PRIMARY KEY(h, d)) WITHOUT ROWID;
        CREATE INDEX IF NOT EXISTS words_d ON words(d);
    """)


def open_index(name: str, tenant=None, create: bool = False
               ) -> tuple[Index | None, str | None]:
    """(index, None) or (None, reason): MISSING when there is no usable
    file, KEY_CHANGED when it was built under another MAILBROOM_SECRET_KEY
    (or the key is gone)."""
    path = _path(name, tenant)
    if not path.exists() and not create:
        return None, MISSING
    if not secretbox.enabled():
        return None, KEY_CHANGED
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=30, check_same_thread=False)
    try:
        path.chmod(0o600)
        _init(conn)
        idx = Index(conn, b"")
        salt_hex = idx.meta("salt")
        if salt_hex is None:
            salt = os.urandom(16)
            key = _derive(salt)
            idx = Index(conn, key)
            idx.set_meta("version", str(SCHEMA_VERSION))
            idx.set_meta("salt", salt.hex())
            idx.set_meta("key_check", hmac.new(
                key, b"check", hashlib.sha256).hexdigest())
            conn.commit()
            return idx, None
        key = _derive(bytes.fromhex(salt_hex))
        idx = Index(conn, key)
        check = hmac.new(key, b"check", hashlib.sha256).hexdigest()
        if idx.meta("version") != str(SCHEMA_VERSION):
            conn.close()
            return None, MISSING
        if not hmac.compare_digest(idx.meta("key_check") or "", check):
            conn.close()
            return None, KEY_CHANGED
        return idx, None
    except Exception:
        conn.close()
        raise


def drop(name: str, tenant=None) -> None:
    for suffix in ("", "-wal", "-shm", "-journal"):
        try:
            Path(str(_path(name, tenant)) + suffix).unlink()
        except FileNotFoundError:
            pass
        except OSError:
            log.exception("could not remove the body index of %r", name)


def rename(old: str, new: str) -> None:
    try:
        src, dst = _path(old), _path(new)
        if src.exists():
            src.replace(dst)
    except OSError:
        log.exception("could not rename the body index")


def info(acc) -> dict:
    """Persisted facts for the Settings panel."""
    idx, reason = open_index(acc.name, acc.tenant)
    out = {"exists": _path(acc.name, acc.tenant).exists(), "usable": False,
           "reason": reason, "docs": 0, "built_ts": None, "bytes": 0}
    try:
        out["bytes"] = _path(acc.name, acc.tenant).stat().st_size
    except OSError:
        pass
    if idx is not None:
        try:
            out.update(usable=True, reason=None, docs=idx.doc_count(),
                       built_ts=int(idx.meta("built_ts") or 0) or None)
        finally:
            idx.close()
    return out


# ------------------------------------------------------------ build / sync

class _Cancelled(Exception):
    pass


def _set(acc, **kw) -> None:
    with acc.lock:
        acc.state["index"].update(kw)


def _job_busy(acc) -> bool:
    s = acc.state
    return (s["status"] == "scanning" or s["ai"]["status"] == "running"
            or s["delete"]["status"] == "running"
            or s["atts"]["status"] == "running"
            or s["unsub"]["status"] == "running"
            or s["index"]["status"] == "running")


def start_build(acc, rebuild: bool = False) -> None:
    """Index every scanned mail in a background job (cancellable; an index
    that is already there is only topped up unless `rebuild`)."""
    from . import mailops
    if not secretbox.enabled():
        raise ValueError("the local index needs MAILBROOM_SECRET_KEY")
    with acc.lock:
        if acc.state["status"] != "done":
            raise RuntimeError("No completed scan")
        if _job_busy(acc):
            raise RuntimeError("busy")
        acc.state["index"].update(status="running", progress="connecting…",
                                  error="", done=0, total=0)
        acc.cancel["index"] = False
    threading.Thread(target=tenants.call_in,
                     args=(acc.tenant, _run_job, acc, rebuild),
                     daemon=True).start()


def _run_job(acc, rebuild: bool) -> None:
    try:
        sync(acc, rebuild=rebuild)
        _set(acc, status="done", progress="")
    except _Cancelled:
        _set(acc, status="idle", progress="")
        with acc.lock:
            acc.state["notice"] = {"key": "index_cancelled", "params": {}}
    except Exception as exc:
        log.exception("[%s] body index job failed", acc.name)
        _set(acc, status="error", progress="",
             error=f"{type(exc).__name__}: {exc}")


def sync_after_scan(acc) -> None:
    """Called at the end of every scan: top up an index that was built
    before (never starts a first build, never fails the scan)."""
    from . import config as cfgmod
    try:
        if cfgmod.account_imap(acc.name).get("body_search") != "local":
            return
        idx, _ = open_index(acc.name, acc.tenant)
        if idx is None:
            return
        built = idx.meta("built_ts")
        idx.close()
        if not built:
            return                      # an unfinished first build stays so
        with acc.lock:
            if acc.state["index"]["status"] == "running":
                return
            acc.state["index"].update(status="running", progress="",
                                      error="", done=0, total=0)
            acc.cancel["index"] = False
        try:
            sync(acc)
            _set(acc, status="done", progress="")
        except _Cancelled:
            _set(acc, status="idle", progress="")
    except Exception as exc:
        log.exception("[%s] body index update failed", acc.name)
        _set(acc, status="error", progress="",
             error=f"{type(exc).__name__}: {exc}")


def sync(acc, rebuild: bool = False) -> None:
    """Make the index match acc.index: fetch + index mails it lacks, drop
    those that are gone. Commits per batch, so a cancel keeps the work."""
    from . import mailops
    if rebuild:
        drop(acc.name, acc.tenant)
    idx, reason = open_index(acc.name, acc.tenant, create=True)
    if idx is None:
        if reason == KEY_CHANGED:           # built under another key
            drop(acc.name, acc.tenant)
            idx, reason = open_index(acc.name, acc.tenant, create=True)
        if idx is None:
            raise RuntimeError(f"cannot open the index ({reason})")
    try:
        with acc.lock:
            current = [(m["folder"], m["uid"],
                        acc.folder_uv.get(m["folder"], 0))
                       for m in acc.index.values()]
        have = idx.known()
        wanted = set(current)
        stale = [i for k, i in have.items() if k not in wanted]
        if stale:
            idx.remove(stale)
            idx.conn.commit()
        todo: dict[tuple[str, int], list[int]] = {}
        for folder, uid, uv in current:
            if (folder, uid, uv) not in have and uv:
                todo.setdefault((folder, uv), []).append(uid)
        total = sum(len(v) for v in todo.values())
        _set(acc, total=total, done=0,
             progress=f"0/{total}" if total else "")
        done = 0
        if todo:
            from . import config as cfgmod
            conn = mailops.connect(cfgmod.account_imap(acc.name), acc.name)
            try:
                for (folder, uv), uids in todo.items():
                    done = _index_folder(acc, idx, conn, folder, uv,
                                         sorted(uids), done, total)
            finally:
                try:
                    conn.logout()
                except Exception:
                    pass
        idx.set_meta("built_ts", str(int(time.time())))
        idx.conn.commit()
        log.info("[%s] body index: %d mails indexed, %d dropped", acc.name,
                 done, len(stale))
    finally:
        idx.close()


def _index_folder(acc, idx: Index, conn, folder: str, uv: int,
                  uids: list[int], done: int, total: int) -> int:
    from . import mailops
    status, _ = conn.select(mailops.quote_folder(folder), readonly=True)
    if status != "OK" or mailops.uidvalidity(conn) != uv:
        return done + len(uids)           # folder changed since the scan
    for start in range(0, len(uids), FETCH_BATCH):
        if mailops.cancel_requested("index", acc):
            idx.conn.commit()
            raise _Cancelled()
        chunk = uids[start:start + FETCH_BATCH]
        status, data = conn.uid(
            "FETCH", ",".join(str(u) for u in chunk),
            f"(UID BODY.PEEK[]<0.{FETCH_BYTES}>)")
        seen: set[int] = set()
        for item in (data or []) if status == "OK" else []:
            if not isinstance(item, tuple) or len(item) < 2:
                continue
            m = mailops._UID_RE.search(item[0])
            if not m:
                continue
            uid = int(m.group(1))
            seen.add(uid)
            try:
                text = mailops.extract_text(
                    email.message_from_bytes(item[1]))[:TEXT_CAP]
            except Exception:
                text = ""                 # unparseable: indexed as empty
            idx.add(folder, uid, uv, words(text))
        idx.conn.commit()
        done += len(chunk)
        _set(acc, done=done, progress=f"{done}/{total}")
    return done
