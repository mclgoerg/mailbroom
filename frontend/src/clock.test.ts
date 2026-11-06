// @vitest-environment jsdom
/* The demo's backend runs on its seed's build instant; the page must read
 * "now" on the same clock (clock.ts), or ages are stale and the this-month
 * card is empty from the first day. */

import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { nowDate, nowMs, setClockShift } from "./clock";
import { fakeRuntime } from "./demo/fakeWorker";
import { fmtAgo, matchGroup, olderThan, parseFilter } from "./lib";
import { computeQuickWins } from "./quickwins";
import type { Group } from "./types";

const DAY = 86400e3;
const REAL_NOW = Date.parse("2026-11-06T12:00:00Z");
const SEED_NOW = REAL_NOW - 90 * DAY;          // a bundle built 90 days ago

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(REAL_NOW);
  // what the worker reports after boot: real clock minus the backend's clock
  const { runtime, last } = fakeRuntime();
  runtime.start();
  last().emit({ type: "ready", clockShiftMs: REAL_NOW - SEED_NOW });
});
afterEach(() => { vi.useRealTimers(); setClockShift(0); });

const group = (over: Partial<Group>): Group => ({
  key: "a@news.example", label: "News", sub: "a@news.example", count: 20,
  size: 1e6, unread: 5, first: "2024-01-01", last: "2026-09-20", tags: [],
  samples: [], bulk: true, unsub: true, ai: null, ratings: null,
  protected: false, replied: false, att_size: 0, unsubscribed: null,
  new: false, pinned: 0, engagement: 10, ...over,
});

test("'now' reads the seed's instant, not the real one", () => {
  expect(nowMs()).toBe(SEED_NOW);
  expect(nowDate().toISOString().slice(0, 10)).toBe("2026-08-08");
});

test("a mail the (shifted) backend just made reads as new, not 90 days old", () => {
  const backendNow = SEED_NOW / 1000;
  expect(fmtAgo(backendNow - 3 * 3600)).toBe("3h");
  expect(fmtAgo(backendNow - 60)).toBe("1m");
});

test("'this month' (the stats card) follows the shifted clock", () => {
  expect(nowDate().toISOString().slice(0, 7)).toBe("2026-08");
  setClockShift(0);
  expect(nowDate().toISOString().slice(0, 7)).toBe("2026-11");
});

test("client-side age: filtering agrees with the server's clock", () => {
  // last activity 14 months before the seed instant: older than 1y there,
  // but with the real clock a group last active 5 months before the seed
  // would wrongly be "older than 6m"
  const old = group({ last: "2025-06-01" });
  const recent = group({ last: "2026-03-10" });
  const f = parseFilter("age:>1y");
  expect(matchGroup(old, f)).toBe(true);
  expect(matchGroup(recent, f)).toBe(false);
  const f6 = parseFilter("age:>6m");
  expect(matchGroup(recent, f6)).toBe(false);       // 5 months at seed time
  setClockShift(0);
  expect(matchGroup(recent, f6)).toBe(true);        // what an unshifted UI says
});

test("olderThan and quick wins use the same clock", () => {
  const ts = (SEED_NOW - 40 * DAY) / 1000;
  expect(olderThan({ ts }, 1)).toBe(true);
  expect(olderThan({ ts }, 2)).toBe(false);
  // 11 months quiet at the seed instant, 14 by the real clock
  const quiet = [group({ last: "2025-09-20", count: 200, size: 5e8,
    engagement: 5 })];
  const ids = () => computeQuickWins(quiet).map((c) => c.def.id);
  expect(ids()).not.toContain("quiet_low");
  setClockShift(0);
  expect(ids()).toContain("quiet_low");
});
