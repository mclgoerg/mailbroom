import { describe, expect, it } from "vitest";
import { applyStatus, fmtDate, ENGAGEMENT_HIGH_MIN, ENGAGEMENT_LOW_MAX,
  engagementTier, fmtAgo, fmtSize, fmtUsd, mailKey, matchGroup, olderThan,
  parseFilter, parseProgress, retainedMailKeys, sieveSnippet } from "./lib";
import type { Group } from "./types";

const g = (over: Partial<Group> = {}): Group => ({
  key: "noreply@dhl.example", label: "DHL Paket", sub: "noreply@dhl.example",
  count: 100, size: 5000, unread: 90, first: "2024-01-01",
  last: "2024-06-01", tags: ["shipping", "newsletter"], samples: [],
  bulk: true, unsub: true, ai: { verdict: "delete_safe", reason: "x" },
  ratings: null, protected: false, replied: false, att_size: 0,
  unsubscribed: null, new: false, pinned: 0, engagement: 50,
  ...over,
});

describe("formatters", () => {
  it("fmtSize", () => {
    expect(fmtSize(500)).toBe("500 B");
    expect(fmtSize(2048)).toBe("2 KB");
    expect(fmtSize(3 * 1048576)).toBe("3.0 MB");
  });
  it("fmtUsd", () => {
    expect(fmtUsd(0.0034)).toBe("$0.0034");
    expect(fmtUsd(1.5)).toBe("$1.50");
  });
  it("mailKey", () => {
    expect(mailKey({ folder: "INBOX", uid: 7 })).toBe("INBOX 7");
  });
  it("olderThan", () => {
    const now = Date.now() / 1000;
    expect(olderThan({ ts: now - 400 * 86400 }, 12)).toBe(true);
    expect(olderThan({ ts: now - 10 * 86400 }, 12)).toBe(false);
    expect(olderThan({ ts: 0 }, 12)).toBe(false);
  });
});

// Mirrors backend/mailops.py::retained_mails - same fixture shape as
// tests/test_retention.py so the two stay in lockstep.
describe("retainedMailKeys", () => {
  const mails = [
    { folder: "INBOX", uid: 1, ts: 500 },
    { folder: "INBOX", uid: 2, ts: 500 },      // ties uid1 on ts
    { folder: "Archive", uid: 10, ts: 100 },   // oldest real timestamp
  ];

  it("no restriction exempts nothing", () => {
    expect(retainedMailKeys(mails, null, null)).toEqual(new Set());
  });

  it("pinned mails join the keep-set on top of the window, without "
    + "using up a keep-latest slot (mirrors mailops.retained_mails)", () => {
    const pinnedOld = mails.map((m) =>
      m.uid === 10 ? { ...m, pinned: true } : m);
    expect(retainedMailKeys(pinnedOld, 1, null, true))
      .toEqual(new Set(["INBOX 1", "Archive 10"]));
    expect(retainedMailKeys(pinnedOld, null, null, true))
      .toEqual(new Set(["Archive 10"]));
    // without skipPinned (mark_read) the pin is ignored
    expect(retainedMailKeys(pinnedOld, 1, null, false))
      .toEqual(new Set(["INBOX 1"]));
    // a pin on an old mail also survives an older-than-days window
    expect(retainedMailKeys(pinnedOld, null, 30, true))
      .toEqual(new Set(["Archive 10"]));
  });

  it("keep_latest keeps the newest N, ties break by folder then uid", () => {
    expect(retainedMailKeys(mails, 1, null)).toEqual(new Set(["INBOX 1"]));
    expect(retainedMailKeys(mails, 2, null))
      .toEqual(new Set(["INBOX 1", "INBOX 2"]));
  });

  it("ts == 0 sorts as oldest for keep_latest", () => {
    const withZero = [...mails, { folder: "INBOX", uid: 3, ts: 0 }];
    const keep = retainedMailKeys(withZero, 3, null);
    expect(keep.has("INBOX 3")).toBe(false);
  });

  it("older_than_days exempts recent mails, treats ts == 0 as old", () => {
    const now = Date.now() / 1000;
    const recent = [
      { folder: "INBOX", uid: 1, ts: now },
      { folder: "INBOX", uid: 2, ts: 0 },
      { folder: "Archive", uid: 10, ts: now - 400 * 86400 },
    ];
    expect(retainedMailKeys(recent, null, 30)).toEqual(new Set(["INBOX 1"]));
  });
});

