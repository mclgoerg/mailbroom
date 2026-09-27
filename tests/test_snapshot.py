"""Scan snapshot persistence: restarts restore the last scan per account,
the slim SSE payload carries no groups, and groups_rev moves whenever the
group lists change so clients know when to refetch."""

import json

from backend import accounts as accountsmod
from backend import mailops, verdictstore
from conftest import FakeIMAP, make_msg, wait_delete_done


def test_snapshot_survives_restart(bridge):
    mailops.run_scan()
    acc = accountsmod.get()
    path = mailops._snap_path(acc.name)
    assert path.exists() and path.stat().st_mode & 0o777 == 0o600
    before = mailops.public_state(acc)

    # "restart": fresh registry, load from disk
    accountsmod.reset()
    acc2 = accountsmod.get()
    assert mailops.load_snapshot(acc2) is True
    after = mailops.public_state(acc2)
    assert after["status"] == "done"
    assert after["scanned_ts"] and after["scanned_ts"] == before["scanned_ts"]
    assert after["groups"]["sender"].keys() == before["groups"]["sender"].keys()
    assert after["trash_count"] == before["trash_count"]
    # stats work immediately from the restored index
    assert mailops.index_stats(acc2)["mails"] == 5


def test_snapshot_restore_reapplies_verdicts_and_allows_actions(bridge):
    mailops.run_scan()
    verdictstore.save("sender", {"noreply@dhl.example":
                                 {"verdict": "delete_safe", "reason": "r"}})
    accountsmod.reset()
    acc = accountsmod.get()
    assert mailops.load_snapshot(acc)
    g = mailops.public_state(acc)["groups"]["sender"]["noreply@dhl.example"]
    assert g["ai"] and g["ai"]["verdict"] == "delete_safe"

    # deleting from restored (unscanned) state works — UIDVALIDITY matches
    mailops.delete_groups("sender", ["noreply@dhl.example"], acc=acc)
    wait_delete_done()
    assert len(bridge.mailbox["Trash"]) == 3
    # ... and the snapshot on disk was updated by the delete worker
    accountsmod.reset()
    acc2 = accountsmod.get()
    assert mailops.load_snapshot(acc2)
    assert "noreply@dhl.example" not in \
        mailops.public_state(acc2)["groups"]["sender"]


def test_snapshot_never_clobbers_live_state(bridge):
    mailops.run_scan()
    acc = accountsmod.get()
    # already-scanned account: loading again must be a no-op
    assert mailops.load_snapshot(acc) is False


def test_snapshot_rename_and_drop(bridge):
    mailops.run_scan()
    acc = accountsmod.get()
    mailops.rename_snapshot(acc.name, "renamed")
    assert not mailops._snap_path(acc.name).exists()
    npath = mailops._snap_path("renamed")
    assert json.loads(npath.read_text())["account"] == "renamed"
    mailops.drop_snapshot("renamed")
    assert not npath.exists()
    mailops.drop_snapshot("renamed")            # idempotent


def test_public_status_is_slim_and_rev_moves(bridge):
    acc = accountsmod.get()
    rev0 = mailops.public_status(acc)["groups_rev"]
    mailops.run_scan()
    slim = mailops.public_status(acc)
    assert "groups" not in slim
    assert slim["status"] == "done" and slim["account"] == acc.name
    assert slim["groups_rev"] > rev0
    # a delete bumps it again
    rev1 = slim["groups_rev"]
    mailops.delete_groups("sender", ["alice@friends.example"])
    wait_delete_done()
    assert mailops.public_status(acc)["groups_rev"] > rev1
    # a no-change status snapshot doesn't
    assert mailops.public_status(acc)["groups_rev"] == \
        mailops.public_status(acc)["groups_rev"]


def test_corrupt_snapshot_is_ignored(bridge, tmp_path):
    acc = accountsmod.get()
    mailops.SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    mailops._snap_path(acc.name).write_text("{not json")
    assert mailops.load_snapshot(acc) is False
    mailops._snap_path(acc.name).write_text(json.dumps({"version": 99}))
    assert mailops.load_snapshot(acc) is False
