---
title: "Inboxrake documentation"
description: "Self-hosted mailbox cleanup: see which senders fill your mailbox, then trash, block or unsubscribe in bulk."
---

# Inboxrake

Inboxrake is a self-hosted web app for a mailbox that has piled up. It
scans your mailbox read-only over IMAP, groups the mail by sender, subject,
thread or company, and shows how many mails each group has, how much space
it takes and how much of it you actually read. You then decide in bulk:
move to Trash, block, unsubscribe, or keep.

It runs as a single container and talks plain IMAP, so it works with Gmail,
Outlook, iCloud, Fastmail, GMX, mailbox.org, Yahoo, Proton Mail (through the
Bridge) and any other IMAP server.

## Start here

- **[Install](install.md)** - the starter compose file, plain `docker run`,
  NAS recipes.
- **[Configuration](configuration.md)** - every environment variable the
  container reads.
- **[Providers & OAuth](providers.md)** - presets, app passwords, Gmail and
  Microsoft OAuth, Proton Bridge.
- **[Filter syntax](filters.md)** - the query language behind the filter box
  and saved rules.
- **[Features](features.md)** - everything Inboxrake can do.
- **[Security & privacy](security.md)** - login, multi-user, secrets, what
  leaves your machine.
- **[FAQ](faq.md)**

## The safety promises

- Nothing is deleted without asking: moving to Trash always shows the exact
  count first, and can be undone.
- Scans are read-only.
- The optional AI review only ever receives mail metadata, never bodies or
  attachments.

Source code and issues:
[github.com/mclgoerg/inboxrake](https://github.com/mclgoerg/inboxrake).
