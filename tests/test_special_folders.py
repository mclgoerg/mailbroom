"""Special-folder detection: provider fixture table, the deterministic pick
and ambiguity marker, look-alike folders (never scanned), the read-only
`role_overrides` hook and `/api/folders` role evidence."""

import json

import pytest
from fastapi.testclient import TestClient

from backend import config as cfgmod
from backend import accounts as accountsmod
from backend import auditlog, mailops
from backend.main import app
from conftest import FakeIMAP, make_msg, wait_delete_done

client = TestClient(app)


def _box(spec: dict[str, int]) -> dict[str, list[dict]]:
    """{folder: mail count} -> mailbox with invented mails."""
    return {f: [make_msg(i + 1, frm=f"s{i}@{n}.example")
                for i in range(count)]
            for n, (f, count) in enumerate(spec.items())}


def _use(monkeypatch, fake: FakeIMAP) -> FakeIMAP:
    monkeypatch.setattr(mailops, "connect", lambda cfg, name=None: fake)
    return fake


# provider: (folders {name: mail count}, flags, delimiter, roles,
#            looks_like, ambiguous roles)
_PROVIDERS = {
    "gmail-flags": (
        {"INBOX": 2, "[Gmail]/All Mail": 2, "[Gmail]/Sent Mail": 1,
         "[Gmail]/Spam": 1, "[Gmail]/Drafts": 0, "[Gmail]/Trash": 1,
         "[Gmail]/Starred": 1, "[Gmail]/Important": 1},
        {"[Gmail]/All Mail": "\\All", "[Gmail]/Sent Mail": "\\Sent",
         "[Gmail]/Spam": "\\Junk", "[Gmail]/Drafts": "\\Drafts",
         "[Gmail]/Trash": "\\Trash", "[Gmail]/Starred": "\\Flagged",
         "[Gmail]/Important": "\\Important"}, "/",
        {"all": "[Gmail]/All Mail", "sent": "[Gmail]/Sent Mail",
         "junk": "[Gmail]/Spam", "drafts": "[Gmail]/Drafts",
         "trash": "[Gmail]/Trash"}, {}, set()),
    "gmail-xlist-attributes": (
        {"INBOX": 1, "[Gmail]/All Mail": 1, "[Gmail]/Spam": 1},
        {"[Gmail]/All Mail": "\\AllMail", "[Gmail]/Spam": "\\Spam"}, "/",
        {"all": "[Gmail]/All Mail", "junk": "[Gmail]/Spam"}, {}, set()),
    "gmail-german-names-only": (
        {"INBOX": 1, "[Google Mail]/Alle Nachrichten": 1,
         "[Google Mail]/Gesendet": 0, "[Google Mail]/Entw&APw-rfe": 0,
         "[Google Mail]/Spam": 0, "[Google Mail]/Papierkorb": 0}, {}, "/",
        {"all": "[Google Mail]/Alle Nachrichten",
         "sent": "[Google Mail]/Gesendet",
         "drafts": "[Google Mail]/Entw&APw-rfe",
         "junk": "[Google Mail]/Spam",
         "trash": "[Google Mail]/Papierkorb"}, {}, set()),
    "icloud": (
        {"INBOX": 1, "Sent Messages": 0, "Deleted Messages": 0, "Junk": 0,
         "Drafts": 0, "Archive": 0, "Notes": 0}, {}, "/",
        {"sent": "Sent Messages", "trash": "Deleted Messages",
         "junk": "Junk", "drafts": "Drafts", "archive": "Archive"},
        {}, set()),
    "icloud-client-lookalikes": (
        {"INBOX": 1, "Sent Messages": 2, "Deleted Messages": 3,
         "Gesendete Elemente": 1, "Gel&APY-schte Elemente": 1},
        {"Sent Messages": "\\Sent", "Deleted Messages": "\\Trash"}, "/",
        {"sent": "Sent Messages", "trash": "Deleted Messages"},
        {"Gesendete Elemente": "sent", "Gel&APY-schte Elemente": "trash"},
        set()),
    "outlook-english": (
        {"INBOX": 1, "Deleted Items": 0, "Junk Email": 0, "Sent Items": 0,
         "Drafts": 0, "Archive": 0},
        {"Deleted Items": "\\Trash", "Junk Email": "\\Junk",
         "Sent Items": "\\Sent", "Drafts": "\\Drafts"}, "/",
        {"trash": "Deleted Items", "junk": "Junk Email",
         "sent": "Sent Items", "drafts": "Drafts", "archive": "Archive"},
        {}, set()),
    "outlook-german-no-flags": (
        {"INBOX": 1, "Gel&APY-schte Elemente": 0, "Junk-E-Mail": 0,
         "Gesendete Elemente": 0, "Entw&APw-rfe": 0, "Archiv": 0}, {}, "/",
        {"trash": "Gel&APY-schte Elemente", "junk": "Junk-E-Mail",
         "sent": "Gesendete Elemente", "drafts": "Entw&APw-rfe",
         "archive": "Archiv"}, {}, set()),
    "gmx-flags-and-client-lookalikes": (
        {"INBOX": 1, "Gel&APY-scht": 0, "Spamverdacht": 0, "Gesendet": 0,
         "Entw&APw-rfe": 0, "Archiv": 0, "Gel&APY-schte Elemente": 4,
         "Junk-E-Mail": 2, "OUTBOX": 1},
        {"Gel&APY-scht": "\\Trash", "Spamverdacht": "\\Junk"}, "/",
        {"trash": "Gel&APY-scht", "junk": "Spamverdacht",
         "sent": "Gesendet", "drafts": "Entw&APw-rfe", "archive": "Archiv"},
        {"Gel&APY-schte Elemente": "trash", "Junk-E-Mail": "junk"}, set()),
    "gmx-names-only": (
        {"INBOX": 1, "Gel&APY-scht": 0, "Spamverdacht": 0, "Gesendet": 0},
        {}, "/",
        {"trash": "Gel&APY-scht", "junk": "Spamverdacht",
         "sent": "Gesendet"}, {}, set()),
    "proton-bridge": (
        {"INBOX": 2, "Drafts": 0, "Sent": 0, "Starred": 1, "Archive": 0,
         "Spam": 0, "Trash": 0, "All Mail": 2, "Folders/Receipts": 1,
         "Labels/Travel": 1},
        {"All Mail": "\\All", "Spam": "\\Junk", "Drafts": "\\Drafts",
         "Sent": "\\Sent", "Archive": "\\Archive", "Starred": "\\Flagged",
         "Trash": "\\Trash"}, "/",
        {"all": "All Mail", "junk": "Spam", "drafts": "Drafts",
         "sent": "Sent", "archive": "Archive", "trash": "Trash"},
        {}, set()),
    "fastmail-inbox-dot-prefix": (
        {"INBOX": 1, "INBOX.Trash": 0, "INBOX.Spam": 0, "INBOX.Sent": 0,
         "INBOX.Drafts": 0, "INBOX.Archive": 0, "INBOX.Receipts": 1}, {}, ".",
        {"trash": "INBOX.Trash", "junk": "INBOX.Spam",
         "sent": "INBOX.Sent", "drafts": "INBOX.Drafts",
         "archive": "INBOX.Archive"}, {}, set()),
    "dovecot-inbox-slash-prefix": (
        {"INBOX": 1, "INBOX/Trash": 0, "INBOX/Junk": 0, "INBOX/Sent": 0},
        {}, "/",
        {"trash": "INBOX/Trash", "junk": "INBOX/Junk",
         "sent": "INBOX/Sent"}, {}, set()),
    "dovecot-two-sent-flags": (
        {"INBOX": 1, "Sent": 1, "Sent Messages": 3},
        {"Sent": "\\Sent", "Sent Messages": "\\Sent"}, "/",
        {"sent": "Sent Messages"}, {"Sent": "sent"}, {"sent"}),
    # a user subfolder below INBOX/ never takes a role from the provider's
    # own top-level folder, however much mail it holds
    "gmx-top-level-beats-inbox-subfolders": (
        {"INBOX": 1, "Gesendet": 1, "INBOX/Sent": 2, "Gel&APY-scht": 1,
         "INBOX/Trash": 2, "Spamverdacht": 1, "INBOX/Junk": 2, "Archiv": 1,
         "INBOX/Archive": 2}, {}, "/",
        {"sent": "Gesendet", "trash": "Gel&APY-scht",
         "junk": "Spamverdacht", "archive": "Archiv"},
        {"INBOX/Sent": "sent", "INBOX/Trash": "trash",
         "INBOX/Junk": "junk", "INBOX/Archive": "archive"}, set()),
    "inbox-subfolder-next-to-flagged-trash": (
        {"INBOX": 1, "Wastebasket": 0, "INBOX/Trash": 2},
        {"Wastebasket": "\\Trash"}, "/",
        {"trash": "Wastebasket"}, {"INBOX/Trash": "trash"}, set()),
    "equal-mail-two-trash-names": (
        {"INBOX": 1, "Trash": 1, "Deleted Items": 1}, {}, "/",
        {"trash": "Deleted Items"}, {"Trash": "trash"}, {"trash"}),
    "equal-mail-two-flagged-sent": (
        {"INBOX": 1, "Sent": 1, "Sent Messages": 1},
        {"Sent": "\\Sent", "Sent Messages": "\\Sent"}, "/",
        {"sent": "Sent"}, {"Sent Messages": "sent"}, {"sent"}),
    "archive-lookalike": (
        {"INBOX": 1, "Archive": 1, "Archiv": 1},
        {"Archive": "\\Archive"}, "/",
        {"archive": "Archive"}, {"Archiv": "archive"}, set()),
    "only-gmail-and-inbox-roots-count": (
        {"INBOX": 1, "[Old]/Trash": 1, "[Gmail]/Trash": 0}, {}, "/",
        {"trash": "[Gmail]/Trash"}, {}, set()),
    "two-trash-names": (
        {"INBOX": 1, "Trash": 1, "Deleted Items": 5}, {}, "/",
        {"trash": "Deleted Items"}, {"Trash": "trash"}, {"trash"}),
    "flagged-trash-beats-named-trash": (
        {"INBOX": 1, "Trash": 9, "Wastebasket": 0},
        {"Wastebasket": "\\Trash"}, "/",
        {"trash": "Wastebasket"}, {"Trash": "trash"}, set()),
    "user-folders-below-other-parents-are-not-special": (
        {"INBOX": 1, "Work/Archive": 1, "Clients/Trash": 1, "Spam Notes": 1},
        {}, "/", {}, {}, set()),
}


