"""Generic-IMAP support: SPECIAL-USE folder roles, provider folder-name
fallbacks, the Gmail All-Mail double-count guard, the no-MOVE fallback,
STARTTLS connect and the separate SMTP host for unsubscribe mails."""

from fastapi.testclient import TestClient

from backend import config as cfgmod
from backend import mailops, unsub
from backend.main import app
from conftest import FakeIMAP, make_msg, wait_delete_done

client = TestClient(app)


def _gmail(monkeypatch, extra_trash=0) -> FakeIMAP:
    """Gmail-shaped account: SPECIAL-USE flags + [Gmail]/ names. Every
    INBOX mail also lives in All Mail — scanning both would double-count."""
    inbox = [
        make_msg(1, frm="a@x.example", subject="hello 1"),
        make_msg(2, frm="a@x.example", subject="hello 2"),
    ]
    fake = FakeIMAP(
        {
            "INBOX": inbox,
            "[Gmail]/All Mail": [dict(m) for m in inbox]
            + [make_msg(3, frm="me@self.example", subject="my own mail")],
            "[Gmail]/Sent Mail": [
                make_msg(20, frm="me@self.example", subject="Re: hi",
                         to="friend@y.example")],
            "[Gmail]/Spam": [make_msg(30, frm="spam@z.example")],
            "[Gmail]/Drafts": [],
            "[Gmail]/Trash": [make_msg(40, frm="gone@x.example")
                              for _ in range(extra_trash)] or [],
            "Receipts": [make_msg(50, frm="b@y.example", subject="receipt")],
        },
        flags={"[Gmail]/All Mail": "\\All", "[Gmail]/Sent Mail": "\\Sent",
               "[Gmail]/Spam": "\\Junk", "[Gmail]/Drafts": "\\Drafts",
               "[Gmail]/Trash": "\\Trash"})
    monkeypatch.setattr(mailops, "connect", lambda cfg: fake)
    return fake


def test_folder_roles_from_special_use_flags(monkeypatch):
    fake = _gmail(monkeypatch)
    roles = mailops.folder_roles(fake)
    assert roles == {"all": "[Gmail]/All Mail", "sent": "[Gmail]/Sent Mail",
                     "junk": "[Gmail]/Spam", "drafts": "[Gmail]/Drafts",
                     "trash": "[Gmail]/Trash"}


def test_flags_win_over_names():
    fake = FakeIMAP({"Trash": [], "Wastebasket": []},
                    flags={"Wastebasket": "\\Trash"})
    assert mailops.folder_roles(fake)["trash"] == "Wastebasket"


def test_name_fallback_localized():
    fake = FakeIMAP({"INBOX": [], "Papierkorb": [], "Gesendet": [],
                     "Entw&APw-rfe": []})
    roles = mailops.folder_roles(fake)
    assert roles["trash"] == "Papierkorb"
    assert roles["sent"] == "Gesendet"
    assert roles["drafts"] == "Entw&APw-rfe"     # decoded: Entwürfe


def test_gmail_all_mail_not_double_counted(monkeypatch):
    _gmail(monkeypatch, extra_trash=1)
    mailops.run_scan()
    groups = mailops.STATE["groups"]["sender"]
    # Only INBOX + Receipts scanned: 2 mails from a@, 1 from b@, and none
    # of the All Mail / Sent / Spam / Trash copies leak in.
    assert groups["a@x.example"]["count"] == 2
    assert groups["b@y.example"]["count"] == 1
    assert set(groups) == {"a@x.example", "b@y.example"}
    # trash_count came from the role folder, replied from [Gmail]/Sent Mail
    assert mailops.STATE["trash_count"] == 1
    assert "friend@y.example" in mailops.REPLIED_TO


def test_delete_lands_in_gmail_trash(monkeypatch):
    fake = _gmail(monkeypatch)
    mailops.run_scan()
    mailops.delete_groups("sender", ["a@x.example"])
    wait_delete_done()
    assert len(fake.mailbox["[Gmail]/Trash"]) == 2
    assert fake.mailbox["INBOX"] == []


