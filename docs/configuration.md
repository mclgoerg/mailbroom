---
title: "Configuration"
description: "Every environment variable Inboxrake reads."
---

# Configuration

Everything here is optional **bootstrap**. The settings UI can change all of
it at runtime and saves to the `/data` volume, which then wins over the
environment. Put the variables in the `.env` next to the starter compose
file ([`deploy/.env.example`](../deploy/.env.example)) or pass them with
`-e` to `docker run`.

## `INBOXRAKE_*`

| Variable | Default | What it does |
|---|---|---|
| `INBOXRAKE_SECRET_KEY` | unset | Encrypts stored secrets (IMAP passwords, API keys, OIDC client secret, OAuth tokens) in `/data`. Any string works; generate one with `openssl rand -base64 32`. Unset means plaintext (a startup warning says so). Also required for the local body-search index. Keep it out of backups. |
| `INBOXRAKE_ALLOWED_HOSTS` | unset | Without a login only `localhost` and IP addresses are answered. List extra host names here: comma separated, exact names, `*.example.org` for subdomains, `*` for any. |
| `INBOXRAKE_MS_CLIENT_ID` | unset | Client ID of an administrator-provided Microsoft (Entra) public app; no such app ships with Inboxrake. When set, Outlook accounts sign in with a device code and need no app registration of their own. Leave it unset and each user registers their own app. |
| `INBOXRAKE_MS_TENANT` | `consumers` | Microsoft tenant for sign-in: a tenant ID or domain, `organizations` or `common` for work/school accounts. |
| `INBOXRAKE_BIND` | `127.0.0.1` | Read by the starter compose file only (not by the app): the host address the port is published on. Use `0.0.0.0` only after setting a login. |
| `INBOXRAKE_PORT` | `8765` | Read by the starter compose file only: the host port. |

**Former name.** Inboxrake was formerly Mailbroom, and settings under the formerly Mailbroom `MAILBROOM_*` names still work: where the matching `INBOXRAKE_*` one is unset or blank, its value is used, and a startup log line suggests the rename. The starter compose file no longer reads the formerly Mailbroom pair `MAILBROOM_BIND` / `MAILBROOM_PORT`.

## First mail account (headless setups)

Leave these unset to use the setup wizard instead. Set them only for a
setup that should come up configured; they bootstrap **one** account.

| Variable | Default | What it does |
|---|---|---|
| `IMAP_HOST` | `127.0.0.1` | IMAP server. |
| `IMAP_PORT` | `1143` | IMAP port. |
| `IMAP_SECURITY` | `ssl` | `ssl` or `starttls`. |
| `IMAP_USER` | empty | Login name. |
| `IMAP_PASSWORD` | empty | Password or app password. |
| `IMAP_CAFILE` | see text | CA file for self-signed certificates (Proton Bridge). Leave it **empty** for normal providers. When unset, Proton Bridge's usual path `/certs/bridge-cert.pem` is used only if that file exists. |
| `SMTP_HOST` | empty | SMTP server, used only to send unsubscribe mails. Empty means the IMAP host. |
| `SMTP_PORT` | `1025` | SMTP port. |
| `SMTP_SECURITY` | `auto` | `auto`, `ssl` or `starttls`. |

## Login

| Variable | Default | What it does |
|---|---|---|
| `AUTH_MODE` | `none` | `none`, `password` or `oidc`. A mode whose prerequisites are missing (no password, or no issuer / client ID / secret) falls back to `none`. |
| `AUTH_PASSWORD` | empty | The shared password for `password` mode (hashed with scrypt at start). |
| `OIDC_ISSUER` | empty | Issuer URL of your OpenID Connect provider. |
| `OIDC_CLIENT_ID` | empty | Client ID registered at the provider. |
| `OIDC_CLIENT_SECRET` | empty | Client secret. |
| `OIDC_ALLOWED` | empty | Comma-separated emails allowed to sign in. Empty admits any account at the provider. |
| `OIDC_REDIRECT_BASE` | empty | Only needed when auto-detection through `X-Forwarded-*` headers does not work. The callback is `<base>/api/oidc/callback`. |
| `OIDC_ADMIN` | empty | Identity that owns the pre-SSO workspace and the server settings. Empty means the first SSO login claims it. |

See [Security & privacy](security.md) for what each mode protects.

## AI review

| Variable | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | empty | API key for the optional AI review. Can also be set in Settings -> AI. |
| `AI_MODEL` | `claude-sonnet-5` | Model name used for it. |

## Tuning and paths

| Variable | Default | What it does |
|---|---|---|
| `LOG_LEVEL` | `INFO` | Python log level. |
| `AUTOSCAN_INTERVAL` | `60` | Seconds between scheduler checks for due automatic scans. |
| `DIGEST_INTERVAL` | `1800` | Seconds between checks for a due digest. |
| `RULES_INTERVAL` | `600` | Seconds between checks for due rules. |
| `RULE_CAP` | `500` | Most mails one rule run may act on. |
| `NEW_SENDER_WINDOW_DAYS` | `7` | How long a sender counts as "new" (`is:new`). |
| `STATIC_DIR` | bundled UI | Where the built web UI is served from. |

State files default to names inside `/data` and normally need no change:
`CONFIG_PATH` (`config.json`), `SERVER_PATH` (`server.json`),
`STATS_PATH` (`ai_usage.json`), `STATS_HISTORY_PATH`
(`stats_history.json`), `RULES_PATH` (`rules.json`), `AUTOSCAN_PATH`
(`autoscan.json`), `DIGEST_PATH` (`digest.json`), `PRESETS_PATH`
(`presets.json`), `PINS_PATH` (`pinned_mails.json`), `REPLIED_PATH`
(`replied.json`), `VERDICTS_PATH` (`ai_verdicts.json`), `AI_SORT_PATH`
(`ai_sort.json`), `SENDER_KNOWLEDGE_PATH` (`sender_knowledge.json`),
`KNOWN_SENDERS_PATH` (`known_senders.json`), `UNSUB_STATE_PATH`
(`unsub_state.json`), `AUDIT_LOG_PATH` (`audit_log.jsonl`),
`SESSION_SECRET_PATH` (`session_secret`), `TENANTS_DIR` (`tenants`),
`SNAPSHOT_DIR` (the scan caches, `/data`).
