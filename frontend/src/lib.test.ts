import { describe, expect, it } from "vitest";
import { fmtSize, fmtUsd, mailKey, matchGroup, olderThan, parseFilter } from "./lib";
import type { Group } from "./types";

const g = (over: Partial<Group> = {}): Group => ({
  key: "noreply@dhl.example", label: "DHL Paket", sub: "noreply@dhl.example",
  count: 100, size: 5000, unread: 90, first: "2024-01-01",
  last: "2024-06-01", tags: ["shipping", "newsletter"], samples: [],
  bulk: true, unsub: true, ai: { verdict: "delete_safe", reason: "x" },
  ratings: null, protected: false, replied: false,
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
  it("age filter uses last activity", () => {
    const f = parseFilter("age:>1y");
    expect(matchGroup(g({ last: "2024-06-01" }), f, NOW)).toBe(true);
    expect(matchGroup(g({ last: "2025-12-30" }), f, NOW)).toBe(false);
    expect(matchGroup(g({ last: "" }), f, NOW)).toBe(false);
  });
});
