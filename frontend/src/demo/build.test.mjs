/* The demo is a separate build of the same UI (`vite build --mode demo`).
 * The normal build must not contain or load any of it; the demo build must
 * (so the first check cannot pass by accident). */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterAll, expect, test } from "vitest";

const out = mkdtempSync(join(tmpdir(), "inboxrake-ui-"));
afterAll(() => rmSync(out, { recursive: true, force: true }));

async function bundle(mode) {
  const dir = join(out, mode);
  await build({ mode, logLevel: "silent", root: fileURLToPath(new URL("../..", import.meta.url)),
    base: mode === "demo" ? "/demo/" : "/",
    build: { outDir: dir, emptyOutDir: true, write: true } });
  const files = readdirSync(join(dir, "assets"));
  const js = files.filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(join(dir, "assets", f), "utf8")).join("\n");
  return { files, js };
}

// what only the demo modules contain (not shared strings like locale text)
const DEMO_ONLY = ["no event stream in the demo"];

test("the normal build has none of the demo", async () => {
  const { files, js } = await bundle("production");
  expect(files.some((f) => f.startsWith("worker-"))).toBe(false);
  for (const marker of DEMO_ONLY) expect(js).not.toContain(marker);
}, 120_000);

test("the demo build has the worker and the intercept", async () => {
  const { files, js } = await bundle("demo");
  expect(files.some((f) => f.startsWith("worker-"))).toBe(true);
  expect(js).toContain("no event stream in the demo");
}, 120_000);
