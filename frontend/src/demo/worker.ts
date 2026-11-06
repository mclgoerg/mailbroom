/* The demo's module Web Worker: Pyodide plus the real backend on the
 * pre-built demo mailboxes (scripts/demo-bundle builds what it loads,
 * scripts/demo_glue.py is the Python half). Never imported by the page: Vite
 * bundles it as its own hashed file (new Worker(new URL(...)) in entry.tsx),
 * which is only referenced from demo builds. */

import type { FromWorker, StepId, ToWorker } from "./protocol";

type Manifest = {
  pyodide: { dir: string; roots: string[] };
  app: string; seed: string; seedNow: number; wireBytes: number;
  files: { path: string; bytes: number }[];
};

// Just the corner of Pyodide's API used here.
type PyProxy = { toJs(o?: unknown): unknown; destroy(): void };
type Pyodide = {
  loadPackage(names: string[], o?: unknown): Promise<unknown>;
  unpackArchive(data: ArrayBuffer, format: string, o?: unknown): void;
  runPython(code: string): unknown;
  runPythonAsync(code: string): Promise<unknown>;
  globals: { get(name: string): (...args: unknown[]) => Promise<PyProxy> };
};

const post = (m: FromWorker, transfer: Transferable[] = []) =>
  (self as unknown as Worker).postMessage(m, transfer);
const step = (s: StepId) => post({ type: "progress", step: s });

// The glue's request(), wrapped to hand JS a plain (status, headers, body).
const SERVE = `
import demo_glue

async def _serve(method, path, query, body, headers):
    if body is not None and not isinstance(body, str):
        body = body.to_bytes()
    r = await demo_glue.request(method, path, query, body,
                                headers.to_py() if headers else {})
    return (r["status"], r["headers"], r["body"])
`;

/** Fetches every bundle file (landing in the HTTP cache, which Pyodide's own
 *  loads then hit) while reporting bytes. Progress is bytes after
 *  decompression against the manifest's raw sizes. */
async function download(base: string, m: Manifest): Promise<void> {
  const total = m.files.reduce((s, f) => s + f.bytes, 0);
  let done = 0;
  let lastPost = 0;
  const report = (force = false) => {
    const now = performance.now();
    if (!force && now - lastPost < 100) return;
    lastPost = now;
    post({ type: "progress", step: "download", done, total, wire: m.wireBytes });
  };
  report(true);
  const queue = [...m.files];
  const lane = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const res = await fetch(base + f.path);
      if (!res.ok || !res.body) throw new Error(`${f.path}: ${res.status}`);
      const reader = res.body.getReader();
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        done += value.byteLength;
        report();
      }
    }
  };
  await Promise.all([lane(), lane(), lane(), lane()]);
  done = total;
  report(true);
}

async function boot(bundle: string): Promise<Pyodide> {
  const base = bundle.endsWith("/") ? bundle : `${bundle}/`;
  const manifest: Manifest = await (await fetch(`${base}manifest.json`, {
    cache: "no-cache" })).json();
  await download(base, manifest);

  step("python");
  const runtime = `${base}${manifest.pyodide.dir}/`;
  const { loadPyodide } = await import(/* @vite-ignore */ `${runtime}pyodide.mjs`);
  const py: Pyodide = await loadPyodide({
    indexURL: runtime, stdout: () => {}, stderr: () => {} });

  step("libraries");
  await py.loadPackage(manifest.pyodide.roots, { messageCallback: () => {} });
  const zip = async (name: string) => (await fetch(base + name)).arrayBuffer();
  py.unpackArchive(await zip(manifest.app), "zip", { extractDir: "/app" });
  py.unpackArchive(await zip(manifest.seed), "zip", { extractDir: "/app/seed" });

  step("seed");
  py.runPython("import sys; sys.path.insert(0, '/app/scripts')");
  py.runPython("import demo_glue; demo_glue.boot()");
  await py.runPythonAsync(SERVE);
  return py;
}

let serving: Promise<Pyodide> | null = null;
let serve: ((...args: unknown[]) => Promise<PyProxy>) | undefined;

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  if (m.type === "boot") {
    serving = boot(m.bundle);
    try {
      const py = await serving;
      // The backend's clock now reads the seed's build instant and runs on
      // from there; the page shifts its own "now" by the same amount.
      const backendNow = py.runPython("import time; time.time()") as number;
      post({ type: "ready", clockShiftMs: Date.now() - backendNow * 1000 });
    } catch (e) {
      post({ type: "fatal", error: String((e as Error)?.message ?? e) });
    }
    return;
  }
  try {
    const py = await serving;
    if (!py) return;
    serve ??= py.globals.get("_serve");
    const r = await serve(
      m.method, m.path, m.query, m.body ?? undefined, m.headers)   // undefined = None;
    const [status, headers, body] = r.toJs() as [
      number, [string, string][], Uint8Array];
    r.destroy();
    // copy out of the wasm heap into a transferable buffer of its own
    const buf = body.slice().buffer;
    post({ type: "res", id: m.id, status, headers, body: buf }, [buf]);
  } catch (e) {
    // demo.request already turns app errors into 500 responses; this is the
    // bridge itself failing. Still answer, or the UI would wait forever.
    const buf = new TextEncoder().encode(
      JSON.stringify({ detail: String((e as Error)?.message ?? e) })).buffer;
    post({ type: "res", id: m.id, status: 500,
      headers: [["content-type", "application/json"]], body: buf }, [buf]);
  }
};
