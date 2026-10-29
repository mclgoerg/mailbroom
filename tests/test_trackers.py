"""Tracker report: generic pixel / click-tracking detection on the HTML of
mails the local body index parses, per-mail rows that live and die with
their doc, the group field, /api/trackers and the has:tracker filter."""

import sqlite3
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend import accounts as accountsmod
from backend import bodyindex, trackers
from backend import config as cfgmod
from backend import mailops
from backend.main import app
from conftest import make_msg

client = TestClient(app)


@pytest.fixture(autouse=True)
def secret_key(monkeypatch):
    monkeypatch.setenv("MAILBROOM_SECRET_KEY", "test-key-one")


def acc():
    return accountsmod.get()


# ---------------------------------------------------------------- scan_html

def img(**attrs):
    return "<img " + " ".join(f'{k.replace("_", "-")}="{v}"'
                              for k, v in attrs.items()) + ">"


PIXEL_CASES = {
    "1x1 attributes": img(src="https://t.tracker.example/a.gif",
                          width=1, height=1),
    "1x1 px style": img(src="https://t.tracker.example/a.gif",
                        style="width:1px; height:1px"),
    "display none": img(src="https://t.tracker.example/a.gif",
                        style="display:none"),
    "visibility hidden": img(src="https://t.tracker.example/a.gif",
                             style="visibility:hidden"),
    "opacity 0": img(src="https://t.tracker.example/a.gif",
                     style="opacity:0"),
    "max-height 0": img(src="https://t.tracker.example/a.gif",
                        style="max-height:0"),
    "beacon path": img(src="https://t.tracker.example/open/Ab3dEf9hIj2kLm5nOp.gif",
                       width=600, height=300),
    "beacon query": img(src="https://t.tracker.example/p.gif?pixel=1"
                            "&id=9f8e7d6c5b4a39281706"),
    "protocol-relative": img(src="//t.tracker.example/a.gif", width=1,
                             height=1),
}


@pytest.mark.parametrize("name", sorted(PIXEL_CASES))
def test_pixel_detected(name):
    r = trackers.scan_html(f"<p>hi</p>{PIXEL_CASES[name]}")
    assert r["pixel"] is True and r["click"] is False, name
    assert r["hosts"] == ["tracker.example"]


NOT_PIXEL_CASES = {
    "banner": img(src="https://cdn.shop.example/banner.jpg", width=600,
                  height=300),
    "banner no size": img(src="https://cdn.shop.example/banner.jpg"),
    "only width 1": img(src="https://cdn.shop.example/rule.png", width=1,
                        height=40),
    "percent size": img(src="https://cdn.shop.example/x.png", width="1%",
                        height="1%"),
    "data uri": img(src="data:image/gif;base64,R0lGOD", width=1, height=1),
    "cid": img(src="cid:logo@shop.example", width=1, height=1),
    "cid hidden": img(src="cid:logo@shop.example", style="display:none"),
    "data hidden": img(src="data:image/gif;base64,R0lG",
                       style="display:none"),
    "word without id": img(src="https://cdn.shop.example/open-door-photo.jpg"),
    "id without word": img(src="https://cdn.shop.example/Ab3dEf9hIj2kLm5nOp.jpg"),
    "bigger than 3px": img(src="https://cdn.shop.example/x.gif", width=4,
                           height=4),
}


@pytest.mark.parametrize("name", sorted(NOT_PIXEL_CASES))
def test_not_a_pixel(name):
    r = trackers.scan_html(NOT_PIXEL_CASES[name])
    assert r == {"pixel": False, "click": False, "hosts": []}, name


def test_size_threshold_is_three_pixels():
    ok = img(src="https://t.tracker.example/a.gif", width=3, height=3)
    big = img(src="https://t.tracker.example/a.gif", width=4, height=3)
    assert trackers.scan_html(ok)["pixel"] is True
    assert trackers.scan_html(big)["pixel"] is False


