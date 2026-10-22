"""Empty Trash deletes exactly the mails the confirm counted: UID-based,
UIDVALIDITY-checked, never `1:*` nor a plain EXPUNGE for a partial purge;
the undo log is only pruned after success. Plus FakeIMAP STORE/EXPUNGE
realism (F8)."""

import imaplib

import pytest
from fastapi.testclient import TestClient

from backend import auditlog
from backend import mailops
from backend.main import app
from conftest import FakeIMAP, code_re, make_msg, wait_delete_done

client = TestClient(app)


def _trash_msgs(*uids):
    return [make_msg(u, subject=f"Old {u}") for u in uids]


def _bridge(monkeypatch, trash, **kw):
    fake = FakeIMAP({"INBOX": [make_msg(1), make_msg(2, msgid="<keep@a.example>")],
                     "Trash": trash, "Sent": []}, **kw)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    return fake


def _trash_uids(fake):
    return [m["uid"] for m in fake.mailbox["Trash"]]


class Spy:
    """Records every IMAP command that could delete."""

    def __init__(self, fake):
        self.calls = []
        for name in ("uid", "store", "expunge"):
            orig = getattr(fake, name)
            setattr(fake, name, self._wrap(name, orig))

    def _wrap(self, name, orig):
        def f(*a):
            self.calls.append((name,) + a)
            return orig(*a)
        return f


# ------------------------------------------------------------ exact UIDs

def test_mail_arriving_after_the_count_survives(monkeypatch):
    fake = _bridge(monkeypatch, _trash_msgs(3, 4, 5))
    listing = mailops.trash_list()
    assert listing["total"] == 3 and listing["max_uid"] == 5
    fake.mailbox["Trash"].append(make_msg(6, subject="Arrived later"))
    r = mailops.empty_trash(uv=listing["uv"], max_uid=listing["max_uid"])
    assert r["deleted"] == 3
    assert _trash_uids(fake) == [6]
    assert mailops.STATE["trash_count"] == 1


def test_delete_uses_uid_store_and_uid_expunge_on_exact_uids(monkeypatch):
    fake = _bridge(monkeypatch, _trash_msgs(3, 4, 5))
    spy = Spy(fake)
    fake.mailbox["Trash"].append(make_msg(9))
    mailops.empty_trash(uv=1, max_uid=5)
    assert ("uid", "STORE", "3,4,5", "+FLAGS", r"(\Deleted)") in spy.calls
    assert ("uid", "EXPUNGE", "3,4,5") in spy.calls
    assert not [c for c in spy.calls if c[0] in ("store", "expunge")]
    assert not any("*" in str(c) for c in spy.calls)


def test_another_clients_deleted_flag_is_not_expunged(monkeypatch):
    """A \\Deleted mail from a later UID (another client's pending delete)
    must not be swept away by our EXPUNGE."""
    fake = _bridge(monkeypatch, _trash_msgs(3, 4))
    late = make_msg(7)
    late["deleted"] = True
    fake.mailbox["Trash"].append(late)
    mailops.empty_trash(uv=1, max_uid=4)
    assert _trash_uids(fake) == [7]


def test_everything_up_to_max_uid_is_deleted(monkeypatch):
    fake = _bridge(monkeypatch, _trash_msgs(3, 4))
    assert mailops.empty_trash(uv=1, max_uid=4)["deleted"] == 2
    assert fake.mailbox["Trash"] == []


@pytest.mark.parametrize("uv,max_uid", [(0, 0), (0, 5), (None, None)])
def test_no_counted_listing_refuses_and_deletes_nothing(monkeypatch, uv,
                                                        max_uid):
    fake = _bridge(monkeypatch, _trash_msgs(3, 4))
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match=code_re(mailops.COUNT_REQUIRED)):
        if uv is None:
            mailops.empty_trash()
        else:
            mailops.empty_trash(uv=uv, max_uid=max_uid)
    assert _trash_uids(fake) == [3, 4]
    assert not spy.calls


