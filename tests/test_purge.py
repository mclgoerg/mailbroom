"""Permanent deletion of Trash / Junk mails (P6): the irreversible path.

Every guard has its own test: exact UIDs only (a mail that arrives after the
count survives, a foreign \\Deleted mail is not expunged), UIDVALIDITY
(mismatch and unreadable), never `1:*` / a plain EXPUNGE for a partial purge
(no UIDPLUS -> refuse), protected senders and pinned mail skipped (no
override), ambiguous / missing Trash or Junk refused before any destructive
command, chunking with partial-failure booking, audit / undo / stats /
digest / role index, Junk via Trash with and without COPYUID (and stopping
after the reversible MOVE when the copies cannot be identified), account
scoping, busy handling and inertness."""

import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import auditlog
from backend import config as cfgmod
from backend import digest as digestmod
from backend import mailops
from backend import pinstore
from backend import stats as statsmod
from backend.main import app
from conftest import FakeIMAP, make_msg

client = TestClient(app)

OLD = "05-Jan-2020 10:00:00 +0000"


def _recent() -> str:
    return time.strftime("%d-%b-%Y %H:%M:%S +0000",
                         time.gmtime(time.time() - 3600))


def _mails(uids, who="s{n}@gone.example", **kw):
    return [make_msg(u, frm=who.format(n=u), subject=f"Subject {u}",
                     size=100 + u, **kw) for u in uids]


class Spy:
    """Records every IMAP command that could change a mailbox."""

    def __init__(self, fake):
        self.calls: list[tuple] = []
        for name in ("uid", "store", "expunge"):
            orig = getattr(fake, name)
            setattr(fake, name, self._wrap(name, orig))

    def _wrap(self, name, orig):
        def f(*a):
            self.calls.append((name,) + a)
            return orig(*a)
        return f

    def destructive(self):
        return [c for c in self.calls
                if c[0] in ("store", "expunge")
                or (c[0] == "uid" and c[1] in ("STORE", "EXPUNGE", "MOVE",
                                               "COPY"))]


def _env(monkeypatch, junk=(), trash=(), **kw):
    """Fake server with INBOX, Spam (junk), Trash; role folders by name."""
    fake = FakeIMAP({"INBOX": [make_msg(1), make_msg(2, msgid="<k@a.example>")],
                     "Spam": list(junk), "Trash": list(trash), "Sent": []},
                    **kw)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    return fake


def _uids(fake, folder):
    return sorted(m["uid"] for m in fake.mailbox[folder])


def _count(role, **crit):
    return mailops.purge_preview(role, **crit)


_W = {"trash": {"folder": "Trash", "trash_folder": None},
      "junk": {"folder": "Spam", "trash_folder": "Trash"}}


def _at(c):
    """Where the count was read (what the confirm sends back)."""
    return {"folder": c["folder"], "trash_folder": c["trash_folder"]}


def _purge(role, **crit):
    """Count live, then purge exactly what the count said - the UI's flow."""
    c = _count(role, **crit)
    return mailops.purge_mails(role, c["uids"], c["uv"], **_at(c)), c


def _entries(action=None):
    es = auditlog.load("default", 0, 200)["entries"]
    return [e for e in es if action is None or e["action"] == action]


# ======================================================= Trash: exact UIDs

def test_mail_arriving_after_the_count_survives(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4, 5]))
    c = _count("trash", everything=True)
    assert c["uids"] == [3, 4, 5] and c["count"] == 3
    fake.mailbox["Trash"].append(make_msg(6, subject="Arrived later"))
    res = mailops.purge_mails("trash", c["uids"], c["uv"], **_at(c))
    assert res["deleted"] == 3
    assert _uids(fake, "Trash") == [6]
    assert mailops.STATE["trash_count"] == 1


def test_only_the_requested_uids_go_even_if_more_are_listed(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4, 5]))
    c = _count("trash", uids=[4])
    assert mailops.purge_mails("trash", c["uids"], c["uv"], **_at(c))["deleted"] == 1
    assert _uids(fake, "Trash") == [3, 5]


def test_delete_is_uid_store_plus_uid_expunge_of_the_exact_uids(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4, 5, 9]))
    spy = Spy(fake)
    c = _count("trash", uids=[3, 5])
    spy.calls.clear()
    mailops.purge_mails("trash", c["uids"], c["uv"], **_at(c))
    assert ("uid", "STORE", "3,5", "+FLAGS", r"(\Deleted)") in spy.calls
    assert ("uid", "EXPUNGE", "3,5") in spy.calls
    assert not [c for c in spy.calls if c[0] in ("store", "expunge")]
    assert not any("*" in str(c) or ":" in str(c[2:]) for c in spy.calls
                   if c[0] == "uid" and c[1] in ("STORE", "EXPUNGE"))
    assert _uids(fake, "Trash") == [4, 9]


def test_a_later_deleted_flagged_foreign_mail_is_not_expunged(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4]))
    c = _count("trash", everything=True)
    foreign = make_msg(7)
    foreign["deleted"] = True               # another client's pending delete
    fake.mailbox["Trash"].append(foreign)
    mailops.purge_mails("trash", c["uids"], c["uv"], **_at(c))
    assert _uids(fake, "Trash") == [7]


def test_uids_that_vanished_are_reported_not_an_error(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4, 5]))
    c = _count("trash", everything=True)
    fake.mailbox["Trash"] = [m for m in fake.mailbox["Trash"]
                             if m["uid"] != 4]
    res = mailops.purge_mails("trash", c["uids"], c["uv"], **_at(c))
    assert res["deleted"] == 2 and res["missing"] == 1


# ===================================================== counted uv + UIDs

@pytest.mark.parametrize("uids,uv", [([], 1), ([3], 0), ([], 0)])
def test_request_without_counted_uv_and_uids_is_refused(monkeypatch, uids, uv):
    fake = _env(monkeypatch, trash=_mails([3, 4]))
    spy = Spy(fake)
    with pytest.raises(ValueError, match="counted listing"):
        mailops.purge_mails("trash", uids, uv, **_W["trash"])
    assert spy.calls == [] and _uids(fake, "Trash") == [3, 4]
    r = client.post("/api/folders_panel/purge",
                    json={"role": "trash", "uids": uids, "uv": uv,
                          "folder": "Trash"})
    assert r.status_code == 400 and _uids(fake, "Trash") == [3, 4]
    r = client.post("/api/folders_panel/purge", json={"role": "trash"})
    assert r.status_code == 400                    # not even a body


def test_api_has_no_range_or_all_mode(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4]))
    r = client.post("/api/folders_panel/purge", json={
        "role": "trash", "uids": [3], "uv": 1, "folder": "Trash",
        "all": True, "range": "1:*"})
    assert r.status_code == 200 and r.json()["deleted"] == 1
    assert _uids(fake, "Trash") == [4]             # extra fields ignored
    r = client.post("/api/folders_panel/purge",
                    json={"role": "trash", "uids": ["1:*"], "uv": 1,
                          "folder": "Trash"})
    assert r.status_code == 422


def test_bad_role_is_refused(monkeypatch):
    _env(monkeypatch, trash=_mails([3]))
    for role in ("sent", "inbox", ""):
        with pytest.raises(ValueError, match="bad role"):
            mailops.purge_mails(role, [3], 1, folder="Trash")
    r = client.post("/api/folders_panel/purge",
                    json={"role": "sent", "uids": [3], "uv": 1})
    assert r.status_code == 400