describe("parseFilter", () => {
  it("splits qualifiers and text", () => {
    const f = parseFilter("tag:ship ai:safe age:>1y unread:>80 is:unsub dhl");
    expect(f.tags).toEqual(["ship"]);
    expect(f.ai).toBe("delete_safe");
    expect(f.ageMonths).toBe(12);
    expect(f.unreadMin).toBe(80);
    expect(f.unsub).toBe(true);
    expect(f.text).toEqual(["dhl"]);
  });
  it("handles plain text and months", () => {
    expect(parseFilter("hello world").text).toEqual(["hello", "world"]);
    expect(parseFilter("age:>6m").ageMonths).toBe(6);
    expect(parseFilter("age:bogus").ageMonths).toBeNull();
  });
  it("recognises is:protected", () => {
    expect(parseFilter("is:protected").protectedOnly).toBe(true);
    expect(parseFilter("dhl").protectedOnly).toBe(false);
  });
  it("recognises is:new", () => {
    expect(parseFilter("is:new").newOnly).toBe(true);
    expect(parseFilter("dhl").newOnly).toBe(false);
  });
  it("recognises is:replied / is:noreply-ever", () => {
    expect(parseFilter("is:replied").replied).toBe(true);
    expect(parseFilter("is:noreply-ever").replied).toBe(false);
    expect(parseFilter("dhl").replied).toBeNull();
  });
  it("recognises is:unsubscribed / is:not-unsubscribed", () => {
    expect(parseFilter("is:unsubscribed").unsubscribed).toBe(true);
    expect(parseFilter("is:not-unsubscribed").unsubscribed).toBe(false);
    expect(parseFilter("dhl").unsubscribed).toBeNull();
  });
  it("parses attachment sizes", () => {
    expect(parseFilter("att:>10m").attMin).toBe(10 * 1048576);
    expect(parseFilter("att:>500k").attMin).toBe(500 * 1024);
    expect(parseFilter("att:5").attMin).toBe(5);
    expect(parseFilter("att:bogus").attMin).toBeNull();
  });
  it("has:pinned parses like backend/rules.py; other has:* is plain text",
    () => {
    expect(parseFilter("has:pinned").pinnedOnly).toBe(true);
    expect(parseFilter("has:pinned").text).toEqual([]);
    expect(parseFilter("").pinnedOnly).toBe(false);
    const other = parseFilter("has:other");
    expect(other.pinnedOnly).toBe(false);
    expect(other.text).toEqual(["has:other"]);
  });
  it("recognises from:/domain: (block-sender exact qualifiers)", () => {
    expect(parseFilter("from:noreply@dhl.example").fromAddr)
      .toBe("noreply@dhl.example");
    expect(parseFilter("dhl").fromAddr).toBeNull();
    expect(parseFilter("domain:dhl.example").domain).toBe("dhl.example");
    expect(parseFilter("dhl").domain).toBeNull();
  });
});

describe("sieveSnippet", () => {
  it("fileinto for a sender", () => {
    const s = sieveSnippet("sender", "news@shop.example", "fileinto", "Ads");
    expect(s).toContain('require ["fileinto"];');
    expect(s).toContain('if address :is "from" "news@shop.example" {');
    expect(s).toContain('fileinto "Ads";');
  });
  it("discard for a domain, no require", () => {
    const s = sieveSnippet("domain", "shop.example", "discard");
    expect(s).not.toContain("require");
    expect(s).toContain('address :domain "from" "shop.example"');
    expect(s).toContain("discard;");
    expect(s).toContain("stop;");
  });
  it("markread requires imap4flags and escapes quotes", () => {
    const s = sieveSnippet("sender", 'a"b@x.example', "markread");
    expect(s).toContain('require ["imap4flags"];');
    expect(s).toContain('addflag "\\\\Seen";');
    expect(s).toContain('"a\\"b@x.example"');
  });
});

// Mirrors backend/mailops.py ENGAGEMENT_* / engagement_tier and the cases in
// tests/test_engagement.py::test_eng_filter_parses_and_matches_tiers.
describe("engagement tiers", () => {
  it("thresholds mirror the backend constants", () => {
    expect(ENGAGEMENT_LOW_MAX).toBe(33);
    expect(ENGAGEMENT_HIGH_MIN).toBe(67);
  });
  it("maps scores to tiers at every boundary", () => {
    expect([0, 33].map(engagementTier)).toEqual(["low", "low"]);
    expect([34, 50, 66].map(engagementTier)).toEqual(["medium", "medium",
      "medium"]);
    expect([67, 100].map(engagementTier)).toEqual(["high", "high"]);
  });
  it("eng:* parses like backend/rules.py", () => {
    for (const tier of ["low", "medium", "high"] as const) {
      expect(parseFilter(`eng:${tier}`).eng).toBe(tier);
    }
    expect(parseFilter("").eng).toBeNull();
    expect(parseFilter("ENG:Low").eng).toBe("low");     // case-folded
    const bogus = parseFilter("eng:extreme");
    expect(bogus.eng).toBeNull();
    expect(bogus.text).toEqual(["eng:extreme"]);
  });
  it("matches exactly the tier asked for", () => {
    const cases: [number, string][] = [[0, "low"], [33, "low"],
      [34, "medium"], [66, "medium"], [67, "high"], [100, "high"]];
    for (const [score, tier] of cases) {
      for (const other of ["low", "medium", "high"]) {
        expect(matchGroup(g({ engagement: score }),
          parseFilter(`eng:${other}`))).toBe(other === tier);
      }
    }
  });
  it("combines with other qualifiers, e.g. the cleanup query", () => {
    const f = parseFilter("eng:low age:>1y");
    const NOW = new Date("2026-01-01").getTime();
    expect(matchGroup(g({ engagement: 5, last: "2020-01-01" }), f, NOW))
      .toBe(true);
    expect(matchGroup(g({ engagement: 5, last: "2025-12-01" }), f, NOW))
      .toBe(false);
    expect(matchGroup(g({ engagement: 90, last: "2020-01-01" }), f, NOW))
      .toBe(false);
  });
});

