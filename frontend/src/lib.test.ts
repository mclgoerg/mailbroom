import { describe, expect, it } from "vitest";
import { applyStatus, fmtAgo, fmtSize, fmtUsd, mailKey, matchGroup,
  olderThan, parseFilter, sieveSnippet } from "./lib";
import type { Group } from "./types";

const g = (over: Partial<Group> = {}): Group => ({
  key: "noreply@dhl.example", label: "DHL Paket", sub: "noreply@dhl.example",
  count: 100, size: 5000, unread: 90, first: "2024-01-01",
  last: "2024-06-01", tags: ["shipping", "newsletter"], samples: [],
  bulk: true, unsub: true, ai: { verdict: "delete_safe", reason: "x" },
  ratings: null, protected: false, replied: false, att_size: 0,
  unsubscribed: null,
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
