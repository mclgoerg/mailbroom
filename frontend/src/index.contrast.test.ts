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
  // Every --color-* must parse: an unsupported notation (#fff, oklch(), ...)
  // throws here instead of silently dropping out of the checks.
  for (const m of body.matchAll(/--color-([\w-]+):\s*([^;]+);/g)) {
    out[m[1]] = parse(m[2].trim());
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
const lightOverrides = tokens(block('html[data-theme="light"]'));
// Tokens the light theme intentionally inherits from the dark block.
const INHERITED = ["danger"];
const themes: Record<string, Record<string, Rgba>> = {
  dark,
  light: { ...dark, ...lightOverrides },
};

test("light theme overrides every colour token except the listed ones", () => {
  const missing = Object.keys(dark)
    .filter((k) => !(k in lightOverrides) && !INHERITED.includes(k));
  expect(missing).toEqual([]);
  expect(INHERITED.every((k) => k in dark && !(k in lightOverrides))).toBe(true);
});

test("an unparseable colour is an error, not a skipped check", () => {
  expect(() => tokens("--color-x: #fff;")).toThrow();
  expect(() => tokens("--color-x: oklch(0.5 0.1 40);")).toThrow();
});
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
    // `tinted` Button: rest (accent on accent-tint) and hover (accenth on
    // accent at 22%, see BUTTON_VARIANT), over every base it sits on.
    const hover: Rgba = [...tk.accent.slice(0, 3), 0.22] as unknown as Rgba;
    for (const base of ["surface", "panel"]) {
      min(`tinted rest over ${base}`, tk.accent,
        over(tk["accent-tint"], tk[base]));
      min(`tinted hover over ${base}`, tk.accenth, over(hover, tk[base]));
    }
    min("chiptext on chip", tk.chiptext, tk.chip);
    min("body on chip", tk.body, tk.chip);
  });
}
