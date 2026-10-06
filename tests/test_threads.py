"""Thread grouping: pure union-find threading (chains, forks, missing
parents, cycles, capped References, stable keys), the scan fetching the
headers, snapshot migration, incremental-scan interaction, and every
consumer of GROUPINGS (delete, protected, pinned, rules, verdicts, AI)."""

import json
import re
import types

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import aihelper
from backend import config as cfgmod
from backend import mailops
from backend import rules as rulesmod
from backend import verdictstore
from backend.main import app
from conftest import make_msg, wait_delete_done

client = TestClient(app)
assign = mailops.assign_threads


def mail(uid, msgid="", irt=None, refs=None, ts=1000, subject="Subj",
         addr="a@x.example", folder="INBOX"):
    return {"uid": uid, "folder": folder, "msgid": msgid, "irt": irt or [],
            "refs": refs or [], "ts": ts, "subject": subject, "addr": addr}


def keys(msgs):
    return [k for k, _ in assign(msgs)]


# --------------------------------------------------------- pure threading

def test_chain_forms_one_thread_with_the_original_subject_as_label():
    msgs = [mail(1, "<a>", ts=1, subject="Plan"),
            mail(2, "<b>", ["<a>"], ["<a>"], ts=2, subject="Re: Plan"),
            mail(3, "<c>", ["<b>"], ["<a>", "<b>"], ts=3,
                 subject="AW: Re: Plan")]
    out = assign(msgs)
    assert len({k for k, _ in out}) == 1
    assert {label for _, label in out} == {"Plan"}


def test_fork_via_references_stays_one_thread_and_unrelated_is_separate():
    msgs = [mail(1, "<a>", ts=1), mail(2, "<b>", ["<a>"], ["<a>"], ts=2),
            mail(3, "<c>", ["<a>"], ["<a>"], ts=3),     # sibling of b
            mail(4, "<d>", ts=4)]
    k = keys(msgs)
    assert k[0] == k[1] == k[2] and k[3] != k[0]


def test_missing_parent_still_joins_siblings():
    # the root <a> was never scanned / has been deleted
    msgs = [mail(2, "<b>", ["<a>"], ["<a>"]), mail(3, "<c>", ["<a>"], ["<a>"])]
    k = keys(msgs)
    assert k[0] == k[1]


def test_mails_without_linkage_are_singletons_and_subjects_never_merge():
    msgs = [mail(1, "<a>", subject="Same"), mail(2, "<b>", subject="Same"),
            mail(3, "", subject="Same")]
    assert len(set(keys(msgs))) == 3


def test_mail_without_message_id_joins_through_in_reply_to():
    msgs = [mail(1, "<a>"), mail(2, "", ["<a>"])]
    k = keys(msgs)
    assert k[0] == k[1]


def test_cycles_and_self_references_do_not_hang_or_split():
    msgs = [mail(1, "<a>", ["<a>"], ["<a>"]),               # replies to itself
            mail(2, "<b>", ["<c>"], ["<c>"]),               # b <-> c cycle
            mail(3, "<c>", ["<b>"], ["<b>"])]
    k = keys(msgs)
    assert k[0] != k[1] and k[1] == k[2]


def test_header_id_parsing_and_capped_references():
    assert mailops.header_ids("<a@x> junk <b@y>\n <c@z>") == \
        ["<a@x>", "<b@y>", "<c@z>"]
    assert mailops.header_ids(None) == []
    ids = [f"<m{i}@x>" for i in range(300)]
    capped = mailops.capped_refs(ids)
    assert len(capped) == mailops.REFS_KEEP_TAIL + 1
    assert capped[0] == "<m0@x>" and capped[-1] == "<m299@x>"
    assert mailops.capped_refs(ids[:5]) == ids[:5]


def test_capped_references_still_link_to_the_root_thread():
    ids = [f"<m{i}@x>" for i in range(300)]
    root = mail(0, ids[0], ts=1)
    late = mail(299, ids[299], [ids[298]], mailops.capped_refs(ids[:299]),
                ts=2)
    k = keys([root, late])
    assert k[0] == k[1]


