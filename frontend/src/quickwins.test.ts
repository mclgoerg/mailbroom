// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { matchGroup, parseFilter } from "./lib";
import { computeQuickWins, dismissKey, isDismissed, loadDismissed,
  QUICK_WINS, saveDismissed, unionTotals } from "./quickwins";
import type { Group } from "./types";

const MB = 1048576;
const mk = (key: string, over: Partial<Group> = {}): Group => ({
  key, label: key, sub: key, count: 20, size: 2 * MB, unread: 0,
  first: "2020-01-01", last: "2024-01-01", tags: [], samples: [],
  bulk: false, unsub: false, ai: null, ratings: null, protected: false,
  replied: false, att_size: 0, unsubscribed: null, new: false, pinned: 0,
  engagement: 50, ...over,
});
const card = (cards: ReturnType<typeof computeQuickWins>, id: string) =>
  cards.find((c) => c.def.id === id);
const NOW = Date.parse("2026-10-29T12:00:00Z");

afterEach(() => localStorage.clear());

test("per-card counts equal a manual matchGroup filter", () => {
  const gs = [
    mk("a@x.example", { tags: ["newsletter"], unread: 20, count: 20,
      size: 6 * MB }),
    mk("b@x.example", { tags: ["newsletter"], unread: 20, count: 30,
      size: 7 * MB, last: "2026-10-01" }),         // too recent
    mk("c@x.example", { tags: ["newsletter"], unread: 2, count: 12 }),
  ];
  const c = card(computeQuickWins(gs, NOW), "old_newsletters")!;
  const f = parseFilter(c.def.query);
  const manual = gs.filter((g) => matchGroup(g, f, NOW));
  expect(c.keys).toEqual(manual.map((g) => g.key));
  expect(c.mails).toBe(manual.reduce((n, g) => n + g.count, 0));
  expect(c.size).toBe(manual.reduce((n, g) => n + g.size, 0));
  expect(c.keys).toEqual(["a@x.example"]);
});

test("every card query is plain filter syntax", () => {
  for (const d of QUICK_WINS) {
    expect(parseFilter(d.query).text).toEqual([]);
  }
});

test("protected groups are excluded and counted as skipped", () => {
  const gs = [
    mk("a@x.example", { engagement: 10, count: 30 }),
    mk("p@x.example", { engagement: 10, count: 40, protected: true }),
  ];
  const c = card(computeQuickWins(gs, NOW), "quiet_low")!;
  expect(c.keys).toEqual(["a@x.example"]);
  expect(c.mails).toBe(30);
  expect(c.protectedSkipped).toBe(1);
});

test("the union total counts a group matching two cards once", () => {
  const both = mk("a@x.example", { engagement: 10, count: 50,
    size: 8 * MB, unsubscribed: { n: 1, of: 1, status: "done", link: "",
      addr: "" } });
  const only = mk("b@x.example", { engagement: 10, count: 15, size: 6 * MB });
  const gs = [both, only];
  const cards = computeQuickWins(gs, NOW);
  expect(card(cards, "quiet_low")!.keys).toHaveLength(2);
  expect(card(cards, "unsubscribed")!.keys).toEqual(["a@x.example"]);
  const sum = cards.reduce((n, c) => n + c.size, 0);
  expect(sum).toBe(8 * MB + 6 * MB + 8 * MB);
  expect(unionTotals(cards, gs)).toEqual({ mails: 65, size: 14 * MB });
});

test("a card under 10 mails AND 5 MB is hidden; either one keeps it", () => {
  const small = mk("a@x.example", { engagement: 10, count: 9, size: 4 * MB });
  expect(computeQuickWins([small], NOW)).toEqual([]);
  expect(computeQuickWins([{ ...small, count: 10 }], NOW)).toHaveLength(1);
  expect(computeQuickWins([{ ...small, size: 5 * MB }], NOW)).toHaveLength(1);
});

test("cards are ordered biggest first", () => {
  const gs = [
    mk("a@x.example", { engagement: 10, size: 3 * MB }),
    mk("b@x.example", { size: 90 * MB, att_size: 20 * MB }),
  ];
  const ids = computeQuickWins(gs, NOW).map((c) => c.def.id);
  expect(ids[0]).toBe("big_attachments");
});

test("needs-gating: no attachment pass hides card 4, no verdicts card 5",
  () => {
  const g = mk("a@x.example", { size: 50 * MB });
  const ids = (gs: Group[]) => computeQuickWins(gs, NOW).map((c) => c.def.id);
  expect(ids([g])).not.toContain("big_attachments");
  expect(ids([g])).not.toContain("ai_safe");
  const withAtt = { ...g, att_size: 20 * MB };
  expect(ids([withAtt])).toContain("big_attachments");
  const ai = { verdict: "delete_safe", reason: "" } as Group["ai"];
  expect(ids([{ ...g, ai }])).toContain("ai_safe");
});

test("dismissal is per account and returns after 25 % growth", () => {
  saveDismissed("a1", { old_newsletters: 100 });
  expect(loadDismissed("a2")).toEqual({});
  expect(localStorage.getItem(dismissKey("a1"))).toContain("100");
  const d = loadDismissed("a1");
  expect(isDismissed(d, "old_newsletters", 100)).toBe(true);
  expect(isDismissed(d, "old_newsletters", 124)).toBe(true);
  expect(isDismissed(d, "old_newsletters", 125)).toBe(false);
  expect(isDismissed(d, "quiet_low", 5000)).toBe(false);
});

test("a corrupt dismissal entry is ignored", () => {
  localStorage.setItem(dismissKey("a1"), "{not json");
  expect(loadDismissed("a1")).toEqual({});
  localStorage.setItem(dismissKey("a1"), "[1]");
  expect(loadDismissed("a1")).toEqual({});
});

test("pinned mails are not counted: they are kept by the trash", () => {
  const g = mk("a@x.example", { engagement: 10, count: 40, pinned: 10,
    size: 8 * MB });
  const gs = [g];
  const c = card(computeQuickWins(gs, NOW), "quiet_low")!;
  expect(c.mails).toBe(30);
  expect(c.size).toBe(6 * MB);
  expect(unionTotals([c], gs)).toEqual({ mails: 30, size: 6 * MB });
});
