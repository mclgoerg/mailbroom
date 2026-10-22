"""Settings picker backend: confirmed role choices (`role_overrides`: save
validation, config migration, import/export), the `/api/folders` special
rows and the one-time, undoable move of a look-alike folder's mail."""

import json

import pytest
from fastapi.testclient import TestClient

from backend import auditlog, mailops
from backend import config as cfgmod
from backend.main import app
from conftest import FakeIMAP, make_msg

client = TestClient(app)


def _mails(tag: str, n: int, first: int = 1) -> list[dict]:
    """(FakeIMAP keeps a mail's UID on MOVE, so mails that share a target
    folder get distinct UIDs via `first`.)"""
    return [make_msg(first + i, frm=f"{tag}{i}@{tag}.example",
                     msgid=f"<{tag}{first + i}@{tag}.example>")
            for i in range(n)]


def _use(monkeypatch, fake: FakeIMAP) -> FakeIMAP:
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    return fake


def _client_made_trash(monkeypatch, n=3, **kw) -> FakeIMAP:
    """A flagged Trash plus a client-made 'Deleted Items' look-alike."""
    return _use(monkeypatch, FakeIMAP({
        "INBOX": _mails("in", 1), "Trash": _mails("tr", 1, first=100),
        "Deleted Items": _mails("de", n)},
        flags={"Trash": "\\Trash"}, **kw))


def _two_trashes(monkeypatch) -> FakeIMAP:
    return _use(monkeypatch, FakeIMAP({
        "INBOX": _mails("in", 1), "Trash": _mails("tr", 2),
        "Deleted Items": _mails("de", 3)}))


def _saved() -> dict:
    return json.loads(cfgmod.CONFIG_PATH.read_text())


def _audit() -> list[dict]:
    return auditlog.load(None, 0, 100)["entries"]


# -- config schema: role_overrides ---------------------------------------

def test_old_config_without_the_key_reads_as_empty():
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "default": {"host": "imap.example"}}}))
    assert cfgmod.load_config()["accounts"]["default"]["role_overrides"] == {}


def test_save_keeps_and_roundtrips_role_overrides():
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "default": {"host": "imap.example"}}}))            # old file
    cfgmod.update_config({"account": "default", "imap": {
        "role_overrides": {"trash": "Trash", "bogus": "X", "junk": 5,
                           "sent": ""}}})
    assert _saved()["accounts"]["default"]["role_overrides"] == {
        "trash": "Trash"}
    cfgmod.update_config({"account": "default", "imap": {"host": "h.example"}})
    assert cfgmod.load_config()["accounts"]["default"]["role_overrides"] \
        == {"trash": "Trash"}                  # an unrelated save keeps it


def test_export_and_import_carry_role_overrides():
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {"default": {
        "role_overrides": {"trash": "Trash"}}}}))
    backup = json.loads(client.get("/api/export_config").content)
    assert backup["config"]["accounts"]["default"]["role_overrides"] \
        == {"trash": "Trash"}
    cfgmod.update_config({"account": "default",
                          "imap": {"role_overrides": {}}})
    assert client.post("/api/import_config", json=backup).status_code == 200
    assert cfgmod.load_config()["accounts"]["default"]["role_overrides"] \
        == {"trash": "Trash"}


# -- confirming a role ----------------------------------------------------

def test_folders_endpoint_lists_special_rows_with_choices(monkeypatch):
    _two_trashes(monkeypatch)
    body = client.get("/api/folders").json()
    trash = next(r for r in body["special"] if r["role"] == "trash")
    assert trash["ambiguous"] is True and trash["source"] == "name"
    assert trash["raw"] == "Deleted Items"            # most mail
    assert [(c["raw"], c["count"]) for c in trash["choices"]] == [
        ("Deleted Items", 3), ("Trash", 2)]


def test_confirming_unlocks_empty_trash_and_changes_the_pick(monkeypatch):
    fake = _two_trashes(monkeypatch)
    r = client.post("/api/folders/role",
                    json={"role": "trash", "folder": "Trash"})
    assert r.status_code == 200
    assert r.json() == {"role": "trash", "folder": "Trash",
                        "source": "override"}
    assert _saved()["accounts"]["default"]["role_overrides"] \
        == {"trash": "Trash"}
    trash = next(r for r in client.get("/api/folders").json()["special"]
                 if r["role"] == "trash")
    assert trash["ambiguous"] is False and trash["source"] == "override"
    assert len(trash["choices"]) == 2        # still changeable
    assert mailops.empty_trash(uv=1, max_uid=99)["deleted"] == 2
    assert len(fake.mailbox["Deleted Items"]) == 3


def test_clearing_the_choice_makes_the_role_ambiguous_again(monkeypatch):
    _two_trashes(monkeypatch)
    client.post("/api/folders/role", json={"role": "trash", "folder": "Trash"})
    assert client.post("/api/folders/role",
                       json={"role": "trash", "folder": ""}).status_code == 200
    assert _saved()["accounts"]["default"]["role_overrides"] == {}
    with pytest.raises(RuntimeError, match="ambiguous"):
        mailops.empty_trash(uv=1, max_uid=99)


