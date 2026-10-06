"""Per-group engagement score: the pure formula (monotonicity, clamps,
tiers), its exposure on group records / public_state (also for snapshots
that predate it), the eng:* filter in rules, and that it never reaches the
AI payload."""

import json
import time

import pytest

from backend import accounts as accountsmod
from backend import mailops
from backend import rules as rulesmod

from conftest import make_msg
from test_ai_unsub import FakeClient

NOW = 1_800_000_000.0
DAY = 86400


def eng(count=10, unread=0, replied=False, bulk=False, age_days=0, now=NOW):
    last = None if age_days is None else now - age_days * DAY
    return mailops.engagement(count, unread, replied, bulk, last, now)


# ------------------------------------------------------------------ formula

def test_read_ratio_is_the_backbone():
    assert eng(unread=0) == 100                     # everything read
    assert eng(unread=10) == 0                      # nothing read
    assert eng(count=10, unread=5) == 50
    assert eng(count=100, unread=88) == 12          # "12% read"


def test_more_unread_never_raises_the_score():
    for replied in (False, True):
        for bulk in (False, True):
            for age in (0, 100, 400, 2000):
                scores = [eng(20, u, replied, bulk, age) for u in range(21)]
                assert scores == sorted(scores, reverse=True), \
                    (replied, bulk, age)


def test_replied_always_raises_the_score():
    for unread in range(0, 11):                     # 10 = fully unread
        for bulk in (False, True):
            for age in (0, 400, 2000):
                base = eng(10, unread, False, bulk, age)
                boosted = eng(10, unread, True, bulk, age)
                maxed = unread == 0 and not bulk   # nothing left to boost
                assert boosted > base or maxed, (unread, bulk, age)
                assert boosted >= base
    assert eng(10, 10, True) == 60          # never opened, but you write back


def test_replied_is_never_lower_even_when_already_maxed():
    assert eng(10, 0, True) == eng(10, 0, False) == 100


def test_older_last_mail_lowers_the_score():
    ages = [0, 30, 60, 200, 400, 700, 730, 1500, 4000]
    scores = [eng(10, 2, False, False, a) for a in ages]
    assert scores == sorted(scores, reverse=True)
    assert eng(10, 2, age_days=2000) < eng(10, 2, age_days=10)
    # fresh window: no penalty; floor: half the score at >= 2 years
    assert eng(10, 0, age_days=30) == 100
    assert eng(10, 0, age_days=730) == 50
    assert eng(10, 0, age_days=9999) == 50


def test_bulk_dampens_the_score():
    assert eng(10, 0, bulk=True) == 70
    assert eng(10, 5, bulk=True) < eng(10, 5)
    assert eng(10, 10, bulk=True) == 0


def test_unknown_last_date_applies_no_recency_penalty():
    assert eng(10, 0, age_days=None) == 100
    assert mailops.engagement(10, 0, False, False, 0, NOW) == 100


def test_clamps_and_degenerate_inputs():
    assert mailops.engagement(0, 0, False, False, None, NOW) == 0
    assert mailops.engagement(0, 5, True, False, None, NOW) == 0
    assert eng(10, unread=99) == 0                  # unread > count clamps
    assert eng(10, unread=-4) == 100                # negative unread clamps
    # last mail in the future must not push the score over 100
    assert mailops.engagement(10, 0, True, False, NOW + 99 * DAY, NOW) == 100
    for u in range(0, 12):
        for r in (False, True):
            for b in (False, True):
                v = eng(10, u, r, b, 12345)
                assert isinstance(v, int) and 0 <= v <= 100


def test_deterministic():
    assert eng(7, 3, True, True, 123) == eng(7, 3, True, True, 123)


def test_tier_thresholds():
    t = mailops.engagement_tier
    assert [t(s) for s in (0, 33)] == ["low", "low"]
    assert [t(s) for s in (34, 50, 66)] == ["medium"] * 3
    assert [t(s) for s in (67, 100)] == ["high", "high"]
    assert mailops.ENGAGEMENT_LOW_MAX == 33
    assert mailops.ENGAGEMENT_HIGH_MIN == 67


# --------------------------------------------------------- group records

def scan(bridge):
    mailops.run_scan()
    assert mailops.STATE["status"] == "done", mailops.STATE["error"]


def test_build_groups_sets_engagement_on_every_grouping(bridge):
    scan(bridge)
    for recs in mailops.STATE["groups"].values():
        for rec in recs.values():
            assert 0 <= rec["engagement"] <= 100


def test_public_state_exposes_engagement(bridge):
    scan(bridge)
    groups = mailops.public_state()["groups"]["sender"]
    # alice: 1 mail, read, replied to (Sent has a reply) -> max
    assert groups["alice@friends.example"]["engagement"] == 100
    # the shop newsletter: unread + bulk + never replied -> bottom
    assert groups["news@shop.example"]["engagement"] == 0
    # dhl: 1 of 3 unread, shipping notices
    assert 0 < groups["noreply@dhl.example"]["engagement"] < 100


