## What & why

<!-- One or two sentences. The PR title becomes the squash-commit line. -->

## Release notes

<!-- feat / fix / perf PRs (and breaking changes): 1-4 plain-language lines
     on what changes for the USER, plus anything to know when upgrading.
     This text is copied under the PR's entry in the release PR, CHANGELOG.md
     and the GitHub Release. Not user-facing? Use the `skip-release-notes`
     label instead. One PR shipping several distinct changes? See
     "Release notes" in CONTRIBUTING.md (BEGIN_COMMIT_OVERRIDE). -->

## Checklist

- [ ] Tests added/updated (pytest for backend, vitest for frontend) and
      `npm test` + `python -m pytest tests/` pass locally
- [ ] User-visible strings added to **both** `locales/en.ts` and
      `locales/de.ts`
- [ ] UI changes compose `ui.tsx` components / theme tokens only
- [ ] Safety invariants untouched (reversible deletes, UIDVALIDITY
      checks, strict account separation, AI gets metadata only - consent
      texts updated if AI payload fields changed)
- [ ] Persisted-format change? Read-side migration + migration test
      included
- [ ] README updated if behavior or setup changed
