import { describe, expect, it } from "vitest";
import {
  buildDeck, can, DECK_MAX, dragDecision, planOf, protectEntry, summarize,
} from "./triage";
import type { Group } from "./types";

const g = (over: Partial<Group> = {}): Group => ({
  key: "a@x.example", label: "A", sub: "", count: 10, size: 1000, unread: 0,
  first: "2024-01-01", last: "2024-06-01", tags: [], samples: [], bulk: false,
  unsub: true, ai: null, ratings: null, protected: false, replied: false,
  att_size: 0, unsubscribed: null, new: false, pinned: 0, engagement: 10,
  ...over,
});

describe("deck", () => {
  it("keeps the list order and caps at 50", () => {
    const list = Array.from({ length: 80 }, (_, i) => g({ key: `k${i}` }));
    const deck = buildDeck(list);
    expect(deck).toHaveLength(DECK_MAX);
    expect(deck.map((x) => x.key)).toEqual(list.slice(0, 50).map((x) => x.key));
  });
});

describe("what a card allows", () => {
  it("protected groups cannot be trashed, unsubscribed or re-protected", () => {
    const p = g({ protected: true });
    expect(can("trash", p, "sender")).toBe(false);
    expect(can("unsub", p, "sender")).toBe(false);
    expect(can("protect", p, "sender")).toBe(false);
    expect(can("keep", p, "sender")).toBe(true);
  });
  it("unsubscribe needs a header and no finished unsubscribe", () => {
    expect(can("unsub", g({ unsub: false }), "sender")).toBe(false);
    expect(can("unsub", g({ unsubscribed: { n: 1, of: 1, status: "done",
      link: "", addr: "" } }), "sender")).toBe(false);
    expect(can("unsub", g({ unsubscribed: { n: 0, of: 1, status: "failed",
      link: "", addr: "" } }), "sender")).toBe(true);
  });
  it("protect only on Sender / Domain", () => {
    expect(can("protect", g(), "sender")).toBe(true);
    expect(can("protect", g(), "domain")).toBe(true);
    for (const m of ["subject", "thread", "smart"] as const) {
      expect(can("protect", g(), m)).toBe(false);
    }
    expect(protectEntry("domain", g({ key: "x.example" }))).toBe("@x.example");
    expect(protectEntry("sender", g())).toBe("a@x.example");
  });
});

describe("dragDecision", () => {
  const all = () => true;
  it("commits past 30% of the width, springs back below", () => {
    expect(dragDecision(-100, 0, 300, 1000, all)).toBe("trash");
    expect(dragDecision(100, 5, 300, 1000, all)).toBe("keep");
    expect(dragDecision(0, -100, 300, 1000, all)).toBe("unsub");
    expect(dragDecision(-80, 0, 300, 1000, all)).toBeNull();
    expect(dragDecision(0, -80, 300, 1000, all)).toBeNull();
    expect(dragDecision(0, 150, 300, 1000, all)).toBeNull();   // down: nothing
  });
  it("a fling commits a short drag", () => {
    expect(dragDecision(-60, 0, 300, 50, all)).toBe("trash");
    expect(dragDecision(-60, 0, 300, 600, all)).toBeNull();     // slow
    expect(dragDecision(-20, 0, 300, 5, all)).toBeNull();       // too short
  });
  it("never commits a decision the group does not allow", () => {
    expect(dragDecision(-200, 0, 300, 500, (d) => d !== "trash")).toBeNull();
    expect(dragDecision(0, -200, 300, 500, (d) => d !== "unsub")).toBeNull();
  });
});

describe("summary and plan", () => {
  const deck = [
    g({ key: "t1", count: 10, size: 100, pinned: 2 }),
    g({ key: "t2", count: 5, size: 50 }),
    g({ key: "u1" }), g({ key: "p1" }), g({ key: "k1" }),
    g({ key: "prot", protected: true }),
  ];
  const byKey = Object.fromEntries(deck.map((x) => [x.key, x]));
  const decisions = { t1: "trash", t2: "trash", u1: "unsub", p1: "protect",
    k1: "keep", prot: "trash" } as const;
  it("sums groups, mails (minus pinned) and size", () => {
    const s = summarize({ ...decisions }, byKey);
    expect(s.trash).toEqual({ groups: 2, mails: 8 + 5, size: 150 });
    expect(s.unsub).toBe(1);
    expect(s.protect).toBe(1);
    expect(s.keep).toBe(1);
  });
  it("the plan holds exactly the decided keys, never a protected group", () => {
    const p = planOf({ ...decisions }, deck, "sender");
    expect(p.trash).toEqual(["t1", "t2"]);
    expect(p.unsub).toEqual(["u1"]);
    expect(p.protect).toEqual(["p1"]);
  });
  it("a stale unsubscribe on a group that cannot is dropped", () => {
    const p = planOf({ x: "unsub" }, [g({ key: "x", unsub: false })], "sender");
    expect(p.unsub).toEqual([]);
  });
});
