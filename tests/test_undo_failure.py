"""A failed Undo must keep its undo entry (in place, unchanged) so it can be
retried - whatever the failure was."""

import pytest

from backend import mailops
from conftest import FakeIMAP, make_msg, wait_delete_done


def _trashed(monkeypatch):
    """Two mails of a sender moved to Trash; returns the fake server and the
    recorded undo entry."""
    fake = FakeIMAP({
        "INBOX": [make_msg(1, frm="a@x.example"),
                  make_msg(2, frm="a@x.example"),
                  make_msg(3, frm="b@x.example")],
        "Trash": [],
    })
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    mailops.delete_groups("sender", ["a@x.example"])
    assert wait_delete_done()["moved"] == 2
    assert len(mailops.STATE["undo"]) == 1
    # a restore starts a background rescan; not what these tests are about
    monkeypatch.setattr(mailops, "_rescan_after_restore",
                        lambda *a, **k: False)
    return fake, [dict(e) for e in accounts_undo_log()]


def accounts_undo_log():
    from backend import accounts
    return accounts.get().undo_log


def _assert_entry_kept(before):
    assert accounts_undo_log() == before
    assert len(mailops.STATE["undo"]) == 1


def test_a_failed_connect_keeps_the_undo_entry(monkeypatch):
    fake, before = _trashed(monkeypatch)

    def down(cfg, name=None):
        raise OSError("connection refused")
    monkeypatch.setattr(mailops, "connect", down)
    with pytest.raises(OSError):
        mailops.undo_last()
    _assert_entry_kept(before)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    assert mailops.undo_last()["restored"] == 2          # the retry works
    assert not accounts_undo_log()


def test_an_unopenable_trash_keeps_the_undo_entry(monkeypatch):
    fake, before = _trashed(monkeypatch)
    fake.noselect["Trash"] = "\\Noselect"
    with pytest.raises(RuntimeError) as exc:
        mailops.undo_last()
    assert str(exc.value).startswith(mailops.CANNOT_OPEN)
    _assert_entry_kept(before)
    fake.noselect.clear()
    assert mailops.undo_last()["restored"] == 2


def test_a_missing_trash_role_keeps_the_undo_entry(monkeypatch):
    fake, before = _trashed(monkeypatch)
    accounts_undo_log()[0]["in"] = ""            # target not recorded
    before = [dict(e) for e in accounts_undo_log()]
    monkeypatch.setattr(mailops, "folder_roles", lambda conn, acc: {})
    with pytest.raises(RuntimeError) as exc:
        mailops.undo_last()
    assert str(exc.value).startswith(mailops.ROLE_MISSING)
    _assert_entry_kept(before)


def test_an_unexpected_error_mid_restore_keeps_the_entry_and_the_rest(
        monkeypatch):
    """A dropped connection after the first chunk: the mail that moved is
    back, the entry stays, and the retry restores only the other one."""
    fake, before = _trashed(monkeypatch)
    monkeypatch.setattr(mailops, "MOVE_CHUNK", 1)
    real = fake.uid
    seen = {"copies": 0}

    def uid(cmd, *args):
        if cmd in ("COPY", "MOVE"):
            seen["copies"] += 1
            if seen["copies"] == 2:
                raise OSError("connection reset")
        return real(cmd, *args)
    monkeypatch.setattr(fake, "uid", uid)
    with pytest.raises(OSError):
        mailops.undo_last()
    _assert_entry_kept(before)
    assert len(fake.mailbox["Trash"]) == 1               # one is back
    monkeypatch.setattr(fake, "uid", real)
    assert mailops.undo_last()["restored"] == 1          # only the rest
    assert fake.mailbox["Trash"] == []
    assert not accounts_undo_log()


def test_a_refused_undo_still_keeps_its_entry_in_position(monkeypatch):
    """Two entries; undoing the older one (by index) fails: both stay, in
    the same order."""
    fake, before = _trashed(monkeypatch)
    mailops.delete_groups("sender", ["b@x.example"])
    wait_delete_done()
    entries = [dict(e) for e in accounts_undo_log()]
    assert len(entries) == 2
    fake.noselect["Trash"] = "\\Noselect"
    with pytest.raises(RuntimeError):
        mailops.undo_last(index=0)
    assert accounts_undo_log() == entries