def test_zero_count_deletes_nothing(monkeypatch):
    fake = _bridge(monkeypatch, _trash_msgs(3))
    spy = Spy(fake)
    assert mailops.empty_trash(uv=1, max_uid=0) == {"deleted": 0}
    assert _trash_uids(fake) == [3] and not spy.calls


def test_unreadable_uidvalidity_refuses(monkeypatch):
    fake = _bridge(monkeypatch, _trash_msgs(3, 4))
    fake.response = lambda key: (key, [None])      # server never announces it
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match=code_re(mailops.FOLDER_CHANGED, role="trash")):
        mailops.empty_trash(uv=1, max_uid=4)
    assert _trash_uids(fake) == [3, 4]
    assert not [c for c in spy.calls if "STORE" in c or "EXPUNGE" in c]


def test_empty_trash_empty_folder_deletes_nothing(monkeypatch):
    fake = _bridge(monkeypatch, [])
    spy = Spy(fake)
    assert mailops.empty_trash(uv=1, max_uid=10_000)["deleted"] == 0
    assert not [c for c in spy.calls if "STORE" in c or "EXPUNGE" in c]


def test_large_trash_is_deleted_in_chunks(monkeypatch):
    fake = _bridge(monkeypatch, _trash_msgs(*range(1, 1202)))
    spy = Spy(fake)
    assert mailops.empty_trash(uv=1, max_uid=10_000)["deleted"] == 1201
    assert fake.mailbox["Trash"] == []
    stores = [c for c in spy.calls if c[:2] == ("uid", "STORE")]
    assert len(stores) == 3 and all(
        len(c[2].split(",")) <= mailops.MOVE_CHUNK for c in stores)


# ------------------------------------------------------------ UIDVALIDITY

def test_uidvalidity_mismatch_refuses_and_deletes_nothing(monkeypatch):
    fake = _bridge(monkeypatch, _trash_msgs(3, 4))
    listing = mailops.trash_list()
    fake.uv["Trash"] = 2                    # server re-numbered the folder
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match=code_re(mailops.FOLDER_CHANGED, role="trash")):
        mailops.empty_trash(uv=listing["uv"], max_uid=listing["max_uid"])
    assert _trash_uids(fake) == [3, 4]
    assert not [c for c in spy.calls if "STORE" in c or "EXPUNGE" in c]


def test_api_passes_uv_and_max_uid(monkeypatch):
    fake = _bridge(monkeypatch, _trash_msgs(3, 4, 5))
    fake.mailbox["Trash"].append(make_msg(8))
    r = client.post("/api/empty_trash", json={"uv": 1, "max_uid": 5})
    assert r.status_code == 200 and r.json() == {"deleted": 3}
    assert _trash_uids(fake) == [8]
    assert client.post("/api/empty_trash", json={"uv": 7, "max_uid": 9}).status_code == 409
    # no (or an empty) counted listing refuses and deletes nothing
    assert client.post("/api/empty_trash").status_code == 422
    assert client.post("/api/empty_trash", json={}).status_code == 409
    assert _trash_uids(fake) == [8]


# --------------------------------------------------------------- UIDPLUS

def test_no_uidplus_refuses_a_partial_purge(monkeypatch):
    fake = _bridge(monkeypatch, _trash_msgs(3, 4, 5), uidplus=False)
    fake.mailbox["Trash"].append(make_msg(6))       # arrived after the count
    spy = Spy(fake)
    with pytest.raises(RuntimeError, match=code_re(mailops.PARTIAL_UNSAFE_CHANGED)):
        mailops.empty_trash(uv=1, max_uid=5)
    assert _trash_uids(fake) == [3, 4, 5, 6]
    assert not [c for c in spy.calls if "STORE" in c or "EXPUNGE" in c]


def test_no_uidplus_whole_folder_empty_is_allowed(monkeypatch):
    fake = _bridge(monkeypatch, _trash_msgs(3, 4, 5), uidplus=False)
    assert mailops.empty_trash(uv=1, max_uid=5)["deleted"] == 3
    assert fake.mailbox["Trash"] == []


