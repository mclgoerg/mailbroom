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
