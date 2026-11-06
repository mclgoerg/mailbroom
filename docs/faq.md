---
title: "FAQ"
description: "Short answers on safety, privacy, exposure, footprint and backups."
---

# FAQ

## Does it delete anything without asking?

No. Trashing is an IMAP move to the Trash folder, always behind a
confirmation, with an Undo. The confirmation gives the number of mails;
the one exception is explicitly trashing a single protected group, which
asks "anyway?" with a warning naming the group instead of a count.
UIDVALIDITY is checked before every move, and scans are read-only.
Permanent deletion exists only as explicit actions in Trash and Junk: the
manual ones confirm with exact counts, and an opt-in purge rule only acts
after you have reviewed a report run (then it runs on its schedule within
its age limit and per-run cap). Rules and the Folders-panel purges always
skip protected senders and pinned mails. Moving a protected group, or a
single pinned mail, to Trash asks for an extra confirmation; individually
selected mails from a protected sender are not checked. **Empty Trash
empties everything in Trash**, protected or not. Rules also start in report
mode.

## What leaves my machine?

Nothing, unless you turn on AI review - and then only metadata, never mail
bodies or attachments (see [what exactly](security.md#what-the-optional-ai-review-sends)).
Pick a cloud provider or a local model (Ollama, LM Studio, vLLM) and nothing
leaves your network at all. The AI is optional and you can set a monthly
budget in Settings -> AI. The UI loads no external assets.

## Why not just use filters or Sieve?

Filters work forward in time. Inboxrake shows what already piled up - which
senders, how many mails, how much space, how much you actually read - so
you decide in bulk, and can then block a sender, unsubscribe or export a
Sieve rule so it stays gone.

## How heavy is it?

One container, about 80 MB to download and roughly 55 MB of RAM while idle
(measured by the maintainer on amd64 with the demo; scanning a large mailbox
uses more while it runs). Images are published for amd64 and arm64, for
example Raspberry Pi 4/5.

## Backup and uninstall?

Everything lives in the `/data` volume; Settings -> General has a backup
export, which leaves out all passwords, tokens and API keys (the mail
password, OAuth tokens and client secrets, AI keys) - after a restore you
re-enter them. Stop the container and delete the
volume to remove it. Your mailbox is never modified by installing or
removing Inboxrake.

## Is it safe to expose?

There is no login by default - keep the port on localhost or behind an
authenticating proxy, or enable the built-in password or SSO login. Without
a login it also answers only to `localhost` and IP addresses; for a host
name set `INBOXRAKE_ALLOWED_HOSTS`. Details in [Security & privacy](security.md).

## Why does it need my IMAP password?

Inboxrake reads and moves mail over IMAP, and IMAP has no way to do that
without a credential. Use an app password where your provider offers one
(Gmail, iCloud, Fastmail, Yahoo ...): it is limited to mail access and you
can revoke it in your account at any time, which cuts Inboxrake off
instantly. Providers that only allow OAuth (Outlook) use a token instead.
The credential is stored in `/data`, encrypted with your
`INBOXRAKE_SECRET_KEY` (set one - without it, it is plaintext), and is only
ever sent to your own mail server.

## How is it different from other tools?

- **Server-side filters / Sieve** act on new mail as it arrives. Inboxrake
  looks at what has already piled up and lets you decide in bulk (and can
  export a Sieve rule afterwards, see above).
- **Mail-client search and rules** work on a mail or a search result at a
  time; they do not group a whole mailbox by sender with counts, sizes and
  how much you actually read.
- **Scriptable IMAP tools** (imapfilter and the like) are powerful if you
  want to write and maintain scripts; Inboxrake is a point-and-click web UI
  with confirmation and Undo instead.
- **Hosted cleanup services** run on someone else's servers and read your
  mailbox there. Inboxrake runs on yours; mail only travels between your
  server and your mail server (plus metadata to an AI provider if you turn
  that on).

## What is the project's status?

One maintainer, MIT-licensed. Releases are cut with release-please from
the commit history, see the [changelog](../CHANGELOG.md). Security reports
go through [SECURITY.md](../SECURITY.md); nothing is promised beyond what
is written there.

## Is there an API?

No public one. The web UI talks to JSON endpoints under `/api/`, but they
are internal and may change in any release.

## How far back does Undo go?

Each account keeps its last 10 undoable actions. An undo finds the mails
again in the folder they were moved to (matched by Message-ID), so it only
works while they are still in Trash - once they are emptied from Trash
(by you, a purge rule or your mail server) they cannot be brought back.

## "Cannot write to /data"

The image runs as user ID 1000. A host folder you created yourself is
usually owned by root; give it to 1000 (`chown -R 1000:1000 <folder>`) and
restart. See [Install](install.md#data-folder-ownership).

## Where do I report a vulnerability?

Not in a public issue - see [SECURITY.md](../SECURITY.md).