@pytest.mark.parametrize("role, folder", [
    ("trash", "INBOX"), ("trash", "Projects"), ("trash", "Starred"),
    ("trash", "Sent"), ("trash", "No Such Folder"), ("bogus", "Trash"),
    ("junk", "Trash"), ("trash", "inbox")])
def test_override_save_refuses_anything_but_a_candidate(
        monkeypatch, role, folder):
    _use(monkeypatch, FakeIMAP({
        "INBOX": _mails("in", 1), "Trash": _mails("tr", 1),
        "Deleted Items": _mails("de", 1), "Starred": _mails("st", 1),
        "Sent": _mails("se", 1), "Projects": _mails("pr", 1)},
        flags={"Starred": "\\Flagged", "Sent": "\\Sent"}))
    r = client.post("/api/folders/role", json={"role": role, "folder": folder})
    assert r.status_code == 400 and r.json()["detail"] == "role_not_candidate"
    assert not cfgmod.CONFIG_PATH.exists() \
        or not cfgmod.load_config()["accounts"]["default"]["role_overrides"]


def test_a_confirmed_lookalike_becomes_the_role_holder(monkeypatch):
    _client_made_trash(monkeypatch)
    r = client.post("/api/folders/role",
                    json={"role": "trash", "folder": "Deleted Items"})
    assert r.status_code == 200 and r.json()["folder"] == "Deleted Items"


# -- move a look-alike's contents ----------------------------------------

def _undo_entries() -> list[dict]:
    return client.get("/api/state").json()["undo"]


def test_lookalike_count_is_live_and_validated(monkeypatch):
    _client_made_trash(monkeypatch, n=3)
    r = client.get("/api/folders/lookalike", params={"folder": "Deleted Items"})
    assert r.status_code == 200
    assert r.json() == {"role": "trash", "target": "Trash",
                        "target_name": "Trash", "count": 3, "uv": 1,
                        "max_uid": 3}


def test_move_contents_moves_exact_uids_records_undo_and_audit(monkeypatch):
    fake = _client_made_trash(monkeypatch, n=3)
    n_trash = len(fake.mailbox["Trash"])
    r = client.post("/api/folders/move_contents", json={
        "folder": "Deleted Items", "uv": 1, "max_uid": 3})
    assert r.status_code == 200
    body = r.json()
    assert body["moved"] == 3 and body["target"] == "Trash"
    assert fake.mailbox["Deleted Items"] == []
    assert len(fake.mailbox["Trash"]) == n_trash + 3
    assert len(fake.mailbox["INBOX"]) == 1                  # untouched
    undo = _undo_entries()
    assert [(u["action"], u["count"], u["label"]) for u in undo] \
        == [("move_contents", 3, "Deleted Items")]
    assert body["undo"]["count"] == 3
    entry = next(e for e in _audit() if e["action"] == "move_contents")
    assert entry["count"] == 3 and entry["outcome"] == "ok"
    # undo puts every mail back where it came from
    r = client.post("/api/undo", json={"ident": body["undo"]})
    assert r.status_code == 200 and r.json()["restored"] == 3
    assert len(fake.mailbox["Deleted Items"]) == 3
    assert len(fake.mailbox["Trash"]) == n_trash


def test_mail_that_arrived_after_the_count_stays(monkeypatch):
    fake = _client_made_trash(monkeypatch, n=2)
    fake.mailbox["Deleted Items"].append(
        make_msg(3, msgid="<late@later.example>"))
    r = client.post("/api/folders/move_contents", json={
        "folder": "Deleted Items", "uv": 1, "max_uid": 2})
    assert r.json()["moved"] == 2
    assert [m["uid"] for m in fake.mailbox["Deleted Items"]] == [3]


def test_uidvalidity_change_refuses(monkeypatch):
    fake = _client_made_trash(monkeypatch)
    fake.uv["Deleted Items"] = 9
    before = {f: list(m) for f, m in fake.mailbox.items()}
    r = client.post("/api/folders/move_contents", json={
        "folder": "Deleted Items", "uv": 1, "max_uid": 3})
    assert r.status_code == 409 and "UIDVALIDITY" in r.json()["detail"]
    assert fake.mailbox == before and not _audit()


def test_needs_the_counted_listing(monkeypatch):
    fake = _client_made_trash(monkeypatch)
    before = {f: list(m) for f, m in fake.mailbox.items()}
    r = client.post("/api/folders/move_contents", json={
        "folder": "Deleted Items", "uv": 0, "max_uid": 3})
    assert r.status_code == 409 and fake.mailbox == before
    r = client.post("/api/folders/move_contents", json={
        "folder": "Deleted Items", "uv": 1, "max_uid": 0})
    assert r.json()["moved"] == 0 and fake.mailbox == before


