"""New-sender review queue ("screener-lite"): first scan seeds silently,
a later scan flags genuinely new senders (and the domain/subject groups
containing them), the flag expires with the window, is:new works in
both filter parsers and in rules, and the store follows the same
tenant/account-separation + rename/delete-account + corrupt-file-
tolerance rules as every other per-account cache."""

import json
import time

from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import knownsenders
from backend import mailops
from backend import rules as rulesmod
from backend import tenants
from backend.main import app

from conftest import make_msg

client = TestClient(app)

NEW_SENDER = '"Gadget Co" <deals@gadgetco.example>'
NEW_ADDR = "deals@gadgetco.example"


def _add_new_sender(bridge):
    bridge.mailbox["INBOX"].append(
        make_msg(99, frm=NEW_SENDER, subject="Welcome to Gadget Co!"))


# --------------------------------------------------------------- seeding

def test_first_scan_seeds_silently_and_flags_nothing(bridge):
    mailops.run_scan()
    st = mailops.public_state()
    assert not any(g["new"] for g in st["groups"]["sender"].values())
    assert not any(g["new"] for g in st["groups"]["domain"].values())
    # but the store now knows about every sender that was scanned
    known = knownsenders.load_account("default")
    assert "noreply@dhl.example" in known and "alice@friends.example" in known


def test_second_scan_flags_only_genuinely_new_senders(bridge):
    mailops.run_scan()                        # seeds
    _add_new_sender(bridge)
    mailops.run_scan()                        # should flag the new one

    st = mailops.public_state()
    senders = st["groups"]["sender"]
    assert senders[NEW_ADDR]["new"] is True
    assert senders["noreply@dhl.example"]["new"] is False
    assert senders["alice@friends.example"]["new"] is False


def test_domain_and_subject_groups_flag_too(bridge):
    mailops.run_scan()
    _add_new_sender(bridge)
    mailops.run_scan()

    st = mailops.public_state()
    assert st["groups"]["domain"]["gadgetco.example"]["new"] is True
    # a subject group containing the new sender's mail is flagged too
    subj = next(g for g in st["groups"]["subject"].values()
               if "Gadget Co" in g["label"] or "welcome" in g["label"].lower())
    assert subj["new"] is True


def test_rescanning_without_new_mail_keeps_the_flag_stable(bridge):
    mailops.run_scan()
    _add_new_sender(bridge)
    mailops.run_scan()
    assert mailops.public_state()["groups"]["sender"][NEW_ADDR]["new"]
    mailops.run_scan()                        # nothing changed
    assert mailops.public_state()["groups"]["sender"][NEW_ADDR]["new"]


# ----------------------------------------------------------- window expiry

def test_flag_expires_once_the_window_passes(bridge):
    mailops.run_scan()
    _add_new_sender(bridge)
    mailops.run_scan()
    assert mailops.public_state()["groups"]["sender"][NEW_ADDR]["new"]

    # age the entry past the default 7-day window - no rescan needed,
    # flagging is computed fresh from first_seen vs. now every time
    data = json.loads(knownsenders.KNOWN_SENDERS_PATH.read_text())
    data["accounts"]["default"]["addrs"][NEW_ADDR] = \
        int(time.time()) - 8 * 86400
    knownsenders.KNOWN_SENDERS_PATH.write_text(json.dumps(data))
    assert not mailops.public_state()["groups"]["sender"][NEW_ADDR]["new"]


def test_new_since_respects_a_custom_window():
    knownsenders.update_scan("default", {"a@x.example"}, now=1_000_000)
    knownsenders.update_scan("default", {"a@x.example", "b@x.example"},
                             now=1_000_000 + 10 * 86400)
    # "a" is outside a 7-day window measured from "b"'s scan, "b" is in it
    new = knownsenders.new_since("default", window_days=7,
                                 now=1_000_000 + 10 * 86400)
    assert new == {"b@x.example"}


# -------------------------------------------------------- read-side tolerance

def test_tolerates_missing_or_corrupt_file(tmp_path, monkeypatch):
    missing = tmp_path / "nope.json"
    monkeypatch.setattr(knownsenders, "KNOWN_SENDERS_PATH", missing)
    assert knownsenders.load_account("default") == {}
    assert knownsenders.new_since("default") == set()

    corrupt = tmp_path / "corrupt.json"
    corrupt.write_text("{not json")
    monkeypatch.setattr(knownsenders, "KNOWN_SENDERS_PATH", corrupt)
    assert knownsenders.load_account("default") == {}


# ------------------------------------------------------- is:new in rules

def test_rule_using_is_new_matches_only_new_senders(bridge):
    mailops.run_scan()
    _add_new_sender(bridge)
    mailops.run_scan()

    rule = rulesmod.create_rule({
        "name": "screen new", "grouping": "sender", "query": "is:new"})
    res = rulesmod.run_rule(rule["id"], rescan=False)   # report mode only
    assert res["groups"] == 1
    assert res["preview"][0]["key"] == NEW_ADDR


# --------------------------------------------------------- account lifecycle

def test_rename_account_follows():
    knownsenders.update_scan("default", {"a@x.example"})
    client.post("/api/config", json={
        "rename_account": {"from": "default", "to": "renamed"}})
    assert knownsenders.load_account("default") == {}
    assert "a@x.example" in knownsenders.load_account("renamed")


def test_delete_account_drops_its_known_senders(monkeypatch):
    from backend import config as cfgmod
    cfgmod.update_config({"add_account": "two"})
    knownsenders.update_scan("default", {"a@x.example"})
    knownsenders.update_scan("two", {"b@x.example"})
    client.post("/api/config", json={"delete_account": "two"})
    assert "a@x.example" in knownsenders.load_account("default")
    assert knownsenders.load_account("two") == {}


# ------------------------------------------------------------ tenant isolation

def test_known_senders_isolated_per_tenant():
    alice = tenants.for_subject("alice@x.example")
    with tenants.use(alice):
        knownsenders.update_scan("default", {"secret@x.example"})
    assert knownsenders.load_account("default") == {}   # default untouched
    with tenants.use(alice):
        assert "secret@x.example" in knownsenders.load_account("default")


# --------------------------------------------------------- multi-account scan

def test_two_accounts_scan_independently(monkeypatch):
    from conftest import FakeIMAP
    import json as jsonlib
    from backend import config as cfgmod
    cfgmod.CONFIG_PATH.write_text(jsonlib.dumps({"accounts": {
        "one": {"host": "host-one", "user": "u1", "password": "pw"},
        "two": {"host": "host-two", "user": "u2", "password": "pw"},
    }}))
    fakes = {
        "host-one": FakeIMAP({
            "INBOX": [make_msg(1, frm="shop@a.example", subject="sale A")],
            "Trash": [],
        }),
        "host-two": FakeIMAP({
            "INBOX": [make_msg(1, frm="news@b.example", subject="letter B")],
            "Trash": [],
        }),
    }
    monkeypatch.setattr(mailops, "connect",
                       lambda im, name=None: fakes[im["host"]])
    one = accountsmod.get("one")
    two = accountsmod.get("two")
    mailops.run_scan(one)
    mailops.run_scan(two)
    assert "shop@a.example" in knownsenders.load_account("one")
    assert "shop@a.example" not in knownsenders.load_account("two")
    assert "news@b.example" in knownsenders.load_account("two")
    assert "news@b.example" not in knownsenders.load_account("one")
