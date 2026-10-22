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
    # restore starts a background rescan on the shared fake connection, which
    # would race with the FETCH counting; no test here is about it
    monkeypatch.setattr(mailops, "_rescan_after_restore",
                        lambda *a, **k: False)
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
    assert accountsmod.get().role_uv["trash"] == {"Trash": 7}


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
    acc = accountsmod.get()

    def numbers():
        g = mailops.STATE["groups"]
        return (dict(mailops.INDEX), mailops.index_stats(acc),
                dict(mailops.FOLDER_UV),
                {k: {a: (r["count"], r["size"], r["unread"])
                     for a, r in recs.items()} for k, recs in g.items()})

    before = numbers()
    mailops.trash_list()
    assert numbers() == before
    assert not any(m["folder"] == "Trash" for m in mailops.INDEX.values())
    assert "Trash" not in mailops.FOLDER_UV
    mailops.run_scan()                              # role index survives scans
    assert numbers() == before
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
    assert len(acc2.index) == 2 and not any(acc2.role_index.values())


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


# ------------------------------------------------ safety / failure paths

def test_returned_uv_belongs_to_its_own_listing(env):
    """Two concurrent opens: the uv sent back with a listing must be the one
    that very refresh read, not whatever the cache holds by then."""
    fake, _ = env
    orig = fake.uid
    inner = {}

    def uid(cmd, *args):
        if cmd == "FETCH" and "done" not in inner:
            inner["done"] = True
            fake.uv["Trash"] = 2                   # a second tab, new generation
            fake.mailbox["Trash"] = _trash(60, 61)
            inner["b"] = mailops.trash_list()
            fake.uv["Trash"] = 1
        return orig(cmd, *args)
    fake.uid = uid
    a = mailops.trash_list()
    assert inner["b"]["uv"] == 2 and inner["b"]["max_uid"] == 61
    assert a["uv"] == 1                            # A read uv 1 itself
    assert accountsmod.get().role_uv["trash"] == {"Trash": 1}


def test_role_state_is_one_consistent_pair(env):
    fake, _ = env
    mailops.trash_list()
    uv, mails = mailops.role_state("trash", "Trash")
    assert uv == 1 and {m["uid"] for m in mails} == {3, 4, 5}
    assert mailops.role_state("junk", "Spam") == (0, [])


def test_role_of_folder_is_generic(env):
    acc = accountsmod.get()
    mailops.trash_list()
    assert mailops.role_of_folder(acc, "Trash") == "trash"
    assert mailops.role_of_folder(acc, "INBOX") is None


def test_aborted_refresh_leaves_cache_and_uv_untouched(env):
    fake, _ = env
    mailops.trash_list()
    acc = accountsmod.get()
    snap = ({k: dict(v) for k, v in acc.role_index["trash"].items()},
            dict(acc.role_uv["trash"]))
    fake.uv["Trash"] = 5                           # would rebuild ...
    orig = fake.uid

    def boom(cmd, *a):
        if cmd == "FETCH":
            raise OSError("connection reset")      # ... but dies midway
        return orig(cmd, *a)
    fake.uid = boom
    with pytest.raises(OSError):
        mailops.trash_list()
    assert (acc.role_index["trash"], acc.role_uv["trash"]) == snap


def test_failed_flags_fetch_keeps_cached_records(env):
    fake, _ = env
    mailops.trash_list()
    orig = fake.uid

    def uid(cmd, *a):
        if cmd == "FETCH" and a[1] == "(UID FLAGS)":
            return "NO", [b""]
        return orig(cmd, *a)
    fake.uid = uid
    r = mailops.trash_list()
    assert r["total"] == 3 and r["max_uid"] == 5
    assert {m["uid"] for m in mailops.role_mails("trash")} == {3, 4, 5}


def test_failed_search_lists_nothing_and_empty_does_nothing(env):
    fake, _ = env
    mailops.trash_list()
    orig = fake.uid

    def uid(cmd, *a):
        if cmd == "SEARCH" and a[-1] == "ALL" and fake.selected == "Trash":
            return "NO", [b""]
        return orig(cmd, *a)
    fake.uid = uid
    r = mailops.trash_list()
    assert r["total"] == 0 and r["max_uid"] == 0
    assert mailops.empty_trash(uv=r["uv"], max_uid=r["max_uid"]) \
        == {"deleted": 0}
    assert [m["uid"] for m in fake.mailbox["Trash"]] == [3, 4, 5]


def test_partial_restore_failure_keeps_the_index_consistent(env, monkeypatch):
    fake, _ = env
    monkeypatch.setattr(mailops, "MOVE_CHUNK", 1)
    r = mailops.trash_list()
    orig = fake.uid

    def uid(cmd, *a):
        if cmd == "MOVE" and a[0] == "4":
            return "NO", [b""]
        return orig(cmd, *a)
    fake.uid = uid
    res = mailops.trash_restore([3, 4, 5], "INBOX", uv=r["uv"])
    assert res["restored"] == 2
    assert [m["uid"] for m in fake.mailbox["Trash"]] == [4]
    assert {m["uid"] for m in mailops.role_mails("trash")} == {4}


def test_incomplete_role_record_is_dropped_by_the_loader(env):
    mailops.run_scan()
    mailops.trash_list()
    acc = accountsmod.get()
    path = mailops._snap_path(acc.name)
    data = json.loads(path.read_text())
    del data["role_index"]["trash"][0]["ts"]       # has folder + uid only
    gone = data["role_index"]["trash"][0]["uid"]
    path.write_text(json.dumps(data))
    accountsmod.reset()
    acc2 = accountsmod.get()
    assert mailops.load_snapshot(acc2) is True
    assert gone not in {m["uid"] for m in mailops.role_mails("trash", acc2)}
    r = mailops.trash_list(acc=acc2)               # sorts fine, refetches it
    assert r["total"] == 3


def test_role_index_reads_the_resolved_folder_never_a_look_alike(monkeypatch):
    fake = FakeIMAP({"INBOX": [make_msg(1)], "Bin": _trash(3, 4),
                     "Trash": _trash(70, 71), "Sent": []},
                    flags={"Bin": "\\Trash"})
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    r = mailops.trash_list()
    assert r["folder"] == "Bin" and [m["uid"] for m in r["mails"]] == [4, 3]
    assert {m["folder"] for m in mailops.role_mails("trash")} == {"Bin"}