# ============================================================ UIDVALIDITY

@pytest.mark.parametrize("role", ["trash", "junk"])
def test_uidvalidity_mismatch_refuses_and_deletes_nothing(monkeypatch, role):
    box = {"trash": dict(trash=_mails([3, 4])), "junk": dict(junk=_mails([3, 4]))}
    fake = _env(monkeypatch, **box[role])
    c = _count(role, everything=True)
    fake.uv["Trash" if role == "trash" else "Spam"] = 9
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="changed on the server"):
        mailops.purge_mails(role, c["uids"], c["uv"], **_at(c))
    assert spy.destructive() == []
    assert _uids(fake, "Trash" if role == "trash" else "Spam") == [3, 4]
    assert _entries("purge") == []                  # nothing happened


def test_uidvalidity_changing_between_listing_and_delete_refuses(monkeypatch):
    """The refresh read the counted uv, then the folder is re-created before
    the destructive select: the second read refuses."""
    fake = _env(monkeypatch, trash=_mails([3, 4]))
    c = _count("trash", everything=True)
    orig = fake.select
    n = []

    def select(q, readonly=False):
        r = orig(q, readonly)
        if not readonly:
            n.append(1)
            fake.uv["Trash"] = 77
        return r
    fake.select = select
    with pytest.raises(RuntimeError, match="changed on the server"):
        mailops.purge_mails("trash", c["uids"], c["uv"], **_at(c))
    assert _uids(fake, "Trash") == [3, 4] and n


def _uv_flips(fake, folder, readonly_uv, rw_uv):
    """The folder reports `readonly_uv` to a read-only SELECT (the listing)
    and `rw_uv` to a read-write one (the destructive step)."""
    orig = fake.select

    def select(q, readonly=False):
        if q.strip('"') == folder:
            fake.uv[folder] = readonly_uv if readonly else rw_uv
        return orig(q, readonly)
    fake.select = select


@pytest.mark.parametrize("role,folder", [("trash", "Trash"),
                                         ("junk", "Spam")])
def test_the_listing_read_alone_refuses_a_changed_uidvalidity(
        monkeypatch, role, folder):
    """Each UIDVALIDITY check on its own: here only the fresh listing (the
    read-only select) disagrees with the count."""
    fake = _env(monkeypatch, trash=_mails([3, 4]), junk=_mails([3, 4]))
    c = _count(role, everything=True)
    _uv_flips(fake, folder, readonly_uv=9, rw_uv=1)
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="changed on the server"):
        mailops.purge_mails(role, c["uids"], c["uv"], **_at(c))
    assert spy.destructive() == [] and _uids(fake, folder) == [3, 4]


@pytest.mark.parametrize("role,folder", [("trash", "Trash"),
                                         ("junk", "Spam")])
def test_the_destructive_select_alone_refuses_a_changed_uidvalidity(
        monkeypatch, role, folder):
    """...and here only the read-write select (right before the command)
    disagrees: the folder was re-created after the listing."""
    fake = _env(monkeypatch, trash=_mails([3, 4]), junk=_mails([3, 4]))
    c = _count(role, everything=True)
    _uv_flips(fake, folder, readonly_uv=1, rw_uv=9)
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="changed on the server"):
        mailops.purge_mails(role, c["uids"], c["uv"], **_at(c))
    assert spy.destructive() == [] and _uids(fake, folder) == [3, 4]


@pytest.mark.parametrize("role", ["trash", "junk"])
def test_unreadable_uidvalidity_refuses(monkeypatch, role):
    box = {"trash": dict(trash=_mails([3])), "junk": dict(junk=_mails([3]))}
    fake = _env(monkeypatch, **box[role])
    c = _count(role, everything=True)
    fake.response = lambda key: (key, [None])      # no UIDVALIDITY announced
    spy = Spy(fake)
    with pytest.raises(RuntimeError):
        mailops.purge_mails(role, c["uids"], c["uv"], **_at(c))
    assert spy.destructive() == []
    with pytest.raises(RuntimeError, match="UIDVALIDITY"):
        _count(role, everything=True)               # the count refuses too


# ===================================================================== UIDPLUS

def test_no_uidplus_refuses_a_partial_trash_purge(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4, 5]), uidplus=False)
    c = _count("trash", uids=[3])
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="cannot delete part of a folder"):
        mailops.purge_mails("trash", c["uids"], c["uv"], **_at(c))
    assert spy.destructive() == [] and _uids(fake, "Trash") == [3, 4, 5]


def test_no_uidplus_whole_folder_purge_is_allowed(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4, 5]), uidplus=False)
    res, _ = _purge("trash", everything=True)
    assert res["deleted"] == 3 and _uids(fake, "Trash") == []


def test_no_uidplus_refuses_when_trash_changes_during_the_recheck(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4]), uidplus=False)
    c = _count("trash", everything=True)
    orig = fake.uid
    searches = []

    def uid(cmd, *a):
        r = orig(cmd, *a)
        if cmd == "SEARCH":
            searches.append(1)
            if len(searches) == 2:   # after the destructive step's listing
                fake.mailbox["Trash"].append(make_msg(9))
        return r
    fake.uid = uid
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="changed since it was counted"):
        mailops.purge_mails("trash", c["uids"], c["uv"], **_at(c))
    assert [c_ for c_ in spy.destructive() if c_[0] == "expunge"
            or c_[:2] == ("uid", "STORE")] == []
    assert _uids(fake, "Trash") == [3, 4, 9]


def test_junk_without_uidplus_is_refused_before_any_move(monkeypatch):
    fake = _env(monkeypatch, junk=_mails([3, 4]), trash=_mails([8]),
                uidplus=False)
    c = _count("junk", everything=True)
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="cannot delete part of a folder"):
        mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert spy.destructive() == []
    assert _uids(fake, "Spam") == [3, 4] and _uids(fake, "Trash") == [8]


# ======================================================= protected / pinned

def _protect(*entries):
    cfgmod.update_config({"protected": list(entries)})


def test_protected_senders_are_skipped_and_reported(monkeypatch):
    fake = _env(monkeypatch, trash=[
        make_msg(3, frm="Boss <boss@work.example>", subject="Contract"),
        make_msg(4, frm="x@gone.example"), make_msg(5, frm="a@bank.example")])
    _protect("boss@work.example", "@bank.example")
    c = _count("trash", everything=True)
    assert c["uids"] == [4] and c["skipped_protected"] == 2
    assert c["skipped_pinned"] == 0
    res = mailops.purge_mails("trash", c["uids"], c["uv"], **_at(c))
    assert res["deleted"] == 1 and _uids(fake, "Trash") == [3, 5]


def test_server_enforces_protection_even_if_the_client_asks_for_it(monkeypatch):
    """A request naming a protected mail's UID directly (a stale or
    hand-made request) still skips it: the guard is the server's."""
    fake = _env(monkeypatch, trash=[
        make_msg(3, frm="boss@work.example"), make_msg(4)])
    c = _count("trash", everything=True)          # counted before protecting
    assert c["uids"] == [3, 4]
    _protect("boss@work.example")
    res = mailops.purge_mails("trash", [3, 4], c["uv"], **_W["trash"])
    assert res["deleted"] == 1 and res["skipped_protected"] == 1
    assert _uids(fake, "Trash") == [3]
    res = client.post("/api/folders_panel/purge", json={
        "role": "trash", "uids": [3], "uv": c["uv"],
        "folder": "Trash"}).json()
    assert res["deleted"] == 0 and res["skipped_protected"] == 1
    assert _uids(fake, "Trash") == [3]