def test_public_state_follows_live_counters_after_mark_read(bridge):
    scan(bridge)
    key = "news@shop.example"
    assert mailops.public_state()["groups"]["sender"][key]["engagement"] == 0
    mailops._apply_seen("INBOX", [4], accountsmod.get())
    now = mailops.public_state()["groups"]["sender"][key]["engagement"]
    assert now > 0                       # the stored scan-time value was 0


def test_old_snapshot_without_engagement_is_tolerated(bridge, tmp_path):
    scan(bridge)
    acc = accountsmod.get()
    mailops.save_snapshot(acc)
    path = mailops._snap_path(acc.name, acc.tenant)
    data = json.loads(path.read_text())
    for recs in data["groups"].values():
        for rec in recs.values():
            del rec["engagement"]
    path.write_text(json.dumps(data))

    accountsmod.reset()
    fresh = accountsmod.get()
    assert mailops.load_snapshot(fresh)
    g = mailops.public_state(fresh)["groups"]["sender"]
    assert g["alice@friends.example"]["engagement"] == 100
    assert all("engagement" in r for r in g.values())


def test_group_engagement_tolerates_missing_or_bad_dates():
    assert mailops.group_engagement({"count": 4, "unread": 0}) == 100
    assert mailops.group_engagement(
        {"count": 4, "unread": 0, "last": "garbage"}) == 100
    assert mailops.group_engagement({}) == 0
    old = {"count": 4, "unread": 0, "last": "2000-01-01"}
    assert mailops.group_engagement(old) == 50


def test_recency_uses_the_group_last_date():
    day = lambda d: time.strftime("%Y-%m-%d", time.localtime(NOW - d * DAY))
    recent = {"count": 4, "unread": 1, "last": day(5)}
    stale = {"count": 4, "unread": 1, "last": day(900)}
    assert mailops.group_engagement(recent, NOW) \
        > mailops.group_engagement(stale, NOW)


# --------------------------------------------------------------- the filter

def test_eng_filter_parses_and_matches_tiers():
    for tier in ("low", "medium", "high"):
        assert rulesmod.parse_filter(f"eng:{tier}")["eng"] == tier
    assert rulesmod.parse_filter("")["eng"] is None
    assert rulesmod.parse_filter("ENG:Low")["eng"] == "low"   # case-folded
    bogus = rulesmod.parse_filter("eng:extreme")
    assert bogus["eng"] is None and bogus["text"] == ["eng:extreme"]

    g = {"key": "a@b", "label": "A", "sub": "", "tags": [], "unread": 0,
         "count": 3, "last": ""}
    for score, tier in ((0, "low"), (33, "low"), (34, "medium"),
                        (66, "medium"), (67, "high"), (100, "high")):
        for other in ("low", "medium", "high"):
            f = rulesmod.parse_filter(f"eng:{other}")
            assert rulesmod.match_group({**g, "engagement": score}, f) \
                is (other == tier), (score, other)


def test_eng_filter_combines_with_other_qualifiers():
    f = rulesmod.parse_filter("eng:low age:>1y")
    g = {"key": "a@b", "label": "A", "sub": "", "tags": [], "unread": 0,
         "count": 3, "last": "2020-01-01", "engagement": 5}
    assert rulesmod.match_group(g, f)
    assert not rulesmod.match_group({**g, "last": "2999-01-01"}, f)
    assert not rulesmod.match_group({**g, "engagement": 90}, f)


def test_rule_runs_on_eng_query(bridge):
    scan(bridge)
    rule = rulesmod.create_rule({
        "name": "ignored", "grouping": "sender", "query": "eng:low",
        "action": "trash"})
    res = rulesmod.run_rule(rule["id"], rescan=False)
    assert res["groups"] == 1 and res["mails"] == 1     # the shop newsletter
    assert res["preview"][0]["key"] == "news@shop.example"


# ------------------------------------------------------------ AI payload

def test_engagement_is_not_sent_to_the_ai(bridge, monkeypatch):
    from backend import aihelper
    from backend import config as cfgmod
    cfgmod.update_config({"ai": {"api_key": "k", "model": "claude-sonnet-5"}})
    scan(bridge)
    sent = []

    def payload(s):
        sent.append(s)
        return {"verdicts": [{"key": g["key"], "verdict": "review",
                              "reason": "r"} for g in s["groups"]]}
    fake = FakeClient(payload)
    monkeypatch.setattr(aihelper, "ai_client", lambda cfg: fake)
    aihelper._run_ai("sender")
    assert sent and "engagement" not in json.dumps(sent)
