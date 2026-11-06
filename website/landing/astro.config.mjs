import { defineConfig } from "astro/config";

// The landing page: a second, plain Astro build (no framework, no client
// JS bundle) served at the site root. The docs build (../astro.config.mjs)
// is rooted at /docs/; the two outputs never share a directory, so the
// deploy step can lay them side by side without collisions.
export default defineConfig({
  root: ".",
  srcDir: "./landing/src",
  publicDir: "./public",
  outDir: "./dist-landing",
  site: "https://inboxrake.com",
  base: "/",
  trailingSlash: "always",
  // Own asset folder, so it can never clash with the docs build's _astro/.
  build: { assets: "landing-assets" },
});