@pytest.mark.parametrize("href", [
    "https://go.mailer.example/click/Ab3dEf9hIj2kLm5nOp",
    "https://go.mailer.example/redirect?x=1",
    "https://go.mailer.example/c/Ab3dEf9hIj2kLm5nOp7",
    "https://go.mailer.example/landing?url=https%3A%2F%2Fshop.example%2Fsale",
    "http://go.mailer.example/e/tracking/Ab3dEf9hIj2kLm5nOp7",
])
def test_redirect_links_are_click_tracking(href):
    r = trackers.scan_html(f'<a href="{href}">Buy</a>')
    assert r == {"pixel": False, "click": True, "hosts": ["mailer.example"]}


@pytest.mark.parametrize("href", [
    "https://shop.example/sale/summer",
    "https://shop.example/c/shoes",
    "https://shop.example/blog/click-here-for-more",
    "mailto:hello@shop.example",
    "https://shop.example/page?lang=de&ref=newsletter",
    "/relative/click",
    "https://shop.example/orders/track",
    "https://shop.example/orders/track?order=1234",
    "https://shop.example/help/tracking-your-parcel",
    "https://shop.example/orders/tracking/1234",
])
def test_normal_links_are_not_click_tracking(href):
    r = trackers.scan_html(f'<a href="{href}">Read</a>')
    assert r == {"pixel": False, "click": False, "hosts": []}


def test_hosts_are_registrable_domains_deduped_and_capped():
    imgs = "".join(img(src=f"https://m.t{i}.example/a.gif", width=1,
                       height=1) for i in range(8))
    r = trackers.scan_html(imgs + imgs)
    assert r["hosts"] == [f"t{i}.example" for i in range(5)]
    # a multi-part suffix: the name is built from labels, not written out
    multi = ".".join(["tracker", "co", "uk"])
    uk = trackers.scan_html(img(src=f"https://a.b.{multi}/x.gif",
                                width=1, height=1))
    assert uk["hosts"] == [multi]


def test_pixel_and_click_together():
    r = trackers.scan_html(
        img(src="https://t.a.example/o.gif", width=1, height=1)
        + '<a href="https://c.b.example/click/1">x</a>')
    assert r == {"pixel": True, "click": True,
                 "hosts": ["a.example", "b.example"]}


def test_broken_html_is_tolerated():
    html = ('<div><img src="https://t.tracker.example/a.gif" width=1 '
            'height=1 <<< <a href="https://go.m.example/click/1" '
            '<p>unclosed &bogus; <table><tr><td>')
    r = trackers.scan_html(html)
    assert isinstance(r["pixel"], bool) and isinstance(r["hosts"], list)
    assert trackers.scan_html("") == {"pixel": False, "click": False,
                                      "hosts": []}
    assert trackers.scan_html(None)["pixel"] is False


def test_huge_html_is_bounded():
    pad = "<p>x</p>" * 200_000                       # > MAX_HTML characters
    tail = img(src="https://t.tracker.example/a.gif", width=1, height=1)
    t0 = time.time()
    # beyond the character cap: not looked at
    assert trackers.scan_html(pad + tail)["pixel"] is False
    # many tags: stops at the tag cap, still answers quickly
    many = '<a href="https://shop.example/x">x</a>' * 20_000
    assert trackers.scan_html(many + tail)["pixel"] is False
    assert time.time() - t0 < 5


@pytest.mark.parametrize("attrs", [
    'style="width:1' + " " * 60_000 + 'x"',
    'style="width:1px' + " " * 60_000 + 'x; height:1' + " " * 60_000 + '"',
    'style="display:none' + " " * 60_000 + 'x"',
    'width="1' + " " * 60_000 + 'x" height="1"',
    'width="1' + " " * 60_000 + '" height="1' + " " * 60_000 + 'x"',
])
def test_long_whitespace_runs_in_attributes_stay_linear(attrs):
    html = f'<img src="https://t.tracker.example/a.gif" {attrs}>'
    t0 = time.time()
    trackers.scan_html(html)
    assert time.time() - t0 < 0.5