def test_key_is_stable_when_the_thread_grows_or_loses_its_root():
    a = mail(1, "<a>", ts=1)
    b = mail(2, "<b>", ["<a>"], ["<a>"], ts=2)
    c = mail(3, "<c>", ["<b>"], ["<a>", "<b>"], ts=3)
    key_ab = keys([a, b])[0]
    assert keys([a, b, c])[0] == key_ab            # a reply joined
    assert keys([b, c])[0] == key_ab               # the root was deleted
    # a reply whose own id sorts BEFORE the root's must not rekey the thread
    early = mail(4, "<0000-first>", ["<a>"], ["<a>"], ts=9)
    assert keys([a, b, early])[0] == key_ab
    # and a lone mail keeps its key once its first reply arrives
    assert keys([a])[0] == key_ab


def test_key_is_an_opaque_hash_not_the_message_id():
    k = keys([mail(1, "<secret-id@mail.example>")])[0]
    assert re.fullmatch(r"[0-9a-f]{16}", k)


def test_labels_strip_reply_prefixes_and_fill_empty_subjects():
    out = assign([mail(1, "<a>", ts=1, subject="Re: Fwd: Hello"),
                  mail(2, "<z>", ts=1, subject="")])
    assert out[0][1] == "Hello" and out[1][1] == "(no subject)"


# ----------------------------------------------------------- scan / groups

@pytest.fixture
def threaded(bridge):
    """INBOX/Archive plus one 3-mail conversation spanning two folders and
    one unrelated mail (existing fixture mails stay singletons)."""
    bridge.mailbox["INBOX"] += [
        make_msg(30, frm="Boss <boss@corp.example>", subject="Project plan",
                 msgid="<root@x>", date="01-Mar-2024 10:00:00 +0000",
                 size=1000),
        make_msg(31, frm="alice@friends.example", subject="Re: Project plan",
                 msgid="<r1@x>", irt="<root@x>", refs="<root@x>",
                 date="02-Mar-2024 10:00:00 +0000", size=2000),
        make_msg(33, frm="alice@friends.example", subject="Lunch?",
                 msgid="<l1@x>", date="05-Mar-2024 10:00:00 +0000"),
    ]
    bridge.mailbox["Archive"].append(
        make_msg(32, frm="Boss <boss@corp.example>",
                 subject="Re: Project plan", msgid="<r2@x>",
                 irt="<r1@x>", refs="<root@x> <r1@x>",
                 date="03-Mar-2024 10:00:00 +0000", size=3000))
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    return bridge


def thread_rec(label="Project plan"):
    return next(r for r in mailops.STATE["groups"]["thread"].values()
                if r["label"] == label)


def test_scan_requests_the_threading_headers(bridge, monkeypatch):
    specs = []
    orig = bridge.uid
    monkeypatch.setattr(bridge, "uid", lambda cmd, *a: (
        specs.append(a[1]) if cmd == "FETCH" else None) or orig(cmd, *a))
    mailops.run_scan()
    full = [s for s in specs if "RFC822.SIZE" in s]
    assert full and all("IN-REPLY-TO" in s and "REFERENCES" in s
                        for s in full)


def test_conversation_becomes_one_thread_group(threaded):
    rec = thread_rec()
    assert rec["count"] == 3 and rec["size"] == 6000
    assert rec["sub"] == "3 mails, 2 senders"
    assert rec["first"] == "2024-03-01" and rec["last"] == "2024-03-03"
    assert rec["folders"] == {"INBOX": [30, 31], "Archive": [32]}
    assert sorted(rec["samples"]) == ["alice@friends.example",
                                      "boss@corp.example"]
    lunch = thread_rec("Lunch?")
    assert lunch["count"] == 1 and lunch["sub"] == "1 mail, 1 sender"
    # the 5 default fixture mails are all singleton threads
    assert len(mailops.STATE["groups"]["thread"]) == 5 + 2
    # index records carry the linkage
    m31 = mailops.INDEX[mailops.ikey("INBOX", 31)]
    assert m31["irt"] == ["<root@x>"] and m31["refs"] == ["<root@x>"]


