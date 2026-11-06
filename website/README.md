# Documentation site

Static site for <https://inboxrake.com/docs/>, built with
[Astro Starlight](https://starlight.astro.build/) from the Markdown in
[`../docs`](../docs) (the single source - there is no copy under
`website/`). Search is Pagefind, light/dark comes with the theme.

This directory is self-contained tooling: nothing here is part of the app
image, `backend/requirements*.txt` or `frontend/package.json`.

```bash
cd website
npm ci
npm run build      # static site in website/dist/, URLs rooted at /docs/
npm run dev        # live preview on http://127.0.0.1:4321/docs/
```

Serve `dist/` under `/docs/` (the `base` in `astro.config.mjs`).

## Writing pages

- Pages are `docs/*.md`. Each needs `title:` (and ideally `description:`)
  frontmatter; the leading `# Heading` stays for GitHub readers and is
  dropped on the site (Starlight renders the title).
- Link pages as `other.md#anchor` and repository files as `../path` - the
  plugin in `plugins/docs-links.mjs` turns them into site URLs and GitHub
  links.
- A new page also needs an entry in the `sidebar` of `astro.config.mjs`.
- Invented `.example` data only (see CONTRIBUTING.md, "Privacy").
