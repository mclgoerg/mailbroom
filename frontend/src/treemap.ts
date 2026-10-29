/* Squarified treemap (Bruls, Huizing, van Wijk 2000): pure layout, no DOM.
 * Tiles get an area proportional to their value; rows are filled along the
 * shorter side of the free rectangle for as long as the worst aspect ratio
 * of the row improves, which keeps tiles close to square. */

export interface TreemapItem { key: string; value: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface TreemapRect extends Rect { key: string }

/** Worst aspect ratio (>= 1) of a row of `areas` laid along a side of
 *  length `side`. */
const worst = (areas: number[], side: number): number => {
  const sum = areas.reduce((a, b) => a + b, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  const s2 = side * side;
  return Math.max((s2 * max) / (sum * sum), (sum * sum) / (s2 * min));
};

/** Lay `items` out inside `bounds`. Deterministic: biggest first, ties in
 *  input order. Items with a value <= 0 (or not finite) get an empty rect
 *  in the bounds' corner so every input key still appears in the output. */
export function squarify(items: TreemapItem[], bounds: Rect): TreemapRect[] {
  const live = items
    .map((it, i) => ({ ...it, i }))
    .filter((it) => Number.isFinite(it.value) && it.value > 0)
    .sort((a, b) => b.value - a.value || a.i - b.i);
  const out: TreemapRect[] = [];
  const total = live.reduce((a, it) => a + it.value, 0);
  if (live.length && bounds.w > 0 && bounds.h > 0) {
    const scale = (bounds.w * bounds.h) / total;
    const areas = live.map((it) => it.value * scale);
    let { x, y, w, h } = bounds;
    let start = 0;
    while (start < live.length) {
      const side = Math.min(w, h);
      let end = start + 1;
      while (end < live.length
          && worst(areas.slice(start, end + 1), side)
            <= worst(areas.slice(start, end), side)) end++;
      const row = areas.slice(start, end);
      const sum = row.reduce((a, b) => a + b, 0);
      const last = end >= live.length;
      if (w >= h) {              // row is a column on the left edge
        const rw = last ? w : sum / h;
        let cy = y;
        row.forEach((a, k) => {
          const rh = k === row.length - 1 ? y + h - cy : a / rw;
          out.push({ key: live[start + k].key, x, y: cy, w: rw, h: rh });
          cy += rh;
        });
        x += rw; w -= rw;
      } else {                   // row is a strip along the top edge
        const rh = last ? h : sum / w;
        let cx = x;
        row.forEach((a, k) => {
          const rw = k === row.length - 1 ? x + w - cx : a / rh;
          out.push({ key: live[start + k].key, x: cx, y, w: rw, h: rh });
          cx += rw;
        });
        y += rh; h -= rh;
      }
      start = end;
    }
  } else {
    for (const it of live) out.push({ key: it.key, x: bounds.x, y: bounds.y,
      w: 0, h: 0 });
  }
  for (const it of items) {
    if (!(Number.isFinite(it.value) && it.value > 0)) {
      out.push({ key: it.key, x: bounds.x, y: bounds.y, w: 0, h: 0 });
    }
  }
  return out;
}

/** Slice-and-dice reference layout (one strip per item, input order), only
 *  there so tests can show squarify gives better aspect ratios. */
export function sliceAndDice(items: TreemapItem[], bounds: Rect):
    TreemapRect[] {
  const total = items.reduce((a, it) => a + Math.max(0, it.value), 0);
  let x = bounds.x;
  return items.map((it) => {
    const w = total ? (bounds.w * Math.max(0, it.value)) / total : 0;
    const r = { key: it.key, x, y: bounds.y, w, h: bounds.h };
    x += w;
    return r;
  });
}
