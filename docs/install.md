# Installing Mailbroom

Mailbroom is a single container. Whatever platform you use, it boils
down to the same four things:

| What | Value |
|---|---|
| Image | `ghcr.io/mclgoerg/mailbroom:latest` (or pin `:1.0`) |
| Port | `8765` (HTTP web UI + API) |
| Volume | `/data` - all settings, scan caches and stats live here |
| Env vars | all optional bootstrap - see [`deploy/.env.example`](../deploy/.env.example) |

Everything set via env can also be configured later in the settings UI
(env is only the first-start bootstrap). Two things to decide up front:

- **Login:** out of the box there is NO authentication. Either keep the
  port on localhost behind a reverse proxy with auth, or enable the
  built-in password/SSO login (Settings -> Login, or `AUTH_MODE` env).
  Never publish port 8765 straight to the internet without one of these.
- **Secrets encryption:** set `MAILBROOM_SECRET_KEY` (generate with
  `openssl rand -base64 32`) so IMAP passwords and API keys are
  encrypted inside `/data` - protects volume backups.

**Proton Mail users:** Mailbroom talks to Proton through the
[Proton Mail Bridge](https://proton.me/mail/bridge), which runs as a
second container sharing the network namespace. Use
[`deploy/docker-compose.proton.yml`](../deploy/docker-compose.proton.yml)
(setup steps in the file header) - the platform recipes below cover the
generic IMAP case (Gmail, iCloud, Fastmail, ...).

## Docker Compose (recommended)

```bash
git clone https://github.com/mclgoerg/mailbroom
cd mailbroom/deploy
cp .env.example .env        # optional edits - account setup is in the UI
docker compose up -d
```

Open http://localhost:8765. Update later with
`docker compose pull && docker compose up -d`.

## Plain `docker run`

```bash
docker run -d --name mailbroom \
  -e IMAP_HOST=imap.mail.me.com -e IMAP_PORT=993 -e IMAP_CAFILE= \
  -e IMAP_USER=you@icloud.com -e IMAP_PASSWORD=app-password \
  -e MAILBROOM_SECRET_KEY=$(openssl rand -base64 32) \
  -v mailbroom_data:/data \
  -p 127.0.0.1:8765:8765 \
  ghcr.io/mclgoerg/mailbroom:latest
```

(Note: generating the key inline like this means it only lives in the
container config - put it in an env file you keep out of backups if you
ever plan to recreate the container.)

## Synology (Container Manager, DSM 7.2+)

1. Container Manager -> **Project** -> Create.
2. Name it `mailbroom`, pick a folder (e.g. `/docker/mailbroom`), choose
   "Create docker-compose.yml" and paste the contents of
   [`deploy/docker-compose.yml`](../deploy/docker-compose.yml).
3. Put your variables in the project's `.env` (copy from
   [`deploy/.env.example`](../deploy/.env.example)).
4. Build & run, then open `http://<nas-ip>:8765`.

On older DSM (Docker package): download the image
`ghcr.io/mclgoerg/mailbroom` in Registry, then create a container with
port `8765` and a volume mounted at `/data`; add the env vars in the
Advanced Settings -> Environment tab.

## Unraid

No Community Applications template yet - add it manually:

1. Docker tab -> **Add Container**.
2. Repository: `ghcr.io/mclgoerg/mailbroom:latest`.
3. Add a Port: container `8765` -> host port of your choice.
4. Add a Path: container `/data` -> host `/mnt/user/appdata/mailbroom`.
5. Add Variables for your IMAP provider (`IMAP_HOST`, `IMAP_PORT`,
   `IMAP_USER`, `IMAP_PASSWORD`, `IMAP_CAFILE=` empty for normal
   providers) plus `MAILBROOM_SECRET_KEY`.
6. Apply, then open `http://<unraid-ip>:<port>`.

## TrueNAS SCALE (24.10+)

Apps -> Discover Apps -> ⋮ -> **Install via YAML** (or "Custom App"):

- Image repository `ghcr.io/mclgoerg/mailbroom`, tag `latest`.
- Port forwarding: container port `8765`.
- Storage: host path or ixVolume mounted at `/data`.
- Environment variables as in [`deploy/.env.example`](../deploy/.env.example).

## Portainer

Stacks -> **Add stack** -> paste
[`deploy/docker-compose.yml`](../deploy/docker-compose.yml), fill the
environment variables in the "Environment variables" section (same
names as `.env.example`), deploy.

## Raspberry Pi / ARM servers

Nothing special to do - the image is multi-arch (amd64 + arm64). A
64-bit OS is required (Raspberry Pi OS 64-bit, Pi 4/5).

## Gmail OAuth setup

Mailbroom connects to Gmail via OAuth only (no app-password option in
the settings UI). Google requires every OAuth client to be registered
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
   `https://your-mailbroom-domain/api/oauth/imap/callback`
4. In Mailbroom, add or edit an account, select the **Gmail** preset,
   paste the client ID and client secret under "Connect via OAuth",
   then click **Connect** and sign in with the Google account you added
   as a test user.

## Microsoft OAuth setup

Mailbroom connects to Outlook/Microsoft 365 via OAuth only (Microsoft
has no app-password option for IMAP). Select the **Outlook / Microsoft
365** preset for the account, then:

- If the maintainer's shared app is configured
  (`MAILBROOM_MS_CLIENT_ID` set on the server), no registration is
  needed - click **Connect with a device code**, then enter the shown
  code at microsoft.com/devicelogin.
- Otherwise, register your own public client in
  [Entra ID](https://entra.microsoft.com/) (App registrations -> New
  registration, no redirect URI needed, enable "Allow public client
  flows" under Authentication), paste its client ID under "Connect via
  OAuth", then click **Connect**.

## After the first start

1. Open the web UI -> the onboarding asks for IMAP credentials if env
   didn't provide them (Settings -> Mail account has presets for
   Gmail/iCloud/Fastmail/GMX/mailbox.org/Yahoo).
2. Hit **Scan**.
3. Optional: Settings -> AI for AI-assisted cleanup verdicts, Settings
   -> Login to protect the UI, Settings -> General for protected
   senders.
