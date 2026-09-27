# Contributing to Mailbroom

Thanks for helping! Mailbroom deals with people's mailboxes, so the bar
for changes is: **safe by default, tested, and translated.**

## Workflow

1. Fork (or branch, if you have access) from `main`.
2. One topic per pull request; keep diffs reviewable.
3. CI must be green — it runs the backend tests, the frontend tests
   **including the TypeScript check**, and a full multi-arch Docker
   build. `main` only takes squash merges, so your PR title becomes the
   commit message: write it like a changelog line.
4. A maintainer review is required; @mclgoerg is auto-requested via
   CODEOWNERS.

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

No IMAP server or network is needed — the backend suite runs against an
in-memory fake IMAP server (`tests/conftest.py`).

## Ground rules for changes

- **Safety invariants are non-negotiable.** Deletions must remain
  reversible IMAP moves to the trash role, UIDVALIDITY must be checked
  before acting on cached UIDs, UID bookkeeping stays server-side, and
  accounts stay strictly separated (never aggregate across accounts).
  The optional AI review may only ever receive mail *metadata* — if you
  add a field to an AI payload, update the consent texts
  (`ai.disclaimer` / `ai.data_note`) in the same PR.
- **Tests come with the feature.** New backend behavior gets pytest
  coverage (use the FakeIMAP double), new frontend behavior gets a
  vitest test. Changes to persisted file formats need a read-side
  migration plus a migration test.
- **Every user-visible string** goes through `t()` with entries in BOTH
  `frontend/src/locales/en.ts` and `de.ts`.
- **UI composes the design system** (`frontend/src/components/ui.tsx`)
  and the theme tokens (`frontend/src/index.css`) — no hand-rolled
  controls, no raw colors, one shared loading animation.
- **No new runtime dependencies** without discussing it in an issue
  first; the stdlib has taken us far.
- Filter-syntax changes must land in both parsers: `frontend/src/lib.ts`
  and `backend/rules.py` (they are line-for-line ports, parity-tested).

## AI-assisted contributions

AI-generated code is welcome (most of this codebase started that way —
see the README's AI disclosure), with the same expectations as any other
code: you understood it, you tested it, and you can discuss it in
review.

## Security issues

Please do NOT open a public issue — see [SECURITY.md](SECURITY.md).
