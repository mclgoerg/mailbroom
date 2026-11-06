"""A failed Undo must keep its undo entry (in place, unchanged) so it can be
retried - whatever the failure was."""

import pytest

from backend import auditlog, mailops
from conftest import FakeIMAP, make_msg, wait_delete_done, wait_scan_done


def _trashed(monkeypatch, stub_rescan=True, **server):
    """Two mails of a sender moved to Trash; returns the fake server and the
    recorded undo entries. A restore starts a background rescan; it is
    stubbed unless a test is about it."""
    fake = FakeIMAP({
        "INBOX": [make_msg(1, frm="a@x.example"),
                  make_msg(2, frm="a@x.example"),
                  make_msg(3, frm="b@x.example")],
        "Trash": [],
    }, **server)
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    mailops.run_scan()
    mailops.delete_groups("sender", ["a@x.example"])
    assert wait_delete_done()["moved"] == 2
    assert len(mailops.STATE["undo"]) == 1
    if stub_rescan:
        monkeypatch.setattr(mailops, "_rescan_after_restore",
                            lambda *a, **k: False)
    return fake, [dict(e) for e in accounts_undo_log()]


def accounts_undo_log():
    return accounts_undo_log_acc().undo_log


def accounts_undo_log_acc():
    from backend import accounts
    return accounts.get()


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


def _drop_after(fake, monkeypatch, *cmds):
    """The connection dies right AFTER the server executed one of `cmds`
    (its reply is lost) - once."""
    real = fake.uid
    seen = {"n": 0}

    def uid(cmd, *args):
        out = real(cmd, *args)
        if cmd in cmds and not seen["n"]:
            seen["n"] += 1
            raise ConnectionResetError("reply lost")
        return out
    monkeypatch.setattr(fake, "uid", uid)
    return real


def _inbox_ids(fake):
    return sorted(m["msgid"] for m in fake.mailbox["INBOX"])


def test_a_retry_after_a_dropped_copy_does_not_restore_twice(monkeypatch):
    """No MOVE on the server: COPY ran, the connection died before the
    originals were flagged - copies sit in INBOX, originals in Trash."""
    fake, before = _trashed(monkeypatch, move=False, uidplus=False)
    ids_before = _inbox_ids(fake)
    real = _drop_after(fake, monkeypatch, "COPY")
    with pytest.raises(ConnectionResetError):
        mailops.undo_last()
    _assert_entry_kept(before)
    monkeypatch.setattr(fake, "uid", real)
    mailops.undo_last()
    assert len(_inbox_ids(fake)) == len(set(_inbox_ids(fake))) == 3
    assert not accounts_undo_log()
    assert ids_before != _inbox_ids(fake)          # sanity: mails came back


def test_a_retry_when_everything_was_restored_is_a_harmless_no_op(
        monkeypatch):
    """The server executed the MOVE, the reply was lost: the retry finds
    nothing to do, consumes the entry and tells the user to rescan."""
    fake, before = _trashed(monkeypatch, stub_rescan=False)
    real = _drop_after(fake, monkeypatch, "MOVE", "COPY")
    with pytest.raises(ConnectionResetError):
        mailops.undo_last()
    wait_scan_done()                         # the rescan of what did move
    monkeypatch.setattr(fake, "uid", real)
    res = mailops.undo_last()
    assert res == {"restored": 0, "of": 2, "rescan": False}
    assert not accounts_undo_log() and not mailops.STATE["undo"]
    assert mailops.STATE["notice"]["key"] == "restored_rescan"
    assert len(fake.mailbox["INBOX"]) == 3 and fake.mailbox["Trash"] == []


