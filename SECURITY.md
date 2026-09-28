# Security policy

Mailbroom holds IMAP credentials and (optionally) AI API keys, and acts
on real mailboxes - security reports are taken seriously.

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** on this
repository ("Security" tab → "Report a vulnerability"). Do not open a
public issue for security problems.

You can expect an initial response within a week. Please include steps
to reproduce and the deployment mode (reverse proxy / built-in login /
open).

## Supported versions

Only the latest release (the `main` branch / the `latest` container
image) receives fixes.

## Scope notes

- Authentication is **off by default** by design (the documented trust
  model is localhost + reverse-proxy auth); reports assuming an exposed
  unauthenticated instance configured against the README's warning are
  out of scope.
- In scope, always: credential/secret exfiltration, authentication
  bypass of the built-in password/OIDC login, SSRF beyond the guarded
  unsubscribe POST, path traversal, and anything letting one account
  read another account's data.
