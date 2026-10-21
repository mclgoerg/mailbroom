"""Special-folder detection: provider fixture table, the deterministic pick
and ambiguity marker, look-alike folders (never scanned), the read-only
`role_overrides` hook and `/api/folders` role evidence."""

import json

import pytest
from fastapi.testclient import TestClient

from backend import config as cfgmod
from backend import mailops
from backend.main import app
from conftest import FakeIMAP, make_msg

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
