// Loads a built bundle in Pyodide (Node) the way the browser worker will and
// checks that the backend answers: boot from the seed, /api/state, then a
// Trash and an Undo.   node smoke.mjs [bundle-dir]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dir = path.resolve(process.argv[2] || "dist");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
const check = (ok, what) => { if (!ok) { console.error(`FAIL: ${what}`); process.exit(1); } console.log(`ok: ${what}`); };

// the bundle's own runtime, not node_modules'
const runtime = path.join(dir, manifest.pyodide.dir);
const { loadPyodide } = await import(pathToFileURL(path.join(runtime, "pyodide.mjs")).href);
const t0 = performance.now();
const py = await loadPyodide({
  indexURL: runtime + "/",
  stdout: () => {}, stderr: console.error,
});
await py.loadPackage(manifest.pyodide.roots, { messageCallback: () => {} });
py.unpackArchive(new Uint8Array(fs.readFileSync(path.join(dir, manifest.app))), "zip", { extractDir: "/app" });
py.unpackArchive(new Uint8Array(fs.readFileSync(path.join(dir, manifest.seed))), "zip", { extractDir: "/app/seed" });
const tLoaded = performance.now();
py.runPython("import sys; sys.path.insert(0, '/app/scripts')");
const marks = py.runPython("import demo_glue; demo_glue.boot()").toJs({ dict_converter: Object.fromEntries });
console.log(`pyodide + packages + unpack ${Math.round(tLoaded - t0)} ms; boot ${JSON.stringify(marks)}`);

py.globals.set("_call", null);
const call = async (method, url, body) => {
  const [p, q = ""] = url.split("?");
  py.globals.set("_a", [method, p, q, body ?? null]);
  const r = await py.runPythonAsync(`
import json, demo_glue
m, p, q, b = _a.to_py()
r = await demo_glue.request(m, p, q, b)
json.dumps({"status": r["status"], "body": r["body"].decode()})`);
  const out = JSON.parse(r);
  return { status: out.status, json: () => JSON.parse(out.body) };
};

check(py.runPython("import sys; sys.modules['backend.main'].__file__").endsWith(".pyc"),
  "the backend loads from .pyc");
check(py.runPython("import sys; 'cryptography' not in sys.modules or not hasattr(sys.modules['cryptography'], '__file__')"),
  "no real cryptography");
const auth = await call("GET", "/api/auth");
check(auth.status === 200, "GET /api/auth");
const state = await call("GET", "/api/state?account=proton");
check(state.status === 200, "GET /api/state");
const senders = Object.entries(state.json().groups.sender);
check(senders.length > 100, `the proton demo mailbox is seeded (${senders.length} senders)`);
const [key, group] = senders.find(([, g]) => !g.protected && g.count > 5);
const del = await call("POST", "/api/delete?account=proton", { grouping: "sender", keys: [key] });
check(del.status === 200, `Trash ${key} (${group.count} mails)`);
const after = (await call("GET", "/api/state?account=proton")).json();
check(!(key in after.groups.sender), "the sender is gone from the state");
const undo = await call("POST", "/api/undo?account=proton", {});
check(undo.status === 200, "Undo");
const back = (await call("GET", "/api/state?account=proton")).json();
check(key in back.groups.sender, "the sender is back after Undo");
// the clock reads the seed's build time, not the real one
const clock = py.runPython("import time; time.time()");
check(Math.abs(clock - manifest.seedNow) < 600, `the clock is at the seed's build time (${new Date(clock * 1000).toISOString()})`);
console.log("smoke test passed");