describe("matchGroup", () => {
  const NOW = new Date("2026-01-01").getTime();
  it("combines all criteria (AND)", () => {
    const f = parseFilter("tag:shipping ai:safe unread:>80 is:unsub dhl");
    expect(matchGroup(g(), f, NOW)).toBe(true);
    expect(matchGroup(g({ tags: ["finance"] }), f, NOW)).toBe(false);
    expect(matchGroup(g({ ai: null }), f, NOW)).toBe(false);
    expect(matchGroup(g({ unread: 10 }), f, NOW)).toBe(false);
    expect(matchGroup(g({ unsub: false }), f, NOW)).toBe(false);
    expect(matchGroup(g({ label: "UPS", key: "a@ups.example", sub: "" }),
      f, NOW)).toBe(false);
  });
  it("is:protected matches only protected groups", () => {
    const f = parseFilter("is:protected");
    expect(matchGroup(g({ protected: true }), f, NOW)).toBe(true);
    expect(matchGroup(g(), f, NOW)).toBe(false);
  });
  it("is:new matches only flagged-new groups", () => {
    const f = parseFilter("is:new");
    expect(matchGroup(g({ new: true }), f, NOW)).toBe(true);
    expect(matchGroup(g(), f, NOW)).toBe(false);
  });
  it("has:pinned matches only groups containing a pinned mail", () => {
    const f = parseFilter("has:pinned");
    expect(f.pinnedOnly).toBe(true);
    expect(matchGroup(g({ pinned: 2 }), f, NOW)).toBe(true);
    expect(matchGroup(g({ pinned: 0 }), f, NOW)).toBe(false);
    expect(matchGroup(g({ pinned: 1 }), parseFilter("dhl"), NOW)).toBe(true);
  });
  it("is:replied / is:noreply-ever split on the replied flag", () => {
    expect(matchGroup(g({ replied: true }), parseFilter("is:replied"), NOW))
      .toBe(true);
    expect(matchGroup(g(), parseFilter("is:replied"), NOW)).toBe(false);
    expect(matchGroup(g(), parseFilter("is:noreply-ever"), NOW)).toBe(true);
    expect(matchGroup(g({ replied: true }),
      parseFilter("is:noreply-ever"), NOW)).toBe(false);
  });
  it("is:unsubscribed requires EVERY sender done, not just one", () => {
    const done = { n: 1, of: 1, status: "done" as const, link: "", addr: "" };
    const pending = { n: 0, of: 1, status: "pending" as const, link: "",
      addr: "" };
    expect(matchGroup(g({ unsubscribed: done }),
      parseFilter("is:unsubscribed"), NOW)).toBe(true);
    expect(matchGroup(g({ unsubscribed: pending }),
      parseFilter("is:unsubscribed"), NOW)).toBe(false);
    expect(matchGroup(g({ unsubscribed: null }),
      parseFilter("is:unsubscribed"), NOW)).toBe(false);
    expect(matchGroup(g({ unsubscribed: pending }),
      parseFilter("is:not-unsubscribed"), NOW)).toBe(true);
    expect(matchGroup(g({ unsubscribed: null }),
      parseFilter("is:not-unsubscribed"), NOW)).toBe(true);
    expect(matchGroup(g({ unsubscribed: done }),
      parseFilter("is:not-unsubscribed"), NOW)).toBe(false);
  });
  it("att filter uses the analyzed aggregate", () => {
    const f = parseFilter("att:>10k");
    expect(matchGroup(g({ att_size: 28000 }), f, NOW)).toBe(true);
    expect(matchGroup(g(), f, NOW)).toBe(false);
  });
  it("age filter uses last activity", () => {
    const f = parseFilter("age:>1y");
    expect(matchGroup(g({ last: "2024-06-01" }), f, NOW)).toBe(true);
    expect(matchGroup(g({ last: "2025-12-30" }), f, NOW)).toBe(false);
    expect(matchGroup(g({ last: "" }), f, NOW)).toBe(false);
  });
  it("from:/domain: match the exact key, never a substring", () => {
    const f = parseFilter("from:noreply@dhl.example");
    expect(matchGroup(g({ key: "noreply@dhl.example" }), f, NOW)).toBe(true);
    expect(matchGroup(
      g({ key: "other-noreply@dhl.example" }), f, NOW)).toBe(false);
    expect(matchGroup(g({ key: "dhl.example" }), f, NOW)).toBe(false);

    const fd = parseFilter("domain:dhl.example");
    expect(matchGroup(g({ key: "dhl.example" }), fd, NOW)).toBe(true);
    expect(matchGroup(g({ key: "sub.dhl.example" }), fd, NOW)).toBe(false);
  });
});