def test_pinned_mails_are_skipped_by_message_id(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4, 5]))
    pinstore.set_pinned("<m4@shop.example>", True, "default")
    c = _count("trash", everything=True)
    assert c["uids"] == [3, 5] and c["skipped_pinned"] == 1
    res = mailops.purge_mails("trash", [3, 4, 5], c["uv"], **_W["trash"])
    assert res["deleted"] == 2 and res["skipped_pinned"] == 1
    assert _uids(fake, "Trash") == [4]


def test_a_mail_both_protected_and_pinned_is_counted_once(monkeypatch):
    _env(monkeypatch, trash=[make_msg(3, frm="boss@work.example")])
    _protect("boss@work.example")
    pinstore.set_pinned("<m3@shop.example>", True, "default")
    c = _count("trash", everything=True)
    assert c["skipped_protected"] + c["skipped_pinned"] == 1 and not c["uids"]


def test_nothing_deletable_runs_no_destructive_command(monkeypatch):
    fake = _env(monkeypatch, trash=[make_msg(3, frm="boss@work.example")])
    _protect("boss@work.example")
    c = _count("trash", everything=True)
    spy = Spy(fake)
    res = mailops.purge_mails("trash", [3], c["uv"], **_W["trash"])
    assert res["deleted"] == 0 and res["skipped_protected"] == 1
    assert spy.destructive() == [] and _entries("purge") == []


def test_junk_protected_and_pinned_are_skipped_and_never_moved(monkeypatch):
    fake = _env(monkeypatch, junk=[
        make_msg(3, frm="boss@work.example"), make_msg(4), make_msg(5)],
        renumber=True, copyuid=True)
    _protect("boss@work.example")
    pinstore.set_pinned("<m5@shop.example>", True, "default")
    spy = Spy(fake)
    res, c = _purge("junk", everything=True)
    assert c["uids"] == [4]
    assert c["skipped_protected"] == 1 and c["skipped_pinned"] == 1
    assert res["deleted"] == 1
    res = mailops.purge_mails("junk", [3, 4, 5], c["uv"], **_W["junk"])   # asked directly
    assert res["deleted"] == 0 and res["skipped_protected"] == 1 \
        and res["skipped_pinned"] == 1
    assert _uids(fake, "Spam") == [3, 5] and _uids(fake, "Trash") == []
    assert ("uid", "MOVE", "4", '"Trash"') in spy.calls


def test_protection_is_per_account_for_pins(monkeypatch):
    """A pin of another account never protects this account's mail."""
    fake = _env(monkeypatch, trash=_mails([3]))
    pinstore.set_pinned("<m3@shop.example>", True, "other")
    c = _count("trash", everything=True)
    assert c["uids"] == [3] and c["skipped_pinned"] == 0
    assert mailops.purge_mails("trash", [3], c["uv"], **_W["trash"])["deleted"] == 1
    assert _uids(fake, "Trash") == []


# ===================================================== D6: ambiguity, missing

def _confirm(role, folder):
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {"default": {
        "role_overrides": {role: folder}}}}))


@pytest.mark.parametrize("which", ["trash", "junk-own", "junk-via-trash"])
def test_ambiguous_unconfirmed_role_refuses_before_any_command(monkeypatch,
                                                               which):
    if which == "trash":
        fake = _env(monkeypatch, trash=_mails([3]))
        fake.mailbox["Deleted Items"] = _mails([4])
        fake.uv["Deleted Items"] = 1
        role = "trash"
    elif which == "junk-own":
        fake = _env(monkeypatch, junk=_mails([3]), trash=_mails([8]))
        fake.mailbox["Junk Email"] = _mails([4])
        fake.uv["Junk Email"] = 1
        role = "junk"
    else:
        fake = _env(monkeypatch, junk=_mails([3]), trash=_mails([8]))
        fake.mailbox["Deleted Items"] = _mails([4])
        fake.uv["Deleted Items"] = 1
        role = "junk"
    before = {f: list(m) for f, m in fake.mailbox.items()}
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="ambiguous"):
        mailops.purge_mails(role, [3], 1, **_W[role])
    with pytest.raises(RuntimeError, match="ambiguous"):
        _count(role, everything=True)
    assert spy.destructive() == [] and fake.mailbox == before
    assert _entries() == []
    r = client.post("/api/folders_panel/purge",
                    json={"role": role, "uids": [3], "uv": 1,
                          **_W[role]})
    assert r.status_code == 409 and "ambiguous" in r.json()["detail"]
    assert fake.mailbox == before


def test_a_confirmed_override_unlocks_the_purge_on_that_folder(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3]))
    fake.mailbox["Deleted Items"] = _mails([4])
    fake.uv["Deleted Items"] = 1
    _confirm("trash", "Deleted Items")
    res, _ = _purge("trash", everything=True)
    assert res["deleted"] == 1
    assert _uids(fake, "Deleted Items") == [] and _uids(fake, "Trash") == [3]


def test_a_confirmed_junk_and_trash_unlock_the_junk_purge(monkeypatch):
    fake = _env(monkeypatch, junk=_mails([3]), trash=_mails([8]),
                renumber=True, copyuid=True)
    for name in ("Junk Email", "Deleted Items"):
        fake.mailbox[name] = _mails([4])
        fake.uv[name] = 1
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {"default": {
        "role_overrides": {"junk": "Junk Email", "trash": "Deleted Items"}}}}))
    res, _ = _purge("junk", everything=True)
    assert res["deleted"] == 1
    assert _uids(fake, "Junk Email") == [] and _uids(fake, "Spam") == [3]


@pytest.mark.parametrize("target", ["INBOX", "Sent", "No Such Folder",
                                    "Spam"])
def test_an_invalid_override_never_unlocks_a_purge(monkeypatch, target):
    fake = _env(monkeypatch, trash=_mails([3]))
    fake.mailbox["Deleted Items"] = _mails([4])
    fake.uv["Deleted Items"] = 1
    _confirm("trash", target)
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="ambiguous"):
        mailops.purge_mails("trash", [3], 1, **_W["trash"])
    assert spy.destructive() == [] and _uids(fake, "Trash") == [3]


def test_missing_role_folders_refuse(monkeypatch):
    fake = FakeIMAP({"INBOX": [make_msg(1)], "Spam": _mails([3]), "Sent": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="No Trash folder"):
        mailops.purge_mails("trash", [3], 1, **_W["trash"])
    with pytest.raises(RuntimeError, match="No Trash folder"):
        mailops.purge_mails("junk", [3], 1, **_W["junk"])         # Junk goes via Trash
    with pytest.raises(RuntimeError, match="No Trash folder"):
        _count("junk", everything=True)
    assert spy.destructive() == [] and _uids(fake, "Spam") == [3]
    fake2 = FakeIMAP({"INBOX": [make_msg(1)], "Trash": _mails([3])})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake2)
    with pytest.raises(RuntimeError, match="No Junk folder"):
        mailops.purge_mails("junk", [3], 1, **_W["junk"])
    assert _uids(fake2, "Trash") == [3]


def test_junk_and_trash_being_the_same_folder_refuses(monkeypatch):
    fake = FakeIMAP({"INBOX": [make_msg(1)], "Bin": _mails([3])},
                    flags={"Bin": "\\Trash \\Junk"})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    with pytest.raises(RuntimeError, match="same folder"):
        mailops.purge_mails("junk", [3], 1, **_W["junk"])
    assert _uids(fake, "Bin") == [3]


