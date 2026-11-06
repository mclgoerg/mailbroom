"""Moving mail on a server with neither MOVE nor UIDPLUS must never purge
what ANOTHER client only flagged \\Deleted in the same folder."""

import pytest

from backend import mailops
from conftest import FakeIMAP, make_msg, wait_delete_done


def _server(monkeypatch, foreign: bool, **kw):
    kw = {"move": False, "uidplus": False, **kw}
    fake = FakeIMAP({
        "INBOX": [make_msg(1, frm="a@x.example"),
                  make_msg(2, frm="a@x.example"),
                  make_msg(3, frm="friend@x.example")],
        "Trash": [],
    }, **kw)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    if foreign:                  # another client flags a mail afterwards
        fake.mailbox["INBOX"][2]["deleted"] = True
    return fake


def test_foreign_deleted_mail_survives_and_the_move_stops(monkeypatch):
    fake = _server(monkeypatch, foreign=True)
    mailops.delete_groups("sender", ["a@x.example"])
    st = wait_delete_done()
    assert st["error"].startswith(mailops.MOVE_FOREIGN_DELETED)
    inbox = {m["uid"]: m for m in fake.mailbox["INBOX"]}
    assert set(inbox) == {1, 2, 3}                 # nothing was purged
    assert inbox[3]["deleted"] is True             # their flag is untouched
    assert not inbox[1].get("deleted") and not inbox[2].get("deleted")
    # the copies already made stay (not identifiable without UIDPLUS)
    assert len(fake.mailbox["Trash"]) == 2


def test_our_move_still_works_when_nothing_else_is_flagged(monkeypatch):
    fake = _server(monkeypatch, foreign=False)
    mailops.delete_groups("sender", ["a@x.example"])
    st = wait_delete_done()
    assert st["moved"] == 2 and not st["error"]
    assert [m["uid"] for m in fake.mailbox["INBOX"]] == [3]
    assert len(fake.mailbox["Trash"]) == 2


def test_with_uidplus_foreign_deleted_is_never_touched(monkeypatch):
    fake = _server(monkeypatch, foreign=True, uidplus=True)
    mailops.delete_groups("sender", ["a@x.example"])
    st = wait_delete_done()
    assert st["moved"] == 2 and not st["error"]
    assert [m["uid"] for m in fake.mailbox["INBOX"]] == [3]
    assert fake.mailbox["INBOX"][0]["deleted"] is True


def test_a_failed_search_counts_as_foreign(monkeypatch):
    fake = _server(monkeypatch, foreign=False)
    real = fake.uid

    def uid(cmd, *args):
        if cmd == "SEARCH" and args[-1] == "DELETED":
            return "NO", [b"nope"]
        return real(cmd, *args)
    monkeypatch.setattr(fake, "uid", uid)
    mailops.delete_groups("sender", ["a@x.example"])
    st = wait_delete_done()
    assert st["error"].startswith(mailops.MOVE_FOREIGN_DELETED)
    assert len(fake.mailbox["INBOX"]) == 3


@pytest.mark.parametrize("text,expected", [
    ("1,2,5:7", {1, 2, 5, 6, 7}), ("4", {4}), ("1:*", None), ("x", None)])
def test_uid_set_parsing(text, expected):
    assert mailops._uid_numbers(text) == expected


# --------------------------------------------- Undo / restore from Trash

def _deleted_then_foreign_flag(monkeypatch):
    """Our delete works (nothing foreign flagged in INBOX); afterwards another
    client flags a mail of its own in Trash."""
    fake = FakeIMAP({
        "INBOX": [make_msg(1, frm="a@x.example"),
                  make_msg(2, frm="a@x.example")],
        "Trash": [make_msg(90, frm="old@x.example")],
    }, move=False, uidplus=False)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    mailops.delete_groups("sender", ["a@x.example"])
    assert wait_delete_done()["moved"] == 2
    fake.mailbox["Trash"][0]["deleted"] = True        # theirs
    return fake


def _flag_theirs_after_first_move(fake, monkeypatch):
    """Another client flags its own Trash mail while our job is running:
    the first chunk moves fine, the second one is refused.

    Returns the list of restore-rescans requested. A restore starts a
    background rescan whose result overwrites `trash_count` with the real
    folder count at some point; it is stubbed out so the assertions on the
    restore's own bookkeeping don't race that thread."""
    monkeypatch.setattr(mailops, "MOVE_CHUNK", 1)
    rescans = []
    monkeypatch.setattr(mailops, "_rescan_after_restore",
                        lambda acc, restored, key, params:
                        rescans.append(restored) or True)
    real = fake.uid
    state = {"copies": 0}

    def uid(cmd, *args):
        if cmd == "COPY":
            state["copies"] += 1
            if state["copies"] == 2:
                fake.mailbox["Trash"][0]["deleted"] = True
        return real(cmd, *args)
    monkeypatch.setattr(fake, "uid", uid)
    return rescans


def test_a_refused_undo_keeps_its_undo_entry(monkeypatch):
    fake = _deleted_then_foreign_flag(monkeypatch)
    fake.mailbox["Trash"][0]["deleted"] = False
    assert len(mailops.STATE["undo"]) == 1
    rescans = _flag_theirs_after_first_move(fake, monkeypatch)
    before = mailops.STATE["trash_count"]
    with pytest.raises(RuntimeError) as exc:
        mailops.undo_last()
    assert str(exc.value) == "move_foreign_deleted:folder=Trash"
    assert rescans == [1]                 # the mail that moved is rescanned
    assert len(mailops.STATE["undo"]) == 1           # can be tried again
    # one mail is back; the refused one was copied but its original stays
    trash = {m["uid"]: m for m in fake.mailbox["Trash"]}
    assert set(trash) == {2, 90} and not trash[2].get("deleted")
    assert trash[90]["deleted"] is True                       # theirs stays
    assert before is not None
    assert mailops.STATE["trash_count"] == before - 1  # bookkeeping still ran
    # the other program expunges; the retry restores the rest
    fake.mailbox["Trash"] = [m for m in fake.mailbox["Trash"]
                             if m["uid"] != 90]


def test_a_refused_trash_restore_still_runs_its_bookkeeping(monkeypatch):
    fake = _deleted_then_foreign_flag(monkeypatch)
    fake.mailbox["Trash"][0]["deleted"] = False
    mailops.STATE["trash_count"] = 3
    uids = [m["uid"] for m in fake.mailbox["Trash"] if m["uid"] != 90]
    _flag_theirs_after_first_move(fake, monkeypatch)
    with pytest.raises(RuntimeError) as exc:
        mailops.trash_restore(uids, "INBOX")
    assert str(exc.value) == "move_foreign_deleted:folder=Trash"
    assert mailops.STATE["trash_count"] == 2          # the one that moved
    assert 90 in {m["uid"] for m in fake.mailbox["Trash"]}