def test_a_new_reply_joins_its_thread_on_an_incremental_scan(
        threaded, monkeypatch):
    key = thread_rec()["key"]
    fetched = []
    orig = threaded.uid
    monkeypatch.setattr(threaded, "uid", lambda cmd, *a: (
        fetched.append((a[0], a[1])) if cmd == "FETCH"
        and "RFC822.SIZE" in a[1] else None) or orig(cmd, *a))
    threaded.mailbox["INBOX"].append(
        make_msg(40, frm="boss@corp.example", subject="Re: Re: Project plan",
                 msgid="<r3@x>", irt="<r2@x>", refs="<root@x> <r1@x> <r2@x>",
                 date="09-Mar-2024 10:00:00 +0000", size=500))
    mailops.run_scan()
    rec = thread_rec()
    assert rec["key"] == key and rec["count"] == 4        # same key, grown
    assert fetched == [("40", fetched[0][1])]             # only the new mail


def test_group_mails_endpoint_lists_the_whole_conversation(threaded):
    key = thread_rec()["key"]
    rows = client.get("/api/group", params={
        "grouping": "thread", "key": key}).json()
    assert sorted((m["folder"], m["uid"]) for m in rows) == \
        [("Archive", 32), ("INBOX", 30), ("INBOX", 31)]
    st = client.get("/api/state").json()
    assert key in st["groups"]["thread"]
    csv_text = client.get("/api/export", params={"grouping": "thread"}).text
    assert "Project plan" in csv_text


# ------------------------------------------------------------- snapshots

def test_snapshot_roundtrip_keeps_threads(threaded):
    before = mailops.STATE["groups"]["thread"].keys()
    accountsmod.reset()
    acc = accountsmod.get()
    assert mailops.load_snapshot(acc)
    assert acc.state["groups"]["thread"].keys() == before
    assert acc.index[mailops.ikey("Archive", 32)]["refs"] == \
        ["<root@x>", "<r1@x>"]


def test_pre_thread_snapshot_is_ignored_so_headers_are_refetched(threaded):
    """Migration: a v1 snapshot has no irt/refs - loading it would leave old
    mails unthreaded forever (incremental scans reuse cached records)."""
    acc = accountsmod.get()
    path = mailops._snap_path(acc.name)
    data = json.loads(path.read_text())
    assert data["version"] == 2
    for m in data["index"]:
        m.pop("irt"), m.pop("refs")
    data["groups"].pop("thread")
    data["version"] = 1
    path.write_text(json.dumps(data))

    accountsmod.reset()
    acc2 = accountsmod.get()
    assert mailops.load_snapshot(acc2) is False
    assert not acc2.index and acc2.state["status"] == "idle"
    mailops.run_scan(acc2)                       # nothing cached: full fetch
    assert acc2.state["groups"]["thread"]
    rec = next(r for r in acc2.state["groups"]["thread"].values()
               if r["label"] == "Project plan")
    assert rec["count"] == 3


# --------------------------------------------- consumers of GROUPINGS

def test_delete_thread_group_moves_the_whole_conversation_and_undoes(threaded):
    key = thread_rec()["key"]
    r = mailops.delete_groups("thread", [key])
    assert r["queued"] == 3
    wait_delete_done()
    assert {m["uid"] for m in threaded.mailbox["Trash"]} == {30, 31, 32}
    assert key not in mailops.STATE["groups"]["thread"]
    # the other groupings were patched in place too
    assert "boss@corp.example" not in mailops.STATE["groups"]["sender"]
    res = mailops.undo_last()
    assert res["restored"] == 3


def test_protected_sender_in_a_thread_protects_the_thread(threaded):
    cfgmod.update_config({"protected": ["boss@corp.example"]})
    rec = mailops.public_state()["groups"]["thread"][thread_rec()["key"]]
    assert rec["protected"] is True
    assert not mailops.public_state()["groups"]["thread"][
        thread_rec("Lunch?")["key"]]["protected"]
    key = rec["key"]
    with pytest.raises(ValueError, match="protected"):
        mailops.delete_groups("thread", [key])
    assert not threaded.mailbox["Trash"]
    r = mailops.delete_groups("thread", [key], force=True)
    assert r["queued"] == 3
    wait_delete_done()


