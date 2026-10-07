import { expect, test } from "vitest";

/* Keeps the UI harmonisation sweep from regressing: components compose the
   tokens and primitives of index.css / ui.tsx instead of local styling.
   `check` is pure so the probes below can prove each rule really bites. */

const HUES = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|"
  + "green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";

// The only raw palette classes allowed: hash-based avatar tints in ui.tsx.
const AVATAR_HUES = new Set(["violet", "teal", "cyan", "lime", "indigo",
  "fuchsia"].map((h) => `"bg-${h}-900 text-${h}-300",`));

// The only `!important` utilities allowed (each has a comment in code).
const BANG_ALLOWED = new Set(["!rounded-none", "!border-0", "!min-h-16",
  "!p-3", "!text-inherit"]);

const ICON_SIZES = new Set([14, 16, 18]);

type Rule = { name: string; lines?: RegExp;
  skip?: (file: string, line: string) => boolean;
  custom?: (src: string) => string[] };

const RULES: Rule[] = [
  { name: "text size", lines: /text-\[|(?<![\w!-])text-(xs|sm|base|lg|[x\d]*xl)(?![\w-])/ },
  { name: "palette colour", lines: new RegExp(`\\b(${HUES})-\\d{2,3}\\b`),
    skip: (f, l) => f.endsWith("ui.tsx") && AVATAR_HUES.has(l.trim()) },
  { name: "arbitrary colour",
    lines: /\b(bg|text|border|ring|outline|fill|stroke|shadow|from|to|via)-\[(#|rgb|hsl|oklch)/ },
  { name: "raw shadow / black scrim",
    lines: /\bshadow(-(sm|md|lg|xl|2xl|inner))?(?![\w-])(?=[\s"'`}]|$)|shadow-\[|\bbg-black\b/,
    skip: (_f, l) => /^\s*(\/\/|\/?\*|\{\/\*)/.test(l) },
  { name: "raw checkbox", lines: /type=\{?\s*["'`]checkbox["'`]/,
    skip: (f) => f.endsWith("ui.tsx") },
  { name: "ghost variant", lines: /variant=\{?\s*["'`]ghost["'`]/ },
  { name: "icon size", custom: (src) => {
    const bad: string[] = [];
    for (const m of src.matchAll(/\bsize=(?:"(\d+)"|\{([^}]*)\})/g)) {
      const nums = (m[1] ?? m[2]).match(/\d+(\.\d+)?/g) ?? [];
      if (nums.some((n) => !ICON_SIZES.has(Number(n)))) bad.push(m[0]);
    }
    return bad;
  } },
  { name: "!important utility", custom: (src) =>
    [...src.matchAll(/(?<=[\s"'`:])!(?:min-|max-|[hw]-|[pm][xytrbl]?-|bg-|text-|rounded|border|opacity|size-|font-|gap-|shadow|ring|outline)[\w./-]*/g)]
      .map((m) => m[0]).filter((t) => !BANG_ALLOWED.has(t)) },
  { name: "transform on a Button/Chip", custom: (src) => {
    // Button/Chip set `active:translate-y-px`, which REPLACES any transform
    // class on the same element: wrap them instead of translating them.
    const bad: string[] = [];
    for (const m of src.matchAll(/<(Button|Chip|ChipSegment)\b/g)) {
      let depth = 0, i = m.index! + m[0].length;
      for (; i < src.length; i++) {
        const c = src[i];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) break;
      }
      const tag = src.slice(m.index!, i);
      if (/(?<![\w:-])-?(translate|rotate|scale)-/.test(tag)) bad.push(tag.slice(0, 60));
    }
    return bad;
  } },
];

/** Violations as "rule: text" for one source file's content. */
export function check(src: string, file = "x.tsx"): string[] {
  const out: string[] = [];
  const lines = src.split("\n");
  for (const r of RULES) {
    if (r.lines) {
      lines.forEach((line, i) => {
        if (r.lines!.test(line) && !r.skip?.(file, line)) {
          out.push(`${r.name}: ${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    r.custom?.(src).forEach((t) => out.push(`${r.name}: ${file}: ${t}`));
  }
  return out;
}

test("components and App follow the design system", async () => {
  // @ts-expect-error node builtins have no types in this project
  const { readdirSync, readFileSync } = await import("node:fs");
  const files: string[] = ["src/App.tsx",
    ...(readdirSync("src/components") as string[])
      .filter((f) => f.endsWith(".tsx")).map((f) => `src/components/${f}`)];
  expect(files.length).toBeGreaterThan(15);
  const bad = files.flatMap((f) => check(readFileSync(f, "utf8") as string, f));
  expect(bad).toEqual([]);
});

test("the guard flags known-bad snippets", () => {
  const bad: [string, string][] = [
    ["text size", '<p className="text-3xl">'],
    ["text size", '<p className="text-xs">'],
    ["text size", '<p className="text-[0.7rem]">'],
    ["palette colour", '<p className="bg-red-50">'],
    ["palette colour", '<p className="text-slate-400">'],
    ["palette colour", '<p className="border-purple-500">'],
    ["palette colour", '<p className="text-pink-300">'],
    ["arbitrary colour", '<p className="bg-[#f00]">'],
    ["arbitrary colour", '<p className="text-[rgb(1,2,3)]">'],
    ["raw shadow", '<p className="shadow-md">'],
    ["raw shadow", '<p className="rounded shadow">'],
    ["raw shadow", '<p className="shadow-xl">'],
    ["raw shadow", '<p className="shadow-[0_0_4px_red]">'],
    ["raw checkbox", `<input type='checkbox' />`],
    ["raw checkbox", '<input type={"checkbox"} />'],
    ["raw checkbox", '<input type="checkbox" />'],
    ["ghost variant", '<Button variant="ghost">'],
    ["icon size", "<X size={12} />"],
    ["icon size", "<X size={on ? 12 : 16} />"],
    ["icon size", '<X size="12" />'],
    ["icon size", "<X size={17} />"],
    ["!important", '<p className="!h-4">'],
    ["!important", '<p className="!p-2">'],
    ["!important", '<p className="!bg-red">'],
    ["!important", '<p className="!rounded-md">'],
    ["!important", '<p className="!min-w-0">'],
    ["transform", '<Button className="absolute -translate-y-1/2">x</Button>'],
    ["transform", '<Chip onClick={() => go()} className="-translate-x-2">x</Chip>'],
  ];
  for (const [rule, snippet] of bad) {
    expect(check(snippet).join("\n").toLowerCase(), snippet).toContain(rule);
  }
});

test("the guard accepts the sanctioned patterns", () => {
  const good = [
    '<p className="type-meta text-muted shadow-popover shadow-bar">',
    "<X size={14} /> <Y size={on ? 16 : 18} /> <Spinner size=\"sm\" />",
    '<Select className="!rounded-none !border-0" />',
    '<Button size="icon" className="text-muted">{cond ? a : b}</Button>',
    '<span className="absolute inset-y-0 right-0 -translate-y-1/2"><Button /></span>',
    '<input type="text" />',
    "{!flat && !open && x}",
  ];
  for (const s of good) expect(check(s), s).toEqual([]);
  expect(check('  "bg-violet-900 text-violet-300",', "src/components/ui.tsx"))
    .toEqual([]);
  expect(check('  "bg-violet-900 text-violet-300",', "src/App.tsx")).not.toEqual([]);
});
