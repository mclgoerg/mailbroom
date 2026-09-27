"""Shared fixtures: isolated config/stats paths, clean global state, and a
fake in-memory IMAP server that speaks imaplib's response format."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend import config as cfgmod          # noqa: E402
from backend import mailops                   # noqa: E402
from backend import verdictstore              # noqa: E402


@pytest.fixture(autouse=True)
def isolate(tmp_path, monkeypatch):
    """Every test gets fresh config paths and empty global state."""
    monkeypatch.setattr(cfgmod, "CONFIG_PATH", tmp_path / "config.json")
    monkeypatch.setattr(cfgmod, "STATS_PATH", tmp_path / "stats.json")
    monkeypatch.setattr(verdictstore, "VERDICTS_PATH",
                        tmp_path / "verdicts.json")
    monkeypatch.setattr(mailops, "REPLIED_PATH", tmp_path / "replied.json")
    monkeypatch.setattr(mailops, "_replied_loaded", False)
    mailops.REPLIED_TO.clear()
    verdictstore._mails_cache = None
    with mailops.STATE_LOCK:
        mailops.STATE.update(
            status="idle", progress="", error="", folders=[],
            trash_count=None, notice=None, undo=[])
        mailops.STATE["groups"] = {g: {} for g in mailops.GROUPINGS}
        mailops.STATE["ai"] = {"status": "idle", "grouping": "",
                               "progress": "", "error": "", "usage": None}
        mailops.STATE["delete"] = {"status": "idle", "progress": "",
                                   "error": "", "moved": 0}
        mailops.STATE["folders_raw"] = []
        mailops.INDEX.clear()
        mailops.FOLDER_UV.clear()
        mailops.UNDO_LOG.clear()
        mailops._DELETE_PENDING.clear()
        for k in mailops._CANCEL:
            mailops._CANCEL[k] = False
    yield


def make_msg(uid, frm='"Shop News" <news@shop.example>',
             subject="Big Sale 42", unsub=None, unsub_post=False,
             msgid=None, size=1000, seen=False,
             date="26-Sep-2026 12:00:00 +0000", to=None, cc=None):
    return {"uid": uid, "from": frm, "subject": subject, "unsub": unsub,
            "unsub_post": unsub_post,
            "msgid": msgid or f"<m{uid}@shop.example>",
            "size": size, "seen": seen, "date": date, "to": to, "cc": cc}


class FakeIMAP:
    """In-memory IMAP double producing imaplib-shaped responses."""

    def __init__(self, mailbox: dict[str, list[dict]]):
        self.mailbox = mailbox            # folder -> list of make_msg dicts
        self.uv = {f: 1 for f in mailbox}
        self.selected: str | None = None
        self.logged_out = False

    # -- connection lifecycle -------------------------------------------
    def login(self, user, password):
        return "OK", [b"LOGIN done"]

    def logout(self):
        self.logged_out = True
        return "BYE", [b""]

    def shutdown(self):
        pass

    # -- mailbox metadata -----------------------------------------------
    def list(self):
        return "OK", [f'(\\HasNoChildren) "/" "{f}"'.encode()
                      for f in list(self.mailbox)]

    def select(self, qname, readonly=False):
        name = qname.strip('"')
        if name not in self.mailbox:
            return "NO", [b"no such folder"]
        self.selected = name
        return "OK", [str(len(self.mailbox[name])).encode()]

    def response(self, key):
        if key == "UIDVALIDITY" and self.selected:
            return key, [str(self.uv[self.selected]).encode()]
        return key, [None]

    def status(self, qname, what):
        name = qname.strip('"')
        if name not in self.mailbox:
            return "NO", [b""]
        return "OK", [f'"{name}" (MESSAGES {len(self.mailbox[name])})'.encode()]

    # -- data ------------------------------------------------------------
    def _header_blob(self, m) -> bytes:
        lines = [f"From: {m['from']}", f"Subject: {m['subject']}",
                 f"Message-ID: {m['msgid']}"]
        if m.get("to"):
            lines.append(f"To: {m['to']}")
        if m.get("cc"):
            lines.append(f"Cc: {m['cc']}")
        if m["unsub"]:
            lines.append(f"List-Unsubscribe: {m['unsub']}")
        if m["unsub_post"]:
            lines.append("List-Unsubscribe-Post: List-Unsubscribe=One-Click")
        return ("\r\n".join(lines) + "\r\n\r\n").encode()

    def uid(self, cmd, *args):
        msgs = self.mailbox[self.selected]
        if cmd == "SEARCH":
            if args[-1] == "ALL":
                hits = msgs
            elif "HEADER" in args:
                target = args[-1].strip('"')
                hits = [m for m in msgs if m["msgid"] == target]
            else:
                raise AssertionError(f"unexpected SEARCH {args!r}")
            return "OK", [b" ".join(str(m["uid"]).encode() for m in hits)]

        if cmd == "FETCH":
            wanted = {int(u) for u in args[0].split(",")}
            if "BODY.PEEK[]" in args[1]:
                for i, m in enumerate(msgs):
                    if m["uid"] in wanted:
                        body = self._header_blob(m) + b"Hello mail body\r\n"
                        return "OK", [(f"{i+1} (UID {m['uid']} BODY[] "
                                       f"{{{len(body)}}}".encode(), body), b")"]
                return "OK", [None]
            data = []
            for i, m in enumerate(msgs):
                if m["uid"] not in wanted:
                    continue
                hdr = self._header_blob(m)
                flags = "\\Seen" if m["seen"] else ""
                meta = (f"{i+1} (UID {m['uid']} FLAGS ({flags}) "
                        f"RFC822.SIZE {m['size']} "
                        f"INTERNALDATE \"{m['date']}\" "
                        f"BODY[HEADER.FIELDS (FROM SUBJECT MESSAGE-ID "
                        f"LIST-UNSUBSCRIBE LIST-UNSUBSCRIBE-POST)] "
                        f"{{{len(hdr)}}}").encode()
                data.append((meta, hdr))
                data.append(b")")
            return "OK", data

        if cmd == "STORE":
            wanted = {int(u) for u in args[0].split(",")}
            if "Seen" in args[2]:
                for m in msgs:
                    if m["uid"] in wanted:
                        m["seen"] = True
            return "OK", [b""]

        if cmd == "MOVE":
            wanted = {int(u) for u in args[0].split(",")}
            dest = args[1].strip('"')
            moving = [m for m in msgs if m["uid"] in wanted]
            self.mailbox[self.selected] = [m for m in msgs
                                           if m["uid"] not in wanted]
            self.mailbox.setdefault(dest, []).extend(moving)
            return "OK", [b""]

        raise AssertionError(f"unexpected UID {cmd}")

    def store(self, span, op, flags):
        return "OK", [b""]

    def expunge(self):
        self.mailbox[self.selected] = []
        return "OK", [b""]


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
                     unsub_post=True, size=30000),
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
    monkeypatch.setattr(mailops, "connect", lambda cfg: fake)
    return fake


def wait_delete_done(timeout=5.0):
    """Delete jobs run in a worker thread; wait for the queue to drain."""
    import time
    end = time.time() + timeout
    while time.time() < end:
        with mailops.STATE_LOCK:
            if mailops.STATE["delete"]["status"] != "running":
                return mailops.STATE["delete"]
        time.sleep(0.02)
    raise TimeoutError("delete worker did not finish")
