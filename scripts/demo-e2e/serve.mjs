// Serves the built demo the way the deploy lays it out (127.0.0.1 only):
//   /demo/bundle/*  <- DEMO_BUNDLE  (scripts/demo-bundle/build.mjs --out)
//   /demo/*         <- DEMO_UI      (frontend: npm run build:demo)
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const UI = path.resolve(process.env.DEMO_UI || path.join(here, "../../frontend/dist-demo"));
const BUNDLE = path.resolve(process.env.DEMO_BUNDLE || path.join(here, "../demo-bundle/dist"));
const PORT = Number(process.env.DEMO_PORT || 4173);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm",
  ".svg": "image/svg+xml", ".zip": "application/zip", ".whl": "application/zip",
  ".webmanifest": "application/manifest+json" };

for (const [what, dir] of [["DEMO_UI", UI], ["DEMO_BUNDLE", BUNDLE]]) {
  if (!fs.existsSync(path.join(dir, what === "DEMO_UI" ? "index.html" : "manifest.json"))) {
    console.error(`${what}=${dir} is not a build output (build it first, see README.md)`);
    process.exit(1);
  }
}

http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const root = rel.startsWith("/demo/bundle/") ? BUNDLE : UI;
  rel = rel.startsWith("/demo/bundle/") ? rel.slice("/demo/bundle/".length)
    : rel.startsWith("/demo/") ? rel.slice("/demo/".length) : null;
  if (rel === null) { res.writeHead(404).end(); return; }
  if (rel === "") rel = "index.html";
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, "127.0.0.1", () => console.log(`demo on http://127.0.0.1:${PORT}/demo/`));
