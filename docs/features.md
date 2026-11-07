---
title: "Features"
---

# Features

Everything Inboxrake can do, in one list. The [README](../README.md) has
the short version; [install.md](install.md) covers running it and
[security.md](security.md) the login, multi-user and secrets options.

- **Views** - five of them: Sender, Smart (every big sender keeps
  its own row; the long tail of small senders is pooled by company - all
  `noreply@`, `news@`, … of one domain - and by what their mails are
  about: orders & deliveries, appointments & bookings, job applications,
  support & inquiries, accounts & security, newsletters, people you write
  to, …, so hundreds of rows become ~50. A company row says what its mails
  are about; open a pooled row to see its senders and act on just some of
  them. The per-account threshold is "Own row from N mails", default 10),
  Subject (normalized: merges
  `Order 123` / `Order 456`, strips Re:/Fwd:), Thread (whole
  conversations) and a flat "All mails" list. The All mails view is
  remembered; the grouping starts at Sender.
- **Cleanup signals** - mail count, total size (find attachment hogs),
  unread percentage, first->last date range (short dates, e.g. "7 Oct"), category tags
  (shipping, finance, shopping, social, travel, newsletters,
  automated…).
- **Swipe triage** - Tools -> Triage deals out the
  groups of the current list one card at a time: swipe left to Trash,
  right to Keep, up to Unsubscribe - or use the buttons or the arrow keys.
  Nothing happens while you decide; at the end one confirm names every
  decision, then protects, unsubscribes and trashes (with the usual Undo).
- **Drill-down** - every mail of a group with date/size/unread, full-text
  reader (HTML mails rendered as plain text - no remote content, no
  tracking pixels), per-mail selection and deletion ("Trash this mail",
  or "Trash all N" for the whole group). On screens 1280 px and wider the
  group opens in a **side pane** next to the list, so you can keep
  scanning the list while you read; below that it is a dialog.
- **AI review (optional)** - coarse verdicts per group
  (delete-safe/review/keep) and a fine-grained mode that rates every mail
  *inside* a group, with selection by rating. Verdicts are cached (by group
  key and Message-ID), so rescans and reopened groups cost nothing. Sends
  only metadata (addresses, counts, subject lines) - never mail bodies.
  Providers: Anthropic API, OpenAI, Claude on Microsoft Foundry, or any
  OpenAI-compatible local endpoint (Ollama, LM Studio, vLLM). Token usage
  and cost are tracked with a built-in price table.
- **AI sorting of Smart's "Other" row (optional)** - a button on that row
  asks your AI to pick one of the fixed kinds (orders, appointments,
  applications, support, accounts, newsletters, individuals, other) for the
  senders the rules could not place. It shows the scope and cost first,
  sends only the sender's name and address, mail count and up to three
  recent subject lines (plus your own instructions from Settings, which you
  can edit), places senders without moving or deleting any mail, caches each
  answer until that sender's mails change, and can be removed again.
- **Filing senders in Smart** - tick senders in a pooled row and choose
  "File in Smart as…" (a kind, or one of your own categories) to decide
  where a sender - or its whole company - belongs. It only places the
  sender: no mail is moved, it is remembered (per user, on your server
  only, never sent to an AI), undoable, and a sender's detail view shows
  how it is filed and why. After an AI sorting run you can keep its answers
  as your own rules too; clearer mail still wins over a kept answer.
  Settings > Filed senders lists everything Inboxrake knows this way -
  searchable and sortable, editable in place, with delete, "Remove unused",
  and download / upload of just this list.
- **Attachment explorer** - an on-demand BODYSTRUCTURE pass (structure
  only, no content downloaded) lists mails by attachment size with file
  names, adds a 📎 aggregate to groups, and enables the `att:>10m` filter.
  Proton IMAP can't strip single attachments, so cleanup means deleting
  the whole mail (reversible as always).