@pytest.mark.parametrize("folder", [
    "Trash", "INBOX", "Projects", "No Such Folder"],
    ids=["the-role-folder-itself", "inbox", "unrelated", "unknown"])
def test_refuses_anything_but_a_lookalike(monkeypatch, folder):
    fake = _client_made_trash(monkeypatch)
    fake.mailbox["Projects"] = _mails("pr", 1)
    fake.uv["Projects"] = 1
    before = {f: list(m) for f, m in fake.mailbox.items()}
    for call in (
        lambda: client.get("/api/folders/lookalike", params={
            "folder": folder}),
        lambda: client.post("/api/folders/move_contents", json={
            "folder": folder, "uv": 1, "max_uid": 99})):
        r = call()
        assert r.status_code == 409 and r.json()["detail"] == "not_lookalike"
    assert fake.mailbox == before and not _audit()


def test_refuses_while_the_role_is_ambiguous_and_unconfirmed(monkeypatch):
    """Two flagged Trash folders tie; a third, client-made one looks like
    it too. Nothing moves until the user has confirmed one."""
    fake = _use(monkeypatch, FakeIMAP({
        "INBOX": _mails("in", 1), "Bin": _mails("bi", 2),
        "Trash": _mails("tr", 1), "Deleted Items": _mails("de", 2)},
        flags={"Bin": "\\Trash", "Trash": "\\Trash"}))
    before = {f: list(m) for f, m in fake.mailbox.items()}
    r = client.post("/api/folders/move_contents", json={
        "folder": "Deleted Items", "uv": 1, "max_uid": 2})
    assert r.status_code == 409 and r.json()["detail"] == "role_ambiguous"
    assert fake.mailbox == before and not _audit()
    client.post("/api/folders/role", json={"role": "trash", "folder": "Bin"})
    r = client.post("/api/folders/move_contents", json={
        "folder": "Deleted Items", "uv": 1, "max_uid": 2})
    assert r.status_code == 200 and r.json()["moved"] == 2


def test_junk_lookalike_moves_into_the_junk_folder(monkeypatch):
    fake = _use(monkeypatch, FakeIMAP({
        "INBOX": _mails("in", 1), "Spam": _mails("sp", 1),
        "Junk Email": _mails("ju", 2)}, flags={"Spam": "\\Junk"}))
    r = client.post("/api/folders/move_contents", json={
        "folder": "Junk Email", "uv": 1, "max_uid": 2})
    assert r.json()["moved"] == 2 and r.json()["role"] == "junk"
    assert len(fake.mailbox["Spam"]) == 3


def test_large_folder_moves_in_chunks(monkeypatch):
    monkeypatch.setattr(mailops, "MOVE_CHUNK", 2)
    fake = _client_made_trash(monkeypatch, n=5)
    moves = []
    real = fake.uid

    def spy(cmd, *args):
        if cmd.upper() == "MOVE":
            moves.append(args[0])
        return real(cmd, *args)
    fake.uid = spy
    r = client.post("/api/folders/move_contents", json={
        "folder": "Deleted Items", "uv": 1, "max_uid": 5})
    assert r.json()["moved"] == 5 and moves == ["1,2", "3,4", "5"]


def test_a_failing_chunk_books_what_moved_and_raises(monkeypatch):
    monkeypatch.setattr(mailops, "MOVE_CHUNK", 2)
    fake = _client_made_trash(monkeypatch, n=5)
    real = mailops._uid_move
    calls = []

    def flaky(conn, uidstr, dest):
        calls.append(uidstr)
        return real(conn, uidstr, dest) if len(calls) < 2 else False
    monkeypatch.setattr(mailops, "_uid_move", flaky)
    r = client.post("/api/folders/move_contents", json={
        "folder": "Deleted Items", "uv": 1, "max_uid": 5})
    assert r.status_code == 409 and "2 mails were moved" in r.json()["detail"]
    assert len(fake.mailbox["Deleted Items"]) == 3
    entry = next(e for e in _audit() if e["action"] == "move_contents")
    assert entry["count"] == 2 and entry["outcome"] == "partial"
    assert [u["count"] for u in _undo_entries()] == [2]


def test_works_without_the_move_capability(monkeypatch):
    fake = _client_made_trash(monkeypatch, n=2, move=False)
    r = client.post("/api/folders/move_contents", json={
        "folder": "Deleted Items", "uv": 1, "max_uid": 2})
    assert r.json()["moved"] == 2 and fake.mailbox["Deleted Items"] == []


def test_refuses_while_a_job_runs(monkeypatch):
    fake = _client_made_trash(monkeypatch)
    acc = mailops.accounts.get()
    acc.state["delete"]["status"] = "running"
    r = client.post("/api/folders/move_contents", json={
        "folder": "Deleted Items", "uv": 1, "max_uid": 3})
    assert r.status_code == 409 and len(fake.mailbox["Deleted Items"]) == 3
