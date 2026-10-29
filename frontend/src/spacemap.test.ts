import { describe, expect, test } from "vitest";
import { MAX_TILES, buildDomains, dominantVerdict, fmtBig, heatOf,
  levelTiles, senderIndex, tickState, toggleItem } from "./spacemap";
import type { Group } from "./types";

const MB = 1048576;
const g = (key: string, size: number, over: Partial<Group> = {}): Group => ({
  key, label: key, sub: key, count: 10, size, unread: 0, first: "2020-01-01",
  last: "2026-01-01", tags: [], samples: [], bulk: false, unsub: false,
  ai: null, ratings: null, protected: false, replied: false, att_size: 0,
  unsubscribed: null, new: false, pinned: 0, engagement: 50, ...over,
});
const groups = (...gs: Group[]) => Object.fromEntries(gs.map((x) => [x.key, x]));

describe("buildDomains", () => {
  test("folds senders into domains, biggest first, sums sizes and counts", () => {
    const d = buildDomains(groups(
      g("a@big.example", 30 * MB), g("b@big.example", 50 * MB),
      g("c@small.example", 5 * MB, { count: 3 })));
    expect(d.map((x) => x.label)).toEqual(["big.example", "small.example"]);
    expect(d[0].size).toBe(80 * MB);
    expect(d[0].count).toBe(20);
    expect(d[0].children.map((c) => c.label))
      .toEqual(["b@big.example", "a@big.example"]);
    expect(d[0].keys.sort()).toEqual(["a@big.example", "b@big.example"]);
  });

  test("protected senders count in the size but never in the keys", () => {
    const [d] = buildDomains(groups(
      g("a@x.example", 10 * MB), g("p@x.example", 40 * MB, { protected: true })));
    expect(d.size).toBe(50 * MB);
    expect(d.keys).toEqual(["a@x.example"]);
    expect(d.protectedSenders).toBe(1);
  });

  test("zero-size senders have no area and are left out", () => {
    expect(buildDomains(groups(g("a@x.example", 0)))).toEqual([]);
  });

  test("count-weighted engagement, newest last, dominant AI verdict", () => {
    const ai = (verdict: "delete_safe" | "keep") => ({ verdict, reason: "" });
    const [d] = buildDomains(groups(
      g("a@x.example", MB, { count: 30, engagement: 10, last: "2025-05-01",
        ai: ai("delete_safe") }),
      g("b@x.example", MB, { count: 10, engagement: 90, last: "2026-02-01",
        ai: ai("keep") })));
    expect(d.engagement).toBe(30);
    expect(d.last).toBe("2026-02-01");
    expect(d.verdict).toBe("delete_safe");
    expect(dominantVerdict({})).toBeNull();
    expect(dominantVerdict({ keep: 5, delete_safe: 5 })).toBe("keep");
  });
});

describe("levelTiles", () => {
  const items = (sizes: number[]) => buildDomains(groups(
    ...sizes.map((s, i) => g(`u${i}@d${i}.example`, s))));

  test("items under 0.5 % merge into one Other tile that holds them", () => {
    const tiles = levelTiles(items([1000, 600, 4, 3, 2]));
    expect(tiles.map((t) => t.kind)).toEqual(["domain", "domain", "other"]);
    const other = tiles[2];
    expect(other.children).toHaveLength(3);
    expect(other.size).toBe(9);
    expect(other.label).toBe("");
  });

  test("a lone small item is not hidden in an Other (1)", () => {
    const tiles = levelTiles(items([1000, 600, 4]));
    expect(tiles.map((t) => t.kind)).toEqual(["domain", "domain", "domain"]);
  });

  test("at most MAX_TILES tiles, the rest drills into Other", () => {
    const many = items(Array.from({ length: 150 }, () => 1000));
    const tiles = levelTiles(many);
    expect(tiles).toHaveLength(MAX_TILES);
    const other = tiles[MAX_TILES - 1];
    expect(other.kind).toBe("other");
    expect(other.children).toHaveLength(150 - (MAX_TILES - 1));
    // inside Other the share rule is off, only the cap applies
    const inner = levelTiles(other.children, false);
    expect(inner).toHaveLength(MAX_TILES);       // 91 members: capped again
    expect(inner.filter((t) => t.kind === "other")).toHaveLength(1);
    expect(levelTiles(other.children.slice(0, 5), false)
      .every((t) => t.kind === "domain")).toBe(true);
  });

  test("an Other tile ticks every non-protected sender inside", () => {
    const tiles = levelTiles(buildDomains(groups(
      g("a@big.example", 100000), g("a@t1.example", 1), g("b@t2.example", 1,
        { protected: true }), g("c@t3.example", 1))));
    const other = tiles.find((t) => t.kind === "other")!;
    expect(other.keys.sort()).toEqual(["a@t1.example", "c@t3.example"]);
    expect(other.protectedSenders).toBe(1);
  });
});

describe("selection", () => {
  const [d] = buildDomains(groups(
    g("a@x.example", 10 * MB), g("b@x.example", 20 * MB),
    g("p@x.example", 30 * MB, { protected: true })));

  test("toggling a domain ticks exactly its non-protected senders", () => {
    const sel = toggleItem(d, new Set());
    expect([...sel].sort()).toEqual(["a@x.example", "b@x.example"]);
    expect(tickState(d, sel)).toBe("all");
    expect(toggleItem(d, sel).size).toBe(0);
  });

  test("partly ticked: a toggle completes it; foreign keys stay", () => {
    const sel = new Set(["a@x.example", "other@y.example"]);
    expect(tickState(d, sel)).toBe("some");
    const next = toggleItem(d, sel);
    expect(tickState(d, next)).toBe("all");
    expect(next.has("other@y.example")).toBe(true);
  });

  test("an all-protected tile can't be ticked", () => {
    const [p] = buildDomains(groups(g("p@z.example", MB, { protected: true })));
    expect(p.keys).toEqual([]);
    expect(toggleItem(p, new Set()).size).toBe(0);
    expect(tickState(p, new Set())).toBe("none");
  });

  test("senderIndex maps every sender key", () => {
    expect([...senderIndex([d]).keys()].sort())
      .toEqual(["a@x.example", "b@x.example", "p@x.example"]);
  });
});

describe("colour + size helpers", () => {
  const it = (over: object) => buildDomains(groups(g("a@x.example", MB,
    over)))[0];
  const now = Date.parse("2026-10-29T00:00:00Z");

  test("engagement: low is the strong (candidate) end", () => {
    expect(heatOf(it({ engagement: 10 }), "engagement")).toBe(2);
    expect(heatOf(it({ engagement: 50 }), "engagement")).toBe(1);
    expect(heatOf(it({ engagement: 90 }), "engagement")).toBe(0);
  });

  test("age: older last mail is stronger", () => {
    expect(heatOf(it({ last: "2022-01-01" }), "age", now)).toBe(2);
    expect(heatOf(it({ last: "2025-06-01" }), "age", now)).toBe(1);
    expect(heatOf(it({ last: "2026-10-01" }), "age", now)).toBe(0);
  });

  test("fmtBig steps up to GB", () => {
    expect(fmtBig(512)).toBe("512 B");
    expect(fmtBig(5 * MB)).toBe("5.0 MB");
    expect(fmtBig(1.2 * 1024 * MB)).toBe("1.2 GB");
  });
});
