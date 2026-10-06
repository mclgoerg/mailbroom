"""Flat "All mails" view: GET /api/mails over the scan index - paging,
sorts, per-mail query qualifiers (and the ignored group-level ones),
account separation, pinned handling, no IMAP traffic."""

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import mailops
from backend.main import app
from conftest import wait_delete_done
from test_multiaccount import _two_accounts

client = TestClient(app)


@pytest.fixture
def scanned(bridge):
    """INBOX uid 1..4 + Archive uid 10, with distinct dates (uid 3 newest)."""
    dates = {1: "01-Jan-2024", 2: "02-Jan-2024", 3: "20-Sep-2026",
             4: "05-Mar-2026", 10: "01-Jan-2025"}
    for folder in ("INBOX", "Archive"):
        for m in bridge.mailbox[folder]:
            m["date"] = f"{dates[m['uid']]} 12:00:00 +0000"
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    return bridge


def page(**params):
    r = client.get("/api/mails", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def uids(res):
    return [m["uid"] for m in res["mails"]]


# ----------------------------------------------------------------- paging

def test_default_is_newest_first_with_total(scanned):
    res = page()
    assert res["total"] == 5 and res["offset"] == 0
    assert uids(res) == [3, 4, 10, 2, 1]
    row = res["mails"][0]
    assert set(row) >= {"uid", "folder", "date", "ts", "subject", "addr",
                        "size", "seen", "ai", "pinned"}
    assert row["folder"] == "INBOX" and row["pinned"] is False


def test_paging_boundaries(scanned):
    assert uids(page(limit=2, offset=0)) == [3, 4]
    assert uids(page(limit=2, offset=2)) == [10, 2]
    last = page(limit=2, offset=4)
    assert uids(last) == [1] and last["total"] == 5     # short last page
    beyond = page(limit=2, offset=5)
    assert beyond["mails"] == [] and beyond["total"] == 5
    assert uids(page(limit=1000)) == [3, 4, 10, 2, 1]


def test_invalid_paging_and_sort_are_rejected(scanned):
    for bad in ({"limit": 0}, {"limit": 1001}, {"offset": -1},
                {"sort": "color"}, {"dir": "sideways"}):
        assert client.get("/api/mails", params=bad).status_code == 422


# ------------------------------------------------------------------ sorts

def test_sort_by_size_both_directions(scanned):
    assert uids(page(sort="size")) == [4, 10, 1, 2, 3]
    assert uids(page(sort="size", dir="asc")) == [3, 2, 1, 10, 4]


def test_sort_by_sender_defaults_ascending_with_stable_ties(scanned):
    # alice, news, then the three dhl mails ordered by (folder, uid)
    assert uids(page(sort="sender")) == [3, 4, 10, 1, 2]
    assert uids(page(sort="sender", dir="desc")) == [10, 1, 2, 4, 3]


def test_date_sort_ascending_and_paging_stays_consistent(scanned):
    full = uids(page(dir="asc"))
    assert full == [1, 2, 10, 4, 3]
    assert uids(page(dir="asc", limit=2, offset=2)) == full[2:4]


# ---------------------------------------------------------------- queries

def test_text_matches_sender_name_subject_and_ands_words(scanned):
    assert sorted(uids(page(q="dhl"))) == [1, 2, 10]          # name/address
    assert sorted(uids(page(q="sendung"))) == [1, 2, 10]      # subject
    assert uids(page(q="dhl 789")) == [10]
    assert page(q="dhl nomatch")["total"] == 0
    assert uids(page(q="ALICE")) == [3]                       # case-insens.


def test_age_qualifier(scanned, monkeypatch):
    # fixed clock: the fixture dates are absolute
    monkeypatch.setattr(mailops.time, "time", lambda: 1791288000)  # 2026-10-06
    assert sorted(uids(page(q="age:>1y"))) == [1, 2, 10]      # before ~Oct 2025
    assert uids(page(q="age:>3y")) == []
    assert sorted(uids(page(q="age:>30d"))) == [1, 2, 4, 10]  # 3 is recent


def test_size_and_att_qualifiers(scanned):
    assert uids(page(q="size:>10k")) == [4]
    assert sorted(uids(page(q="size:5000"))) == [1, 4, 10]    # at least 5000
    for m in mailops.INDEX.values():          # as the attachment scan sets it
        if m["uid"] == 4:
            m["att_size"] = 28000
    assert uids(page(q="att:>1m")) == []
    assert uids(page(q="att:>20k")) == [4]


def test_from_domain_folder_read_state_qualifiers(scanned):
    assert sorted(uids(page(q="from:noreply@dhl.example"))) == [1, 2, 10]
    assert uids(page(q="from:dhl.example")) == []             # exact address
    assert sorted(uids(page(q="domain:dhl.example"))) == [1, 2, 10]
    assert uids(page(q="folder:archive")) == [10]
    assert sorted(uids(page(q="is:read"))) == [2, 3, 10]
    assert sorted(uids(page(q="is:unread"))) == [1, 4]
    assert uids(page(q="is:unread domain:shop.example")) == [4]


def test_has_pinned_and_pinned_flag(scanned):
    client.post("/api/pin", json={"folder": "INBOX", "uid": 1,
                                  "pinned": True})
    assert uids(page(q="has:pinned")) == [1]
    flags = {m["uid"]: m["pinned"] for m in page()["mails"]}
    assert flags == {1: True, 2: False, 3: False, 4: False, 10: False}


def test_group_level_qualifiers_are_ignored_and_reported(scanned):
    res = page(q="tag:shipping unread:>50 is:unsub eng:low has:ai dhl")
    assert res["ignored"] == ["tag:shipping", "unread:>50", "is:unsub",
                              "eng:low", "has:ai"]
    assert sorted(uids(res)) == [1, 2, 10]      # only "dhl" narrowed it
    assert page(q="dhl")["ignored"] == []


def test_malformed_qualifier_value_falls_back_to_text(scanned):
    assert page(q="age:abc")["total"] == 0      # nothing contains "age:abc"


# ---------------------------------------------------------- invariants

def test_no_imap_traffic(scanned, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("the flat view must not touch IMAP")
    monkeypatch.setattr(mailops, "connect", boom)
    assert page(q="dhl")["total"] == 3


def test_empty_before_any_scan(bridge):
    assert page() == {"total": 0, "offset": 0, "mails": [], "ignored": []}


def test_accounts_never_mix(monkeypatch):
    _two_accounts(monkeypatch)
    one, two = accountsmod.get("one"), accountsmod.get("two")
    mailops.run_scan(one)
    mailops.run_scan(two)
    r1 = client.get("/api/mails", params={"account": "one"}).json()
    r2 = client.get("/api/mails", params={"account": "two"}).json()
    assert {m["subject"] for m in r1["mails"]} == \
        {"sale A", "sale A2", "in one"}
    assert {m["subject"] for m in r2["mails"]} == {"letter B", "in two"}
    assert r1["total"] == 3 and r2["total"] == 2
    assert client.get("/api/mails", params={"account": "nope"}
                      ).status_code == 400


# ------------------------------------------ actions from the flat list

def test_pinned_mail_from_the_flat_list_needs_force_to_be_trashed(scanned):
    client.post("/api/pin", json={"folder": "INBOX", "uid": 1,
                                  "pinned": True})
    pinned = next(m for m in page()["mails"] if m["pinned"])
    item = [pinned["folder"], pinned["uid"]]
    r = client.post("/api/delete_messages", json={
        "items": [item], "action": "trash"})
    assert r.status_code == 400 and r.json()["detail"] == mailops.PINNED_MAILS
    assert not scanned.mailbox["Trash"]
    r = client.post("/api/delete_messages", json={
        "items": [item], "action": "trash", "force": True})
    assert r.status_code == 200
    wait_delete_done()
    assert {m["uid"] for m in scanned.mailbox["Trash"]} == {1}
    # and the list follows the deletion without a rescan
    assert 1 not in uids(page())
    assert page()["total"] == 4