- **Statistics** (Tools -> Statistics) - mails-per-year histogram, top
  domains by size, scan history and per-month cleanup tallies ("moved to
  Trash" and, for permanent deletes only, "freed"), persisted across restarts.
- **Space map** (Tools -> Space map) - a treemap of the whole mailbox by
  size: tiles are domains, tap one to see its senders; tiny ones fold into
  an "Other" tile. Color by engagement, age of the last mail or AI
  verdict. "Select" ticks tiles (protected senders are skipped), and "Done"
  hands exactly those senders to the Sender list's normal selection for
  Trash / Archive with the usual confirmation - the map itself never moves
  mail.
- **Your year in mail** (Tools -> Your year in mail, or from Statistics) -
  a full-screen story of one calendar year: how many mails you received,
  your loudest senders, the month that buried you, your busiest weekday
  and hour, ghost senders (10+ mails, none ever opened), your biggest mail
  and what you cleaned up (moves, permanent deletes, unsubscribes, rule
  runs). Tap right/left or use the arrow keys, hold to pause. The last
  card saves a summary image, generated in your browser with sender names
  hidden unless you tick "Show names". Based on the mail in the mailbox
  now; metadata only, nothing is uploaded.
- **Duplicate finder** - three sections. **Identical copies**: mails with
  the same Message-ID and the same size (e.g. copies across folders),
  grouped into sets with one click to select everything but the newest
  copy - the only place that button and the "reclaimable" figure apply.
  **Same mail, different versions**: the same Message-ID but different
  sizes (a mailing-list copy next to a direct one, a copy whose attachments
  another client stripped), plus mails without a usable Message-ID (missing,
  or junk such as `<>`) that share sender + subject + size (and the
  identical id text, if there is one); the largest copy is tagged, nothing
  is selected for you. Two mails with their own, different Message-IDs (say,
  two monthly statements) are never treated as duplicates. **Possible
  duplicates** lists the same sender and subject sent within ten minutes of
  each other (different Message-IDs, so they may differ in content), never
  repeating a mail from the first two sections: nothing there is selected
  for you either, open the mails to compare and tick what to trash.
- **Rules + scheduler** - save a filter query (same syntax as the filter
  box) plus an action as a rule, run it manually or daily/weekly. Rules
  always start in **report mode** (they only tell you what they would do);
  execute mode can be enabled after at least one report run. Every run is
  capped at 500 mails, skips protected senders, and uses the normal
  Trash/undo pipeline - the scheduler is a background loop inside the
  container, no cron needed.
- **Retention actions** - restrict a bulk action or a rule to "keep the
  newest N mails" or "only mails older than N days" per group instead of
  the whole group - mutually exclusive, computed against the real mail
  list rather than just the group count.
- **Block a sender/domain in one click** - from a group's detail view,
  instantly creates a standing daily auto-trash rule for that sender or
  domain (optionally trashing what's already there too). Reversible any
  time by unblocking, which just deletes the rule; protected senders
  can't be blocked.
- **Saved filter presets** - save the current filter query under a name
  and recall it with one tap from an outlined chip next to the built-in
  quick-select ones; edit a saved preset's query later with the same
  filter builder, or delete it. Account-scoped like everything else.
- **New-sender review** - a sender new to the mailbox since your last few
  scans gets a 🆕 badge and shows up under a one-tap `is:new` chip, so it
  doesn't get lost among a thousand others - block, protect or
  unsubscribe right from there. Purely a read-only signal (first scan
  seeds silently, nothing is ever auto-actioned); the window it stays
  flagged for (default 7 days) is configurable in settings.
- **Unsubscribe watchdog** - a sender you unsubscribed from successfully
  that still delivers mail more than two days later is flagged "Still
  mailing" on its row, collected under a one-tap chip and the filter
  `is:still-mailing`, and can be blocked from its detail view. Based on
  when the mail arrived, not its Date header; the digest counts them.
- **Activity digest email** - an optional daily/weekly summary per
  account (actions taken, permanently deleted mails/bytes freed, rule previews still
  awaiting review, unsubscribe outcomes), sent as a branded HTML +
  plain-text mail at a time of day you pick; skipped entirely when
  nothing happened, with a "send test digest" button to preview it
  first and every send itself audit-logged.
- **"Never replied" signal** - each scan also reads the To/Cc headers of
  your Sent folder (headers only, cached across scans): groups you have
  written to get a ↩ replied tag, filter with `is:replied` /
  `is:noreply-ever`, and the AI leans towards keeping senders you actually
  correspond with.
- **Protected senders** - mark addresses or whole domains (a shield
  toggle in a group's detail view, or a list in settings) as
  never-bulk-delete: selection presets and bulk trash skip them
  (trashing one explicitly asks first), and the AI is told - and
  forced - to never rate their mails "safe to delete". Filter them with
  `is:protected`.
- **Protected mails** - the same safety net for a single mail: the pin
  toggle on a mail row in a group's detail view ("Protect this mail")
  makes it exempt from every bulk action - group actions (trash/archive/
  move), saved rules and retention actions (also in their report
  numbers), selection presets and AI picks (its AI rating is forced to
  "keep"). Marking read still works; acting on a protected mail yourself
  asks first. "Protect all mails in this group" (in the detail view's ... menu) pins everything currently in a group - later mail isn't covered, that's what the shield is for. It is remembered per account by Message-ID, so it survives
  rescans and folder moves. Filter groups with `has:pinned`. (This is a
  protection against accidental cleanup, not a PIN code or privacy lock.)
- **Engagement score** - every group gets a 0-100 score for how much you
  actually engage with it, computed locally from what a scan already
  knows: the share of its mails you read (the backbone), a strong boost if
  you have written to its senders, a damping factor for newsletters/bulk
  mail, and a fade for senders that have been silent for months. It shows
  as a small three-step meter on each row (tap or hover for the breakdown), sorts
  via "Sort: engagement", and filters with `eng:low` / `eng:medium` /
  `eng:high` (tiers <=33 / 34-66 / >=67) - usable in rules and saved
  presets, e.g. `eng:low age:>1y`. The score is never sent to the AI.
- **Tracker report** - Tools -> Trackers shows which senders put tracking
  pixels or click-tracking links in their mail: the share of checked mails
  that carry a pixel, the senders that track most and the hosts they use,
  plus a small eye badge on each row (tap for the breakdown) and the
  `has:tracker` filter. It is detected locally from the HTML of mails
  while the local body index is built (generic heuristics, no vendor
  lists - hosts are read from your own mail); nothing is loaded, sent or
  given to the AI, and only two flags plus plain tracker domains are kept
  per mail. Mails indexed before this existed show up under "Check older
  mails" (a rebuild of the index, with the usual confirm).
- **One-click unsubscribe** - RFC 8058 one-click POST or unsubscribe mail
  via Bridge SMTP, straight from a group's detail view - or in bulk:
  select any number of groups and unsubscribe from every one of their
  senders in the background, with live progress and cancel. Every
  outcome (done / needs a confirmation page / failed) is remembered per
  sender and survives rescans and restarts, shown as a badge on the
  group and filterable with `is:unsubscribed` / `is:not-unsubscribed`
  (and `is:still-mailing`, see the Unsubscribe watchdog).
  Protected senders are always skipped.
- **Sieve export** - generate a Proton Sieve filter for a sender or
  domain (move to folder / delete on arrival / mark read) with a copy
  button, so future mail never clutters the mailbox again.
- **Undo** - every move to Trash ends in a toast ("Moved 618 mails to
  Trash") with an **Undo** button; older deletions can be restored from
  the Undo list in the status line above the list (destination UID and
  UIDVALIDITY tracking). If a server cannot identify a moved copy safely,
  its Undo entry is kept for manual recovery from the destination.
- **Trash browser** - the Trash button in the header (shown while the
  Trash has mail; the count is as of the last scan) opens the real Trash
  (also mail deleted outside the app): search it, restore selected mails
  to any folder, or empty it. "Empty Trash…" is also in the profile menu
  while the Trash isn't empty, and always asks first, naming how many
  mails will be deleted permanently.
- **Delete permanently (Trash and Junk)** - in the Folders panel, select
  mails or a sender, delete everything received more than N days ago, or
  use "Empty Junk…". The count is read live from the server, the confirm
  shows it (plus the mails from protected senders and the protected mails
  that are skipped - they are never deleted; remove the protection first
  to delete them) and only exactly those mails are deleted, on the
  server, irreversibly. Junk mails go through Trash first. Refused while
  Trash/Junk is ambiguous and not confirmed in Settings. Nothing is ever
  deleted without your click and the confirm.
- **Purge rules (Trash and Junk)** - an opt-in kind of rule (Rules ->
  "Applies to": Junk or Trash) that deletes mail that has been in that folder for more
  than N days (default 30, weekly) **permanently, on the server**. The
  days count from when Inboxrake first saw the mail there (so a mail you
  trash by mistake today is safe for N days, whatever its date), and the
  mail must also have been received more than N days ago; after an upgrade
  or a folder reset the count starts again. Nothing creates one for you; a
  new one starts in report mode (counts and a sender-level preview, nothing
  is deleted), may only be switched to execute after a report run of its
  current definition behind a confirm, and goes back to report mode when
  its folder, filter or age is edited - or when its account is renamed,
  its server / login changes, or the Junk / Trash folder it resolves to
  changes (also a folder deleted and re-created). Deleting an account
  deletes its purge rules (its ordinary rules stay and stop running). Every run is
  capped per run (oldest first; the confirm names the cap), skips protected
  senders and protected mails with no override, and deletes through the
  same exact-UID path as the manual delete above (refused when the role is
  ambiguous, UIDVALIDITY changed or the server lacks UIDPLUS). An empty
  filter means all senders in that folder. Audited as `rule:<id>`, counted as permanent
  deletes in the digest and statistics.
- **Persistent audit log** - every mailbox action (trash/archive/move/
  mark-read, incl. rule-triggered ones, rule runs, unsubscribes, undo,
  empty-trash) is recorded with a timestamp, actor, outcome and bytes
  freed - browsable in-app and exportable as CSV.
- **Selection bar** - appears at the bottom only once something is
  selected, showing how many groups and mails you picked, with Clear
  selection, Export CSV, the retention limiter ("Limit to:"), an
  "Action…" picker (Archive/Move/Mark read/Unsubscribe/AI review) and the
  red **Trash N** button. Destructive actions ask first in an in-app
  confirmation that names what they affect (e.g. "618 mails from 6
  groups will be affected"), mentions skipped protected senders and
  mails, and focuses Cancel; on a phone it is a bottom sheet.
- **Quick chips** - one-tap chips under the filter box: AI-safe groups,
  **Inactive: 6 mo | 1 yr | 2 yr**, and Not yet unsubscribed (plus
  new senders when there are any). A chip narrows the list down to its
  own matches and, on the next tap, selects them; a third tap un-selects
  and clears. Chips never combine - use the filter box for that.
- **Quick wins** - after a scan, a strip above the Sender list suggests a
  few cleanups (old newsletters you never open, quiet low-engagement
  senders, mail from senders you already unsubscribed from, big old
  attachments, what the AI rated safe) with how much each frees. Review
  puts the card's filter in the box and selects its matches; Clean up goes
  straight to the usual Trash confirm (protected senders skipped, Undo
  afterwards); Not now hides a card until a later scan finds 25 % more.
- **Filter builder** - the sliders button next to the filter box opens a
  click-together builder (category, AI verdict, age, unread %,
  attachments, flags such as "not yet unsubscribed" or "rarely engaged
  with"); on phones it opens as a bottom sheet. It writes the same
  filter syntax you can type, and the result can be saved as a preset.
- **Describe a filter** - with an AI provider set up, the sparkles button
  next to the filter box turns a sentence ("shop newsletters I have not
  opened in a year") into a filter you can read and edit, with a live
  preview of how many groups, mails and how much space it matches. Apply it,
  save it as a preset, or start a rule from it (rules still begin in report
  mode). Only your sentence, the filter syntax and your tag names are sent
  to the provider - no mail data - and nothing is selected or changed.
- **Tools menu** - Rules, Attachments, Duplicates, Statistics, Space map,
  Your year in mail, Audit Log, AI review (once AI is set up) and Export CSV
  live under one Tools
  button. AI review and CSV export scope to the current selection once
  something is selected; the Tools versions (nothing selected) act on
  everything, as before.
- **Bulk workflows** - background deletion queue with live progress and
  cancel, global mail search (optionally inside the message text, a
  per-account setting: your mail server does that search per query and
  nothing is stored, or an opt-in local word index for instant searches -
  see below), Empty Trash (profile menu or Trash panel), cancellable scans
  and AI runs. Results and errors arrive as toasts instead of a status
  line you have to scroll back to.
- **Multiple accounts** - connect several providers at once (e.g. Proton
  Bridge + Gmail). Every account is strictly separate: its own scans,
  groups, rules, saved presets, digest settings, statistics, folder
  exclusions and replied/verdict/known-senders caches - nothing is ever
  mixed or aggregated. The profile menu (top right) switches the whole
  view between accounts; accounts can be added, renamed (all their data
  follows) and removed in settings, and each has its own folder-discovery picker.
- **Fast to open** - each account's last scan is cached on disk and shown
  instantly after a restart or account switch (with its age); a rescan
  refreshes it. Live updates stream only small status deltas - the full
  group list is re-fetched just when it actually changed.
- **Safe by design** - deletions are IMAP `MOVE` to Trash (reversible);
  the only irreversible actions are the explicit permanent-delete ones in
  Trash and Junk (manual, or an opt-in purge rule), which confirm with
  counts. UIDVALIDITY is checked before every move, scans are read-only,
  UID bookkeeping stays server-side, the container runs as a non-root
  user.
- **Keyboard shortcuts** - in the grouped views, `j`/`k` (or ↑/↓) move
  through the list, `Enter` or `o` opens the group, `x` selects it, `#` trashes the
  selection (or the focused group; it still asks first), `/` jumps to the
  filter box and `Esc` closes the side pane. In the All mails view only
  `/` and `Esc` apply.
- **Light and dark theme** - toggle in the profile menu; remembered per
  browser.
- **Phone layout** - the same app on a small screen: touch-sized
  controls, filters and confirmations as bottom sheets, a compact list.
- **Settings** - Mail account, General, AI, Filed senders and (for the
  admin) Server; **Backup & restore** (config and AI verdict export +
  import; all passwords, tokens and API keys are left out) is on the General tab.
- **Polish** - installable as a PWA (manifest + icon), optional desktop
  notifications when background jobs finish, monthly AI budget cap,
  a first-run setup wizard (provider -> sign in and test -> folders ->
  optional password -> first scan; also behind "Add account"), and error
  messages that are translated rather than raw server text.
- **Languages** - English and German. Translations live in
  `frontend/src/locales/`; to contribute one, copy `de.ts`, translate the
  values and register the locale in `frontend/src/i18n.ts`.
- **Stack** - FastAPI backend (SSE live updates), React + TypeScript +
  Tailwind frontend, single container, no external assets at runtime.

## Local mail-text search index (opt-in)

Settings -> Mail account -> *Mail text search* -> **Local word index**
(needs `INBOXRAKE_SECRET_KEY`) builds, on a button press, a small SQLite
index per account next to the scan snapshots. It stores **no readable mail
text**: for every mail only keyed hashes (HMAC-SHA256 with a key derived
from `INBOXRAKE_SECRET_KEY` plus a random per-index salt) of its distinct
words, and the same message handles the scan snapshot holds. A copied
`/data` therefore reveals no mail content, and an index built under a
different key is unusable until rebuilt. Searches match **whole words**
(case and accents ignored, several words are ANDed) - not word parts or
phrases - and are instant for any provider. The build reads the first
~256 KB of every scanned mail from your server once (cancellable, with
progress); later scans only add new mails and drop vanished ones. Before
anything is read, Settings shows the **estimated disk use** and the free
space of the data volume and asks for confirmation (about 5-6 KB per mail,
up to ~12 KB for text-heavy mail: roughly 0.5-1.2 GB for 100,000 mails; the
build is refused if even the typical estimate would not fit). It is meant
for large mailboxes and slow providers - for a few thousand mails the
server-side search is already fast.
Switching the mode off or deleting the account removes the index.