def test_icloud_deleted_messages_as_trash(monkeypatch):
    fake = FakeIMAP({
        "INBOX": [make_msg(1, frm="a@x.example")],
        "Deleted Messages": [make_msg(9, frm="old@x.example")],
        "Sent Messages": [],
    })
    monkeypatch.setattr(mailops, "connect", lambda cfg: fake)
    mailops.run_scan()
    assert set(mailops.STATE["groups"]["sender"]) == {"a@x.example"}
    mailops.delete_groups("sender", ["a@x.example"])
    wait_delete_done()
    assert len(fake.mailbox["Deleted Messages"]) == 2
    # Trash browser resolves the same folder and its mails open fine.
    listed = mailops.trash_list()
    assert listed["folder"] == "Deleted Messages" and listed["total"] == 2
    msg = mailops.fetch_message("Deleted Messages", 9)
    assert "old@x.example" in msg["from"]


def test_move_fallback_without_capability(monkeypatch):
    fake = FakeIMAP({
        "INBOX": [make_msg(1, frm="a@x.example"),
                  make_msg(2, frm="a@x.example")],
        "Trash": [],
    }, move=False)
    monkeypatch.setattr(mailops, "connect", lambda cfg: fake)
    mailops.run_scan()
    mailops.delete_groups("sender", ["a@x.example"])
    st = wait_delete_done()
    assert st["moved"] == 2 and not st["error"]
    assert len(fake.mailbox["Trash"]) == 2
    assert fake.mailbox["INBOX"] == []


def test_folders_endpoint_reports_roles(monkeypatch):
    _gmail(monkeypatch)
    resp = client.get("/api/folders").json()
    by_name = {f["raw"]: f for f in resp["folders"]}
    allmail = by_name["[Gmail]/All Mail"]
    assert allmail["role"] == "all" and allmail["excluded"] is True
    assert by_name["INBOX"]["excluded"] is False
    assert by_name["Receipts"]["role"] is None


def test_connect_starttls(monkeypatch):
    calls = {}

    class FakePlainIMAP:
        def __init__(self, host, port, timeout=None):
            calls["host"], calls["port"] = host, port

        def starttls(self, ssl_context=None):
            calls["starttls"] = True

        def login(self, user, password):
            calls["login"] = True
            return "OK", [b""]

    monkeypatch.setattr(mailops.imaplib, "IMAP4", FakePlainIMAP)
    mailops.connect({"host": "imap.example", "port": 143,
                     "security": "starttls", "user": "u", "password": "p",
                     "cafile": ""})
    assert calls == {"host": "imap.example", "port": 143,
                     "starttls": True, "login": True}


def test_unsub_smtp_host_override(monkeypatch):
    seen = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout=None, context=None):
            seen["host"], seen["port"] = host, port

        def login(self, user, password):
            seen["login"] = user

        def sendmail(self, frm, to, msg):
            seen["to"] = to

        def quit(self):
            pass

    monkeypatch.setattr(unsub.smtplib, "SMTP_SSL", FakeSMTP)
    unsub._send_mailto(
        {"host": "imap.gmail.example", "smtp_host": "smtp.gmail.example",
         "smtp_port": 465, "smtp_security": "ssl", "user": "u",
         "password": "p", "cafile": ""},
        "mailto:unsub@list.example")
    assert seen["host"] == "smtp.gmail.example" and seen["port"] == 465
    assert seen["to"] == ["unsub@list.example"]


def test_config_transport_fields_roundtrip():
    cfg = cfgmod.update_config({"imap": {
        "security": "starttls", "smtp_host": "smtp.example",
        "smtp_security": "starttls", "preset": "gmail", "cafile": ""}})
    im = cfg["accounts"]["default"]
    assert im["security"] == "starttls" and im["smtp_host"] == "smtp.example"
    assert im["preset"] == "gmail" and im["cafile"] == ""
    # invalid values are ignored, not stored
    cfg = cfgmod.update_config({"imap": {"security": "plaintext",
                                         "preset": "hotmail"}})
    im = cfg["accounts"]["default"]
    assert im["security"] == "starttls"
    assert im["preset"] == "gmail"
