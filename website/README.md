# Website (landing page + documentation)

Static site for <https://inboxrake.com/>: the landing page at `/` and the
documentation at <https://inboxrake.com/docs/>. The docs are built with
[Astro Starlight](https://starlight.astro.build/) from the Markdown in
[`../docs`](../docs) (the single source - there is no copy under
`website/`). Search is Pagefind, light/dark comes with the theme.

This directory is self-contained tooling: nothing here is part of the app
image, `backend/requirements*.txt` or `frontend/package.json`.

```bash
cd website
npm ci
npm run build      # builds both: docs -> dist/ (URLs rooted at /docs/),
                   #                landing -> dist-landing/ (rooted at /)
npm run dev        # docs live preview on http://127.0.0.1:4321/docs/
npm run dev:landing
```

The two outputs never share a directory; the deploy step puts
`dist-landing/` at the site root and `dist/` under `docs/`.

## Deploying

`scripts/build-site.sh` builds the landing page (with the demo button), the
docs, the demo UI and the demo bundle and lays them out as one tree in
`site-dist/` (`/`, `/docs/`, `/demo/`, `/demo/bundle/`, `_headers` at the
root), then checks it. `wrangler.jsonc` publishes that tree as Cloudflare
Workers static assets (wrangler is pinned in `package.json`). The
`deploy-site` workflow does both on every release tag and on a manual run,
then `scripts/smoke-site.sh` checks the live site (pages, and the cache
headers and MIME types the demo depends on). Pull requests only build and
dry-run. It needs the repository secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`; without them it fails up front saying so.

## Landing page

`landing/` is a second, plain Astro build (no framework, no client JS beyond
a tiny theme check that reuses the docs site's light/dark choice). The page
is `landing/src/pages/index.astro`; the hero screenshots are imported from
`../docs/screenshots/` (change the two imports at the top to swap them).

The **Try the demo** button is a build-time switch: it is only emitted when
`INBOXRAKE_DEMO_LIVE=1` is set for the build (off by default, so no dead
`/demo/` link ships). The deploy step flips it once the demo is live.

Serve `dist/` under `/docs/` (`BASE` in `site.config.mjs`, shared by the
Astro config and the link plugin).

`@astrojs/markdown-remark` is listed although nothing imports it: Astro 7
requires it to be installed for `markdown.remarkPlugins` to run.

## Writing pages

- Pages are `docs/*.md`. Each needs `title:` (and ideally `description:`)
  frontmatter; the leading `# Heading` stays for GitHub readers and is
  dropped on the site (Starlight renders the title).
- Link pages as `other.md#anchor` and repository files as `../path` - the
  plugin in `plugins/docs-links.mjs` turns them into site URLs and GitHub
  links.
- A new page also needs an entry in the `sidebar` of `astro.config.mjs`.
- Invented `.example` data only (see CONTRIBUTING.md, "Privacy").
