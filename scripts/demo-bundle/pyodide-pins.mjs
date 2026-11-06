// Reads the Pyodide pin (package.json, via node_modules/pyodide) so CI can
// run the backend on the same Python and package versions the browser gets.
//
//   node pyodide-pins.mjs python        Python version (e.g. 3.14.2)
//   node pyodide-pins.mjs constraints   `name==version` for every package the
//                                       demo loads (build.mjs's closure)
//   node pyodide-pins.mjs requirements  fails if backend/requirements.in names
//                                       a package Pyodide lacks and the demo
//                                       does not replace (see ALLOWED below)
//
// Needs `npm ci` in this directory first.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, "..", "..");
const ROOTS = ["fastapi", "pydantic"];   // keep in step with build.mjs
const OMIT = new Set(["httpx", "jinja2"]);
// Requirements Pyodide does not ship that the demo does not need: uvicorn
// (no sockets), anthropic/openai (stubbed, backend/demo.py), cryptography
// (Fernet stand-in). Anything else new in requirements.in would break the
// bundle's imports, so it must be dealt with in backend/demo.py first.
const ALLOWED = new Set(["uvicorn", "anthropic", "openai", "cryptography"]);

const norm = (n) => n.toLowerCase().replace(/_/g, "-");
const pin = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8")).dependencies.pyodide;
const lock = JSON.parse(fs.readFileSync(
  path.join(here, "node_modules", "pyodide", "pyodide-lock.json"), "utf8"));
const closure = new Map();
const walk = (name) => {
  name = norm(name);
  if (closure.has(name) || OMIT.has(name)) return;
  const p = lock.packages[name];
  if (!p) throw new Error(`pyodide ${pin} has no package ${name}`);
  closure.set(name, p.version);
  p.depends.forEach(walk);
};
ROOTS.forEach(walk);

const mode = process.argv[2];
if (mode === "python") {
  console.log(lock.info.python);
} else if (mode === "constraints") {
  for (const [n, v] of [...closure].sort()) console.log(`${n}==${v}`);
} else if (mode === "requirements") {
  const names = fs.readFileSync(path.join(REPO, "backend", "requirements.in"), "utf8")
    .split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean)
    .map((l) => norm(l.match(/^[A-Za-z0-9._-]+/)[0]));
  const bad = names.filter((n) => !closure.has(n) && !ALLOWED.has(n));
  if (bad.length) {
    console.error(`backend/requirements.in names ${bad.join(", ")}: not in Pyodide ${pin} and not stubbed in the demo.\n`
      + "See \"The browser demo runs this code too\" in CONTRIBUTING.md.");
    process.exit(1);
  }
  console.log(`ok: ${names.join(", ")}`);
} else {
  console.error("usage: pyodide-pins.mjs python|constraints|requirements");
  process.exit(2);
}