def test_no_uidplus_refuses_when_trash_changes_during_the_recheck(monkeypatch):
    fake = _bridge(monkeypatch, _trash_msgs(3, 4), uidplus=False)
    orig = fake.uid
    searches = []

    def uid(cmd, *a):
        r = orig(cmd, *a)
        if cmd == "SEARCH":
            searches.append(1)
            if len(searches) == 1:      # a mail lands between the two looks
                fake.mailbox["Trash"].append(make_msg(5))
        return r
    fake.uid = uid
    with pytest.raises(RuntimeError, match=code_re(mailops.FOLDER_CHANGED, role="trash")):
        mailops.empty_trash(uv=1, max_uid=10_000)
    assert _trash_uids(fake) == [3, 4, 5]


# ----------------------------------------------------- undo log + audit

def _undo_entry(items, dest="Trash", label="x"):
    mailops.UNDO_LOG.append({"ts": 1, "label": label, "action": "trash",
                             "count": len(items), "items": items,
                             "in": dest})


def test_undo_entry_of_mail_above_max_uid_is_kept(monkeypatch):
    fake = _bridge(monkeypatch, _trash_msgs(3, 4))
    fake.mailbox["Trash"].append(make_msg(9))      # trashed after the count
    _undo_entry([("INBOX", "<m3@shop.example>")], label="old")
    _undo_entry([("INBOX", "<m9@shop.example>")], label="new")
    mailops.empty_trash(uv=1, max_uid=4)
    assert [e["label"] for e in mailops.UNDO_LOG] == ["new"]
    assert _trash_uids(fake) == [9]


def test_undo_entries_for_another_folder_are_untouched(monkeypatch):
    _bridge(monkeypatch, _trash_msgs(3))
    _undo_entry([("INBOX", "<m3@shop.example>")], dest="Archive",
                label="archived")
    _undo_entry([("INBOX", "<m3@shop.example>")], label="trashed")
    mailops.empty_trash(uv=1, max_uid=3)
    assert [(e["label"], e["count"]) for e in mailops.UNDO_LOG] == \
        [("archived", 1)]


def test_partial_failure_books_what_was_really_deleted(monkeypatch):
    fake = _bridge(monkeypatch, _trash_msgs(*range(1, 1202)))
    _undo_gone = [("INBOX", "<m1@shop.example>"),
                  ("INBOX", "<m500@shop.example>")]
    _undo_left = [("INBOX", "<m501@shop.example>"),
                  ("INBOX", "<m1201@shop.example>")]
    _undo_entry(_undo_gone + _undo_left, label="mixed")
    _undo_entry(_undo_gone, label="all-gone")
    orig = fake.uid
    stores = []

    def uid(cmd, *a):
        if cmd == "STORE":
            stores.append(1)
            if len(stores) == 2:
                return "NO", [b"denied"]
        return orig(cmd, *a)
    fake.uid = uid
    with pytest.raises(RuntimeError, match=code_re(
            mailops.DELETED_THEN_FAILED, n=500, cause=mailops.CANNOT_FLAG)):
        mailops.empty_trash(uv=1, max_uid=1201)
    assert _trash_uids(fake) == list(range(501, 1202))
    e = [e for e in auditlog.load("default", 0, 100)["entries"]
         if e["action"] == "empty_trash"]
    assert len(e) == 1 and e[0]["count"] == 500 \
        and e[0]["outcome"] == "partial"
    assert [(x["label"], x["items"]) for x in mailops.UNDO_LOG] == \
        [("mixed", _undo_left)]
    assert mailops.UNDO_LOG[0]["count"] == 2
    assert mailops.STATE["trash_count"] == 701


