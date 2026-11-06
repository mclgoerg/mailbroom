# Login, multi-user and secrets

Out of the box Inboxrake has **no login**: anyone who can reach the port
can read your mail metadata and reconfigure the IMAP host or AI endpoint
(and so read the stored credentials). Pick one of:

- keep the port on localhost, or behind a reverse proxy with its own
  authentication (Traefik + tinyauth/Authelia, ...), or
- turn on the built-in login in Settings -> Server -> Login: a
  **password** (scrypt-hashed, session cookie), or **SSO via any OpenID
  Connect provider** (Pocket ID, Authentik, Keycloak, ...). Register the app
  at the provider with the callback URL `https://your-host/api/oidc/callback`,
  then enter issuer, client ID and secret. Both can also be bootstrapped
  from the environment (`AUTH_MODE`, `AUTH_PASSWORD`, `OIDC_*` - see
  [`deploy/.env.example`](../deploy/.env.example)).

Docker published ports bypass `ufw`, so a host firewall is not enough.

## Behaviour worth knowing

- **Host check (no login only).** Without a login, Inboxrake refuses
  requests whose `Host` is not `localhost` or an IP address (protection
  against DNS rebinding), and refuses cross-site writes. To open it under a
  host name add `INBOXRAKE_ALLOWED_HOSTS=<name>` (comma list,
  `*.example.org` for subdomains) to the container environment. A blocked
  browser sees a page that says so.
- **Password mode** slows down repeated wrong passwords per client.
- **Sessions.** Changing the password, the login method, the allowed users,
  the admin or the identity provider (also via `.env` + restart) signs every
  browser out, as does Settings -> Server -> *Sign out all sessions*. Logging
  out only clears that browser's cookie.
- **SSO and `email_verified`.** An identity whose email the provider reports
  as unverified (`email_verified: false`) is refused; providers that omit the
  claim are accepted. Keep the allowed-users list filled: **empty means every
  account at the provider may sign in** and gets its own workspace (a startup
  warning says so).

## Multi-user (SSO mode)

With SSO enabled, **every signed-in identity gets its own isolated
workspace**: their own mail accounts, scans, AI verdicts, rules, statistics
and settings - nothing is shared or visible across users. One identity is the
**admin** (set `OIDC_ADMIN`, enter it in settings, or let the first login
claim it): the admin owns the workspace that existed before SSO was enabled,
plus the server-level settings (login config and the optional **shared AI
key** - users without their own key can use the admin's, capped by a
per-user monthly budget). Password mode and "none" stay single-workspace.

## Secrets encryption at rest

Set `INBOXRAKE_SECRET_KEY` (e.g. `openssl rand -base64 32`) and every stored
secret - IMAP passwords, AI API keys, the OIDC client secret, OAuth client
secrets and tokens - is encrypted on disk (Fernet/AES). That protects
**volume backups**: without the key, a copied `/data` contains no usable
credentials. Keep the key in the environment only, never in the backups; if
it is lost, re-enter the secrets. Unset = plaintext (a startup log line
reminds you).

## Microsoft tenant

Outlook / Microsoft 365 sign-in uses the `consumers` tenant by default
(personal accounts). For a work or school tenant set `INBOXRAKE_MS_TENANT`
to its tenant ID or domain (or `organizations` / `common`); the shared
client ID, if you run one, is `INBOXRAKE_MS_CLIENT_ID` (see
[install.md](install.md#microsoft-oauth-setup)).

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