# ================================================================== chunking

def test_large_purge_is_done_in_move_chunk_pieces(monkeypatch):
    fake = _env(monkeypatch, trash=_mails(range(10, 1211)))
    spy = Spy(fake)
    res, c = _purge("trash", everything=True)
    assert res["deleted"] == 1201 and _uids(fake, "Trash") == []
    stores = [c_ for c_ in spy.calls
              if c_[0] == "uid" and c_[1] == "STORE"]
    assert [len(c_[2].split(",")) for c_ in stores] == [500, 500, 201]


def _undo_entry(items, dest="Trash", label="x"):
    mailops.UNDO_LOG.append({"ts": 1, "label": label, "action": "trash",
                             "count": len(items), "items": items,
                             "in": dest})


def test_partial_failure_books_what_was_really_deleted(monkeypatch):
    fake = _env(monkeypatch, trash=_mails(range(1, 1202)))
    gone = [("INBOX", "<m1@shop.example>"), ("INBOX", "<m500@shop.example>")]
    left = [("INBOX", "<m501@shop.example>"),
            ("INBOX", "<m1201@shop.example>")]
    _undo_entry(gone + left, label="mixed")
    _undo_entry(gone, label="all-gone")
    c = _count("trash", everything=True)
    orig = fake.uid
    stores = []

    def uid(cmd, *a):
        if cmd == "STORE" and a[1] == "+FLAGS":
            stores.append(1)
            if len(stores) == 2:
                return "NO", [b"denied"]
        return orig(cmd, *a)
    fake.uid = uid
    with pytest.raises(RuntimeError, match="500 mails were permanently "
                                           "deleted before the failure"):
        mailops.purge_mails("trash", c["uids"], c["uv"], **_at(c))
    assert _uids(fake, "Trash") == list(range(501, 1202))
    e = _entries("purge")
    assert len(e) == 1 and e[0]["count"] == 500 and e[0]["outcome"] == "partial"
    assert [(x["label"], x["items"]) for x in mailops.UNDO_LOG] == \
        [("mixed", left)]
    assert mailops.STATE["trash_count"] == 701
    assert len(mailops.role_mails("trash")) == 701     # role index matches
    assert statsmod.load()["actions"][time.strftime("%Y-%m")]["purge"] == 500


def test_expunge_failure_unflags_the_chunk_and_books_nothing(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4]))
    c = _count("trash", everything=True)
    orig = fake.uid

    def uid(cmd, *a):
        if cmd == "EXPUNGE":
            return "NO", [b"denied"]
        return orig(cmd, *a)
    fake.uid = uid
    with pytest.raises(RuntimeError, match="cannot expunge"):
        mailops.purge_mails("trash", c["uids"], c["uv"], **_at(c))
    assert _uids(fake, "Trash") == [3, 4]
    assert not any(m.get("deleted") for m in fake.mailbox["Trash"])
    assert _entries("purge") == []


# ========================================== audit / undo / stats / counts

def test_one_audit_entry_with_role_and_counts_only(monkeypatch):
    _env(monkeypatch, trash=_mails([3, 4, 5]))
    pinstore.set_pinned("<m5@shop.example>", True, "default")
    mailops.purge_mails("trash", [3, 4, 5], 1, **_W["trash"])
    es = _entries("purge")
    assert len(es) == 1
    e = es[0]
    assert e["count"] == 2 and e["outcome"] == "ok" and e["actor"] == "user"
    assert e["bytes"] == 103 + 104
    assert e["label"].startswith("Trash") and "pinned" in e["label"]
    blob = json.dumps(e)
    assert "Subject" not in blob and "gone.example" not in blob
    assert not _entries("empty_trash") and not _entries("trash")


def test_undo_entries_of_purged_mails_are_pruned_and_only_those(bridge):
    mailops.run_scan()
    mailops.delete_messages([["INBOX", 4]])
    from conftest import wait_delete_done
    wait_delete_done()
    mailops.delete_messages([["INBOX", 3]])
    wait_delete_done()
    assert len(mailops.UNDO_LOG) == 2
    keep = [e for e in mailops.UNDO_LOG
            if all(i[1] != "<m4@shop.example>" for i in e["items"])]
    c = mailops.purge_preview("trash", uids=[
        m["uid"] for m in bridge.mailbox["Trash"]
        if m["msgid"] == "<m4@shop.example>"])
    mailops.purge_mails("trash", c["uids"], c["uv"], **_at(c))
    assert mailops.UNDO_LOG == keep and len(keep) == 1
    assert [m["msgid"] for m in bridge.mailbox["Trash"]] == [
        "<m3@shop.example>"]


def test_stats_audit_counts_and_role_index_after_a_purge(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4, 5]))
    mailops.trash_list()
    _purge("trash", uids=[3, 4])
    month = time.strftime("%Y-%m")
    acts = statsmod.load()["actions"][month]
    assert acts["purge"] == 2 and acts["purged_bytes"] == 103 + 104
    assert acts["freed"] == 0
    assert [m["uid"] for m in mailops.role_mails("trash")] == [5]
    assert mailops.STATE["trash_count"] == 1
    assert _uids(fake, "Trash") == [5]
    _, subj_text, _ = digestmod.compose("default", 0)[0:3]
    assert "Permanently deleted: 2" in subj_text


def test_empty_trash_also_counts_as_freed_and_in_the_digest(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4]))
    listing = mailops.trash_list()
    mailops.empty_trash(uv=listing["uv"], max_uid=listing["max_uid"])
    acts = statsmod.load()["actions"][time.strftime("%Y-%m")]
    assert acts["purge"] == 2 and acts["purged_bytes"] == 103 + 104
    assert acts["freed"] == 0
    e = _entries("empty_trash")
    assert len(e) == 1 and e[0]["bytes"] == 207
    _, text, _ = digestmod.compose("default", 0)
    assert "Permanently deleted: 2" in text and "Space freed: 207 B" in text
    assert _uids(fake, "Trash") == []


# ================================================================= scoping

def test_purge_acts_on_the_given_account_never_the_active_one(monkeypatch):
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "host-one", "user": "u1", "password": "pw"},
        "two": {"host": "host-two", "user": "u2", "password": "pw"}}}))
    boxes = {"host-one": FakeIMAP({"INBOX": [], "Trash": _mails([3, 4])}),
             "host-two": FakeIMAP({"INBOX": [], "Trash": _mails([3, 4])})}
    seen = []

    def connect(cfg, name=None):
        seen.append(name)
        return boxes[cfg["host"]]
    monkeypatch.setattr(mailops, "connect", connect)
    acc = accountsmod.get("two")
    pinstore.set_pinned("<m4@shop.example>", True, "two")
    pinstore.set_pinned("<m3@shop.example>", True, "one")   # not this account
    c = mailops.purge_preview("trash", everything=True, acc=acc)
    assert c["uids"] == [3] and c["skipped_pinned"] == 1
    res = mailops.purge_mails("trash", c["uids"], c["uv"], acc, **_at(c))
    assert res["deleted"] == 1
    assert _uids(boxes["host-two"], "Trash") == [4]
    assert _uids(boxes["host-one"], "Trash") == [3, 4]      # untouched
    assert set(seen) == {"two"}
    assert [e["action"] for e in auditlog.load("two", 0, 50)["entries"]] \
        == ["purge"]
    assert auditlog.load("one", 0, 50)["entries"] == []
    # over the API: ?account= picks the account, unknown ones are refused
    r = client.post("/api/folders_panel/purge_preview?account=two",
                    json={"role": "trash", "everything": True})
    assert r.status_code == 200 and r.json()["uids"] == []
    r = client.post("/api/folders_panel/purge?account=one", json={
        "role": "trash", "uids": [3, 4], "uv": 1, "folder": "Trash"})
    assert r.status_code == 200 and r.json()["deleted"] == 1   # 3 is pinned
    assert _uids(boxes["host-one"], "Trash") == [3]
    assert _uids(boxes["host-two"], "Trash") == [4]
    assert client.post("/api/folders_panel/purge?account=nope", json={
        "role": "trash", "uids": [3], "uv": 1,
        "folder": "Trash"}).status_code == 400


