---
title: "Install"
---

# Installing Inboxrake

Inboxrake is a single container. Whatever platform you use, it boils
down to the same four things:

| What | Value |
|---|---|
| Image | `ghcr.io/mclgoerg/inboxrake:latest` follows `main` (every merge, possibly ahead of the last release); pin `:2.0` (or `:2.0.x`) for release-only updates |
| Port | `8765` (HTTP web UI + API) |
| Volume | `/data` - all settings, scan caches and stats live here |
| Env vars | all optional bootstrap - see [`deploy/.env.example`](../deploy/.env.example) |

Everything set via env can also be configured later in the settings UI
(env is only the first-start bootstrap). Two things to decide up front:

- **Login:** out of the box there is NO authentication. Either keep the
  port on localhost behind a reverse proxy with auth, or enable the
  built-in password/SSO login (Settings -> Server -> Login, or `AUTH_MODE` env).
  Never publish port 8765 straight to the internet without one of these.
  Without a login, Inboxrake only answers to `localhost` and IP
  addresses (DNS-rebinding protection); to open it under a host name,
  add `INBOXRAKE_ALLOWED_HOSTS=<name>` to the container environment
  (comma list, `*.example.org` for subdomains).
- **Secrets encryption:** set `INBOXRAKE_SECRET_KEY` (generate with
  `openssl rand -base64 32`) **before the first start**, so IMAP
  passwords, API keys and OAuth tokens are encrypted inside `/data` and the
  stored secrets in a copied volume backup are unreadable without the
  key (mail metadata, verdicts and stats are not encrypted). Without it
  the secrets are stored as plaintext and every start logs a warning. Keep the key out of
  your backups; if it is lost you re-enter the secrets.

**Proton Mail users:** Inboxrake talks to Proton through the
[Proton Mail Bridge](https://proton.me/mail/bridge), which runs as a
second container sharing the network namespace. Use
[`deploy/docker-compose.proton.yml`](../deploy/docker-compose.proton.yml)
(setup steps in the file header) - the platform recipes below cover the
generic IMAP case (Gmail, iCloud, Fastmail, ...). Before the first start
set `BRIDGE_IMAGE` in `.env`: Inboxrake ships no Bridge image, so build
one from Proton's source or pick a community image (verify it is still
maintained). Running Bridge in Docker is a community setup that Proton
does not support, and Bridge needs a paid Proton plan.

## Docker Compose (recommended)

```bash
git clone https://github.com/mclgoerg/inboxrake
cd inboxrake/deploy
cp .env.example .env        # optional edits - account setup is in the UI
docker compose up -d
```

Open http://localhost:8765. Update later with
`docker compose pull && docker compose up -d`.

**Reaching it from other devices.** The kit publishes the port on
`127.0.0.1` only. To open it to your LAN set `INBOXRAKE_BIND=0.0.0.0` in
`.env` (and `docker compose up -d` again) - but **set a login first**
([security.md](security.md)): until you do, anyone on that network can read
the mailbox metadata and change the IMAP settings. Without a login you
also need `INBOXRAKE_ALLOWED_HOSTS` for a host name (an IP address works
as is).

## Plain `docker run`

```bash
docker run -d --name inboxrake \
  -e IMAP_HOST=imap.mail.me.com -e IMAP_PORT=993 -e IMAP_CAFILE= \
  -e IMAP_USER=you@icloud.com -e IMAP_PASSWORD=app-password \
  -e INBOXRAKE_SECRET_KEY=$(openssl rand -base64 32) \
  -v inboxrake_data:/data \
  -p 127.0.0.1:8765:8765 \
  ghcr.io/mclgoerg/inboxrake:latest
```

(Note: generating the key inline like this means it only lives in the
container config - put it in an env file you keep out of backups if you
ever plan to recreate the container.)

## Data folder ownership

The image runs as user ID 1000. A named volume (`inboxrake_data`) just
works; a **host folder** mounted at `/data` that you created yourself is
usually owned by root, and Inboxrake then logs `Cannot write to /data` and
the UI says it cannot write to its data folder. Fix it once on the host
and restart:

```bash
chown -R 1000:1000 /path/to/the/folder      # or: docker run --user <uid>:<gid> ...
```

## Synology (Container Manager, DSM 7.2+)

1. Container Manager -> **Project** -> Create.
2. Name it `inboxrake`, pick a folder (e.g. `/docker/inboxrake`), choose
   "Create docker-compose.yml" and paste the contents of
   [`deploy/docker-compose.yml`](../deploy/docker-compose.yml).
3. Put your variables in the project's `.env` (copy from
   [`deploy/.env.example`](../deploy/.env.example)).