def test_long_urls_stay_bounded():
    url = "https://t.tracker.example/" + "a1" * 100_000
    t0 = time.time()
    trackers.scan_html(f'<img src="{url}"><a href="{url}">x</a>')
    assert time.time() - t0 < 0.5


def test_scan_message_uses_the_html_part_only():
    import email
    raw = ("From: a@shop.example\r\nContent-Type: multipart/alternative; "
           'boundary="b"\r\n\r\n--b\r\nContent-Type: text/plain\r\n\r\n'
           "hello\r\n--b\r\nContent-Type: text/html\r\n\r\n"
           + img(src="https://t.tracker.example/a.gif", width=1, height=1)
           + "\r\n--b--\r\n")
    assert trackers.scan_message(email.message_from_string(raw))["pixel"]
    plain = email.message_from_string(
        "From: a@shop.example\r\n\r\n"
        + img(src="https://t.tracker.example/a.gif", width=1, height=1))
    assert trackers.scan_message(plain) == {
        "pixel": False, "click": False, "hosts": []}


# ------------------------------------------------------ index integration

PIX = img(src="https://t.tracker.example/o/Ab3dEf9hIj2kLm5nOp.gif",
          width=1, height=1)
CLICK = '<a href="https://go.mailer.example/click/77">Shop</a>'
CLEAN = ('<p>Hello</p><img src="https://cdn.shop.example/banner.jpg" '
         'width="600" height="300">'
         '<a href="https://shop.example/sale">Sale</a>')


@pytest.fixture
def scanned(bridge):
    for m in bridge.mailbox["INBOX"] + bridge.mailbox["Archive"]:
        m["html"] = None
    by_uid = {m["uid"]: m for m in
              bridge.mailbox["INBOX"] + bridge.mailbox["Archive"]}
    by_uid[1]["html"] = f"<p>Parcel</p>{PIX}"                # dhl: pixel
    by_uid[2]["html"] = f"<p>Parcel 2</p>{CLICK}"            # dhl: click
    by_uid[4]["html"] = CLEAN                                # shop: clean
    by_uid[4]["body"] = "plain text twin"
    # uid 3 (alice) and uid 10 stay plain text
    cfgmod.update_config({"imap": {"body_search": "local"}})
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]
    return bridge