# ==================================================================== busy

def test_busy_while_a_delete_job_or_a_scan_runs(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3]))
    spy = Spy(fake)
    acc = accountsmod.get()
    for key, val in (("delete", {**acc.state["delete"], "status": "running"}),
                     ("status", "scanning")):
        old = acc.state[key]
        acc.state[key] = val
        with pytest.raises(RuntimeError, match="busy"):
            mailops.purge_mails("trash", [3], 1, **_W["trash"])
        acc.state[key] = old
    assert spy.calls == []
    r = client.post("/api/folders_panel/purge",
                    json={"role": "trash", "uids": [3], "uv": 1,
                          "folder": "Trash"})
    assert r.status_code == 200


def test_two_permanent_deletions_never_run_side_by_side(monkeypatch):
    _env(monkeypatch, trash=_mails([3]))
    acc = accountsmod.get()
    assert acc.purge_lock.acquire(blocking=False)
    try:
        with pytest.raises(RuntimeError, match="busy"):
            mailops.purge_mails("trash", [3], 1, **_W["trash"])
        with pytest.raises(RuntimeError, match="busy"):
            mailops.empty_trash(uv=1, max_uid=3)
    finally:
        acc.purge_lock.release()


# ============================================================ preview

def test_preview_selections_and_age(monkeypatch):
    fake = _env(monkeypatch, trash=[
        make_msg(3, frm="a@gone.example", date=OLD),
        make_msg(4, frm="a@gone.example", date=_recent()),
        make_msg(5, frm="b@gone.example", date=OLD)])
    spy = Spy(fake)
    assert _count("trash", uids=[4, 5, 99])["uids"] == [4, 5]
    assert _count("trash", senders=["A@Gone.example"])["uids"] == [3, 4]
    assert _count("trash", older_than_days=30)["uids"] == [3, 5]
    assert _count("trash", older_than_days=100000)["uids"] == []
    assert _count("trash", everything=True)["count"] == 3
    c = _count("trash", everything=True)
    assert c["uv"] == 1 and c["size"] == 3000 \
        and c["total"] == 3 and c["via_trash"] is False
    assert spy.destructive() == []                      # a count only
    assert _uids(fake, "Trash") == [3, 4, 5]


def test_preview_age_ignores_mail_without_a_date(monkeypatch):
    _env(monkeypatch, trash=[make_msg(3, date="garbage")])
    assert _count("trash", older_than_days=1)["uids"] == []


def test_preview_needs_exactly_one_selection(monkeypatch):
    _env(monkeypatch, trash=_mails([3]))
    for kw in ({}, {"uids": [3], "everything": True},
               {"senders": ["a"], "older_than_days": 3},
               {"older_than_days": 0}):
        with pytest.raises(ValueError):
            _count("trash", **kw)
    r = client.post("/api/folders_panel/purge_preview",
                    json={"role": "trash"})
    assert r.status_code == 400


def test_preview_is_live_not_cached(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3]))
    assert _count("trash", everything=True)["count"] == 1
    fake.mailbox["Trash"].append(make_msg(4))
    assert _count("trash", everything=True)["count"] == 2


def test_cap_deletes_at_most_that_many_oldest_first(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3, 4, 5, 6]))
    c = _count("trash", everything=True)
    res = mailops.purge_mails("trash", c["uids"], c["uv"], **_at(c), cap=3)
    assert res["deleted"] == 3 and res["capped"] == 1
    assert _uids(fake, "Trash") == [6]


# ======================================================== Junk via Trash

def _junk_via(monkeypatch, copyuid, **kw):
    return _env(monkeypatch, junk=_mails([3, 4, 5]),
                trash=_mails([8, 9], who="t{n}@keep.example"),
                renumber=True, copyuid=copyuid, **kw)


@pytest.mark.parametrize("copyuid", [True, False], ids=["copyuid", "msgid"])
def test_junk_goes_via_trash_and_only_the_moved_copies_are_deleted(
        monkeypatch, copyuid):
    fake = _junk_via(monkeypatch, copyuid)
    spy = Spy(fake)
    res, c = _purge("junk", uids=[3, 4])
    assert c["via_trash"] is True
    assert res["deleted"] == 2 and res["unverified"] == 0
    assert _uids(fake, "Spam") == [5]                # the third stays
    assert _uids(fake, "Trash") == [8, 9]            # nothing else touched
    assert ("uid", "MOVE", "3,4", '"Trash"') in spy.calls
    # the permanent delete targets the NEW Trash UIDs, never a Junk UID
    expunges = [c_ for c_ in spy.calls if c_[:2] == ("uid", "EXPUNGE")]
    assert expunges == [("uid", "EXPUNGE", "10,11")]
    assert not any("*" in str(c_) for c_ in spy.calls)
    assert not [c_ for c_ in spy.calls if c_[0] in ("store", "expunge")]
    e = _entries("purge")
    assert len(e) == 1 and e[0]["count"] == 2 and e[0]["label"] == "Junk"
    assert not _entries("trash")                      # no extra move entry
    acts = statsmod.load()["actions"][time.strftime("%Y-%m")]
    assert acts["purge"] == 2 and acts.get("trash", 0) == 0
    assert acts["purged_bytes"] == 103 + 104 and acts["freed"] == 0
    assert [m["uid"] for m in mailops.role_mails("junk")] == [5] \
        or mailops.role_mails("junk") == []
    assert mailops.STATE["junk_count"] == 1
    assert mailops.UNDO_LOG == []                     # nothing left to undo


def test_junk_via_trash_with_a_move_less_server(monkeypatch):
    """No MOVE: COPY + \\Deleted + UID EXPUNGE of the exact source UIDs,
    COPYUID read from the COPY answer."""
    fake = _junk_via(monkeypatch, True, move=False)
    spy = Spy(fake)
    res, _ = _purge("junk", everything=True)
    assert res["deleted"] == 3 and _uids(fake, "Spam") == []
    assert _uids(fake, "Trash") == [8, 9]
    assert not [c for c in spy.calls if c[0] in ("store", "expunge")]
    assert ("uid", "EXPUNGE", "3,4,5") in spy.calls


def test_mail_arriving_in_junk_after_the_count_survives(monkeypatch):
    fake = _junk_via(monkeypatch, False)
    c = _count("junk", everything=True)
    fake.mailbox["Spam"].append(make_msg(6, subject="Arrived later"))
    res = mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert res["deleted"] == 3 and _uids(fake, "Spam") == [6]


def test_junk_uids_that_vanished_are_not_moved(monkeypatch):
    fake = _junk_via(monkeypatch, True)
    c = _count("junk", everything=True)
    fake.mailbox["Spam"] = [m for m in fake.mailbox["Spam"] if m["uid"] != 4]
    spy = Spy(fake)
    res = mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert res["deleted"] == 2 and res["missing"] == 1
    assert ("uid", "MOVE", "3,5", '"Trash"') in spy.calls