@pytest.mark.parametrize("case", list(_PROVIDERS))
@pytest.mark.parametrize("reverse", [False, True],
                         ids=["list-order", "reversed-list-order"])
def test_provider_roles(case, reverse):
    folders, flags, delim, roles, looks, ambiguous = _PROVIDERS[case]
    order = list(folders)[::-1] if reverse else None
    fake = FakeIMAP(_box(folders), flags=flags, delimiter=delim,
                    list_order=order)
    found = mailops.resolve_roles(fake)
    assert found["roles"] == roles          # LIST order never matters
    assert found["looks_like"] == looks
    assert set(found["ambiguous"]) == ambiguous
    assert mailops.folder_roles(fake) == roles


@pytest.mark.parametrize("case", list(_PROVIDERS))
def test_provider_scan_skips_roles_and_lookalikes(monkeypatch, case):
    folders, flags, delim, roles, looks, _ = _PROVIDERS[case]
    _use(monkeypatch, FakeIMAP(_box(folders), flags=flags, delimiter=delim))
    mailops.run_scan()
    held = {roles[r] for r in mailops.EXCLUDED_ROLES if r in roles}
    never = held | {n for n, r in looks.items()
                    if r in mailops.EXCLUDED_ROLES}
    views = {f for f, fl in flags.items()
             if fl in ("\\Flagged", "\\Important")}
    expect = [mailops.decode_mutf7(f) for f in folders
              if f not in never | views
              and not mailops.excluded(f, cfgmod.DEFAULT_EXCLUDED)]
    assert mailops.STATE["folders"] == expect


