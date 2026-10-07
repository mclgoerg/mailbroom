# Mailbroom - instructions for AI agents

Read [CONTRIBUTING.md](CONTRIBUTING.md) first - it is the source of
truth for how changes land here (workflow, tests, ground rules).

Two things worth restating because tooling depends on them being
followed exactly, not just as style:

- **Branch names**: `feature/...`, `fix/...`, `chore/...`, `docs/...`
  (matching the PR title type below).
- **PR titles must be [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)**
  (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `perf:`, `test:`,
  `build:`, `ci:`; `!` after the type for a breaking change) - a CI
  check enforces this, and since `main` only takes squash merges, this
  title becomes the commit history that release-please parses to
  compute the next version and `CHANGELOG.md`. Getting this wrong
  doesn't just read badly, it silently drops the change from the next
  release's notes.

- **User-facing PRs need a `## Release notes` section** in the PR
  description (`feat`/`fix`/`perf`/breaking; 1-4 plain-language lines on
  what changes for the user, plus upgrade caveats) - release-please only
  sees the title, and `release-please.yml` copies that section under the
  PR's entry in the release PR / `CHANGELOG.md`. A CI check enforces it;
  use the `skip-release-notes` label for the rare non-user-facing case.
  Details in CONTRIBUTING.md.

One topic per PR, CI green before merge, never push directly to
`main`.
