"""Role indexes: Trash keeps an incremental cache of its own (flags-only
refresh for known UIDs, header fetch only for new ones, UIDVALIDITY change
rebuilds) that never touches the main scan index, survives restarts in the
snapshot (v3, v2 still loads) and stays consistent across restore / empty /
undo."""

import json

import pytest

from backend import accounts as accountsmod
from backend import mailops
from conftest import FakeIMAP, make_msg


def _trash(*uids):
    return [make_msg(u, frm=f"s{u % 3}@gone.example", subject=f"Old {u}",
                     date=f"{u:02d}-Jan-2026 10:00:00 +0000") for u in uids]


class Spy:
    """Counts FETCHes: header fetches (full metadata) vs flags-only."""

    def __init__(self, fake):
        self.header_uids: list[int] = []
        self.flag_uids: list[int] = []
        orig = fake.uid

        def uid(cmd, *args):
            if cmd == "FETCH":
                uids = [int(u) for u in args[0].split(",")]
                (self.flag_uids if args[1] == "(UID FLAGS)"
                 else self.header_uids).extend(uids)
            return orig(cmd, *args)
        fake.uid = uid

    def reset(self):
        self.header_uids.clear()
        self.flag_uids.clear()


@pytest.fixture
def env(monkeypatch):
    fake = FakeIMAP({"INBOX": [make_msg(1), make_msg(2, msgid="<k@a.example>")],
                     "Trash": _trash(3, 4, 5), "Sent": []})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    return fake, Spy(fake)


def _reference(fake):
    """What the old code returned: a full header fetch of the whole folder."""
    msgs: list = []
    mailops.scan_folder(fake, "Trash", msgs, lambda *a: None,
                        index={}, uv={})
    msgs.sort(key=lambda m: -m["ts"])
    return [m["uid"] for m in msgs], [(m["uid"], m["seen"], m["subject"])
                                      for m in msgs]


def test_first_open_fetches_all_then_only_new_uids(env):
    fake, spy = env
    r = mailops.trash_list()
    assert r["total"] == 3 and spy.header_uids == [3, 4, 5]
    assert spy.flag_uids == []
    spy.reset()

    r = mailops.trash_list()                       # nothing new
    assert spy.header_uids == [] and sorted(spy.flag_uids) == [3, 4, 5]
    assert r["total"] == 3

    fake.mailbox["Trash"].append(make_msg(6, subject="Arrived"))
    spy.reset()
    r = mailops.trash_list()
    assert spy.header_uids == [6]                  # only the new one
    assert sorted(spy.flag_uids) == [3, 4, 5]
    assert r["total"] == 4 and r["max_uid"] == 6


def test_flag_change_picked_up_without_header_fetch(env):
    fake, spy = env
    mailops.trash_list()
    fake.mailbox["Trash"][0]["seen"] = True
    spy.reset()
    r = mailops.trash_list()
    assert spy.header_uids == []
    assert {m["uid"]: m["seen"] for m in r["mails"]}[3] is True


def test_uidvalidity_change_rebuilds(env):
    fake, spy = env
    mailops.trash_list()
    fake.uv["Trash"] = 7
    fake.mailbox["Trash"] = _trash(3, 40)          # new generation, UID 3 reused
    fake.mailbox["Trash"][0]["subject"] = "Different mail"
    spy.reset()
    r = mailops.trash_list()
    assert sorted(spy.header_uids) == [3, 40] and spy.flag_uids == []
    assert r["uv"] == 7
    assert {m["uid"]: m["subject"] for m in r["mails"]}[3] == "Different mail"
    assert mailops.accounts.get().role_uv["trash"] == {"Trash": 7}


