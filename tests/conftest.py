"""Shared fixtures: isolated config/stats paths, clean global state, and a
fake in-memory IMAP server that speaks imaplib's response format."""

from __future__ import annotations

import imaplib
import re
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import accounts as accountsmod   # noqa: E402
from backend import auditlog as auditlogmod   # noqa: E402
from backend import auth as authmod            # noqa: E402
from backend import autoscan as autoscanmod   # noqa: E402
from backend import config as cfgmod          # noqa: E402
from backend import digest as digestmod       # noqa: E402
from backend import knowledgestore            # noqa: E402
from backend import knownsenders              # noqa: E402
from backend import mailops                   # noqa: E402
from backend import pinstore                  # noqa: E402
from backend import presets as presetsmod     # noqa: E402
from backend import rules as rulesmod         # noqa: E402
from backend import stats as statsmod         # noqa: E402
from backend import tenants as tenantsmod     # noqa: E402
from backend import unsubstore                # noqa: E402
from backend import verdictstore              # noqa: E402
from backend import aisortstore               # noqa: E402


@pytest.fixture(autouse=True)
def isolate(tmp_path, monkeypatch):
    """Every test gets fresh config paths and empty per-account state
    (the accounts registry is cleared, so mailops' default-account aliases
    resolve to a brand-new AccountState)."""
    monkeypatch.setattr(cfgmod, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(cfgmod, "STATS_PATH", tmp_path / "stats.json")
    monkeypatch.setattr(cfgmod, "SERVER_PATH", tmp_path / "server.json")
    monkeypatch.setattr(tenantsmod, "TENANTS_DIR", tmp_path / "tenants")
    monkeypatch.setattr(verdictstore, "VERDICTS_PATH",
                        tmp_path / "verdicts.json")
    monkeypatch.setattr(aisortstore, "AI_SORT_PATH", tmp_path / "ai_sort.json")
    monkeypatch.setattr(knowledgestore, "KNOWLEDGE_PATH",
                        tmp_path / "sender_knowledge.json")
    monkeypatch.setattr(unsubstore, "UNSUB_STATE_PATH",
                        tmp_path / "unsub_state.json")
    monkeypatch.setattr(mailops, "REPLIED_PATH", tmp_path / "replied.json")
    monkeypatch.setattr(mailops, "SNAPSHOT_DIR", tmp_path / "snapshots")
    monkeypatch.setattr(authmod, "SESSION_SECRET_PATH",
                        tmp_path / "session_secret")
    monkeypatch.setattr(authmod, "_secret_cache", None)
    monkeypatch.setattr(rulesmod, "RULES_PATH", tmp_path / "rules.json")
    monkeypatch.setattr(presetsmod, "PRESETS_PATH", tmp_path / "presets.json")
    monkeypatch.setattr(statsmod, "HISTORY_PATH",
                        tmp_path / "stats_history.json")
    monkeypatch.setattr(auditlogmod, "AUDIT_PATH",
                        tmp_path / "audit_log.jsonl")
    monkeypatch.setattr(digestmod, "DIGEST_PATH", tmp_path / "digest.json")
    monkeypatch.setattr(autoscanmod, "AUTOSCAN_PATH",
                        tmp_path / "autoscan.json")
    monkeypatch.setattr(knownsenders, "KNOWN_SENDERS_PATH",
                        tmp_path / "known_senders.json")
    monkeypatch.setattr(pinstore, "PINS_PATH", tmp_path / "pinned_mails.json")
    verdictstore._mails_cache.clear()
    unsubstore._cache.clear()
    pinstore._cache.clear()
    mailops._SENT_CACHE.clear()
    accountsmod.reset()
    yield
    # Undo/restore kick off a background scan; let it land before the
    # monkeypatched paths (snapshot dir, ...) are restored under it.
    import time
    end = time.time() + 5
    while time.time() < end and any(
            a.state["status"] == "scanning"
            or a.state["index"]["status"] == "running"
            for a in accountsmod.all_instantiated()):
        time.sleep(0.01)
    verdictstore._mails_cache.clear()
    unsubstore._cache.clear()
    pinstore._cache.clear()
    accountsmod.reset()


def code_re(code: str, **params) -> str:
    """A `pytest.raises(match=...)` pattern for the coded refusal
    `mailops.coded(code, **params)` (the text of the folder features' errors
    is the code the UI translates, see mailops.coded)."""
    from backend import mailops
    return re.escape(mailops.coded(code, **params))


# The default mail date is "a few days old" relative to the run, computed
# once so every default mail shares one timestamp. A hardcoded date ages
# out of the product's windows (30-day retention cutoffs, the engagement
# recency fade) and turns the suite red on its own. Tests that need the
# month/year of these mails derive them from DEFAULT_MAIL_TS.
DEFAULT_MAIL_TS = int(time.time()) - 3 * 86400
DEFAULT_MAIL_DATE = time.strftime(
    "%d-%b-%Y %H:%M:%S +0000", time.gmtime(DEFAULT_MAIL_TS))


def make_msg(uid, frm='"Shop News" <news@shop.example>',
             subject="Big Sale 42", unsub=None, unsub_post=False,
             msgid=None, size=1000, seen=False,
             date=DEFAULT_MAIL_DATE, to=None, cc=None,
             atts=None, body=None, irt=None, refs=None):
    return {"uid": uid, "body": body, "irt": irt, "refs": refs, "from": frm, "subject": subject, "unsub": unsub,
            "unsub_post": unsub_post,
            "msgid": msgid or f"<m{uid}@shop.example>",
            "size": size, "seen": seen, "date": date, "to": to, "cc": cc,
            "atts": atts or []}     # [(filename, size)] for BODYSTRUCTURE


class FakeIMAP:
    """In-memory IMAP double producing imaplib-shaped responses.

    `flags` adds SPECIAL-USE flags per folder (e.g. {"Bin": "\\Trash"});
    `move=False` simulates a server without the MOVE capability (deletes
    must then go through COPY + \\Deleted + UID EXPUNGE); `uidplus=False`
    one without UIDPLUS (UID EXPUNGE is then a BAD command).
    `delimiter` is the hierarchy delimiter LIST announces (None = NIL);
    `list_order` names folders LIST returns first, in that order (the rest
    follow in mailbox order) - role detection must not depend on it.

    `renumber=True`: MOVE / COPY give the copies fresh UIDs above everything
    the destination ever held (a real server does; the default keeps the
    source UID). `copyuid=True` additionally answers them with the UIDPLUS
    COPYUID response code (read through `response("COPYUID")`).

    STORE applies the flags to exactly the given set and EXPUNGE removes
    only \\Deleted mail, like a real server.

    `gmail=True` gives Gmail label semantics: the server advertises
    X-GM-EXT-1 and answers X-GM-MSGID. A message under several labels is
    one dict per folder (own UID each) sharing the same `gmid` key (see
    `gmail_copy`); a MOVE into `trash` removes it from EVERY folder."""

    def __init__(self, mailbox: dict[str, list[dict]],
                 flags: dict[str, str] | None = None, move: bool = True,
                 uidplus: bool = True, gmail: bool = False,
                 trash: str = "[Gmail]/Trash", delimiter: str | None = "/",
                 list_order: list[str] | None = None,
                 renumber: bool = False, copyuid: bool = False):
        self.renumber = renumber
        self.copyuid = copyuid
        self._answers: dict[str, list[bytes]] = {}   # imaplib's response()
        self.delimiter = delimiter
        self.list_order = list_order or []
        self.mailbox = mailbox            # folder -> list of make_msg dicts
        self.flags = flags or {}
        self.move = move
        self.uidplus = uidplus
        self.gmail = gmail
        self.trash = trash
        self.capabilities = ("IMAP4REV1",) \
            + (("UIDPLUS",) if uidplus else ()) \
            + (("MOVE",) if move else ()) \
            + (("X-GM-EXT-1",) if gmail else ())
        self.gm_fetches: list[str] = []      # FETCH specs asking X-GM-MSGID
        self.uv = {f: 1 for f in mailbox}
        self._high: dict[str, int] = {}      # highest UID a folder ever held
        self.selected: str | None = None
        self.logged_out = False
        # imaplib's single-literal slot: UID SEARCH BODY sends its term here
        self.literal: bytes | None = None
        self.body_searches: list[tuple[tuple, str]] = []   # (args, term)
        self.body_fetches: list[tuple[str, list[int]]] = []   # (folder, uids)
        self.message_id_searches: list[tuple] = []
        self.reject_or = False               # server without nested OR
        self.reject_charset = False          # BAD on CHARSET, like old servers
        self.body_search_error: Exception | None = None   # e.g. TimeoutError

    # -- connection lifecycle -------------------------------------------
    def login(self, user, password):
        return "OK", [b"LOGIN done"]

    def authenticate(self, mechanism, authobject):
        self.authenticated_as = authobject(b"")
        return "OK", [b"AUTHENTICATE done"]

    def logout(self):
        self.logged_out = True
        return "BYE", [b""]

    def shutdown(self):
        pass

    # -- mailbox metadata -----------------------------------------------
    def list(self):
        out = []
        first = [f for f in self.list_order if f in self.mailbox]
        delim = f'"{self.delimiter}"' if self.delimiter else "NIL"
        for f in first + [f for f in self.mailbox if f not in first]:
            fl = "\\HasNoChildren"
            if f in self.flags:
                fl += f" {self.flags[f]}"
            out.append(f'({fl}) {delim} "{f}"'.encode())
        return "OK", out

    def select(self, qname, readonly=False):
        name = qname.strip('"')
        if name not in self.mailbox:
            return "NO", [b"no such folder"]
        self.selected = name
        return "OK", [str(len(self.mailbox[name])).encode()]

    def response(self, key):
        if key == "UIDVALIDITY" and self.selected:
            return key, [str(self.uv.get(self.selected, 1)).encode()]
        if key in self._answers:
            return key, self._answers.pop(key)
        return key, [None]

    def _land(self, moving: list[dict], dest: str) -> None:
        """Put `moving` into `dest` (fresh UIDs when `renumber`) and note the
        COPYUID answer."""
        moving = sorted(moving, key=lambda m: m["uid"])
        copies = [dict(m) for m in moving]
        if self.renumber:
            held = self.mailbox.setdefault(dest, [])
            top = max([self._high.get(dest, 0)] + [m["uid"] for m in held])
            for i, c in enumerate(copies, 1):
                c["uid"] = top + i
            self._high[dest] = top + len(copies)
        else:
            self.mailbox.setdefault(dest, [])
        self.mailbox[dest].extend(copies)
        if self.copyuid and moving:
            src = ",".join(str(m["uid"]) for m in moving)
            dst = ",".join(str(c["uid"]) for c in copies)
            self._answers["COPYUID"] = [
                f"{self.uv.get(dest, 1)} {src} {dst}".encode()]

    def status(self, qname, what):
        name = qname.strip('"')
        if name not in self.mailbox:
            return "NO", [b""]
        return "OK", [f'"{name}" (MESSAGES {len(self.mailbox[name])})'.encode()]

    # -- data ------------------------------------------------------------
    def _header_blob(self, m) -> bytes:
        lines = [f"From: {m['from']}", f"Subject: {m['subject']}",
                 f"Message-ID: {m['msgid']}"]
        if m.get("irt"):
            lines.append(f"In-Reply-To: {m['irt']}")
        if m.get("refs"):
            refs = m["refs"]
            lines.append("References: "
                         + (refs if isinstance(refs, str) else " ".join(refs)))
        if m.get("to"):
            lines.append(f"To: {m['to']}")
        if m.get("cc"):
            lines.append(f"Cc: {m['cc']}")
        if m["unsub"]:
            lines.append(f"List-Unsubscribe: {m['unsub']}")
        if m["unsub_post"]:
            lines.append("List-Unsubscribe-Post: List-Unsubscribe=One-Click")
        return ("\r\n".join(lines) + "\r\n\r\n").encode()

    def _bodystructure(self, m) -> str:
        text = '("text" "plain" ("charset" "utf-8") NIL NIL "7bit" 100 5)'
        if not m.get("atts"):
            return text
        parts = [text]
        for name, size in m["atts"]:
            parts.append(
                f'("application" "octet-stream" ("name" "{name}") NIL NIL '
                f'"base64" {size} NIL '
                f'("attachment" ("filename" "{name}")) NIL)')
        return "(" + "".join(parts) + ' "mixed" ("boundary" "b1") NIL NIL)'

    def _gm(self, m) -> str:
        """` X-GM-MSGID <n>` for a Gmail fake's message (empty otherwise)."""
        if not self.gmail or not m.get("gmid"):
            return ""
        return f" X-GM-MSGID {m['gmid']}"

    def uid(self, cmd, *args):
        msgs = self.mailbox[self.selected]
        if cmd == "SEARCH" and args[-1] == "BODY":
            term = (self.literal or b"").decode("utf-8", "replace")
            self.body_searches.append((args, term))
            if self.body_search_error:
                raise self.body_search_error
            has_charset = "CHARSET" in args
            if has_charset and self.reject_charset:
                raise imaplib.IMAP4.error("SEARCH BAD [BADCHARSET]")
            if not has_charset and not term.isascii():
                raise imaplib.IMAP4.error("SEARCH BAD 8-bit without CHARSET")
            hits = [m for m in msgs if term.casefold()
                    in (m.get("body") or "Hello mail body").casefold()]
            return "OK", [b" ".join(str(m["uid"]).encode() for m in hits)]

        if cmd == "SEARCH":
            if args[-1] == "ALL":
                hits = msgs
            elif "HEADER" in args:
                # `HEADER Message-ID <id>` (id as literal or quoted string),
                # also OR-chained: OR HEADER Message-ID a OR HEADER ... z
                if self.literal:
                    targets = {self.literal.decode("utf-8")}
                else:
                    targets = {args[i + 2].strip('"')
                               for i in range(len(args) - 2)
                               if args[i] == "HEADER"
                               and args[i + 1] == "Message-ID"}
                self.message_id_searches.append(args)
                if self.reject_or and "OR" in args:
                    raise imaplib.IMAP4.error("SEARCH BAD OR not supported")
                hits = [m for m in msgs if m["msgid"] in targets]
            else:
                raise AssertionError(f"unexpected SEARCH {args!r}")
            return "OK", [b" ".join(str(m["uid"]).encode() for m in hits)]

        if cmd == "FETCH":
            wanted = {int(u) for u in args[0].split(",")}
            if "BODYSTRUCTURE" in args[1]:
                data = []
                for i, m in enumerate(msgs):
                    if m["uid"] in wanted:
                        data.append(f"{i+1} (UID {m['uid']} BODYSTRUCTURE "
                                    f"{self._bodystructure(m)})".encode())
                return "OK", data
            if "BODY.PEEK[]" in args[1]:
                # Also the index builder's partial form BODY.PEEK[]<0.N>
                # for several UIDs at once.
                self.body_fetches.append((self.selected, sorted(wanted)))
                data = []
                for i, m in enumerate(msgs):
                    if m["uid"] in wanted:
                        body = self._header_blob(m) + (
                            (m.get("body") or "Hello mail body") + "\r\n"
                        ).encode()
                        data += [(f"{i+1} (UID {m['uid']} BODY[] "
                                  f"{{{len(body)}}}".encode(), body), b")"]
                return "OK", data or [None]
            if "X-GM-MSGID" in args[1]:
                self.gm_fetches.append(args[1])
            if args[1] in ("(UID FLAGS)", "(UID FLAGS X-GM-MSGID)"):
                # No literal attached (flags-only) - imaplib hands back a
                # plain bytes line per message, not a (meta, literal) tuple.
                data = []
                for i, m in enumerate(msgs):
                    if m["uid"] not in wanted:
                        continue
                    flags = "\\Seen" if m["seen"] else ""
                    data.append(f"{i+1} (UID {m['uid']}"
                                f"{self._gm(m) if 'GM' in args[1] else ''} "
                                f"FLAGS ({flags}))".encode())
                return "OK", data
            data = []
            for i, m in enumerate(msgs):
                if m["uid"] not in wanted:
                    continue
                hdr = self._header_blob(m)
                flags = "\\Seen" if m["seen"] else ""
                gm = self._gm(m) if "X-GM-MSGID" in args[1] else ""
                meta = (f"{i+1} (UID {m['uid']}{gm} FLAGS ({flags}) "
                        f"RFC822.SIZE {m['size']} "
                        f"INTERNALDATE \"{m['date']}\" "
                        f"BODY[HEADER.FIELDS (FROM SUBJECT MESSAGE-ID "
                        f"LIST-UNSUBSCRIBE LIST-UNSUBSCRIBE-POST)] "
                        f"{{{len(hdr)}}}").encode()
                data.append((meta, hdr))
                data.append(b")")
            return "OK", data

        if cmd == "STORE":
            self._store(msgs, self._uid_set(msgs, args[0]), args[1], args[2])
            return "OK", [b""]

        if cmd == "MOVE":
            assert self.move, "server does not advertise MOVE"
            wanted = {int(u) for u in args[0].split(",")}
            dest = args[1].strip('"')
            moving = [m for m in msgs if m["uid"] in wanted]
            self.mailbox[self.selected] = [m for m in msgs
                                           if m["uid"] not in wanted]
            self._land(moving, dest)
            if self.gmail and dest == self.trash:
                # trashing a Gmail message drops it from every label
                gone = {m["gmid"] for m in moving if m.get("gmid")}
                for f in self.mailbox:
                    if f != dest:
                        self.mailbox[f] = [m for m in self.mailbox[f]
                                           if m.get("gmid") not in gone]
            return "OK", [b""]

        if cmd == "COPY":
            wanted = {int(u) for u in args[0].split(",")}
            dest = args[1].strip('"')
            self._land([m for m in msgs if m["uid"] in wanted], dest)
            return "OK", [b""]

        if cmd == "EXPUNGE":     # UIDPLUS: expunge only the given UIDs
            if not self.uidplus:
                raise imaplib.IMAP4.error("UID EXPUNGE BAD (no UIDPLUS)")
            wanted = self._uid_set(msgs, args[0])
            self.mailbox[self.selected] = [
                m for m in msgs
                if not (m["uid"] in wanted and m.get("deleted"))]
            return "OK", [b""]

        raise AssertionError(f"unexpected UID {cmd}")

    @staticmethod
    def _span(text: str, top: int) -> set[int]:
        """Resolve an IMAP set ("1,3:5", "1:*"); `top` is what `*` means."""
        out: set[int] = set()
        for part in str(text).split(","):
            lo, _, hi = part.partition(":")
            lo_n = top if lo == "*" else int(lo)
            hi_n = (top if hi == "*" else int(hi)) if hi else lo_n
            lo_n, hi_n = min(lo_n, hi_n), max(lo_n, hi_n)
            out |= set(range(lo_n, hi_n + 1))
        return out

    def _uid_set(self, msgs, text) -> set[int]:
        return self._span(text, max((m["uid"] for m in msgs),
                                          default=0))

    @staticmethod
    def _store(msgs, wanted: set[int], op: str, flags: str) -> None:
        names = {f.lstrip("\\").lower()
                 for f in flags.strip("()").split() if f}
        for m in msgs:
            if m["uid"] not in wanted:
                continue
            for key in ("seen", "deleted"):
                if key in names:
                    m[key] = not op.startswith("-")
            if op.upper() == "FLAGS":        # replace: unnamed flags clear
                for key in ("seen", "deleted"):
                    m[key] = key in names

    def store(self, span, op, flags):
        """Sequence-number STORE (`1:*` = every message in the folder)."""
        msgs = self.mailbox[self.selected]
        seqs = self._span(span, len(msgs))
        self._store(msgs, {m["uid"] for i, m in enumerate(msgs, 1)
                           if i in seqs}, op, flags)
        return "OK", [b""]

    def expunge(self):
        self.mailbox[self.selected] = [
            m for m in self.mailbox[self.selected] if not m.get("deleted")]
        return "OK", [b""]


def gmail_copy(m: dict, uid: int, gmid: str = "1001") -> dict:
    """The same Gmail message seen in another label folder: own UID, same
    X-GM-MSGID. (Use gmail_copy on every copy, the first one included.)"""
    return {**m, "uid": uid, "gmid": gmid}


@pytest.fixture
def bridge(monkeypatch):
    """A fake mailbox wired into mailops.connect; returns the FakeIMAP."""
    fake = FakeIMAP({
        "INBOX": [
            make_msg(1, frm='"DHL Paket" <noreply@dhl.example>',
                     subject="Ihre Sendung 123 kommt heute",
                     unsub="<https://dhl.example/unsub?u=1>", size=5000),
            make_msg(2, frm='"DHL Paket" <noreply@dhl.example>',
                     subject="Ihre Sendung 456 kommt heute", size=4000,
                     seen=True),
            make_msg(3, frm="Alice <alice@friends.example>",
                     subject="Re: Dinner on Friday?", size=2000, seen=True),
            make_msg(4, frm='"Newsletter" <news@shop.example>',
                     subject="SALE! 50% off everything",
                     unsub="<mailto:unsub@shop.example?subject=stop>, "
                           "<https://shop.example/u/1>",
                     unsub_post=True, size=30000,
                     atts=[("catalog.pdf", 25000), ("promo.jpg", 3000)]),
        ],
        "Archive": [
            make_msg(10, frm='"DHL Paket" <noreply@dhl.example>',
                     subject="Ihre Sendung 789 wurde zugestellt",
                     size=6000, seen=True,
                     date="01-Jan-2025 09:00:00 +0000"),
        ],
        # Sent is excluded from cleanup views but feeds the "never replied"
        # signal (To/Cc addresses -> REPLIED_TO).
        "Sent": [
            make_msg(20, frm="Me <me@self.example>",
                     subject="Re: Dinner on Friday?",
                     to="Alice <alice@friends.example>",
                     cc="bob@corp.example", seen=True),
        ],
        "Trash": [],
        "Spam": [],
    })
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    return fake


def wait_scan_done(timeout=5.0):
    """A `start_scan()`-dispatched scan runs in a worker thread; wait for
    it to leave "scanning"."""
    import time
    end = time.time() + timeout
    while time.time() < end:
        with mailops.STATE_LOCK:
            if mailops.STATE["status"] != "scanning":
                return mailops.STATE
        time.sleep(0.01)
    return mailops.STATE


def wait_delete_done(timeout=5.0):
    """Delete jobs run in a worker thread; wait for the queue to drain."""
    return _wait_job("delete", timeout)


def wait_unsub_done(timeout=5.0):
    """Bulk unsubscribe runs in a worker thread; wait for it to finish."""
    return _wait_job("unsub", timeout)


def _wait_job(key: str, timeout: float):
    import time
    end = time.time() + timeout
    while time.time() < end:
        with mailops.STATE_LOCK:
            if mailops.STATE[key]["status"] != "running":
                return mailops.STATE[key]
        time.sleep(0.02)
    raise TimeoutError(f"{key} worker did not finish")
