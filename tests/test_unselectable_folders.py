"""Folders the server marks \\Noselect / \\NonExistent (Gmail's "[Gmail]"
parent) can't hold mail: never offered, scanned, a role or a move target."""

import pytest
from fastapi.testclient import TestClient

from backend import mailops
from backend.main import app
from conftest import FakeIMAP, code_re, make_msg

client = TestClient(app)


def _box(*names: str) -> dict[str, list[dict]]:
    return {f: [make_msg(1, frm=f"s{n}@shop{n}.example")]
            for n, f in enumerate(names)}


def _use(monkeypatch, fake: FakeIMAP) -> FakeIMAP:
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    return fake


def _gmail() -> FakeIMAP:
    return FakeIMAP(
        _box("INBOX", "[Gmail]", "[Gmail]/All Mail", "[Gmail]/Trash",
             "[Gmail]/Starred", "Receipts"),
        flags={"[Gmail]/All Mail": "\\All", "[Gmail]/Trash": "\\Trash",
               "[Gmail]/Starred": "\\Flagged"}, gmail=True)


def test_fake_lists_gmail_parent_as_noselect():
    fake = _gmail()
    pairs = dict(mailops.list_folders_ex(fake))
    assert pairs["[Gmail]"] == {"\\haschildren", "\\noselect"}
    assert fake.select('"[Gmail]"')[0] == "NO"


@pytest.mark.parametrize("flag", ["\\Noselect", "\\NonExistent",
                                  "\\NOSELECT", "\\noselect"])
def test_unselectable_matches_both_flags_case_insensitively(flag):
    fake = FakeIMAP(_box("INBOX", "Parent", "Parent/Kid"),
                    noselect={"Parent": flag})
    assert mailops.unselectable(fake) == {"Parent"}
    assert mailops.selectable_folders(fake) == ["INBOX", "Parent/Kid"]
    # LIST itself still reports everything (namespace matching needs it)
    assert "Parent" in mailops.list_folders(fake)


def test_scan_skips_unselectable_even_when_ticked(monkeypatch):
    _use(monkeypatch, FakeIMAP(
        _box("INBOX", "Group", "Group/Kid"),
        noselect={"Group": "\\Noselect"}))
    mailops.run_scan()
    assert mailops.STATE["folders"] == ["INBOX", "Group/Kid"]
    assert {m["folder"] for m in mailops.INDEX.values()} \
        == {"INBOX", "Group/Kid"}


def test_folders_endpoint_hides_unselectable_keeps_children(monkeypatch):
    _use(monkeypatch, _gmail())
    folders = client.get("/api/folders").json()["folders"]
    by = {f["raw"]: f for f in folders}
    assert "[Gmail]" not in by
    assert by["[Gmail]/Trash"]["role"] == "trash"
    assert by["[Gmail]/All Mail"]["role"] == "all"
    assert by["[Gmail]/Starred"]["view"] is True
    assert by["Receipts"]["excluded"] is False


def test_gmail_scan_does_not_report_the_parent(monkeypatch):
    _use(monkeypatch, _gmail())
    mailops.run_scan()
    assert "[Gmail]" not in mailops.STATE["folders"]
    assert "Receipts" in mailops.STATE["folders"]


def test_unselectable_parent_named_trash_is_no_role(monkeypatch):
    fake = FakeIMAP(_box("INBOX", "Trash", "Trash/Old", "Bin"),
                    noselect={"Trash": "\\Noselect"})
    found = mailops.resolve_roles(fake)
    assert found["roles"]["trash"] == "Bin"
    assert "Trash" not in found["candidates"]["trash"]
    assert "Trash" not in found["looks_like"]
    assert not found["ambiguous"]
    # the same name, selectable, still is a role
    fake = FakeIMAP(_box("INBOX", "Trash"))
    assert mailops.resolve_roles(fake)["roles"] == {"trash": "Trash"}


def test_unselectable_trash_flag_is_ignored():
    fake = FakeIMAP(_box("INBOX", "Group"),
                    flags={"Group": "\\Trash"},
                    noselect={"Group": "\\NonExistent"})
    assert "trash" not in mailops.resolve_roles(fake)["roles"]


def test_move_target_rejects_unselectable():
    fake = FakeIMAP(_box("INBOX", "Group", "Group/Kid"),
                    noselect={"Group": "\\Noselect"})
    with pytest.raises(RuntimeError, match=code_re(mailops.UNKNOWN_TARGET,
                                                   folder="Group")):
        mailops._resolve_dest(fake, "move", "Group")
    assert mailops._resolve_dest(fake, "move", "Group/Kid") == "Group/Kid"


def test_test_connection_counts_selectable_folders_only(monkeypatch):
    _use(monkeypatch, _gmail())
    monkeypatch.setattr("backend.config.has_credentials", lambda im: True)
    r = client.post("/api/test_connection").json()
    assert r["folders"] == 5      # six folders minus the "[Gmail]" parent


def test_trash_restore_rejects_unselectable_target(monkeypatch):
    _use(monkeypatch, FakeIMAP(
        _box("INBOX", "Group", "Bin"), flags={"Bin": "\\Trash"},
        noselect={"Group": "\\Noselect"}))
    with pytest.raises(RuntimeError, match=code_re(mailops.UNKNOWN_TARGET,
                                                   folder="Group")):
        mailops.trash_restore([1], "Group")