def wait_index(timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        with acc().lock:
            if acc().state["index"]["status"] != "running":
                return dict(acc().state["index"])
        time.sleep(0.01)
    raise TimeoutError


def build(rebuild=False):
    bodyindex.start_build(acc(), rebuild=rebuild)
    job = wait_index()
    assert job["status"] == "done", job


def rows():
    conn = sqlite3.connect(bodyindex._path(acc().name))
    try:
        return {(f, u): (p, c, h) for f, u, _uv, p, c, h in conn.execute(
            "SELECT folder, uid, uv, pixel, click, hosts FROM trackers")}
    finally:
        conn.close()


def test_build_stores_flags_and_domains_only(scanned):
    build()
    assert rows() == {
        ("INBOX", 1): (1, 0, "tracker.example"),
        ("INBOX", 2): (0, 1, "mailer.example"),
        ("INBOX", 3): (0, 0, ""),
        ("INBOX", 4): (0, 0, ""),
        ("Archive", 10): (0, 0, ""),
    }
    raw = bodyindex._path(acc().name).read_bytes()
    assert b"Ab3dEf9hIj2kLm5nOp" not in raw        # no URL, no token
    assert b"https://" not in raw


def test_rows_are_dropped_with_their_doc(scanned):
    build()
    scanned.mailbox["INBOX"] = [m for m in scanned.mailbox["INBOX"]
                                if m["uid"] != 1]
    mailops.run_scan()
    assert ("INBOX", 1) not in rows() and len(rows()) == 4


def test_uidvalidity_change_drops_the_rows(scanned):
    build()
    scanned.uv["INBOX"] = 42                  # the folder was recreated
    mailops.run_scan()                        # tops the index up inline
    conn = sqlite3.connect(bodyindex._path(acc().name))
    uvs = {r[0] for r in conn.execute(
        "SELECT DISTINCT uv FROM trackers WHERE folder='INBOX'")}
    conn.close()
    assert uvs == {42}                         # old-uv rows are gone
    assert ("Archive", 10) in rows()


def test_rebuild_checks_docs_indexed_before_this_feature(scanned):
    build()
    conn = sqlite3.connect(bodyindex._path(acc().name))
    conn.execute("DROP TABLE trackers")             # an index of an old image
    conn.commit()
    conn.close()
    idx, reason = bodyindex.open_index(acc().name, acc().tenant)
    assert idx is not None and reason is None       # still opens
    assert idx.tracker_rows() == [] and idx.doc_count() == 5
    idx.close()
    rep = trackers.report(acc())
    assert rep["docs"] == 5 and rep["checked"] == 0 and rep["top_senders"] == []
    build(rebuild=True)
    assert len(rows()) == 5
    assert trackers.report(acc())["checked"] == 5


def test_orphan_rows_of_an_older_image_are_ignored(scanned):
    build()
    idx, _ = bodyindex.open_index(acc().name, acc().tenant)
    ids = [i for (f, u, uv), i in idx.known().items() if u == 1]
    # what an older image does: drops the doc, knows nothing of the table
    idx.conn.execute("DELETE FROM words WHERE d=?", ids)
    idx.conn.execute("DELETE FROM docs WHERE id=?", ids)
    idx.conn.commit()
    assert ("INBOX", 1) in rows()                   # orphan row is still there
    assert all(r[:2] != ("INBOX", 1) for r in idx.tracker_rows())
    idx.close()
    assert trackers.report(acc())["checked"] == 4


# ------------------------------------------------------------ group field

def groups(grouping="sender"):
    return mailops.public_state(acc())["groups"][grouping]


def test_groups_carry_the_tracker_summary(scanned):
    build()
    g = groups()
    assert g["noreply@dhl.example"]["trackers"] == {
        "checked": 3, "pixel": 1, "click": 1,
        "hosts": ["mailer.example", "tracker.example"]}
    assert g["news@shop.example"]["trackers"] == {
        "checked": 1, "pixel": 0, "click": 0, "hosts": []}
    # other groupings too
    assert groups("domain")["dhl.example"]["trackers"]["pixel"] == 1


def test_no_group_field_without_an_index(scanned):
    assert all("trackers" not in g for g in groups().values())
    build()
    client.post("/api/index/delete")
    assert all("trackers" not in g for g in groups().values())


def test_group_field_refreshes_with_the_index(scanned):
    build()
    assert groups()["alice@friends.example"]["trackers"]["checked"] == 1
    bodyindex.drop(acc().name, acc().tenant)
    assert "trackers" not in groups()["alice@friends.example"]


def test_group_field_ignores_mails_of_a_changed_folder(scanned):
    build()
    acc().folder_uv["Archive"] = 777
    assert groups()["noreply@dhl.example"]["trackers"]["checked"] == 2


def test_account_separation(scanned):
    build()
    other = SimpleNamespace(name="other", tenant=acc().tenant)
    assert trackers.tracker_map(other) == {}
    assert trackers.tracker_map(acc())


# ------------------------------------------------------------ /api/trackers

def test_api_report_aggregates(scanned):
    build()
    r = client.get("/api/trackers").json()
    assert r["usable"] and r["docs"] == 5 and r["checked"] == 5
    assert (r["pixel"], r["click"], r["any"], r["senders"]) == (1, 1, 2, 1)
    assert r["top_senders"] == [{
        "key": "noreply@dhl.example", "label": "DHL Paket", "checked": 3,
        "tracked": 2, "pixel": 1, "click": 1,
        "hosts": ["mailer.example", "tracker.example"]}]
    assert r["top_hosts"] == [
        {"host": "mailer.example", "mails": 1, "senders": 1},
        {"host": "tracker.example", "mails": 1, "senders": 1}]
    assert r["mode"] == "local" and r["secret_key_set"] and r["scanned"]
    assert r["job"]["status"] == "done"
    assert r["estimate_full"]["mails"] == 5


def test_api_report_without_an_index(scanned):
    r = client.get("/api/trackers").json()
    assert r["usable"] is False and r["checked"] == 0
    assert r["top_senders"] == [] and r["top_hosts"] == []


def test_api_report_orders_senders_by_tracked_mails(scanned):
    scanned.mailbox["INBOX"].append(make_msg(
        30, frm="Deals <deals@promo.example>", msgid="<p30@x>",
        html=PIX))
    scanned.mailbox["INBOX"].append(make_msg(
        31, frm="Deals <deals@promo.example>", msgid="<p31@x>",
        html=PIX + CLICK))
    cfgmod.update_config({"imap": {"body_search": "local"}})
    mailops.run_scan()
    build()
    top = client.get("/api/trackers").json()["top_senders"]
    assert [s["key"] for s in top] == ["deals@promo.example",
                                       "noreply@dhl.example"]


def test_no_ai_payload_carries_tracker_data(scanned):
    import glob
    import json
    import os
    from backend import aisort
    # every module that talks to an AI provider (settings aside)
    base = os.path.dirname(bodyindex.__file__)
    mods = {p for p in glob.glob(os.path.join(base, "*.py"))
            if os.path.basename(p) not in ("config.py", "trackers.py")
            and any(w in open(p).read()
                    for w in ("ai_call(", "ai_client", "anthropic"))}
    mods |= set(glob.glob(os.path.join(base, "ai*.py")))
    assert any(p.endswith("aisort.py") for p in mods)
    for p in sorted(mods):
        src = open(p).read().lower()
        assert "tracker" not in src and "pixel" not in src, p
    # and the real payload units, with the tracker data present
    build()
    assert groups()["noreply@dhl.example"]["trackers"]
    units = json.dumps(aisort.collect_units(acc())).lower()
    for needle in ("tracker", "pixel", "mailer.example"):
        assert needle not in units


def test_checked_and_docs_share_one_base_after_deletes(scanned):
    build()
    with acc().lock:                          # a delete before the next sync
        for k in [k for k, m in acc().index.items() if m["uid"] == 1]:
            del acc().index[k]
    r = trackers.report(acc())
    assert r["docs"] == 5 and r["checked"] == 5
    assert r["pixel"] == 1                    # the deleted mail's own row


def test_second_state_build_does_no_per_mail_work(scanned, monkeypatch):
    build()
    calls = []
    real = trackers.group_trackers
    monkeypatch.setattr(trackers, "group_trackers",
                        lambda *a, **k: calls.append(1) or real(*a, **k))
    first = mailops.public_state(acc())["groups"]
    n = len(calls)
    assert n > 0
    second = mailops.public_state(acc())["groups"]
    assert len(calls) == n                    # nothing recomputed
    assert second["sender"]["noreply@dhl.example"]["trackers"] == \
        first["sender"]["noreply@dhl.example"]["trackers"]
    with acc().lock:                          # the groups changed
        acc().state["groups_rev"] += 1
    mailops.public_state(acc())
    assert len(calls) > n


def test_group_cache_is_replaced_not_accumulated(scanned):
    build()
    mailops.public_state(acc())
    sizes = (len(trackers._GROUP_CACHE), len(trackers._MAP_CACHE))
    for _ in range(3):
        with acc().lock:
            acc().state["groups_rev"] += 1
        mailops.public_state(acc())
    assert (len(trackers._GROUP_CACHE), len(trackers._MAP_CACHE)) == sizes
    path = str(bodyindex._path(acc().name, acc().tenant))
    assert trackers._GROUP_CACHE[path][0][1] == acc().state["groups_rev"]