def test_vanished_uids_are_dropped(env):
    fake, _ = env
    mailops.trash_list()
    fake.mailbox["Trash"] = [m for m in fake.mailbox["Trash"]
                             if m["uid"] != 4]     # purged by the provider
    r = mailops.trash_list()
    assert r["total"] == 2
    assert {m["uid"] for m in mailops.role_mails("trash")} == {3, 5}
    assert r["max_uid"] == 5 and mailops.STATE["trash_count"] == 2
    fake.mailbox["Trash"] = []
    assert mailops.trash_list()["total"] == 0
    assert mailops.role_mails("trash") == []


def test_max_uid_reflects_the_refresh_not_the_cache(env):
    fake, _ = env
    mailops.trash_list()
    fake.mailbox["Trash"] = [m for m in fake.mailbox["Trash"]
                             if m["uid"] != 5]     # highest UID vanished
    r = mailops.trash_list()
    assert r["max_uid"] == 4 and r["total"] == 2


def test_listing_equals_old_full_fetch(env):
    fake, _ = env
    for step in range(4):
        r = mailops.trash_list()
        uids, rows = _reference(fake)
        assert [m["uid"] for m in r["mails"]] == uids
        assert [(m["uid"], m["seen"], m["subject"]) for m in r["mails"]] \
            == rows
        assert r["total"] == len(uids)
        assert r["max_uid"] == max(uids, default=0)
        # mutate for the next round: add, flag, remove
        if step == 0:
            fake.mailbox["Trash"].append(make_msg(9, subject="New", size=77))
        elif step == 1:
            fake.mailbox["Trash"][0]["seen"] = True
        elif step == 2:
            fake.mailbox["Trash"].pop(1)


def test_main_scan_numbers_unchanged(env):
    fake, _ = env
    mailops.run_scan()
    before = (dict(mailops.INDEX), mailops.index_stats(accountsmod.get()),
              dict(mailops.FOLDER_UV))
    mailops.trash_list()
    acc = accountsmod.get()
    assert (dict(mailops.INDEX), mailops.index_stats(acc),
            dict(mailops.FOLDER_UV)) == before
    assert not any(m["folder"] == "Trash" for m in mailops.INDEX.values())
    assert "Trash" not in mailops.FOLDER_UV
    mailops.run_scan()                              # role index survives scans
    assert {m["uid"] for m in mailops.role_mails("trash")} == {3, 4, 5}
    assert not any(m["folder"] == "Trash" for m in mailops.INDEX.values())


# -------------------------------------------------------------- snapshot

def test_snapshot_round_trip_keeps_the_role_index(env):
    fake, spy = env
    mailops.run_scan()
    mailops.trash_list()
    acc = accountsmod.get()
    saved = json.loads(mailops._snap_path(acc.name).read_text())
    assert saved["version"] == 3
    assert {m["uid"] for m in saved["role_index"]["trash"]} == {3, 4, 5}
    assert saved["role_uv"] == {"trash": {"Trash": 1}}

    accountsmod.reset()                             # "restart"
    acc2 = accountsmod.get()
    assert mailops.load_snapshot(acc2) is True
    assert acc2.role_index == acc.role_index and acc2.role_uv == acc.role_uv
    spy.reset()
    r = mailops.trash_list(acc=acc2)
    assert spy.header_uids == []                    # nothing refetched
    assert r["total"] == 3


def test_snapshot_v2_loads_with_empty_role_indexes(env):
    fake, spy = env
    mailops.run_scan()
    acc = accountsmod.get()
    path = mailops._snap_path(acc.name)
    data = json.loads(path.read_text())
    data["version"] = 2
    data.pop("role_index", None)
    data.pop("role_uv", None)
    path.write_text(json.dumps(data))

    accountsmod.reset()
    acc2 = accountsmod.get()
    assert mailops.load_snapshot(acc2) is True
    assert acc2.state["status"] == "done" and len(acc2.index) == 2
    assert acc2.role_index == {} and acc2.role_uv == {}
    spy.reset()
    r = mailops.trash_list(acc=acc2)                # first open: full fetch
    assert r["total"] == 3 and sorted(spy.header_uids) == [3, 4, 5]
    assert json.loads(path.read_text())["version"] == 3    # next save is v3


