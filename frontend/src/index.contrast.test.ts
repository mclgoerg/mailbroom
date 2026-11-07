import { expect, test } from "vitest";

/* WCAG AA for the theme tokens: parses the colours out of index.css, so a
   palette tweak that breaks a text pair fails here. */

// Top-level await: `node:fs` is loaded dynamically, as styleGuard.test.ts does
// (the app tsconfig has no node types).
// @ts-expect-error node builtins have no types in this project
const { readFileSync } = await import("node:fs");
const css = readFileSync("src/index.css", "utf8") as string;

type Rgba = [number, number, number, number];

function block(selector: string): string {
  const start = css.indexOf(selector);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open, i);
  }
  throw new Error(`no block ${selector}`);
}

function parse(v: string): Rgba {
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [n >> 16, (n >> 8) & 255, n & 255, 1];
  }
  const m = v.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\s*\)$/);
  if (!m) throw new Error(`unparseable colour ${v}`);
  return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
}

function tokens(body: string): Record<string, Rgba> {
  const out: Record<string, Rgba> = {};
  for (const m of body.matchAll(/--color-([\w-]+):\s*([^;]+);/g)) {
    try { out[m[1]] = parse(m[2].trim()); } catch { /* not a colour */ }
  }
  return out;
}

const over = (fg: Rgba, bg: Rgba): Rgba => [0, 1, 2].map(
  (i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])) as unknown as Rgba;

const lum = ([r, g, b]: Rgba) => {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

function ratio(fg: Rgba, bg: Rgba): number {
  const [a, b] = [lum(over(fg, bg)), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const dark = tokens(block("@theme"));
const themes: Record<string, Record<string, Rgba>> = {
  dark,
  light: { ...dark, ...tokens(block('html[data-theme="light"]')) },
};
const SEMANTIC = ["safe", "review", "keep", "info", "attach", "new"];
const WHITE: Rgba = [255, 255, 255, 1];

for (const [name, tk] of Object.entries(themes)) {
  const min = (label: string, fg: Rgba, bg: Rgba) =>
    expect(ratio(fg, bg), `${name}: ${label}`).toBeGreaterThanOrEqual(4.5);

  test(`${name}: text on surface and panel`, () => {
    for (const bg of ["surface", "panel"]) {
      for (const fg of ["body", "muted", "accent", "danger-fg"]) {
        min(`${fg} on ${bg}`, tk[fg], tk[bg]);
      }
    }
  });

  test(`${name}: semantic text on its own tint`, () => {
    for (const s of SEMANTIC) {
      for (const base of ["surface", "panel"]) {
        const tint = over(tk[`${s}-bg`], tk[base]);
        min(`${s}-fg on ${s}-bg over ${base}`, tk[`${s}-fg`], tint);
      }
    }
  });

  test(`${name}: text on fills`, () => {
    for (const a of ["accent", "accenth"]) {
      min(`on-accent on ${a}`, tk["on-accent"], tk[a]);
    }
    for (const d of ["danger", "danger-h"]) min(`white on ${d}`, WHITE, tk[d]);
    min("accent on accent-tint over panel", tk.accent,
      over(tk["accent-tint"], tk.panel));
    min("chiptext on chip", tk.chiptext, tk.chip);
    min("body on chip", tk.body, tk.chip);
  });
}
