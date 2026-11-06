// Builds the complete static file set the in-browser demo loads:
//
//   <out>/manifest.json            what is where (serve with `no-cache`)
//   <out>/pyodide-<ver>-<hash>/    the Pyodide runtime + the 10 wheels the
//                                  backend needs, trimmed lockfile, all
//                                  pure-Python code as .pyc
//   <out>/app.<hash>.zip           backend + tests/conftest.py + the demo
//                                  scripts (and their glue), as .pyc
//   <out>/seed.<hash>.zip          the pre-built demo mailboxes
//
// Everything but manifest.json carries a content hash in its path, so it can
// be cached for a year (`immutable`). Same inputs -> same bytes.
//
// The Pyodide version is pinned in ONE place: "dependencies.pyodide" in this
// directory's package.json (exact, no range). A bump is that one line
// plus `npm install` (the lockfile follows; the script checks they agree).
//
//   node build.mjs [--out DIR] [--budget-mb N] [--python PYTHON] [--seed DIR]
//
// --python  interpreter that has the backend's dependencies (builds the seed);
//           default $PYTHON, else python3
// --seed    use an existing seed directory instead of building one
// Exit code 1 when the estimated on-the-wire size is over the budget.

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { loadPyodide } from "pyodide";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..", "..");

// ------------------------------------------------------------------ config
const BUDGET_MB = 10;                // fail above this, estimated on the wire
const SEED_NOW = 1790000000;         // the instant the demo's dates derive from
// (a fixed one keeps the bundle reproducible; loading shifts the clock to it,
// see scripts/demo_seed.py)
const ROOTS = ["fastapi", "pydantic"];      // what the worker loadPackage()s
// what the roots depend on in Pyodide's lockfile but the demo never uses:
// httpx is the test client's, jinja2 is for templates. Anything else
// dropped fails the build.
const OMIT = new Set(["httpx", "jinja2"]);
const RUNTIME = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip"];
// the code the browser runs, copied from the repo at build time (never forked)
const APP_FILES = ["version.txt", "tests/conftest.py", "scripts/demo.py",
  "scripts/demo_seed.py", "scripts/demo_glue.py"];

// -------------------------------------------------------------------- args
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  if (i < 0) return dflt;
  if (i + 1 >= args.length) throw new Error(`${name} needs a value`);
  return args[i + 1];
};
const OUT = path.resolve(opt("--out", path.join(here, "dist")));
const budget = Number(opt("--budget-mb", BUDGET_MB)) * 1_000_000;
const PYTHON = opt("--python", process.env.PYTHON || "python3");
const seedArg = opt("--seed", "");

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const log = (...a) => console.log(...a);

// ----------------------------------------------------------- the version pin
const pkg = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8"));
const VERSION = pkg.dependencies?.pyodide;
if (!/^\d+\.\d+\.\d+$/.test(VERSION || "")) {
  throw new Error(`package.json must pin pyodide exactly (got ${JSON.stringify(VERSION)})`);
}
const PY_DIR = path.join(here, "node_modules", "pyodide");
const installed = JSON.parse(fs.readFileSync(path.join(PY_DIR, "package.json"), "utf8")).version;
if (installed !== VERSION) {
  throw new Error(`node_modules has pyodide ${installed}, package.json pins ${VERSION}: run npm ci`);
}

// -------------------------------------------------------- the trimmed lockfile
const lock = JSON.parse(fs.readFileSync(path.join(PY_DIR, "pyodide-lock.json"), "utf8"));
const norm = (n) => n.toLowerCase().replace(/_/g, "-");
const wanted = new Set();
const dropped = new Set();
const walk = (name) => {
  name = norm(name);
  if (wanted.has(name)) return;
  const p = lock.packages[name];
  if (!p) throw new Error(`pyodide ${VERSION} has no package ${name}`);
  wanted.add(name);
  for (const d of p.depends.map(norm)) {
    if (OMIT.has(d)) dropped.add(d); else walk(d);
  }
};
ROOTS.forEach(walk);
const unexpected = [...dropped].filter((d) => !OMIT.has(d));
if (unexpected.length || wanted.has("cryptography")) {
  throw new Error(`unexpected dependency set: ${[...wanted].sort()}`);
}
log(`pyodide ${VERSION} (python ${lock.info.python}): ${wanted.size} packages: ${[...wanted].sort().join(", ")}`);
log(`  left out: ${[...OMIT].sort().join(", ")}, cryptography (the demo's Fernet stand-in replaces it)`);

