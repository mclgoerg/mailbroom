---
title: "FAQ"
description: "Short answers on safety, privacy, exposure, footprint and backups."
---

# FAQ

## Does it delete anything without asking?

No. Trashing is an IMAP move to the Trash folder, always behind a
confirmation that names how many mails are affected, with an Undo.
UIDVALIDITY is checked before every move, and scans are read-only.
Permanent deletion exists only as explicit actions in Trash and Junk
(manual, or an opt-in purge rule that starts in report mode); they show
exact counts first. Protected senders and pinned mails are skipped by bulk
actions, rules and the Folders-panel purges, but **Empty Trash empties
everything in Trash**, protected or not. Rules also start in report mode.

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
export (sign-in tokens are left out). Stop the container and delete the
volume to remove it. Your mailbox is never modified by installing or
removing Inboxrake.

## Is it safe to expose?

There is no login by default - keep the port on localhost or behind an
authenticating proxy, or enable the built-in password or SSO login. Without
a login it also answers only to `localhost` and IP addresses; for a host
name set `INBOXRAKE_ALLOWED_HOSTS`. Details in [Security & privacy](security.md).

## "Cannot write to /data"

The image runs as user ID 1000. A host folder you created yourself is
usually owned by root; give it to 1000 (`chown -R 1000:1000 <folder>`) and
restart. See [Install](install.md#data-folder-ownership).

## Where do I report a vulnerability?

Not in a public issue - see [SECURITY.md](../SECURITY.md).
