import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The package.json version IS the release version (git tags are v<this>) -
// bake it in at build time so the UI can show it without a backend round
// trip (see __APP_VERSION__ in App.tsx / vite-env.d.ts).
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    // Local dev: proxy API calls to the backend container/port.
    proxy: { "/api": "http://127.0.0.1:8765" },
  },
});