def _after_move(fake, hook):
    """Run `hook()` right after the server answered a MOVE."""
    orig = fake.uid

    def uid(cmd, *a):
        r = orig(cmd, *a)
        if cmd in ("MOVE", "COPY"):
            hook()
        return r
    fake.uid = uid


def _assert_stopped_after_the_move(fake, n=3):
    """Nothing permanent: every moved mail is still in Trash, reversibly."""
    assert _uids(fake, "Spam") == []
    assert len([m for m in fake.mailbox["Trash"]
                if m["msgid"] in {f"<m{u}@shop.example>"
                                  for u in (3, 4, 5)}]) == n
    assert _entries("trash") and _entries("trash")[0]["count"] == n
    p = _entries("purge")
    assert len(p) == 1 and p[0]["count"] == 0 and p[0]["outcome"] == "partial"
    assert "could not verify" in p[0]["error"]
    assert len(mailops.UNDO_LOG) == 1 and mailops.UNDO_LOG[0]["count"] == n
    assert mailops.UNDO_LOG[0]["in"] == "Trash"


def test_foreign_arrival_in_trash_during_the_move_stops_after_the_move(
        monkeypatch):
    """Without COPYUID an extra new UID above the old highest one makes the
    match inexact: stop, never guess."""
    fake = _junk_via(monkeypatch, False)
    c = _count("junk", everything=True)
    _after_move(fake, lambda: fake.mailbox["Trash"].append(
        make_msg(500, subject="Foreign", msgid="<foreign@x.example>")))
    spy = Spy(fake)
    res = mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert res["deleted"] == 0 and res["unverified"] == 3
    assert not [c_ for c_ in spy.calls if c_[:2] == ("uid", "EXPUNGE")]
    assert 500 in _uids(fake, "Trash")
    _assert_stopped_after_the_move(fake)


def test_equal_message_id_foreign_arrival_is_not_guessed_either(monkeypatch):
    fake = _junk_via(monkeypatch, False)
    c = _count("junk", uids=[3])
    _after_move(fake, lambda: fake.mailbox["Trash"].append(
        make_msg(500, subject="Same id", msgid="<m3@shop.example>")))
    res = mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert res["deleted"] == 0 and res["unverified"] == 1
    assert 500 in _uids(fake, "Trash")


def test_mail_without_message_id_cannot_be_identified(monkeypatch):
    nameless = make_msg(3)
    nameless["msgid"] = ""
    fake = _env(monkeypatch, junk=[nameless, make_msg(4)],
                trash=_mails([8]), renumber=True)
    c = _count("junk", everything=True)
    spy = Spy(fake)
    res = mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert res["deleted"] == 0 and res["unverified"] == 2
    assert not [c_ for c_ in spy.calls if c_[:2] == ("uid", "EXPUNGE")]
    assert _uids(fake, "Spam") == [] and len(fake.mailbox["Trash"]) == 3


def test_changed_message_id_in_trash_is_not_accepted(monkeypatch):
    fake = _junk_via(monkeypatch, False)
    c = _count("junk", uids=[3, 4])

    def tamper():
        fake.mailbox["Trash"][-1]["msgid"] = "<other@x.example>"
    _after_move(fake, tamper)
    res = mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert res["deleted"] == 0 and res["unverified"] == 2
    assert len(fake.mailbox["Trash"]) == 4


def test_copyuid_for_other_mails_is_not_trusted(monkeypatch):
    """COPYUID names UIDs whose Message-IDs differ from the moved mails':
    stop after the move."""
    fake = _junk_via(monkeypatch, True)
    c = _count("junk", uids=[3, 4])
    orig = fake.response

    def response(key):
        if key == "COPYUID":
            return key, [b"1 3,4 8,9"]       # claims the OTHER Trash mails
        return orig(key)
    fake.response = response
    spy = Spy(fake)
    res = mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert res["deleted"] == 0 and res["unverified"] == 2
    assert not [c_ for c_ in spy.calls if c_[:2] == ("uid", "EXPUNGE")]
    assert _uids(fake, "Trash")[:2] == [8, 9]            # untouched


@pytest.mark.parametrize("answer", [
    b"2 3,4 10,11",            # another UIDVALIDITY than Trash's
    b"2 3,4 8,9",              # ...naming other mails' UIDs: not trusted
    b"1 3 10",                 # covers only part of the chunk
    b"1 3,4,5 10,11,12",       # names a mail we did not move
    b"1 3,4 10",               # unequal lengths
    b"garbage",
])
def test_unusable_copyuid_falls_back_to_the_exact_match(monkeypatch, answer):
    fake = _junk_via(monkeypatch, False)
    c = _count("junk", uids=[3, 4])
    orig = fake.response

    def response(key):
        return (key, [answer]) if key == "COPYUID" else orig(key)
    fake.response = response
    res = mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert res["deleted"] == 2 and res["unverified"] == 0
    assert _uids(fake, "Trash") == [8, 9]


def test_copyuid_naming_a_missing_trash_uid_stops_after_the_move(
        monkeypatch):
    fake = _junk_via(monkeypatch, True)
    c = _count("junk", uids=[3, 4])
    orig = fake.response

    def response(key):
        return (key, [b"1 3,4 10,99"]) if key == "COPYUID" else orig(key)
    fake.response = response
    spy = Spy(fake)
    res = mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert res["deleted"] == 0 and res["unverified"] == 2
    assert not [c_ for c_ in spy.calls if c_[:2] == ("uid", "EXPUNGE")]


def test_foreign_trash_arrival_after_the_move_survives_with_copyuid(
        monkeypatch):
    """With COPYUID only the moved copies go; a mail that lands in Trash
    right after the move (higher UID) is not touched."""
    fake = _junk_via(monkeypatch, True)
    c = _count("junk", everything=True)
    _after_move(fake, lambda: fake.mailbox["Trash"].append(
        make_msg(500, subject="Foreign", msgid="<foreign@x.example>")))
    res = mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert res["deleted"] == 3 and res["unverified"] == 0
    assert _uids(fake, "Trash") == [8, 9, 500]


def test_junk_mail_vanishing_between_listing_and_move_is_not_moved(
        monkeypatch):
    """The move re-lists Junk right before it: a UID that disappeared after
    the listing is left out of the MOVE (and so out of the deletion)."""
    fake = _junk_via(monkeypatch, True)
    c = _count("junk", everything=True)
    orig = fake.select

    def select(q, readonly=False):
        r = orig(q, readonly)
        if q.strip('"') == "Spam" and not readonly:
            fake.mailbox["Spam"] = [m for m in fake.mailbox["Spam"]
                                    if m["uid"] != 4]
        return r
    fake.select = select
    spy = Spy(fake)
    res = mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert res["deleted"] == 2 and res["unverified"] == 0
    assert ("uid", "MOVE", "3,5", '"Trash"') in spy.calls


def test_trash_uidvalidity_changing_during_the_move_stops(monkeypatch):
    fake = _junk_via(monkeypatch, True)
    c = _count("junk", everything=True)
    _after_move(fake, lambda: fake.uv.__setitem__("Trash", 5))
    spy = Spy(fake)
    res = mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert res["deleted"] == 0 and res["unverified"] == 3
    assert not [c_ for c_ in spy.calls if c_[:2] == ("uid", "EXPUNGE")]


