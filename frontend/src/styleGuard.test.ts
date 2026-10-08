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

/** Opening tags `<Name ...>` of components matching `names`, with the full
 *  attribute text. The scan skips string literals (`"a > b"`, `'…'`, template
 *  literals with `${…}`) and balances `{…}`, so a `>` inside an attribute
 *  value or an arrow function never ends the tag early. */
function jsxTags(src: string, names: RegExp): string[] {
  const out: string[] = [];
  const open = new RegExp(`<(${names.source})(?![\\w.])`, "g");
  for (const m of src.matchAll(open)) {
    let depth = 0;
    let i = m.index! + m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") {
        i = skipString(src, i);
      } else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0 && src[i - 1] !== "=") break;
    }
    out.push(src.slice(m.index!, i + 1));
  }
  return out;
}

/** Index of the closing quote of the string starting at `i`. */
function skipString(src: string, i: number): number {
  const q = src[i];
  for (i++; i < src.length && src[i] !== q; i++) {
    if (src[i] === "\\") i++;
    else if (q === "`" && src[i] === "$" && src[i + 1] === "{") {
      let d = 0;
      for (i++; i < src.length; i++) {
        const c = src[i];
        if (c === '"' || c === "'" || c === "`") i = skipString(src, i);
        else if (c === "{") d++;
        else if (c === "}" && --d === 0) break;
      }
    }
  }
  return i;
}

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
    lines: /\bshadow(-(xs|2xs|sm|md|lg|xl|2xl|inner))?(?![\w-])(?=[\s"'`}]|$)|shadow-\[|\bbg-black\b/,
    skip: (_f, l) => /^\s*(\/\/|\/?\*|\{\/\*)/.test(l) },
  { name: "raw checkbox", lines: /type=\{?\s*["'`]checkbox["'`]/,
    skip: (f) => f.endsWith("ui.tsx") },
  { name: "ghost variant", lines: /variant=\{?\s*["'`]ghost["'`]/ },
  { name: "icon size", custom: (src) => {
    // Icons and components take only the three sanctioned pixel sizes, as
    // literals: a variable (`size={S}`) can't be checked, so it is refused.
    // Form controls keep their native `size` attribute.
    const bad: string[] = [];
    // Only lucide icons must use literal sizes; Modal/Button/Spinner/Avatar
    // take a variable `size` prop of their own (a variant name).
    const icons = new Set<string>();
    for (const im of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']lucide-react["']/g))
      for (const part of im[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop();
        if (name) icons.add(name);
      }
    for (const tag of jsxTags(src, /[A-Z]\w*/)) {
      if (/^<(Input|Select|TextArea)\b/.test(tag)) continue;
      for (const m of tag.matchAll(/\bsize=(?:"([^"]*)"|\{([^{}]*)\})/g)) {
        const expr = m[1] ?? m[2];
        const nums = expr.match(/\d+(\.\d+)?/g) ?? [];
        const isWord = m[1] !== undefined && !/\d/.test(expr);   // size="sm"
        const variable = icons.has(tag.match(/^<(\w+)/)![1])
          && m[2] !== undefined && !nums.length && !/["'`]/.test(expr);
        if (!isWord && (variable || nums.some((n) => !ICON_SIZES.has(Number(n)))))
          bad.push(m[0]);
      }
    }
    return bad;
  } },
  { name: "!important utility", custom: (full) => {
    // Prose inside t("…") is text, not classes.
    const src = full.replace(/\bt\(\s*(["'`])(?:(?!\1)[^\\]|\\.)*\1/g, 't("")');
    // Prefix (`!px-2`) and Tailwind v4 suffix (`px-2!`) forms; the suffix is
    // normalised so one allowlist covers both.
    const util = "(?:min-|max-|[hw]-|[pm][xytrbl]?-|bg-|text-|rounded|border|"
      + "opacity|size-|font-|gap-|shadow|ring|outline)";
    const pre = new RegExp(`(?<=[\\s"'\`:])!${util}[\\w./-]*`, "g");
    // Suffix form: a lowercase class-like token (has a `-`), so TS non-null
    // assertions (`ref!.current`, `outlineEl!`) and prose ("...ring!") pass.
    const suf = new RegExp(
      `(?<=[\\s"'\`:])${util}[a-z0-9./\\[\\]-]*!(?![\\w=.])`, "g");
    // Bare Tailwind roots have no `-` to go by, so they are listed.
    const bare = /(?<=[\s"'`:])(?:border|shadow|rounded|ring|outline)!(?![\w=.])/g;
    return [...src.matchAll(pre), ...src.matchAll(bare),
      ...[...src.matchAll(suf)].filter((m) => m[0].includes("-"))]
      .map((m) => m[0].endsWith("!") ? "!" + m[0].slice(0, -1) : m[0])
      .filter((t) => !BANG_ALLOWED.has(t));
  } },
  { name: "transform on a Button/Chip", custom: (src) =>
    // Button/Chip set `active:translate-y-px`, which REPLACES any transform
    // class on the same element (also behind a variant such as `sm:`): wrap
    // them instead of translating them.
    jsxTags(src, /Button|Chip|ChipSegment/)
      .filter((tag) => /(?<![\w-])-?(translate|rotate|scale)-/.test(tag))
      .map((tag) => tag.slice(0, 60)) },
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
    // review follow-ups: suffix `!`, variants, `>` inside attributes, shadows,
    // variable icon sizes
    ["!important", '<p className="min-h-7!">'],
    ["!important", '<p className="px-2!">'],
    ["!important", '<p className="sm:px-2! text-muted">'],
    ["!important", '<p className="border!">'],
    ["!important", '<p className="rounded! shadow! ring! outline!">'],
    ["!important", '<p className="sm:ring!">'],
    ["!important", '<p className={`rounded-md! ${x}`}>'],
    ["transform", '<Button className="sm:-translate-y-1/2">x</Button>'],
    ["transform", '<Chip className="md:rotate-45">x</Chip>'],
    ["transform", '<Button title="a > b" className="-translate-y-1/2">x</Button>'],
    ["transform", `<Button title='a > b' className="scale-95">x</Button>`],
    ["transform", '<Button className={`a > ${b} -translate-x-1`}>x</Button>'],
    ["transform", '<Button onClick={() => go()} className="hover:-translate-y-0.5">x</Button>'],
    ["raw shadow", '<p className="shadow-xs">'],
    ["raw shadow", '<p className="shadow-2xs">'],
    ["icon size", 'import { X } from "lucide-react"; <X size={S} />'],
    ["icon size", 'import { X } from "lucide-react"; <X size={iconSize} className="a" />'],
    ["icon size", 'import { X as Close } from "lucide-react"; <Close size={s * 2} />'],
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
    // plain text, native input sizes, `>` in attributes, string-valued sizes
    't("Done! Size=big, plain prose")',
    "if (a !== b) return x!;",
    '<Input size={20} /> <input size={12} /> <Select size={4} />',
    '<Button title="a > b" className="w-full">x</Button>',
    '<Button className={`${a > b ? "x" : "y"}`}>x</Button>',
    '<Button size={big ? "sm" : "md"}>x</Button> <Spinner size="sm" />',
    '<Button className="max-sm:w-full">x</Button>',
    // non-null assertions, prose, and variable sizes on non-icon components
    "const el = ref!.current; outlineEl!.focus(); ringEl!;",
    't("Almost there, keep going - ring!")',
    't("This is text-heavy!") + t(`Very border! px-2! indeed`)',
    '<Modal size={sz}>x</Modal> <Button size={s}>x</Button> <Avatar size={sz} /> <Spinner size={sp} />',
    'import { X } from "lucide-react"; <X size={16} /> <Spinner size={s} />',
  ];
  for (const s of good) expect(check(s), s).toEqual([]);
  expect(check('  "bg-violet-900 text-violet-300",', "src/components/ui.tsx"))
    .toEqual([]);
  expect(check('  "bg-violet-900 text-violet-300",', "src/App.tsx")).not.toEqual([]);
});
