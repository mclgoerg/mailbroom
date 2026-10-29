import { describe, expect, test } from "vitest";
import { sliceAndDice, squarify, type Rect, type TreemapRect } from "./treemap";

const B: Rect = { x: 0, y: 0, w: 600, h: 400 };
const SAMPLE = [6, 6, 4, 3, 2, 2, 1].map((value, i) => ({ key: `k${i}`, value }));

const area = (r: TreemapRect) => r.w * r.h;
const aspect = (r: TreemapRect) => Math.max(r.w / r.h, r.h / r.w);
const overlap = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 1e-6 && h > 1e-6 ? w * h : 0;
};

describe("squarify", () => {
  test("areas are proportional to the values (within 1 %)", () => {
    const rects = squarify(SAMPLE, B);
    const total = SAMPLE.reduce((a, i) => a + i.value, 0);
    for (const it of SAMPLE) {
      const r = rects.find((x) => x.key === it.key)!;
      const want = (B.w * B.h * it.value) / total;
      expect(Math.abs(area(r) - want) / want).toBeLessThan(0.01);
    }
  });

  test("every rect lies inside the bounds, and none overlap", () => {
    const b = { x: 10, y: 20, w: 500, h: 300 };
    const rects = squarify(SAMPLE, b);
    expect(rects).toHaveLength(SAMPLE.length);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(b.x - 1e-6);
      expect(r.y).toBeGreaterThanOrEqual(b.y - 1e-6);
      expect(r.x + r.w).toBeLessThanOrEqual(b.x + b.w + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(b.y + b.h + 1e-6);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlap(rects[i], rects[j])).toBe(0);
      }
    }
    // the tiles fill the bounds completely
    expect(rects.reduce((a, r) => a + area(r), 0)).toBeCloseTo(b.w * b.h, 3);
  });

  test("deterministic: biggest first, ties keep input order", () => {
    const again = squarify(SAMPLE, B);
    expect(squarify(SAMPLE, B)).toEqual(again);
    expect(again.map((r) => r.key).slice(0, 2)).toEqual(["k0", "k1"]);
    const shuffled = squarify([...SAMPLE].reverse(), B);
    expect(shuffled.filter((r) => r.key === "k0" || r.key === "k1")
      .map((r) => r.key)).toEqual(["k1", "k0"]);
  });

  test("a single item fills the bounds", () => {
    expect(squarify([{ key: "a", value: 5 }], B))
      .toEqual([{ key: "a", ...B }]);
  });

  test("zero, negative and NaN values get an empty rect; the rest still fill", () => {
    const rects = squarify([{ key: "a", value: 3 }, { key: "z", value: 0 },
      { key: "n", value: -2 }, { key: "x", value: NaN },
      { key: "b", value: 1 }], B);
    expect(rects.map((r) => r.key).sort()).toEqual(["a", "b", "n", "x", "z"]);
    for (const k of ["z", "n", "x"]) {
      const r = rects.find((q) => q.key === k)!;
      expect(area(r)).toBe(0);
    }
    expect(rects.reduce((a, r) => a + area(r), 0)).toBeCloseTo(B.w * B.h, 3);
  });

  test("tiny values next to a huge one stay in bounds with the right area", () => {
    const items = [{ key: "big", value: 1e9 }, { key: "t1", value: 1 },
      { key: "t2", value: 1 }];
    const rects = squarify(items, B);
    for (const r of rects) {
      expect(r.x + r.w).toBeLessThanOrEqual(B.w + 1e-6);
      expect(r.y + r.h).toBeLessThanOrEqual(B.h + 1e-6);
    }
    const t1 = rects.find((r) => r.key === "t1")!;
    expect(area(t1)).toBeCloseTo((B.w * B.h) / 1e9, 6);
  });

  test("no items / empty bounds: nothing to lay out", () => {
    expect(squarify([], B)).toEqual([]);
    const flat = squarify([{ key: "a", value: 1 }], { x: 0, y: 0, w: 0, h: 5 });
    expect(flat.map((r) => area(r))).toEqual([0]);
  });

  test("aspect ratios beat slice-and-dice on the sample", () => {
    const mean = (rs: TreemapRect[]) =>
      rs.reduce((a, r) => a + aspect(r), 0) / rs.length;
    const sq = squarify(SAMPLE, B);
    const sd = sliceAndDice(SAMPLE, B);
    expect(mean(sq)).toBeLessThan(mean(sd) / 2);
    expect(Math.max(...sq.map(aspect))).toBeLessThan(3);
  });
});
