import { expect, test } from "vitest";

/* Keeps the UI harmonisation sweep from regressing: components compose the
   tokens and primitives of index.css / ui.tsx instead of local styling. */

type Hit = string;

/** Every "file:line: text" in App.tsx and components/*.tsx matching `re`. */
async function hits(re: RegExp, skip: (file: string, line: string) => boolean =
  () => false): Promise<Hit[]> {
  // @ts-expect-error node builtins have no types in this project
  const { readdirSync, readFileSync } = await import("node:fs");
  const files: string[] = ["src/App.tsx",
    ...(readdirSync("src/components") as string[])
      .filter((f) => f.endsWith(".tsx")).map((f) => `src/components/${f}`)];
  const out: Hit[] = [];
  for (const f of files) {
    (readFileSync(f, "utf8") as string).split("\n").forEach((line, i) => {
      if (re.test(line) && !skip(f, line)) out.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  return out;
}

test("no arbitrary or raw Tailwind text sizes: use the type-* layers", async () => {
  expect(await hits(
    /text-\[|(?<![\w!-])text-(xs|sm|base|lg|xl|2xl)(?![\w-])/)).toEqual([]);
});

test("no raw palette colours, black scrims or hard-coded shadows", async () => {
  const palette = /\b(red|rose|emerald|amber|sky|blue|orange|green|yellow)-\d{3}\b/;
  expect(await hits(palette)).toEqual([]);
  expect(await hits(/\bbg-black\b|shadow-lg|shadow-\[/)).toEqual([]);
});

test("checkboxes are the Checkbox primitive", async () => {
  expect(await hits(/type="checkbox"/, (f) => f.endsWith("/ui.tsx")))
    .toEqual([]);
});

test("Button has no ghost variant; icons use the 14/16/18 scale", async () => {
  expect(await hits(/variant="ghost"/)).toEqual([]);
  expect(await hits(/size=\{(?!14\}|16\}|18\})\d+\}/)).toEqual([]);
});

test("no !important size overrides on Buttons", async () => {
  expect(await hits(/!(min-h|px|py|text)-/,
    (_f, line) => /TextArea|Loading|text-inherit/.test(line))).toEqual([]);
});