def test_flag_and_name_sources_in_folders_endpoint(monkeypatch):
    _use(monkeypatch, FakeIMAP(
        _box({"INBOX": 1, "Gel&APY-scht": 0, "Spamverdacht": 0,
              "Gesendet": 0, "Gel&APY-schte Elemente": 3, "OUTBOX": 1,
              "Junk-E-Mail": 1}),
        flags={"Gel&APY-scht": "\\Trash", "Spamverdacht": "\\Junk"}))
    by = {f["raw"]: f for f in client.get("/api/folders").json()["folders"]}
    assert by["Gel&APY-scht"]["role"] == "trash"
    assert by["Gel&APY-scht"]["role_source"] == "flag"
    assert by["Gesendet"]["role"] == "sent"
    assert by["Gesendet"]["role_source"] == "name"
    for raw, role in (("Gel&APY-schte Elemente", "trash"),
                      ("Junk-E-Mail", "junk")):
        assert by[raw]["looks_like"] == role
        assert by[raw]["role"] is None and by[raw]["role_source"] is None
        assert by[raw]["excluded"] is True
        assert by[raw]["ambiguous"] is False     # the flag is authoritative
    assert by["OUTBOX"]["looks_like"] is None
    assert by["OUTBOX"]["excluded"] is False
    assert by["INBOX"]["role_source"] is None


