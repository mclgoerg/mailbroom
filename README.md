# Inboxrake

[![CI](https://github.com/mclgoerg/inboxrake/actions/workflows/ci.yml/badge.svg)](https://github.com/mclgoerg/inboxrake/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/mclgoerg/inboxrake)](https://github.com/mclgoerg/inboxrake/releases)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/mclgoerg/inboxrake/badge)](https://scorecard.dev/viewer/?uri=github.com/mclgoerg/inboxrake)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/14997/badge)](https://www.bestpractices.dev/projects/14997)
[![License: MIT](https://img.shields.io/github/license/mclgoerg/inboxrake)](LICENSE)

Inboxrake is a self-hosted web app that rakes an IMAP mailbox into tidy
piles: it scans everything, groups mails by sender, subject or thread with
counts and sizes, and lets you trash, unsubscribe from or block whole
groups at once. Optional AI review (Anthropic, OpenAI, Claude on Microsoft
Foundry, or local models via Ollama, LM Studio or vLLM) suggests what is
safe to delete. *(Formerly Mailbroom.)*

**Nothing is deleted without asking, and everything is undoable** - moves
go to Trash with an Undo - **except** the explicit "delete permanently"
actions in Trash and Junk, which confirm with exact counts first.

![The group list (dark theme): senders with mail counts, sizes, AI verdicts and quick filters](docs/screenshots/groups-dark.png)

## Quick start

Needs Docker and an IMAP mailbox (Gmail, iCloud, Fastmail, Proton via
Bridge, ... - see [providers](#supported-providers)).

**Docker Compose** (the starter kit lives in [`deploy/`](deploy/)):

```bash
git clone https://github.com/mclgoerg/inboxrake
cd inboxrake/deploy
cp .env.example .env        # optional edits - account setup happens in the UI
docker compose up -d
```

Open <http://localhost:8765>; on a fresh install a setup wizard walks you
through provider, sign-in, folders, an optional login password and the first
scan. For Proton Mail use `docker-compose.proton.yml` instead (it needs a
Bridge image you provide - see its header).

**Plain `docker run`** with the published image:

```bash
docker run -d --name inboxrake \
  -v inboxrake_data:/data \
  -p 127.0.0.1:8765:8765 \
  ghcr.io/mclgoerg/inboxrake:latest
```

Pin a minor tag such as `:1.10` if you do not want surprise upgrades.
Guides for Synology, Unraid, TrueNAS, Portainer and Raspberry Pi, the
host-folder ownership note (the image runs as user ID 1000) and every
environment variable are in **[docs/install.md](docs/install.md)**.

## Try the demo

A playground on fake mailboxes - no account, no network:

```bash
git clone https://github.com/mclgoerg/inboxrake && cd inboxrake
docker run --rm -p 127.0.0.1:8765:8765 -v "$PWD":/repo \
  ghcr.io/mclgoerg/inboxrake:latest python /repo/scripts/demo.py
```

Add `--empty` to see the first-run wizard instead (any host works, the
password "demo" signs in).

**In action** - click a filter together, select the matches, confirm the
move to Trash (with the count spelled out), undo from the result toast, open
a group beside the list:

![Build a filter, select, move to Trash with confirmation and Undo, open a group in the split pane](docs/screenshots/demo.gif)

<details>
<summary>More screenshots - split pane, drill-down, statistics, phone, light theme</summary>

![A group open in the side pane next to the group list](docs/screenshots/split-pane.png)
![Group drill-down as a dialog on a mid-size screen, with the Block sender and Trash all actions](docs/screenshots/detail.png)
![Statistics panel: totals, mails per month and year, categories](docs/screenshots/stats.png)
![Phone layout: group list, a group's mails, and the bottom-sheet confirmation before moving to Trash](docs/screenshots/mobile.png)
![The group list in the light theme](docs/screenshots/groups-light.png)

</details>

All screenshots show generated demo data (`scripts/demo.py`).

## Safety & privacy FAQ

**Does it delete anything without asking?** No. Trashing is an IMAP move to
the Trash folder, always behind a confirmation that names how many mails
are affected, with an Undo. UIDVALIDITY is checked before every move and
scans are read-only. Permanent deletion exists only as explicit actions in
Trash and Junk (manual, or an opt-in purge rule that starts in report
mode); they show exact counts first, and protected senders and mails are
never touched. Rules also start in report mode.

**What leaves my machine?** Nothing, unless you turn on AI review - and then
only metadata (addresses, counts, subject lines), never mail bodies or
attachments. Pick a cloud provider or a local model (Ollama, LM Studio, vLLM)
and nothing leaves your network at all. The AI is optional and has a
monthly budget cap. The UI loads no external assets.

**Why not just use filters or Sieve?** Filters work forward in time. Inboxrake
shows what already piled up - which senders, how many mails, how much space,
how much you actually read - so you decide in bulk, and can then block a
sender, unsubscribe or export a Sieve rule so it stays gone.

**How heavy is it?** One container: about 80 MB to download and roughly
55 MB of RAM while idle (measured on amd64 with the demo; a scan of a large
mailbox uses more while it runs). It runs on a Raspberry Pi 4/5.

**Backup and uninstall?** Everything lives in the `/data` volume; Settings
-> General has a backup export (sign-in tokens are left out). Stop the
container and delete the volume to remove it. Your mailbox is never
modified by installing or removing Inboxrake.

**Is it safe to expose?** There is no login by default - keep the port on
localhost or behind an authenticating proxy, or enable the built-in password
or SSO login. Without a login it also answers only to `localhost` and IP
addresses; for a host name set `INBOXRAKE_ALLOWED_HOSTS`. Details in
[docs/security.md](docs/security.md).

## Supported providers

Plain IMAP: special folders are found via SPECIAL-USE (RFC 6154) with a name
fallback, Gmail's "All Mail" is excluded, and servers without `MOVE` get a
COPY+EXPUNGE fallback. Each preset in Settings prefills host, port and
security; you add user and password.

| Preset | IMAP host | SMTP host (unsubscribe) | Auth notes |
|---|---|---|---|
| **Proton Mail Bridge** | `127.0.0.1:1143` SSL | `127.0.0.1:1025` | Featured setup, see below. Paid Proton plan; use the Bridge-generated password and the exported Bridge certificate as CA file. |
| **Gmail** | `imap.gmail.com:993` SSL | `smtp.gmail.com:465` SSL | App password (2-Step Verification on) or OAuth - choose in Settings; see below. |
| **Outlook / Microsoft 365** | `outlook.office365.com:993` SSL | `smtp.office365.com:587` STARTTLS | OAuth only (Microsoft offers no app-password IMAP) - see below. |
| **iCloud Mail** | `imap.mail.me.com:993` SSL | `smtp.mail.me.com:587` STARTTLS | [App-specific password](https://account.apple.com/account/manage) required. |
| **Fastmail** | `imap.fastmail.com:993` SSL | `smtp.fastmail.com:465` SSL | [App password](https://www.fastmail.help/hc/en-us/articles/360058752854) with IMAP scope. |
| **GMX** | `imap.gmx.net:993` SSL | `mail.gmx.net:465` SSL | Enable IMAP in GMX mail settings first; app password if 2FA is on. |
| **mailbox.org** | `imap.mailbox.org:993` SSL | `smtp.mailbox.org:465` SSL | Normal password (or an app password). |
| **Yahoo Mail** | `imap.mail.yahoo.com:993` SSL | `smtp.mail.yahoo.com:465` SSL | [App password](https://help.yahoo.com/kb/SLN15241.html) required. |
| **Custom** | anything | anything | Any IMAP server with SSL or STARTTLS (Dovecot, Courier, …). |

- **Verified on real mailboxes:** Proton Mail (Bridge), iCloud, Gmail
  (app password and OAuth) and GMX. The other presets use the same IMAP
  code and are covered by the fake-server tests; **Outlook / Microsoft 365
  is experimental** (fake-tested only, OAuth device-code flow).
- **Gmail OAuth** needs your own Google Cloud client. In Google's "testing"
  mode refresh tokens expire after 7 days - see
  [install.md](docs/install.md#gmail-oauth-setup); the app password avoids this.
- **Microsoft work/school tenants:** set `INBOXRAKE_MS_TENANT` (default
  `consumers`) - see [docs/security.md](docs/security.md#microsoft-tenant).
- The Sieve export is Proton-only and hidden for other presets.

## Features

Five views (Sender, Smart pools of small senders, Subject, Thread, a flat
list), a drill-down reader with no remote content, quick wins and a filter
builder, optional AI review and a "describe a filter" box, swipe triage,
rules and a scheduler, one-click and bulk unsubscribe with a watchdog,
protected senders and mails, a Trash/Junk browser, space map, statistics,
audit log, multiple strictly separate accounts, light/dark, phone layout,
English and German. Everything is listed in
**[docs/features.md](docs/features.md)**.

## Security & multi-user

- No login by default; password or any OpenID Connect provider (SSO) is
  built in, with a login throttle, sign-out of every browser when the login
  changes, and refusal of SSO identities with an unverified email.
- With SSO every identity gets its own isolated workspace; an empty
  allow-list admits any account at the provider.
- `INBOXRAKE_SECRET_KEY` encrypts stored secrets (IMAP passwords, API keys,
  tokens) so volume backups are useless without it.
- The container runs as a non-root user; CI runs CodeQL and a dependency
  review.

All of it is in [docs/security.md](docs/security.md); vulnerabilities go to
[SECURITY.md](SECURITY.md), not a public issue.

## Development

```bash
# backend
pip install -r backend/requirements-dev.txt
uvicorn backend.main:app --port 8765 --reload
# frontend (proxies /api to :8765)
cd frontend && npm install && npm run dev
# tests - no mail server or network needed (fake in-memory IMAP server)
python -m pytest tests/ -q
```

FastAPI backend, React + TypeScript + Tailwind frontend. Read
[CONTRIBUTING.md](CONTRIBUTING.md) first. English and German live in
`frontend/src/locales/`.

## AI disclosure

Inboxrake was built with AI assistance (Anthropic's Claude via Claude
Code), directed and reviewed by the maintainer. It was used on real
mailboxes at Proton, iCloud, Gmail and GMX; Outlook support has only been
tested against a fake server. Independent of how the code was written, the
safety properties are enforced by tests: deletions are reversible moves
(except the explicit, count-confirmed permanent-delete actions in Trash and
Junk and purge rules), UIDVALIDITY is checked before every action, and the
optional AI review only ever receives mail metadata - never message bodies.

## License

[MIT](LICENSE)