def test_a_failed_undo_is_audited_as_a_code_and_an_error(monkeypatch):
    fake, _ = _trashed(monkeypatch)

    def down(cfg, name=None):
        raise ConnectionRefusedError(111, "refused by secret-host.example")
    monkeypatch.setattr(mailops, "connect", down)
    with pytest.raises(ConnectionRefusedError):
        mailops.undo_last()
    e = [e for e in auditlog.load("default", 0, 100)["entries"]
         if e["action"] == "undo"][0]
    assert e["outcome"] == "error"
    assert "secret-host" not in e["error"] and "refused by" not in e["error"]


def test_the_rescan_after_a_partial_failure_still_runs(monkeypatch):
    """One chunk restored, then the connection drops: the mail that did
    move is rescanned in (real rescan, not the stub)."""
    fake, before = _trashed(monkeypatch, stub_rescan=False)
    monkeypatch.setattr(mailops, "MOVE_CHUNK", 1)
    real = fake.uid
    seen = {"n": 0}

    def uid(cmd, *args):
        if cmd in ("COPY", "MOVE"):
            seen["n"] += 1
            if seen["n"] == 2:
                raise ConnectionResetError("dropped")
        return real(cmd, *args)
    monkeypatch.setattr(fake, "uid", uid)
    with pytest.raises(ConnectionResetError):
        mailops.undo_last()
    st = wait_scan_done()
    assert st["status"] == "done"
    assert st["notice"]["key"] == "restored"
    assert st["notice"]["params"]["restored"] == 1
    _assert_entry_kept(before)


def test_reinsertion_survives_a_changed_list(monkeypatch):
    """Entries trimmed/added while the IMAP work ran: the entry goes back
    into its timestamp slot and the list stays within UNDO_MAX."""
    fake, _ = _trashed(monkeypatch)
    log = accounts_undo_log()
    entry = log.pop()
    log[:] = [{**entry, "ts": entry["ts"] - 5, "label": "older"},
              {**entry, "ts": entry["ts"] + 5, "label": "newer"}]
    mailops._reinsert_undo(accounts_undo_log_acc(), entry, 0)
    assert [e["label"] for e in log] == ["older", entry["label"], "newer"]
    monkeypatch.setattr(mailops, "UNDO_MAX", 3)
    mailops._reinsert_undo(accounts_undo_log_acc(), {**entry, "ts": 0}, 99)
    assert len(log) == 3


@pytest.mark.parametrize("failure", ["no", "bad"])
def test_a_failing_message_id_verification_keeps_the_entry(monkeypatch,
                                                           failure):
    import imaplib
    fake, before = _trashed(monkeypatch)
    real = fake.uid
    broken = {"on": True}

    def flaky(cmd, *args):
        if broken["on"] and cmd == "FETCH" and "MESSAGE-ID" in args[1] \
                and "FLAGS" not in args[1]:
            if failure == "bad":
                raise imaplib.IMAP4.error("FETCH BAD")
            return "NO", [b"[UNAVAILABLE] try later"]
        return real(cmd, *args)

    fake.uid = flaky
    with pytest.raises(imaplib.IMAP4.error):
        mailops.undo_last()
    _assert_entry_kept(before)
    assert len(fake.mailbox["Trash"]) == 2 and not fake.mailbox["INBOX"][1:]
    broken["on"] = False                                 # server recovers
    assert mailops.undo_last()["restored"] == 2
    assert not accounts_undo_log()
    assert sorted(m["uid"] for m in fake.mailbox["INBOX"]) == [1, 2, 3]
    assert not fake.mailbox["Trash"]


def test_a_failing_message_id_search_keeps_the_entry(monkeypatch):
    fake, before = _trashed(monkeypatch)
    real = fake.uid
    broken = {"on": True}

    def flaky(cmd, *args):
        if broken["on"] and cmd == "SEARCH" and "HEADER" in args:
            return "NO", [b"[UNAVAILABLE] try later"]
        return real(cmd, *args)

    fake.uid = flaky
    with pytest.raises(Exception):
        mailops.undo_last()
    _assert_entry_kept(before)
    broken["on"] = False
    assert mailops.undo_last()["restored"] == 2