def test_lookalike_not_scanned_even_when_ticked(monkeypatch):
    """F9: a client's "Gelöschte Elemente" next to the server's \\Trash
    holds deleted mail; it must not show up as cleanup candidates."""
    _use(monkeypatch, FakeIMAP(
        _box({"INBOX": 1, "Gel&APY-scht": 0, "Gel&APY-schte Elemente": 3}),
        flags={"Gel&APY-scht": "\\Trash"}))
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {"default": {
        "excluded_folders": []}}}))                          # all ticked
    mailops.run_scan()
    assert mailops.STATE["folders"] == ["INBOX"]
    assert sum(g["count"] for g in
               mailops.STATE["groups"]["sender"].values()) == 1


def test_ambiguous_pick_is_deterministic_and_marked(monkeypatch):
    fake = _use(monkeypatch, FakeIMAP(
        _box({"INBOX": 1, "Trash": 2, "Deleted Items": 2}),
        list_order=["Deleted Items", "Trash"]))
    found = mailops.resolve_roles(fake)
    # equal mail counts: LIST order decides, but only after the count
    assert found["roles"]["trash"] == "Deleted Items"
    assert found["ambiguous"] == {"trash": ["Deleted Items", "Trash"]}
    fake.mailbox["Trash"].append(make_msg(9))
    assert mailops.resolve_roles(fake)["roles"]["trash"] == "Trash"
    by = {f["raw"]: f for f in client.get("/api/folders").json()["folders"]}
    assert by["Trash"]["ambiguous"] and by["Deleted Items"]["ambiguous"]
    assert by["Trash"]["role"] == "trash"
    assert by["Deleted Items"]["looks_like"] == "trash"
    assert not by["INBOX"]["ambiguous"]


def test_role_overrides_read_hook(monkeypatch):
    fake = _use(monkeypatch, FakeIMAP(
        _box({"INBOX": 1, "Trash": 9, "Deleted Items": 1})))
    assert mailops.resolve_roles(fake)["roles"]["trash"] == "Trash"
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {"default": {
        "role_overrides": {"trash": "Deleted Items",
                           "junk": "No Such Folder"}}}}))
    found = mailops.resolve_roles(fake)
    assert found["roles"] == {"trash": "Deleted Items"}
    assert found["source"] == {"trash": "override"}
    assert found["ambiguous"] == {}          # confirmed -> not ambiguous
    assert found["looks_like"] == {"Trash": "trash"}
    mailops.run_scan()
    assert mailops.STATE["folders"] == ["INBOX"]


def test_role_overrides_default_for_old_configs():
    """Configs written before the key existed load with an empty map."""
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "default": {"host": "imap.example"},
        "other": {"host": "imap2.example", "role_overrides": "garbage"}}}))
    accts = cfgmod.load_config()["accounts"]
    assert accts["default"]["role_overrides"] == {}
    assert accts["other"]["role_overrides"] == {}


def test_list_delimiter_is_parsed():
    fake = FakeIMAP(_box({"INBOX": 0, "INBOX.Trash": 0}), delimiter=".")
    assert mailops.list_folders_ex(fake).delims == {
        "INBOX": ".", "INBOX.Trash": "."}
    nil = FakeIMAP(_box({"INBOX": 0}), delimiter=None)
    assert [n for n, _ in mailops.list_folders_ex(nil)] == ["INBOX"]
    assert mailops.list_folders_ex(nil).delims == {}