def test_unknown_snapshot_version_is_ignored(env):
    mailops.run_scan()
    acc = accountsmod.get()
    path = mailops._snap_path(acc.name)
    data = json.loads(path.read_text())
    data["version"] = 99
    path.write_text(json.dumps(data))
    accountsmod.reset()
    assert mailops.load_snapshot(accountsmod.get()) is False


def test_malformed_role_index_does_not_cost_the_main_snapshot(env):
    mailops.run_scan()
    acc = accountsmod.get()
    path = mailops._snap_path(acc.name)
    data = json.loads(path.read_text())
    data["role_index"] = {"trash": [{"nonsense": 1}]}
    path.write_text(json.dumps(data))
    accountsmod.reset()
    acc2 = accountsmod.get()
    assert mailops.load_snapshot(acc2) is True
    assert len(acc2.index) == 2 and acc2.role_index == {}


def test_open_with_no_change_does_not_rewrite_the_snapshot(env):
    mailops.run_scan()
    mailops.trash_list()
    acc = accountsmod.get()
    path = mailops._snap_path(acc.name)
    path.write_text(path.read_text() + " ")         # marker
    size = path.stat().st_size
    mailops.trash_list()                            # unchanged -> no save
    assert path.stat().st_size == size


# ------------------------------------------------- moves out of Trash

def test_restore_and_empty_keep_the_index_consistent(env):
    fake, spy = env
    r = mailops.trash_list()
    mailops.trash_restore([3], "INBOX", uv=r["uv"])
    assert {m["uid"] for m in mailops.role_mails("trash")} == {4, 5}
    spy.reset()
    r = mailops.trash_list()
    assert spy.header_uids == [] and r["total"] == 2

    fake.mailbox["Trash"].append(make_msg(6, subject="Later"))
    mailops.empty_trash(uv=r["uv"], max_uid=r["max_uid"])
    assert [m["uid"] for m in fake.mailbox["Trash"]] == [6]
    assert mailops.role_mails("trash") == []
    r = mailops.trash_list()
    assert [m["uid"] for m in r["mails"]] == [6]


def test_partial_empty_failure_drops_only_what_was_deleted(env, monkeypatch):
    fake, _ = env
    monkeypatch.setattr(mailops, "MOVE_CHUNK", 1)
    r = mailops.trash_list()
    orig = fake.uid

    def flaky(cmd, *a):
        if cmd == "EXPUNGE" and a[0] == "4":
            raise RuntimeError("connection lost")
        return orig(cmd, *a)
    fake.uid = flaky
    with pytest.raises(RuntimeError):
        mailops.empty_trash(uv=r["uv"], max_uid=r["max_uid"])
    assert {m["uid"] for m in mailops.role_mails("trash")} == {4, 5}


def test_undo_restore_out_of_trash_updates_the_index(env):
    fake, _ = env
    acc = accountsmod.get()
    mailops.run_scan()
    mailops.trash_list()
    # as if a delete job had moved INBOX mail 1 into Trash
    moved = fake.mailbox["INBOX"].pop(0)
    moved["uid"] = 50
    fake.mailbox["Trash"].append(moved)
    acc.undo_log.append({"label": "x", "count": 1, "target": "Trash",
                         "in": "Trash", "items": [("INBOX", moved["msgid"])],
                         "ts": 0})
    mailops.trash_list()
    assert 50 in {m["uid"] for m in mailops.role_mails("trash")}
    assert mailops.undo_last()["restored"] == 1
    assert 50 not in {m["uid"] for m in mailops.role_mails("trash")}


def test_role_accessors_are_generic(env):
    acc = accountsmod.get()
    assert mailops.role_mails("junk") == []
    assert mailops.role_uvalidity("junk", "Spam") == 0
    mailops.role_drop("junk", "Spam", [1, 2])       # no-op, no error
    assert acc.role_index.get("junk", {}) == {}