def test_unreadable_trash_uidvalidity_refuses_before_the_move(monkeypatch):
    fake = _junk_via(monkeypatch, True)
    c = _count("junk", everything=True)
    orig = fake.response
    fake.response = lambda key: ((key, [None]) if key == "UIDVALIDITY"
                                 and fake.selected == "Trash" else orig(key))
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="Trash changed"):
        mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert spy.destructive() == [] and _uids(fake, "Spam") == [3, 4, 5]


def test_failed_move_deletes_nothing(monkeypatch):
    fake = _junk_via(monkeypatch, True)
    c = _count("junk", everything=True)
    orig = fake.uid

    def uid(cmd, *a):
        if cmd == "MOVE":
            return "NO", [b"denied"]
        return orig(cmd, *a)
    fake.uid = uid
    with pytest.raises(RuntimeError, match="cannot move"):
        mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert _uids(fake, "Spam") == [3, 4, 5] and _entries() == []


def test_junk_partial_failure_books_the_completed_chunks_only(monkeypatch):
    fake = _env(monkeypatch, junk=_mails(range(1, 1202)), renumber=True,
                copyuid=True, trash=_mails([2000]))
    gone = [("Spam", "<m1@shop.example>")]
    left = [("Spam", "<m1201@shop.example>")]
    _undo_entry(gone + left, label="mixed")
    c = _count("junk", everything=True)
    orig = fake.uid
    moves = []

    def uid(cmd, *a):
        if cmd == "MOVE":
            moves.append(1)
            if len(moves) == 2:
                return "NO", [b"denied"]
        return orig(cmd, *a)
    fake.uid = uid
    with pytest.raises(RuntimeError, match="500 mails were permanently "
                                           "deleted before the failure"):
        mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert _uids(fake, "Spam") == list(range(501, 1202))
    assert _uids(fake, "Trash") == [2000]
    e = _entries("purge")
    assert len(e) == 1 and e[0]["count"] == 500 and e[0]["outcome"] == "partial"
    assert [(x["label"], x["items"]) for x in mailops.UNDO_LOG] == \
        [("mixed", left)]
    assert mailops.STATE["junk_count"] == 701


# ===================== the count's folder is what gets deleted (blocker A)

def test_a_count_of_junk_cannot_delete_trash_with_the_same_uv(monkeypatch):
    """UIDVALIDITY is not unique across folders (the fake gives every folder
    uv 1): the UIDs counted in Junk, sent as a Trash delete, must refuse
    instead of deleting Trash UIDs 3 and 4."""
    fake = _env(monkeypatch, junk=_mails([3, 4]), trash=_mails([3, 4, 5]))
    c = _count("junk", everything=True)
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="folder changed since it was "
                                           "counted"):
        mailops.purge_mails("trash", c["uids"], c["uv"], folder=c["folder"])
    assert spy.destructive() == [] and _uids(fake, "Trash") == [3, 4, 5]
    r = client.post("/api/folders_panel/purge", json={
        "role": "trash", "uids": c["uids"], "uv": c["uv"],
        "folder": c["folder"]})
    assert r.status_code == 409 and "folder changed" in r.json()["detail"]
    assert _uids(fake, "Trash") == [3, 4, 5] and _uids(fake, "Spam") == [3, 4]
    assert _entries() == []


def test_and_a_count_of_trash_cannot_delete_junk(monkeypatch):
    fake = _env(monkeypatch, junk=_mails([3, 4]), trash=_mails([3, 4]),
                renumber=True, copyuid=True)
    c = _count("trash", everything=True)
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="folder changed"):
        mailops.purge_mails("junk", c["uids"], c["uv"], folder=c["folder"],
                            trash_folder="Trash")
    assert spy.destructive() == [] and _uids(fake, "Spam") == [3, 4]


def test_the_folder_the_role_resolves_to_changing_refuses(monkeypatch):
    """A role_overrides choice made between the count and the delete moves
    the role to another folder: nothing is deleted."""
    fake = _env(monkeypatch, trash=_mails([3, 4]))
    fake.mailbox["Deleted Items"] = _mails([3, 4])
    fake.uv["Deleted Items"] = 1
    _confirm("trash", "Trash")
    c = _count("trash", everything=True)
    assert c["folder"] == "Trash"
    _confirm("trash", "Deleted Items")
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="folder changed"):
        mailops.purge_mails("trash", c["uids"], c["uv"], **_at(c))
    assert spy.destructive() == []
    assert _uids(fake, "Trash") == [3, 4]
    assert _uids(fake, "Deleted Items") == [3, 4]


def test_the_trash_a_junk_purge_goes_through_changing_refuses(monkeypatch):
    fake = _env(monkeypatch, junk=_mails([3]), trash=_mails([8]),
                renumber=True, copyuid=True)
    fake.mailbox["Deleted Items"] = _mails([9])
    fake.uv["Deleted Items"] = 1
    _confirm("trash", "Trash")
    c = _count("junk", everything=True)
    assert c["trash_folder"] == "Trash"
    _confirm("trash", "Deleted Items")
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match="folder changed"):
        mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert spy.destructive() == [] and _uids(fake, "Spam") == [3]


@pytest.mark.parametrize("kw", [
    {}, {"folder": ""}, {"folder": None}], ids=["absent", "empty", "none"])
def test_a_missing_folder_refuses_before_connecting(monkeypatch, kw):
    fake = _env(monkeypatch, trash=_mails([3, 4]))
    spy = Spy(fake)
    with pytest.raises(ValueError, match="counted listing"):
        mailops.purge_mails("trash", [3], 1, **kw)
    assert spy.calls == [] and _uids(fake, "Trash") == [3, 4]
    r = client.post("/api/folders_panel/purge",
                    json={"role": "trash", "uids": [3], "uv": 1, **kw})
    assert r.status_code in (400, 422) and _uids(fake, "Trash") == [3, 4]


def test_junk_needs_the_trash_folder_too_and_a_wrong_one_refuses(monkeypatch):
    fake = _env(monkeypatch, junk=_mails([3]), trash=_mails([8]))
    spy = Spy(fake)
    with pytest.raises(ValueError, match="counted listing"):
        mailops.purge_mails("junk", [3], 1, folder="Spam")
    for wrong in ({"folder": "INBOX", "trash_folder": "Trash"},
                  {"folder": "Spam", "trash_folder": "INBOX"},
                  {"folder": "Spam", "trash_folder": "Spam"}):
        with pytest.raises(RuntimeError, match="folder changed"):
            mailops.purge_mails("junk", [3], 1, **wrong)
    assert spy.destructive() == [] and _uids(fake, "Spam") == [3]


def test_preview_reports_the_folders_it_counted(monkeypatch):
    _env(monkeypatch, junk=_mails([3]), trash=_mails([8]))
    c = _count("junk", everything=True)
    assert (c["folder"], c["trash_folder"]) == ("Spam", "Trash")
    c = _count("trash", everything=True)
    assert (c["folder"], c["trash_folder"]) == ("Trash", None)


# =================================================== review follow-ups