// The npm package ships the runtime and the lockfile but not the wheels;
// they come from Pyodide's release CDN, checked against the lockfile's
// sha256 and cached next to node_modules.
const CDN = `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/`;
const CACHE = path.join(here, "node_modules", ".cache", `pyodide-${VERSION}`);
async function wheel(p) {
  const local = path.join(CACHE, p.file_name);
  if (fs.existsSync(local) && sha(fs.readFileSync(local)) === p.sha256) return fs.readFileSync(local);
  const res = await fetch(CDN + p.file_name);
  if (!res.ok) throw new Error(`${CDN}${p.file_name}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha(buf) !== p.sha256) throw new Error(`${p.file_name}: sha256 does not match Pyodide's lockfile`);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(local, buf);
  return buf;
}

// -------------------------------------------- Pyodide, for the .pyc compiler
const py = await loadPyodide({ indexURL: PY_DIR, stdout: () => {}, stderr: console.error });
if (py.version !== VERSION) throw new Error(`runtime reports ${py.version}`);
const site = py.runPython("import site; site.getsitepackages()[0]") + "/";
py.FS.mkdirTree("/b/lib");
py.FS.writeFile("/b/lib/pyc.py", fs.readFileSync(path.join(here, "pyc.py")));
py.runPython("import sys; sys.path.insert(0, '/b/lib'); import pyc");
const pycMod = py.pyimport("pyc");
// a PythonError's own text is the traceback; Node would print the runtime
const pyc = new Proxy(pycMod, { get: (m, name) => (...a) => {
  try { return m[name](...a); } catch (e) { throw new Error(`pyc.${String(name)}: ${e.message}`); }
} });

// ------------------------------------------------------------- the work dir
const work = fs.mkdtempSync(path.join(os.tmpdir(), "demo-bundle-"));
process.on("exit", () => fs.rmSync(work, { recursive: true, force: true }));
const pyodideStage = path.join(work, "pyodide");
fs.mkdirSync(pyodideStage);

for (const f of RUNTIME) fs.copyFileSync(path.join(PY_DIR, f), path.join(pyodideStage, f));

const trimmed = {};
for (const name of [...wanted].sort()) {
  const p = lock.packages[name];
  const src = await wheel(p);
  let out = src;
  if (!p.file_name.includes("wasm32")) {         // pure Python: ship bytecode
    py.FS.writeFile("/b/in.whl", src);
    pyc.repack_wheel("/b/in.whl", "/b/out.whl", site);
    out = Buffer.from(py.FS.readFile("/b/out.whl"));
  }
  fs.writeFileSync(path.join(pyodideStage, p.file_name), out);
  trimmed[name] = { ...p, sha256: sha(out),
    depends: p.depends.filter((d) => wanted.has(norm(d))) };
}
fs.writeFileSync(path.join(pyodideStage, "pyodide-lock.json"),
  JSON.stringify({ ...lock, packages: trimmed }) + "\n");

// ------------------------------------------------------------------ app.zip
const appSrc = path.join(work, "app-src");
const put = (rel, from) => {
  const to = path.join(appSrc, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
};
const walkFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walkFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]);
for (const f of walkFiles(path.join(REPO, "backend"))) {
  const rel = path.relative(REPO, f);
  if (rel.includes("__pycache__") || /requirements/.test(path.basename(f))) continue;
  put(rel, f);
}
for (const rel of APP_FILES) put(rel, path.join(REPO, rel));
const toFS = (hostDir, fsDir) => {
  py.FS.mkdirTree(fsDir);
  for (const f of walkFiles(hostDir)) {
    const to = fsDir + "/" + path.relative(hostDir, f).split(path.sep).join("/");
    py.FS.mkdirTree(to.slice(0, to.lastIndexOf("/")));
    py.FS.writeFile(to, fs.readFileSync(f));
  }
};
toFS(appSrc, "/b/app-src");
pyc.pack("/b/app-src", "/b/app.zip", "/app/", true);
const appZip = Buffer.from(py.FS.readFile("/b/app.zip"));