describe("fmtAgo", () => {
  const now = 1_000_000;
  it("formats relative ages compactly", () => {
    expect(fmtAgo(now - 30, now)).toBe("1m");
    expect(fmtAgo(now - 600, now)).toBe("10m");
    expect(fmtAgo(now - 7200, now)).toBe("2h");
    expect(fmtAgo(now - 3 * 86400, now)).toBe("3d");
  });
  it("is empty for missing or future timestamps", () => {
    expect(fmtAgo(null, now)).toBe("");
    expect(fmtAgo(now + 60, now)).toBe("");
  });
});

describe("applyStatus (slim SSE merge)", () => {
  const prev = { account: "a", groups_rev: 3, status: "done",
    groups: { sender: { x: 1 } } } as any;
  it("merges status fields and keeps the groups", () => {
    const merged = applyStatus(prev,
      { account: "a", groups_rev: 3, status: "scanning" } as any)!;
    expect(merged.status).toBe("scanning");
    expect(merged.groups).toBe(prev.groups);
  });
  it("demands a full fetch when groups changed server-side", () => {
    expect(applyStatus(prev,
      { account: "a", groups_rev: 4, status: "done" } as any)).toBeNull();
  });
  it("demands a full fetch without state or across accounts", () => {
    expect(applyStatus(null,
      { account: "a", groups_rev: 3 } as any)).toBeNull();
    expect(applyStatus(prev,
      { account: "b", groups_rev: 3 } as any)).toBeNull();
  });
});

describe("parseProgress", () => {
  it("reads the backend's done/total formats", () => {
    expect(parseProgress("5/20")).toEqual({ done: 5, total: 20 });
    expect(parseProgress("5/20 (+1 job(s) queued)"))
      .toEqual({ done: 5, total: 20 });
    expect(parseProgress("3/9 groups")).toEqual({ done: 3, total: 9 });
    expect(parseProgress("Archive/2023/2024: 120/800"))
      .toEqual({ done: 120, total: 800 });
  });
  it("returns null when it isn't structured", () => {
    expect(parseProgress("connecting…")).toBeNull();
    expect(parseProgress("queued…")).toBeNull();
    expect(parseProgress("0/0")).toBeNull();
    expect(parseProgress("")).toBeNull();
  });
});

describe("fmtDate", () => {
  const now = new Date(2026, 9, 7);
  it("omits the year in the current year", () => {
    expect(fmtDate("2026-10-06", now)).toBe("6 Oct");
    expect(fmtDate("2026-10-06 14:32:00+02:00", now)).toBe("6 Oct");
  });
  it("adds the year for other years", () => {
    expect(fmtDate("2024-10-06", now)).toBe("6 Oct 2024");
  });
  it("follows the requested language", () => {
    expect(fmtDate("2026-10-06", now, { lang: "de" })).toBe("6. Okt.");
    expect(fmtDate("2024-10-06", now, { lang: "de" })).toBe("6. Okt. 2024");
  });
  it("appends the wall-clock time on request", () => {
    expect(fmtDate("2026-10-06T21:48:00+02:00", now, { time: true }))
      .toBe("6 Oct, 21:48");
    expect(fmtDate("2026-10-06 09:05", now, { lang: "de", time: true }))
      .toBe("6. Okt., 09:05");
    expect(fmtDate("2026-10-06", now, { time: true })).toBe("6 Oct");
  });
  it("returns empty or invalid input unchanged", () => {
    expect(fmtDate("", now)).toBe("");
    expect(fmtDate("yesterday", now)).toBe("yesterday");
    expect(fmtDate("2026-02-31", now)).toBe("2026-02-31");
  });
  it("keeps years below 100 as they are", () => {
    expect(fmtDate("0050-03-04", now)).toContain("50");
  });
});
