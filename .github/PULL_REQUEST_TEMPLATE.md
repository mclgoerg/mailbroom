## What & why

<!-- One or two sentences. The PR title becomes the squash-commit line. -->

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