// ------------------------------------------------------------------ seed.zip
let seedDir = seedArg && path.resolve(seedArg);
if (!seedDir) {
  seedDir = path.join(work, "seed");
  log(`building the seed with ${PYTHON} (DEMO_NOW=${SEED_NOW})`);
  execFileSync(PYTHON, [path.join(REPO, "scripts", "demo.py"), "--build-seed", seedDir], {
    env: { ...process.env, DEMO_NOW: String(SEED_NOW), LOG_LEVEL: "WARNING", PYTHONHASHSEED: "0" },
    stdio: ["ignore", "ignore", "inherit"], cwd: REPO,
  });
}
const manifestOf = (d) => JSON.parse(fs.readFileSync(path.join(d, "seed.json"), "utf8"));
if (manifestOf(seedDir).built_at !== SEED_NOW) {
  log(`  note: that seed was built at ${manifestOf(seedDir).built_at}, not ${SEED_NOW}`);
}
toFS(seedDir, "/b/seed");
pyc.pack("/b/seed", "/b/seed.zip", "", false);
const seedZip = Buffer.from(py.FS.readFile("/b/seed.zip"));

// ----------------------------------------------------------- assemble <out>
const files = [];                               // [{path, bytes, sha256}]
const pyodideHash = sha(JSON.stringify(fs.readdirSync(pyodideStage).sort().map(
  (f) => [f, sha(fs.readFileSync(path.join(pyodideStage, f)))]))).slice(0, 8);
const pyodideDir = `pyodide-${VERSION}-${pyodideHash}`;
const appName = `app.${sha(appZip).slice(0, 8)}.zip`;
const seedName = `seed.${sha(seedZip).slice(0, 8)}.zip`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, pyodideDir), { recursive: true });
const emit = (rel, buf) => {
  fs.writeFileSync(path.join(OUT, rel), buf);
  files.push({ path: rel, bytes: buf.length, sha256: sha(buf) });
};
for (const f of fs.readdirSync(pyodideStage).sort()) {
  emit(`${pyodideDir}/${f}`, fs.readFileSync(path.join(pyodideStage, f)));
}
emit(appName, appZip);
emit(seedName, seedZip);

// ---------------------------------------------------- size on the wire + budget
// Cloudflare compresses wasm / js / html / json with brotli; zips and wheels
// are sent as they are (DEMO1 findings, Q6/Q9). Quality 9 like the findings'
// measurements.
const compressible = /\.(wasm|m?js|html|json)$/;
const brotli = (b) => zlib.brotliCompressSync(b, { params: {
  [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;
for (const f of files) {
  f.wire = compressible.test(f.path) ? brotli(fs.readFileSync(path.join(OUT, f.path))) : f.bytes;
}
const total = files.reduce((s, f) => s + f.wire, 0);

const manifest = {
  pyodide: { version: VERSION, python: lock.info.python, dir: pyodideDir,
    roots: ROOTS, packages: [...wanted].sort() },
  app: appName,
  seed: seedName,
  seedNow: manifestOf(seedDir).built_at,
  wireBytes: total,
  files: files.map(({ path: p, bytes, sha256, wire }) => ({ path: p, bytes, wire, sha256 })),
};
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 1) + "\n");

const mb = (n) => (n / 1e6).toFixed(2).padStart(7);
log(`\n${"raw MB".padStart(9)} ${"wire MB".padStart(8)}  file`);
for (const f of [...files].sort((a, b) => b.wire - a.wire)) {
  log(`${mb(f.bytes)}  ${mb(f.wire)}  ${f.path}`);
}
log(`${mb(files.reduce((s, f) => s + f.bytes, 0))}  ${mb(total)}  TOTAL (budget ${(budget / 1e6).toFixed(2)} MB on the wire)`);
log(`bundle in ${OUT}`);
if (total > budget) {
  console.error(`\nOVER BUDGET: ${(total / 1e6).toFixed(2)} MB > ${(budget / 1e6).toFixed(2)} MB`);
  process.exit(1);
}