def test_copyuid_pointing_below_the_old_highest_trash_uid_stops(monkeypatch):
    """COPYUID `1 3 8` claims the copy is an OLDER Trash mail (UID 8, which
    happens to carry the same Message-ID): never trusted - the mail stays
    in Trash after the reversible move and the older copy is untouched."""
    older = make_msg(8, msgid="<m3@shop.example>", subject="Older copy")
    fake = _env(monkeypatch, junk=_mails([3]), trash=[older],
                renumber=True, copyuid=True)
    c = _count("junk", everything=True)
    orig = fake.response
    fake.response = lambda key: ((key, [b"1 3 8"]) if key == "COPYUID"
                                 else orig(key))
    spy = Spy(fake)
    res = mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert res["deleted"] == 0 and res["unverified"] == 1
    assert not [c_ for c_ in spy.calls if c_[:2] == ("uid", "EXPUNGE")]
    assert _uids(fake, "Trash") == [8, 9]           # the real copy is UID 9
    assert _uids(fake, "Spam") == []


def test_copyuid_naming_a_foreign_mail_above_pre_max_is_not_deleted(
        monkeypatch):
    """The range check passes (the named UID is above the old highest Trash
    UID) but the mail there is a FOREIGN arrival whose Message-ID is not the
    moved mail's: the Message-ID check alone stops it - nothing permanent,
    the foreign mail is untouched."""
    fake = _junk_via(monkeypatch, True)          # Trash holds 8, 9
    c = _count("junk", uids=[3])
    _after_move(fake, lambda: fake.mailbox["Trash"].append(
        make_msg(500, subject="Foreign", msgid="<foreign@x.example>")))
    orig = fake.response
    fake.response = lambda key: ((key, [b"1 3 500"]) if key == "COPYUID"
                                 else orig(key))
    spy = Spy(fake)
    res = mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert res["deleted"] == 0 and res["unverified"] == 1
    assert not [c_ for c_ in spy.calls if c_[:2] == ("uid", "EXPUNGE")]
    assert 500 in _uids(fake, "Trash")           # the foreign mail survives
    assert {10, 500} <= set(_uids(fake, "Trash"))  # and the real copy too
    assert _uids(fake, "Spam") == [4, 5]


def test_stopped_after_the_move_returns_the_undo_entry(monkeypatch):
    fake = _junk_via(monkeypatch, False)
    c = _count("junk", everything=True)
    _after_move(fake, lambda: fake.mailbox["Trash"].append(
        make_msg(500, msgid="<foreign@x.example>")))
    res = mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    assert res["unverified"] == 3
    last = mailops.UNDO_LOG[-1]
    assert res["undo"] == {"ts": last["ts"], "label": last["label"],
                           "count": 3}
    ok, _ = _purge("trash", everything=True)
    assert ok["undo"] is None


def test_a_trash_mail_vanishing_between_listing_and_delete(monkeypatch):
    """The destructive step re-lists Trash: a UID that disappeared after the
    listing is not counted as deleted (nor as pruned) - its undo entry
    stays, the others' go."""
    fake = _env(monkeypatch, trash=_mails([3, 4, 5]))
    _undo_entry([("INBOX", "<m3@shop.example>")], label="vanished")
    _undo_entry([("INBOX", "<m4@shop.example>")], label="deleted")
    c = _count("trash", everything=True)
    orig = fake.select

    def select(q, readonly=False):
        r = orig(q, readonly)
        if q.strip('"') == "Trash" and not readonly:
            fake.mailbox["Trash"] = [m for m in fake.mailbox["Trash"]
                                     if m["uid"] != 3]
        return r
    fake.select = select
    res = mailops.purge_mails("trash", c["uids"], c["uv"], **_at(c))
    assert res["deleted"] == 2 and _uids(fake, "Trash") == []
    assert [e["label"] for e in mailops.UNDO_LOG] == ["vanished"]
    assert _entries("purge")[0]["count"] == 2
    assert _entries("purge")[0]["bytes"] == 104 + 105


def test_a_junk_purge_also_prunes_undo_entries_pointing_into_junk(
        monkeypatch):
    _junk_via(monkeypatch, True)
    _undo_entry([("INBOX", "<m3@shop.example>"),
                 ("INBOX", "<keep@a.example>")], dest="Spam", label="into")
    _undo_entry([("INBOX", "<m4@shop.example>")], dest="Elsewhere",
                label="other")
    c = _count("junk", uids=[3, 4])
    mailops.purge_mails("junk", c["uids"], c["uv"], **_at(c))
    got = {e["label"]: [i[1] for i in e["items"]] for e in mailops.UNDO_LOG}
    assert got == {"into": ["<keep@a.example>"],
                   "other": ["<m4@shop.example>"]}   # only Spam / Trash ones


# =========================================================== API round trip

def test_api_preview_then_purge_round_trip(monkeypatch):
    fake = _junk_via(monkeypatch, True)
    prev = client.post("/api/folders_panel/purge_preview", json={
        "role": "junk", "senders": ["s3@gone.example"]}).json()
    assert prev["uids"] == [3] and prev["count"] == 1 and prev["via_trash"]
    res = client.post("/api/folders_panel/purge", json={
        "role": "junk", "uids": prev["uids"], "uv": prev["uv"],
        "folder": prev["folder"], "trash_folder": prev["trash_folder"]})
    assert res.status_code == 200 and res.json()["deleted"] == 1
    assert _uids(fake, "Spam") == [4, 5]


def test_api_unverified_is_a_200_with_the_count(monkeypatch):
    fake = _junk_via(monkeypatch, False)
    _after_move(fake, lambda: fake.mailbox["Trash"].append(
        make_msg(500, msgid="<foreign@x.example>")))
    prev = client.post("/api/folders_panel/purge_preview",
                       json={"role": "junk", "everything": True}).json()
    res = client.post("/api/folders_panel/purge", json={
        "role": "junk", "uids": prev["uids"], "uv": prev["uv"],
        "folder": prev["folder"], "trash_folder": prev["trash_folder"]})
    assert res.status_code == 200
    assert res.json()["deleted"] == 0 and res.json()["unverified"] == 3


def test_api_refusals_map_to_409(monkeypatch):
    fake = _env(monkeypatch, trash=_mails([3]))
    fake.uv["Trash"] = 4
    r = client.post("/api/folders_panel/purge",
                    json={"role": "trash", "uids": [3], "uv": 1,
                          "folder": "Trash"})
    assert r.status_code == 409 and "changed" in r.json()["detail"]
    r = client.post("/api/folders_panel/purge_preview",
                    json={"role": "trash", "older_than_days": 0})
    assert r.status_code == 422


# ================================================================ inert

def test_nothing_is_ever_purged_without_an_explicit_call(monkeypatch):
    """Scans, listings, restores, empty previews and role listings never
    delete anything on their own."""
    fake = _env(monkeypatch, junk=_mails([3, 4]), trash=_mails([8, 9]))
    spy = Spy(fake)
    mailops.run_scan()
    mailops.role_list("junk")
    mailops.role_list("trash")
    _count("junk", everything=True)
    _count("trash", older_than_days=1)
    assert spy.destructive() == []
    assert _uids(fake, "Spam") == [3, 4] and _uids(fake, "Trash") == [8, 9]


def test_no_default_config_or_demo_triggers_a_purge():
    import pathlib
    root = pathlib.Path(__file__).resolve().parent.parent
    assert not any("purge" in k for k in cfgmod.load_config())
    for path in (root / "scripts" / "demo.py",):
        if path.exists():
            assert "purge_mails" not in path.read_text()
    called_from = []
    for p in (root / "backend").glob("*.py"):
        text = p.read_text()
        if "purge_mails(" in text and p.name != "mailops.py":
            called_from.append(p.name)
    assert called_from == ["main.py"]             # only the endpoint
