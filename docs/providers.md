---
title: "Providers & OAuth"
description: "Mail provider presets, app passwords, Gmail and Microsoft OAuth, Proton Mail via Bridge."
---

# Providers & OAuth

Inboxrake speaks plain IMAP. Special folders are found through
SPECIAL-USE (RFC 6154) with a name fallback, Gmail's "All Mail" is excluded
from scans, and servers without `MOVE` get a COPY+EXPUNGE fallback. A
**preset** in the account settings only prefills host, port and security;
everything stays editable, and you add user and password.

| Preset | IMAP host | SMTP host (unsubscribe) | Sign-in |
|---|---|---|---|
| **Proton Mail Bridge** | `127.0.0.1:1143` SSL | `127.0.0.1:1025` | Bridge-generated password; the exported Bridge certificate as CA file (`/certs/bridge-cert.pem`). |
| **Gmail** | `imap.gmail.com:993` SSL | `smtp.gmail.com:465` SSL | App password or OAuth. |
| **Outlook / Microsoft 365** | `outlook.office365.com:993` SSL | `smtp.office365.com:587` STARTTLS | OAuth only. |
| **iCloud Mail** | `imap.mail.me.com:993` SSL | `smtp.mail.me.com:587` STARTTLS | App-specific password. |
| **Fastmail** | `imap.fastmail.com:993` SSL | `smtp.fastmail.com:465` SSL | App password with IMAP scope. |
| **GMX** | `imap.gmx.net:993` SSL | `mail.gmx.net:465` SSL | Enable IMAP in GMX first; app password if 2FA is on. |
| **mailbox.org** | `imap.mailbox.org:993` SSL | `smtp.mailbox.org:465` SSL | Normal or app password. |
| **Yahoo Mail** | `imap.mail.yahoo.com:993` SSL | `smtp.mail.yahoo.com:465` SSL | App password. |
| **Custom** | anything | anything | Any IMAP server with SSL or STARTTLS (Dovecot, Courier, ...). |

SMTP is only used to send unsubscribe mails.

## Gmail: app password or OAuth

The **app password** is the simple path: it needs 2-Step Verification on
the Google account, and you paste it as Google shows it (spaces are
removed). See [Gmail app password](install.md#gmail-app-password).

**OAuth** is the alternative when app passwords are not available to you.
Google requires every OAuth client to be registered by whoever uses it, so
you create your own client in the Google Cloud console. In Google's
"testing" mode refresh tokens expire after 7 days. Steps:
[Gmail OAuth setup](install.md#gmail-oauth-setup). Switching between the
two in Settings keeps both credentials.

## Outlook / Microsoft 365: OAuth only

Microsoft offers no app-password IMAP, so Outlook accounts sign in with
OAuth. With `INBOXRAKE_MS_CLIENT_ID` set on the server the account connects
with a **device code** and needs no registration; without it you register
your own public client in Entra ID and use the same bring-your-own flow as
Gmail. For work or school tenants set `INBOXRAKE_MS_TENANT`. Steps:
[Microsoft OAuth setup](install.md#microsoft-oauth-setup).

## Proton Mail via Bridge

Proton has no IMAP endpoint of its own; Inboxrake talks to the
[Proton Mail Bridge](https://proton.me/mail/bridge), which needs a paid
Proton plan and runs as a second container sharing the network namespace.
Use `deploy/docker-compose.proton.yml` and see [Install](install.md) for
the Bridge image caveats. Proton's labels (`Starred`, `Labels/*`) are
excluded from scans because their mails also live in a real folder. The
Sieve export is Proton-only and hidden for other presets.

## Any other IMAP server

Choose **Custom**, enter host, port and `ssl` or `starttls`, and leave the
CA file empty unless the server uses a self-signed certificate.

## What is tested

According to the project README, Proton Mail (Bridge), iCloud, Gmail and
GMX were verified on real mailboxes. The other presets use the same IMAP
code and are covered by the fake-server test suite; Outlook / Microsoft 365
is experimental (fake-tested only).
