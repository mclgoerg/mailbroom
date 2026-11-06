---
title: "Security & privacy"
---

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

## Password login throttling

Password login allows 5 attempts per 15 minutes per client address (IPv6
per /64); further attempts get a "try again in N minutes" answer without
any password check, even with the right password. Attempts are counted
before the check, so parallel requests do not get around the limit. The
counters live in memory only: a restart forgives.

Inboxrake never trusts `X-Forwarded-For` itself. Behind a reverse proxy
every visitor therefore shares the proxy's address, so **5 wrong passwords
from anyone lock everyone out for 15 minutes**, unless uvicorn is told
which proxy to believe. Set `FORWARDED_ALLOW_IPS` in the container
environment to your proxy's address, or to its network in CIDR form (for
example the Docker network's subnet), and attempts are counted per visitor.
**Never set it to `*`**: uvicorn then believes the leftmost
`X-Forwarded-For` entry, which the visitor writes themselves (proxies
append to the header they received), so anyone can dodge the throttle by
sending a different fake address with every attempt.

The trusted address must carry **only the reverse proxy's traffic**. Prefer
the proxy container's own address over a whole Docker subnet: the subnet
includes its gateway, and anything that reaches the app through Docker's
own port forwarding (a process on the host, or IPv6 clients when the port
is published without IPv6 on the bridge) arrives from the gateway and
could then fake `X-Forwarded-For`. When a proxy fronts Inboxrake, keep
`INBOXRAKE_BIND=127.0.0.1` (the default) or do not publish the port at all.

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

## The safety promises

- **Nothing is deleted without asking.** Trashing is an IMAP move to the
  Trash folder, behind a confirmation that names how many mails are
  affected. UIDVALIDITY is checked before acting on cached UIDs, and scans
  are read-only.
- **Everything is undoable** except the explicit permanent-delete actions
  in Trash and Junk. The manual ones confirm with exact counts; an opt-in
  purge rule only acts after you have reviewed a report run, then runs on
  its schedule within its age limit and per-run cap. Rules start in report
  mode too.
- **Protected senders and pinned mails:** rules and the Folders-panel
  purges always skip them. Moving a protected group, or a single pinned
  mail, to Trash asks for an extra confirmation; individually selected
  mails from a protected sender are not checked. **Empty Trash empties
  everything in Trash**, protected or not.
- **Accounts stay strictly separate** - nothing is aggregated across
  accounts, and with SSO nothing is shared between users.

## What the optional AI review sends

Only mail **metadata**, and only to the AI provider you configure (a cloud
provider or a local model such as Ollama): sender names and addresses,
mail counts, sizes, dates, read state, category tags, subject lines,
protected-sender markers and whether you ever replied to a sender. Mail
bodies and attachments are never sent. AI sorting of the "Other" row sends,
per sender, its name and address, mail count, whether it offers an
unsubscribe link and up to three recent subject lines, plus your own sorting
instructions. Describing a filter in words sends only your sentence, the
filter syntax and the names of your tags. The review is off until you set it
up and consent in the UI.

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md).
