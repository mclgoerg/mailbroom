# Contributing to Mailbroom

Thanks for helping! Mailbroom deals with people's mailboxes, so the bar
for changes is: **safe by default, tested, and translated.**

## Workflow

1. Fork (or branch, if you have access) from `main`. Branch names
   aren't enforced, but `feature/...`, `fix/...`, `chore/...` and
   `docs/...` (matching the commit type below) keep things scannable.
2. One topic per pull request; keep diffs reviewable. **Everything**
   lands through a PR - `main` takes no direct pushes, and the
   maintainer holds themselves to the same rule.
3. **PR titles are checked against [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)**
   (`feat: ...`, `fix: ...`, `chore: ...`, `docs: ...`, `refactor: ...`,
   `perf: ...`, `test: ...`, `build: ...`, `ci: ...`; add `!` after the
   type for a breaking change). This isn't just style - `main` only
   takes squash merges, so your PR title becomes the commit message,
   and [release-please](https://github.com/googleapis/release-please)
   parses that history to compute the next version and `CHANGELOG.md`
   entry. An unconventional title is invisible to both.
4. User-facing PRs (`feat`, `fix`, `perf`, or any breaking change) carry
   a **`## Release notes`** section in the description - see
   [Release notes](#release-notes) below. A CI check enforces it.
5. CI must be green - it runs the backend tests, the frontend tests
   **including the TypeScript check**, and a full multi-arch Docker
   build.
6. External PRs get a maintainer review; @mclgoerg is auto-requested
   via CODEOWNERS.

## Releasing (maintainer)

release-please keeps a standing "Release please" PR up to date on
every push to `main`, bumping `version.txt` (mirrored into
`frontend/package.json`) and writing `CHANGELOG.md` from the
Conventional Commit history since the last release - merging it
(whenever, no fixed schedule) is the entire release process: it tags
the version, publishes the versioned image to GHCR, and creates the
GitHub Release.

## Release notes

release-please writes each changelog entry from the PR **title** alone, so
a one-line title is all the release PR, `CHANGELOG.md` and the GitHub
Release would show. To give users the real story:

- Put a `## Release notes` section in the PR description: one to four
  plain-language lines on what changes *for the user* (not how it was
  built), plus anything to know when upgrading (e.g. "the first scan after
  this is a full rescan"). Markdown lists are fine; headings inside are
  flattened to bold; it is capped at ~1200 characters.
- After every push to `main`, `release-please.yml` copies that text under
  the PR's entry in the standing release PR's description and in
  `CHANGELOG.md` on the release branch (`scripts/release_notes.py`;
  idempotent, nothing is rewritten, only added).
- `Release Notes Check` fails a `feat`/`fix`/`perf`/breaking PR without the
  section. Not actually user-facing? Add the `skip-release-notes` label.
- A PR that ships **several distinct changes** can list them as separate
  changelog bullets with release-please's own override block at the end of
  the description (each line is a conventional-commit message; the
  `## Release notes` text is attached under the first bullet):

  ```
  BEGIN_COMMIT_OVERRIDE
  feat: conversation threads as a fourth grouping tab
  fix: thread keys use SHA-256
  END_COMMIT_OVERRIDE
  ```

## Running everything locally

```bash
# backend (Python 3.13)
pip install -r backend/requirements-dev.txt
python -m pytest tests/ -q

# frontend (Node 26)
cd frontend && npm ci
npm test          # tsc --noEmit + vitest

# or exactly like CI, via Docker:
docker run --rm -v "$PWD":/app -w /app python:3.13-slim \
  sh -c "pip install -q -r backend/requirements-dev.txt && python -m pytest tests/ -q"
docker run --rm -v "$PWD/frontend":/app -w /app node:26-alpine \
  sh -c "npm ci --no-audit --no-fund && npm test"
```

No IMAP server or network is needed - the backend suite runs against an
in-memory fake IMAP server (`tests/conftest.py`).

## Ground rules for changes

- **Safety invariants are non-negotiable.** Deletions must remain
  reversible IMAP moves to the trash role, UIDVALIDITY must be checked
  before acting on cached UIDs, UID bookkeeping stays server-side, and
  accounts stay strictly separated (never aggregate across accounts).
  The optional AI review may only ever receive mail *metadata* - if you
  add a field to an AI payload, update the consent texts
  (`ai.disclaimer` / `ai.data_note`) in the same PR.
- **Tests come with the feature.** New backend behavior gets pytest
  coverage (use the FakeIMAP double), new frontend behavior gets a
  vitest test. Changes to persisted file formats need a read-side
  migration plus a migration test.
- **Every user-visible string** goes through `t()` with entries in BOTH
  `frontend/src/locales/en.ts` and `de.ts`.
- **UI composes the design system** (`frontend/src/components/ui.tsx`)
  and the theme tokens (`frontend/src/index.css`) - no hand-rolled
  controls, no raw colors, one shared loading animation.
- **No new runtime dependencies** without discussing it in an issue
  first; the stdlib has taken us far.
- Filter-syntax changes must land in both parsers: `frontend/src/lib.ts`
  and `backend/rules.py` (they are line-for-line ports, parity-tested).

## Privacy

Mailbroom is public, and the people who build it run it on their own
mailboxes. Nothing from a real mailbox may end up here: code, tests,
fixtures, the demo, docs, commit messages, branch names, PR titles,
descriptions and comments use **invented `.example` data and generic words
only** - no real company, sender address, domain or subject line, and no
labels or AI answers taken from a mailbox. Rules never name companies
(company knowledge is per-user data on an instance, not code). Aggregate
numbers are fine; per-sender data is not. This includes *selection*: don't
keep or drop a company, domain or address in anything public because of
which senders it matched in a private mailbox.

- **CI guard:** `tests/test_no_real_names.py` fails on e-mail addresses and
  on host names that are real registrable domains - in URLs, markdown
  links, string literals, comments and docstrings - unless they are
  `.example` / `.invalid` / `.test` / `localhost`, `example.com/.org/.net`,
  the freemail and platform lists in `backend/smartkinds.py`, the built-in
  keyword categories, or listed with a reason in `tests/allowed_domains.txt`
  (public infrastructure only: the project's own repository, documentation,
  provider endpoints - never "because I receive mail from them"). Tests that
  need a multi-part suffix such as `co.uk` build the name from invented
  labels and the suffix list instead of writing a real domain.
- **What the guard cannot see:** a company named without its domain,
  subject lines, labels, anything in a PR description. For that, scan before
  every push with your own list of private tokens (kept outside the
  repository, one token per line or JSON):

  ```bash
  PRIVATE_DATA_DIR=~/private/tokens python scripts/prepush_leak_scan.py --pr 123
  ```

  It scans the lines your branch adds, its commit messages and branch name,
  and (with `--pr`) the PR text; it prints locations, never the surrounding
  text (`--show-tokens` adds the matching tokens). Exit code 0 means clean.

## AI-assisted contributions

AI-generated code is welcome (this codebase was built with AI
assistance - see the README's AI disclosure), with the same expectations
as any other code: you understood it, you tested it, and you can discuss it in
review.

## Security issues

Please do NOT open a public issue - see [SECURITY.md](SECURITY.md).
