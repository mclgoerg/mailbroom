# Proton Mail Cleaner

Declutter a Proton mailbox: scan everything over IMAP, group mails **by
sender, domain, or subject** with counts, sizes, and unread ratios, drill
into any group down to the full mail text, and move whole groups or single
mails to Trash — with optional AI assistance (Anthropic API or Microsoft
Foundry) that suggests what's safe to delete and tracks its own cost.

Built for [Proton Mail Bridge](https://proton.me/mail/bridge) (requires a
paid Proton plan), but it speaks plain IMAP, so other providers work too.

## Features

- **Three group views** — by sender, by domain (catches `noreply@`,
  `news@`, … of the same company), by normalized subject (merges
  `Order 123` / `Order 456`, strips Re:/Fwd:).
- **Cleanup signals** — mail count, total size (find attachment hogs),
  unread percentage, first→last date range, category tags (shipping,
  finance, shopping, social, travel, newsletters, automated…).
- **Drill-down** — every mail of a group with date/size/unread, full-text
  reader (HTML mails rendered as plain text — no remote content, no
  tracking pixels), per-mail selection and deletion.
- **AI review (optional)** — coarse verdicts per group
  (delete-safe/review/keep) and a fine-grained mode that rates every mail
  *inside* a group, with selection by rating. Verdicts are cached (by group
  key and Message-ID), so rescans and reopened groups cost nothing. Sends
  only metadata (addresses, counts, subject lines) — never mail bodies.
  Providers: Anthropic API, OpenAI, Claude on Microsoft Foundry, or any
  OpenAI-compatible local endpoint (Ollama, LM Studio, vLLM). Token usage
  and cost are tracked with a built-in price table.
- **Attachment explorer** — an on-demand BODYSTRUCTURE pass (structure
  only, no content downloaded) lists mails by attachment size with file
  names, adds a 📎 aggregate to groups, and enables the `att:>10m` filter.
  Proton IMAP can't strip single attachments, so cleanup means deleting
  the whole mail (reversible as always).
- **Statistics** — mails-per-year histogram, top domains by size, scan
  history and per-month cleanup tallies ("freed this month"), persisted
  across restarts.
- **Duplicate finder** — mails with the same Message-ID (e.g. copies
  across folders) or identical sender + subject + size, grouped into sets
  with one click to select everything but the newest copy.
- **Rules + scheduler** — save a filter query (same syntax as the filter
  box) plus an action as a rule, run it manually or daily/weekly. Rules
  always start in **report mode** (they only tell you what they would do);
  execute mode can be enabled after at least one report run. Every run is
  capped at 500 mails, skips protected senders, and uses the normal
  Trash/undo pipeline — the scheduler is a background loop inside the
  container, no cron needed.
- **"Never replied" signal** — each scan also reads the To/Cc headers of
  your Sent folder (headers only, cached across scans): groups you have
  written to get a ↩ replied tag, filter with `is:replied` /
  `is:noreply-ever`, and the AI leans towards keeping senders you actually
  correspond with.
- **Protected senders** — mark addresses or whole domains (🛡️ in the group
  row, or a list in settings) as never-bulk-delete: selection presets and
  bulk trash skip them (trashing one explicitly asks first), and the AI is
  told — and forced — to never rate their mails "safe to delete". Filter
  them with `is:protected`.
- **One-click unsubscribe** — RFC 8058 one-click POST or unsubscribe mail
  via Bridge SMTP, straight from a group's detail view.
- **Sieve export** — generate a Proton Sieve filter for a sender or
  domain (move to folder / delete on arrival / mark read) with a copy
  button, so future mail never clutters the mailbox again.
- **Undo** — restore the last deletions from Trash (matched by Message-ID).
- **Trash browser** — inspect the live Trash (also mail deleted outside
  the app), search it, and restore selected mails to any folder.
- **Bulk workflows** — background deletion queue with live progress and
  cancel, "select inactive since…" presets, global mail search, CSV export,
  Empty-Trash button, cancellable scans and AI runs.
- **Multi-account** — switchable connection profiles.
- **Safe by design** — deletions are IMAP `MOVE` to Trash (reversible),
  UIDVALIDITY checked before every move, read-only scans, UID bookkeeping
  stays server-side, non-root container.
- **Stack** — FastAPI backend (SSE live updates), React + TypeScript +
  Tailwind frontend, single container, no external assets at runtime.

## Running

```bash
docker build -t proton-mail-cleaner .
docker run -d --name mailcleaner \
  -e IMAP_HOST=127.0.0.1 -e IMAP_PORT=1143 \
  -e IMAP_USER=you@proton.me -e IMAP_PASSWORD=bridge-password \
  -e IMAP_CAFILE=/certs/bridge-cert.pem \
  -v mailcleaner_data:/data \
  -p 127.0.0.1:8765:8765 proton-mail-cleaner
```

With Proton Mail Bridge, run this container in the Bridge container's
network namespace (`--network container:protonbridge`) so `127.0.0.1`
matches the SAN of Bridge's self-signed TLS certificate, switch Bridge's
IMAP mode to SSL, export its certificate (`cert export` in the Bridge CLI)
and mount it read-only at `IMAP_CAFILE`.

All settings (IMAP credentials, folder exclusions, AI provider/model/key,
token prices) can also be edited in the UI; they persist in `/data`.

> **The app has no authentication.** Anyone who can reach the port can read
> your mail metadata and reconfigure the IMAP host / AI endpoint (i.e.
> exfiltrate the stored credentials). Never publish the port beyond
> localhost (`-p 127.0.0.1:8765:8765`, as above) and put it behind a
> reverse proxy with an auth middleware (Traefik + tinyauth/Authelia, …)
> for remote access. Remember that Docker published ports bypass ufw.

## Development

```bash
# backend
pip install -r backend/requirements-dev.txt
uvicorn backend.main:app --port 8765 --reload
# frontend (proxies /api to :8765)
cd frontend && npm install && npm run dev
# tests — no Bridge or network needed (fake in-memory IMAP server)
python -m pytest tests/ -q
```

## License

[MIT](LICENSE)
