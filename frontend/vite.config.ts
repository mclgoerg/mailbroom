import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Demo build only (served at https://inboxrake.com/demo/): link-preview tags
// for the page, and the web app manifest re-rooted under /demo/ - Vite
// prefixes the base onto index.html links but leaves the manifest's own
// absolute paths alone, so its icon requested /icon.svg and got a 404.
// The app's own index.html in the Docker image is untouched.
const demoSite = (): Plugin => {
  let outDir = "";
  const title = "Inboxrake demo - try it in your browser";
  const description =
    "A mailbox cleanup demo that runs entirely in your browser, on made-up mail. Nothing is sent anywhere.";
  return {
    name: "inboxrake-demo-site",
    apply: "build",
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    transformIndexHtml: () => [
      { tag: "meta", injectTo: "head", attrs: { name: "description", content: description } },
      { tag: "meta", injectTo: "head", attrs: { property: "og:type", content: "website" } },
      { tag: "meta", injectTo: "head", attrs: { property: "og:title", content: title } },
      { tag: "meta", injectTo: "head", attrs: { property: "og:description", content: description } },
      { tag: "meta", injectTo: "head", attrs: { property: "og:url", content: "https://inboxrake.com/demo/" } },
      { tag: "meta", injectTo: "head", attrs: { property: "og:image", content: "https://inboxrake.com/og.png" } },
      { tag: "meta", injectTo: "head", attrs: { property: "og:image:width", content: "1200" } },
      { tag: "meta", injectTo: "head", attrs: { property: "og:image:height", content: "630" } },
      { tag: "meta", injectTo: "head", attrs: { name: "twitter:card", content: "summary_large_image" } },
    ],
    closeBundle() {
      const file = resolve(outDir, "manifest.webmanifest");
      const m = JSON.parse(readFileSync(file, "utf-8"));
      m.start_url = m.scope = "/demo/";
      for (const i of m.icons) i.src = "/demo" + i.src;
      writeFileSync(file, JSON.stringify(m, null, 2) + "\n");
    },
  };
};

// The package.json version IS the release version (git tags are v<this>) -
// bake it in at build time so the UI can show it without a backend round
// trip (see __APP_VERSION__ in App.tsx / vite-env.d.ts).
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

// `vite build --mode demo` (npm run build:demo) is the in-browser demo: the
// same UI plus src/demo/, with VITE_DEMO baked in as a constant so the normal
// build drops all of it (see main.tsx).
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === "demo" ? [demoSite()] : [])],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    ...(mode === "demo" ? { "import.meta.env.VITE_DEMO": '"1"' } : {}),
  },
  // the demo's Pyodide worker is a module worker (it import()s pyodide.mjs)
  worker: { format: "es" },
  server: {
    // Local dev: proxy API calls to the backend container/port.
    proxy: { "/api": "http://127.0.0.1:8765" },
  },
}));