def test_inbox_prefix_needs_the_announced_delimiter():
    """On a "/" server "INBOX.Trash" is one literal name, not Trash below
    INBOX; on a "." server it is."""
    slash = FakeIMAP(_box({"INBOX": 0, "INBOX.Trash": 0}), delimiter="/")
    assert mailops.resolve_roles(slash)["roles"] == {}
    dot = FakeIMAP(_box({"INBOX": 0, "INBOX.Trash": 0}), delimiter=".")
    assert mailops.resolve_roles(dot)["roles"] == {"trash": "INBOX.Trash"}


def test_archive_lookalike_is_still_scanned(monkeypatch):
    """D11: Archive stays a scanned folder, look-alike or not."""
    _use(monkeypatch, FakeIMAP(_box({"INBOX": 1, "Archive": 1, "Archiv": 1}),
                               flags={"Archive": "\\Archive"}))
    mailops.run_scan()
    assert mailops.STATE["folders"] == ["INBOX", "Archive", "Archiv"]
    by = {f["raw"]: f for f in client.get("/api/folders").json()["folders"]}
    assert by["Archiv"]["looks_like"] == "archive"
    assert by["Archiv"]["excluded"] is False


def test_xlist_attributes_map_to_roles():
    fake = FakeIMAP(_box({"Everything": 0, "Bulk": 0}),
                    flags={"Everything": "\\AllMail", "Bulk": "\\Spam"})
    found = mailops.resolve_roles(fake)
    assert found["roles"] == {"all": "Everything", "junk": "Bulk"}
    assert found["source"] == {"all": "flag", "junk": "flag"}


def test_malformed_role_overrides_are_ignored():
    fake = FakeIMAP(_box({"INBOX": 1, "Trash": 1, "Spam": 0, "Drafts": 0,
                          "Entw&APw-rfe": 0}))
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {"default": {
        "role_overrides": {"trash": 5, "junk": ["Spam"], "bogus": "Trash",
                           "sent": None, "drafts": "Entw&APw-rfe"}}}}))
    found = mailops.resolve_roles(fake)
    assert found["roles"] == {"trash": "Trash", "junk": "Spam",
                              "drafts": "Entw&APw-rfe"}   # only the valid one
    assert found["source"]["drafts"] == "override"
    assert found["source"]["trash"] == "name"
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {"default": {
        "role_overrides": ["trash"]}}}))
    assert mailops.resolve_roles(fake)["roles"]["trash"] == "Trash"


def test_folder_holding_two_roles_is_reported_stably(monkeypatch):
    _use(monkeypatch, FakeIMAP(_box({"INBOX": 1, "Everything": 1}),
                               flags={"Everything": "\\All \\Archive"}))
    for _ in range(2):
        by = {f["raw"]: f
              for f in client.get("/api/folders").json()["folders"]}
        assert by["Everything"]["role"] == "all"
        assert by["Everything"]["excluded"] is True


def _two_trashes(monkeypatch) -> FakeIMAP:
    fake = _use(monkeypatch, FakeIMAP(
        _box({"INBOX": 1, "Trash": 2, "Deleted Items": 2})))
    return fake


def test_empty_trash_refuses_while_trash_is_ambiguous(monkeypatch):
    fake = _two_trashes(monkeypatch)
    before = {f: list(m) for f, m in fake.mailbox.items()}
    audit = lambda: auditlog.load(None, 0, 100)["entries"]   # noqa: E731
    assert audit() == []
    with pytest.raises(RuntimeError, match="ambiguous"):
        mailops.empty_trash(uv=1, max_uid=99)
    assert fake.mailbox == before                    # nothing deleted
    assert audit() == []                             # nothing recorded
    r = client.post("/api/empty_trash", json={"uv": 1, "max_uid": 99})
    assert r.status_code == 409 and "ambiguous" in r.json()["detail"]


def test_empty_trash_runs_with_a_confirmed_override(monkeypatch):
    fake = _two_trashes(monkeypatch)
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {"default": {
        "role_overrides": {"trash": "Trash"}}}}))
    assert mailops.empty_trash(uv=1, max_uid=99)["deleted"] == 2
    assert fake.mailbox["Trash"] == []
    assert len(fake.mailbox["Deleted Items"]) == 2   # the other one is left