def test_undo_entries_of_purged_mail_are_pruned_others_kept(bridge):
    mailops.run_scan()
    mailops.delete_messages([["INBOX", 4]])
    wait_delete_done()
    mailops.delete_messages([["INBOX", 3]])
    wait_delete_done()
    assert len(mailops.UNDO_LOG) == 2
    # mail 3 left Trash by another client: only mail 4's entry is purged
    bridge.mailbox["Trash"] = [m for m in bridge.mailbox["Trash"]
                               if m["uid"] == 4]
    keep = [e for e in mailops.UNDO_LOG
            if all(i[1] != "<m4@shop.example>" for i in e["items"])]
    mailops.empty_trash(uv=1, max_uid=10_000)
    assert mailops.UNDO_LOG == keep and len(keep) == 1
    assert mailops.STATE["undo"] == [
        {"ts": keep[0]["ts"], "label": keep[0]["label"],
         "count": keep[0]["count"], "action": keep[0].get("action", "trash")}]


def test_failed_empty_keeps_the_undo_log(bridge, monkeypatch):
    mailops.run_scan()
    mailops.delete_messages([["INBOX", 4]])
    wait_delete_done()
    before = [dict(e) for e in mailops.UNDO_LOG]
    assert before
    orig = bridge.uid

    def uid(cmd, *a):
        if cmd == "STORE":
            return "NO", [b"denied"]
        return orig(cmd, *a)
    monkeypatch.setattr(bridge, "uid", uid)
    with pytest.raises(RuntimeError):
        mailops.empty_trash(uv=1, max_uid=10_000)
    assert mailops.UNDO_LOG == before
    assert len(mailops.STATE["undo"]) == len(before)
    assert len(bridge.mailbox["Trash"]) == 1
    assert not [e for e in auditlog.load("default", 0, 100)["entries"]
                if e["action"] == "empty_trash"]


def test_uidvalidity_refusal_keeps_the_undo_log(bridge):
    mailops.run_scan()
    mailops.delete_messages([["INBOX", 4]])
    wait_delete_done()
    bridge.uv["Trash"] = 5
    with pytest.raises(RuntimeError):
        mailops.empty_trash(uv=1, max_uid=4)
    assert len(mailops.UNDO_LOG) == 1


def test_audit_entry_is_written_with_the_deleted_count(monkeypatch):
    fake = _bridge(monkeypatch, _trash_msgs(3, 4))
    fake.mailbox["Trash"].append(make_msg(9))
    mailops.empty_trash(uv=1, max_uid=4)
    e = [e for e in auditlog.load("default", 0, 100)["entries"]
         if e["action"] == "empty_trash"]
    assert len(e) == 1 and e[0]["count"] == 2


# ------------------------------------------------- FakeIMAP realism (F8)

def test_fake_store_applies_flags_to_the_given_set_only():
    fake = FakeIMAP({"F": [make_msg(1), make_msg(2), make_msg(3)]})
    fake.select('"F"')
    fake.store("2", "+FLAGS", r"(\Deleted)")
    assert [m.get("deleted", False) for m in fake.mailbox["F"]] == \
        [False, True, False]
    fake.store("1:*", "+FLAGS", r"(\Deleted)")
    assert all(m["deleted"] for m in fake.mailbox["F"])
    fake.store("1:2", "-FLAGS", r"(\Deleted)")
    assert [m["deleted"] for m in fake.mailbox["F"]] == [False, False, True]


def test_fake_expunge_removes_only_deleted_mail():
    fake = FakeIMAP({"F": [make_msg(1), make_msg(2), make_msg(3)]})
    fake.select('"F"')
    fake.uid("STORE", "1,3", "+FLAGS", r"(\Deleted)")
    fake.expunge()
    assert [m["uid"] for m in fake.mailbox["F"]] == [2]


def test_fake_uid_expunge_needs_uidplus():
    fake = FakeIMAP({"F": [make_msg(1)]}, uidplus=False)
    fake.select('"F"')
    assert "UIDPLUS" not in fake.capabilities
    with pytest.raises(imaplib.IMAP4.error):
        fake.uid("EXPUNGE", "1")