4. Build & run, then open `http://<nas-ip>:8765` (an IP address works
   as is; for a host name see "Login" above). The kit listens on
   localhost only: to reach it from your LAN set `INBOXRAKE_BIND=0.0.0.0`
   in the project's `.env` - and set a login first (see
   [Docker Compose](#docker-compose-recommended)).

If you use a folder under `/volume1/docker/` instead of a named volume
for `/data`, give it to user ID 1000 first (SSH: `sudo chown -R 1000:1000
<folder>`) - see [Data folder ownership](#data-folder-ownership).

On older DSM (Docker package): download the image
`ghcr.io/mclgoerg/inboxrake` in Registry, then create a container with
port `8765` and a volume mounted at `/data`; add the env vars in the
Advanced Settings -> Environment tab.

## Unraid

No Community Applications template yet - add it manually:

1. Docker tab -> **Add Container**.
2. Repository: `ghcr.io/mclgoerg/inboxrake:latest`.
3. Add a Port: container `8765` -> host port of your choice.
4. Add a Path: container `/data` -> host `/mnt/user/appdata/inboxrake`.
5. Add Variables for your IMAP provider (`IMAP_HOST`, `IMAP_PORT`,
   `IMAP_USER`, `IMAP_PASSWORD`, `IMAP_CAFILE=` empty for normal
   providers) plus `INBOXRAKE_SECRET_KEY`.
6. Make the appdata folder writable for the container (user ID 1000):
   `chown -R 1000:1000 /mnt/user/appdata/inboxrake` in the Unraid
   terminal.
7. Apply, then open `http://<unraid-ip>:<port>` (a host name needs the
   "Login" note above).

## TrueNAS SCALE (24.10+)

Apps -> Discover Apps -> ⋮ -> **Install via YAML** (or "Custom App"):

- Image repository `ghcr.io/mclgoerg/inboxrake`, tag `latest`.
- Port forwarding: container port `8765`.
- Storage: host path or ixVolume mounted at `/data`. For a host path,
  set the dataset's ACL/owner so user ID 1000 can write
  ([Data folder ownership](#data-folder-ownership)); an ixVolume needs
  nothing.
- Environment variables as in [`deploy/.env.example`](../deploy/.env.example).

## Portainer

Stacks -> **Add stack** -> paste
[`deploy/docker-compose.yml`](../deploy/docker-compose.yml), fill the
environment variables in the "Environment variables" section (same
names as `.env.example`), deploy. The kit listens on localhost only; to
reach it from your LAN set `INBOXRAKE_BIND=0.0.0.0` there too, after
setting a login (see [Docker Compose](#docker-compose-recommended)).

## Raspberry Pi / ARM servers

Nothing special to do - the image is multi-arch (amd64 + arm64). A
64-bit OS is required (Raspberry Pi OS 64-bit, Pi 4/5).

## Gmail app password

The simple path, and the default for a new Gmail account. In Inboxrake,
choose the **Gmail** preset, leave the sign-in method on **App
password**, enter your address as the user and the app password below.

1. Create it at <https://myaccount.google.com/apppasswords>. Google
   only offers app passwords on accounts with 2-Step Verification
   turned on; the option is missing if 2-Step Verification is set up
   only for security keys, if the account has Advanced Protection, or
   for work/school accounts where the administrator blocks it (see
   Google's help page "Sign in with app passwords").
2. Google shows it as four groups of four letters. Paste it as shown -
   Inboxrake removes the spaces.
3. Changing your Google Account password revokes your app passwords;
   create a new one then.

If an app password is not available to you, use OAuth instead (below).
Switching between the two in Settings keeps both credentials.

## Gmail OAuth setup

The alternative sign-in method for Gmail (choose **OAuth** next to
*Sign-in method*). Google requires every OAuth client to be registered
by whoever uses it - there is no shared "Sign in with Google" option,
because the restricted mail scope needs per-app Google verification.

1. Go to [Google Cloud console](https://console.cloud.google.com/) and
   create a project (or reuse one).
2. **APIs & Services -> OAuth consent screen**: User type "External",
   fill the required fields, add your own Google account under
   "Test users" (this keeps the client in "testing" mode - no Google
   review needed, but refresh tokens then expire after 7 days; request
   verification later if you need them to last).
3. **APIs & Services -> Credentials -> Create credentials -> OAuth
   client ID**, application type "Web application". Add this authorized
   redirect URI (replace with your instance's URL):
   `https://your-inboxrake-domain/api/oauth/imap/callback`
4. In Inboxrake, add or edit an account, select the **Gmail** preset,
   paste the client ID and client secret under "Connect via OAuth",
   then click **Connect** and sign in with the Google account you added
   as a test user.

## Microsoft OAuth setup

Inboxrake connects to Outlook/Microsoft 365 via OAuth only (Microsoft
has no app-password option for IMAP). Select the **Outlook / Microsoft
365** preset for the account, then:

Inboxrake does not ship a Microsoft app: you need your own (free) app
registration in Microsoft Entra ID.

- Register an app in [Entra ID](https://entra.microsoft.com/) (App
  registrations -> New registration; for personal Outlook.com/Hotmail
  accounts choose a supported account type that includes personal
  Microsoft accounts). Under Authentication add a platform **Mobile and
  desktop applications** with the redirect URI
  `https://your-inboxrake-domain/api/oauth/imap/callback` (for local use
  `http://localhost:8765/api/oauth/imap/callback`; Microsoft accepts
  `http` only for localhost) and set "Allow public client flows" to Yes.
  Do not use the Web platform (it needs a client secret) or the
  single-page-application platform. Then paste the Application (client)
  ID under "Connect your Outlook account via OAuth" and click
  **Connect account**.
  The redirect URI must match exactly what Inboxrake sends: its address
  as your browser sees it (the `X-Forwarded-Proto` / `X-Forwarded-Host`
  headers behind a reverse proxy), or the "Redirect base URL" under
  Settings -> Server -> Login if you set one. Inboxrake does not display
  it, and a mismatch makes Microsoft refuse with AADSTS50011.
- If an administrator runs the server with their own registration
  (`INBOXRAKE_MS_CLIENT_ID`), no registration or redirect URI is needed
  on your side: click **Connect with a device code**, then enter the shown code at
  microsoft.com/devicelogin.

## After the first start

1. Open the web UI. On a fresh install the setup wizard walks you
   through provider, sign-in (with a connection test), folders, an
   optional login password and the first scan. (Settings -> Mail account
   has the same presets: Gmail, iCloud, Fastmail, GMX, mailbox.org,
   Yahoo, Outlook.)
2. Hit **Scan** (the wizard starts the first one).
3. Optional: Settings -> AI for AI-assisted cleanup verdicts, Settings
   -> Server -> Login to protect the UI, Settings -> General for protected
   senders.