def test_pinned_mail_survives_a_thread_delete(threaded):
    key = thread_rec()["key"]
    assert client.post("/api/pin", json={"folder": "INBOX", "uid": 31,
                                         "pinned": True}).status_code == 200
    assert mailops.public_state()["groups"]["thread"][key]["pinned"] == 1
    r = mailops.delete_groups("thread", [key])
    assert r["queued"] == 2 and r["skipped_pinned"] == 1
    wait_delete_done()
    assert {m["uid"] for m in threaded.mailbox["Trash"]} == {30, 32}
    # only the pinned mail left: nothing to do
    with pytest.raises(ValueError, match=mailops.ALL_PINNED):
        mailops.delete_groups("thread", [thread_rec()["key"]])


def test_rules_accept_thread_grouping_and_run_on_it(threaded):
    with pytest.raises(ValueError):
        rulesmod.create_rule({"name": "bad", "grouping": "nope", "query": ""})
    rule = rulesmod.create_rule({
        "name": "old threads", "grouping": "thread", "query": "age:>1y",
        "action": "trash"})
    res = rulesmod.run_rule(rule["id"])           # report mode
    assert res["mode"] == "report"
    assert res["mails"] >= 3 and res["acted"] == 0
    assert any(p["label"] == "Project plan" for p in res["preview"])
    rulesmod.update_rule(rule["id"], {"mode": "execute"})
    res = rulesmod.run_rule(rule["id"], rescan=False)
    assert res["acted"] >= 3
    wait_delete_done()
    assert {30, 31, 32} <= {m["uid"] for m in threaded.mailbox["Trash"]}


def test_block_endpoints_reject_thread_groupings(threaded):
    r = client.post("/api/block", json={
        "grouping": "thread", "key": thread_rec()["key"], "label": "x"})
    assert r.status_code == 400


# --------------------------------------------------- verdicts and AI

def _fake_ai(monkeypatch, sent):
    def create(**kw):
        payload = json.loads(kw["messages"][0]["content"])
        sent.append(payload)
        verdicts = [{"key": g["key"], "verdict": "review", "reason": "t"}
                    for g in payload["groups"]]
        return types.SimpleNamespace(
            stop_reason="end_turn",
            content=[types.SimpleNamespace(
                type="text", text=json.dumps({"verdicts": verdicts}))],
            usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: types.SimpleNamespace(
        messages=types.SimpleNamespace(create=create)))


def test_thread_verdicts_cache_across_rescans_and_payload_shape(
        threaded, monkeypatch):
    cfgmod.update_config({"ai": {"api_key": "k"}})
    sent: list = []
    _fake_ai(monkeypatch, sent)
    aihelper._run_ai("sender")
    aihelper._run_ai("thread")
    base = {"key", "label", "count", "total_size_kb", "unread", "first",
            "last", "tags", "samples"}
    optional = {"replied", "protected"}        # same as every other grouping
    thread_groups = sent[1]["groups"]
    assert thread_groups
    for g in thread_groups + sent[0]["groups"]:
        assert base <= set(g) <= base | optional
    assert not any("<" in g["key"] for g in thread_groups)   # no raw ids
    rec = thread_rec()
    assert rec["ai"] and rec["ai"]["verdict"] == "review"

    key = rec["key"]
    threaded.mailbox["INBOX"].append(      # a reply arrives; rescan
        make_msg(40, frm="boss@corp.example", subject="Re: Project plan",
                 msgid="<r3@x>", irt="<r2@x>", refs="<root@x> <r1@x> <r2@x>",
                 date="09-Mar-2024 10:00:00 +0000"))
    mailops.run_scan()
    rec = thread_rec()
    assert rec["key"] == key and rec["count"] == 4
    assert rec["ai"] and rec["ai"]["verdict"] == "review"   # still cached
    assert verdictstore.load_account("default")["thread"]


def test_state_exposes_the_thread_grouping(bridge):
    assert "thread" in client.get("/api/state").json()["groups"]