def test_reversible_actions_use_the_pick_while_ambiguous(monkeypatch):
    fake = _two_trashes(monkeypatch)
    mailops.run_scan()
    mailops.delete_groups("sender", list(mailops.STATE["groups"]["sender"]))
    wait_delete_done()
    assert fake.mailbox["INBOX"] == []
    assert len(fake.mailbox["Deleted Items"]) == 3   # deterministic pick


@pytest.mark.parametrize("target", [
    "INBOX", "inbox", "Starred", "Sent", "Projects", "Entw&APw-rfe",
    "No Such Folder"],
    ids=["inbox", "inbox-lowercase", "virtual-view", "other-roles-folder",
         "unrelated-folder", "other-roles-name-match", "not-listed"])
def test_invalid_override_never_confirms_or_unlocks_empty_trash(
        monkeypatch, target):
    fake = _use(monkeypatch, FakeIMAP(
        _box({"INBOX": 2, "Trash": 2, "Deleted Items": 2, "Starred": 1,
              "Sent": 1, "Projects": 3, "Entw&APw-rfe": 1}),
        flags={"Starred": "\\Flagged", "Sent": "\\Sent"}))
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {"default": {
        "role_overrides": {"trash": target}}}}))
    found = mailops.resolve_roles(fake)
    assert found["source"]["trash"] == "name"        # override ignored
    assert set(found["ambiguous"]) == {"trash"}      # still unconfirmed
    assert found["roles"]["trash"] == "Deleted Items"
    before = {f: list(m) for f, m in fake.mailbox.items()}
    with pytest.raises(RuntimeError, match="ambiguous"):
        mailops.empty_trash(uv=1, max_uid=99)
    assert fake.mailbox == before
    mailops.run_scan()          # and nothing stopped being scanned for it
    assert "INBOX" in mailops.STATE["folders"]
    assert "Projects" in mailops.STATE["folders"]


def test_invalid_override_on_an_unambiguous_role_keeps_the_pick(monkeypatch):
    fake = _use(monkeypatch, FakeIMAP(_box({"INBOX": 2, "Trash": 1})))
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {"default": {
        "role_overrides": {"trash": "INBOX"}}}}))
    assert mailops.resolve_roles(fake)["roles"] == {"trash": "Trash"}
    assert mailops.empty_trash(uv=1, max_uid=99)["deleted"] == 1
    assert len(fake.mailbox["INBOX"]) == 2


def test_override_may_pick_a_lookalike_candidate(monkeypatch):
    """Look-alikes of the role count as candidates (P7 lets the user choose
    between them); the flagged holder then becomes the look-alike."""
    fake = _use(monkeypatch, FakeIMAP(
        _box({"INBOX": 1, "Wastebasket": 0, "Trash": 1}),
        flags={"Wastebasket": "\\Trash"}))
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {"default": {
        "role_overrides": {"trash": "Trash"}}}}))
    found = mailops.resolve_roles(fake)
    assert found["roles"]["trash"] == "Trash"
    assert found["source"]["trash"] == "override"
    assert found["looks_like"] == {"Wastebasket": "trash"}
    assert mailops.empty_trash(uv=1, max_uid=99)["deleted"] == 1


def test_resolve_dest_uses_its_own_accounts_overrides(monkeypatch):
    """Two accounts with the same two Trash look-alikes but different
    confirmed choices: each resolves (and caches) its own."""
    cfgmod.CONFIG_PATH.write_text(json.dumps({"accounts": {
        "one": {"host": "host-one", "user": "u1", "password": "pw",
                "role_overrides": {"trash": "Trash"}},
        "two": {"host": "host-two", "user": "u2", "password": "pw",
                "role_overrides": {"trash": "Deleted Items"}}}}))
    fakes = {h: FakeIMAP(_box({"INBOX": 1, "Trash": 1, "Deleted Items": 1}))
             for h in ("host-one", "host-two")}
    monkeypatch.setattr(mailops, "connect",
                        lambda im, name=None: fakes[im["host"]])
    one, two = accountsmod.get("one"), accountsmod.get("two")
    assert mailops._resolve_dest(fakes["host-one"], "trash", "", one) == "Trash"
    assert mailops._resolve_dest(
        fakes["host-two"], "trash", "", two) == "Deleted Items"
    assert one.folder_roles["trash"] == "Trash"
    assert two.folder_roles["trash"] == "Deleted Items"
