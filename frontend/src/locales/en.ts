/* English strings. Keys that are literal English text fall back to
 * the key itself, so this file only lists template/notice keys. */

export const EN: Record<string, string> = {
  "notice.scan_cancelled": "Scan cancelled.",
  "notice.action_cancelled": "Action cancelled.",
  "notice.cached_verdicts":
    "{n} cached AI verdicts applied (AI review only evaluates new groups).",
  "notice.restored":
    "Restored {restored} of {of} mails ({label}) - rescan to see them again.",
  "notice.emptied_trash": "Emptied Trash ({count} mails permanently deleted).",
  "notice.ai_all_cached":
    "All groups already have cached AI verdicts - nothing to review.",
  "notice.ai_cancelled": "AI review cancelled after {done}/{total} groups.",
  "confirm.act": "{verb}: {n} mails from {k} group(s)?",
  "confirm.act_mails": "{verb}: {n} selected mails?",
  "confirm.unsubscribe":
    "Unsubscribe from the senders of {k} selected group(s)?",
  "confirm.restore": "Restore {count} mails ({label})?",
  "confirm.empty_trash":
    "PERMANENTLY delete all {n} mails in Trash? This cannot be undone.",
  "confirm.clear_verdicts": "Clear all cached AI verdicts?",
  "confirm.reset_spend": "Reset the AI spend counter?",
  "account.label": "Account to edit",
  "account.add": "Add account",
  "account.hint":
    "Each account is scanned and cleaned separately - views never mix. "
    + "Switch accounts in the header once more than one is set up.",
  "account.new_prompt": "Name for the new account (e.g. \"gmail\"):",
  "account.confirm_delete":
    'Remove account "{name}"? Its rules keep their account name and stop '
    + "running; mails on the server are untouched.",
  "menu.accounts": "Accounts",
  "update.available": "A new version of Mailbroom is available.",
  "update.reload": "Reload",
  "menu.version": "v{version} (build {id})",
  "scan.age": "scanned {ago} ago",
  "login.section": "Login (optional)",
  "login.help":
    "Protects the API with a login. \"None\" trusts your network or a "
    + "reverse-proxy auth layer (as before). Password = one shared "
    + "password. SSO/OIDC = sign in via an OpenID Connect provider "
    + "(Pocket ID, Authentik, Keycloak, …); register this app there "
    + "with the callback URL <origin>/api/oidc/callback first.",
  "login.mode": "Login method",
  "login.mode_none": "None (reverse proxy / trusted network)",
  "login.mode_password": "Password",
  "login.mode_oidc": "SSO (OpenID Connect)",
  "login.password_label": "Login password",
  "login.oidc_issuer": "Issuer URL",
  "login.oidc_client": "Client ID",
  "login.oidc_secret": "Client secret",
  "login.oidc_redirect": "Redirect base URL (optional)",
  "login.oidc_redirect_ph": "auto: from the request headers",
  "login.oidc_allowed": "Allowed users (one email or subject per line)",
  "login.oidc_allowed_help":
    "Empty list = every account your identity provider signs in may use "
    + "the app. With entries, only those emails/subjects get in.",
  "login.submit": "Sign in",
  "login.sso": "Sign in with SSO",
  "login.logout": "Logout",
  "login.admin_tip": "admin - owns the server settings",
  "menu.profile": "Profile & settings",
  "tab.account": "Mail account",
  "tab.general": "General",
  "tab.ai": "AI",
  "tab.server": "Server (admin)",
  "menu.theme": "Switch to {next} theme",
  "menu.light": "light",
  "menu.dark": "dark",
  "login.oidc_admin": "Admin identity (email or subject)",
  "login.oidc_admin_ph": "empty: first login claims it",
  "login.tenancy_note":
    "With SSO every user gets their OWN workspace (accounts, scans, "
    + "settings). The admin keeps this one.",
  "shared.section": "Shared AI key (all users)",
  "shared.help":
    "Optionally share one server-side AI key: users without their own "
    + "key use it automatically, capped per user and month by the "
    + "default budget below (users may lower their cap, never raise it).",
  "shared.enabled": "Share this key with all users",
  "shared.budget": "Default monthly budget per user ($)",
  "ai.shared_key_ph": "using the shared server key",
  "usage.section": "User statistics",
  "usage.help":
    "Usage per workspace - counts, AI spend and disk only. Mailbroom "
    + "never shows you other users' mail data, account names or senders.",
  "usage.user": "User / workspace",
  "usage.mails": "Mails (last scan)",
  "usage.cleaned": "Cleaned (month)",
  "usage.ai_month": "AI spend (month)",
  "usage.last_scan": "Last scan",
  "usage.disk": "Disk",
  "usage.shared": "shared key",
  "sort.desc_tip": "Sorted descending - click for ascending",
  "sort.asc_tip": "Sorted ascending - click for descending",
  "qb.tip": "Build a filter - click conditions together",
  "qb.title": "Filter builder",
  "qb.hint": "every condition you add must ALSO match (AND)",
  "qb.add": "Add",
  "qb.clear": "Clear",
  "qb.done": "Done",
  "qb.tag": "Category",
  "qb.ai": "AI verdict",
  "qb.ai_safe": "safe to delete",
  "qb.ai_review": "review",
  "qb.ai_keep": "keep",
  "qb.age": "Older than",
  "qb.months": "months",
  "qb.years": "years",
  "qb.unread": "Unread ≥",
  "qb.att": "Attachments ≥",
  "qb.flags": "Only groups…",
  "qb.is_unsub": "with unsubscribe link",
  "qb.is_unsubscribed": "fully unsubscribed",
  "qb.is_not_unsubscribed": "not yet unsubscribed",
  "qb.is_noreply": "never replied to",
  "qb.is_replied": "replied to",
  "qb.is_protected": "protected",
  "qb.is_new": "new senders",
  "ai.shared_note":
    "No own key - AI runs on the server's shared key "
    + "(your monthly cap: {cap}).",
  "account.rename": "Rename…",
  "account.rename_prompt": 'New name for account "{name}":',
  "account.renamed": 'Account renamed to "{name}".',
  "folders.title": "Folders to scan - account \u201c{name}\u201d",
  "folders.discover": "Discover",
  "folders.discover_tip":
    "Reload this account's folder list from the server (uses the SAVED "
    + "credentials - save new ones first)",
  "folders.err_hint":
    "- folder discovery needs saved, working credentials for this "
    + "account; save them, then hit Discover.",
  "digest.title": "Activity digest email",
  "digest.schedule": "Schedule",
  "digest.off": "Off",
  "digest.recipient": "Recipient",
  "digest.recipient_placeholder": "this account's own address",
  "digest.time": "Time (24h, server's local time)",
  "digest.help":
    "A summary of what Mailbroom did for this account since the last "
    + "digest - actions taken, mails/bytes freed, rule previews (matches "
    + "found by rules still in report-only mode, not yet applied) and "
    + "unsubscribe outcomes. Skipped entirely when nothing happened.",
  "digest.send_test": "Send test digest",
  "digest.test_sent": "Sent!",
  "digest.test_sent_demo":
    "Sent a preview with example data (there's nothing real to report "
    + "yet) - it won't count as a real digest.",
  "auto_scan.title": "Automatic scanning",
  "auto_scan.enabled": "Enabled",
  "auto_scan.on": "On",
  "auto_scan.every": "Every",
  "auto_scan.unit_minutes": "minutes",
  "auto_scan.unit_hours": "hours",
  "auto_scan.align": "Start at minute (0-59)",
  "auto_scan.help":
    "Rescans this account on a timer, independent of any rule schedule - "
    + "keeps the New-sender flag and the activity digest fresh without "
    + "needing the app open. \"Start at minute\" aligns the cadence to a "
    + "clock boundary (e.g. every 3 hours at minute 10 fires at 00:10, "
    + "03:10, 06:10, ...) instead of drifting from whenever this was saved. "
    + "Skipped automatically while the account is busy with something "
    + "else; it just retries on the next tick.",
  "note.ai_selected": "{note} - selected {n}/{of}",
  "note.ai_truncated": " (first {n} mails only)",
  "note.background": "{verb} - running in the background…",
  "show_more": "Show {n} more ({hidden} hidden)",
  "ai_done": "AI done ({in} in / {out} out{cost}) · total {total}",
  "done_moved": "Done: {n} mails processed.",
  "note.ai_progress": "AI is reviewing… {done}/{total} mails",
  "ai.disclaimer":
    "AI review sends mail METADATA to your configured AI provider "
    + "(e.g. Anthropic, OpenAI, Microsoft Foundry, or your local model): "
    + "sender names and addresses, "
    + "mail counts, sizes, dates, read state, category tags, subject "
    + "lines, protected-sender markers and whether you ever replied to a "
    + "sender. Mail bodies and attachments are NEVER sent. Continue?",
  "ai.data_note":
    "Sent to the AI provider: sender names/addresses, counts, sizes, "
    + "dates, read state, tags, subject lines, protected-sender markers "
    + "and whether you ever replied to a sender - never mail bodies or "
    + "attachments.",
  "confirm.trash_protected":
    'The group "{label}" is protected. Move its mails to Trash anyway?',
  "confirm.protected_skipped": "({n} protected group(s) skipped.)",
  "toast.all_protected":
    "All selected groups are protected - nothing was deleted.",
  "confirm.block":
    'Block "{label}"? This creates a standing rule that automatically '
    + "moves its future mail to Trash on the daily schedule - reversible "
    + "by deleting the rule in Rules.",
  "confirm.block_trash_existing":
    "Also move its {n} existing mail(s) to Trash now?",
  "toast.blocked": 'Blocked "{label}".',
  "block.tip":
    "Block this sender/domain: creates a standing rule that auto-trashes "
    + "future mail",
  "confirm.unblock":
    'Unblock "{label}"? This deletes the standing rule - future mail is '
    + "no longer auto-trashed.",
  "toast.unblocked": 'Unblocked "{label}".',
  "unblock.tip": "Unblock: deletes the standing rule created by Block",
  "protect.tip":
    "Protect this sender - bulk deletes and AI suggestions will skip it",
  "unprotect.tip": "Protected - click to remove protection",
  "protected": "protected",
  "replied": "replied",
  "replied.tip":
    "You have written to this sender before (found in your Sent folder)",
  "new_sender.tip":
    "First seen recently - a signal only, no action was taken "
    + "automatically",
  "chip.new_count": "New ({n})",
  "protected.help":
    "One entry per line: an address (user@example.com) or a domain "
    + "(@example.com). Protected senders are skipped by bulk deletions and "
    + "selection presets, and the AI never rates them safe to delete.",
  "ai.rate": "AI rate mails",
  "sel.ai_safe": "AI: safe to delete",
  "sel.ai_review": "AI: review",
  "sel.unsub_pending": "Not yet unsubscribed",
  "endpoint.label": "Endpoint / base URL",
  "key.optional": "(optional for local models)",
  "note.ai_resume":
    "already rated mails are saved; click again to resume",
  "filter.all": "All ratings",
  "v.delete_safe": "safe to delete",
  "v.review": "review",
  "v.keep": "keep",
  "v.unrated": "unrated",
  "ratings.title": "Per-mail AI ratings (open the group for details)",
  "page.of": "Page {p} / {n}",
  "per page": "per page",
  "All": "All",
  "notice.rule_report":
    'Rule "{name}" (report): {groups} groups · {mails} mails would be '
    + "affected.",
  "notice.rule_executed":
    'Rule "{name}" executed: {acted} mails queued ({groups} groups).',
  "rules.help":
    "A rule saves a group filter (same syntax as the filter box) plus an "
    + "action. New rules only REPORT what they would do; switch to execute "
    + "after checking a report. Runs are capped at 500 mails, protected "
    + "senders are skipped, and everything lands in Trash/undo as usual.",
  "rules.empty": "No rules yet - create one below.",
  "rule.never_ran": "never ran",
  "rule.run_report": "report: {groups} groups · {mails} mails would be affected",
  "rule.run_executed": "executed: {acted} mails queued ({groups} groups, {mails} matched)",
  "rule.capped": "{n} mails beyond the per-run cap",
  "rule.protected_skipped": "{n} protected skipped",
  "rule.run_now": "Run now",
  "rule.enable_execute": "Enable execute",
  "rule.back_to_report": "Back to report mode",
  "rule.need_report": "Run at least one report first",
  "rule.confirm_execute": 'Run rule "{name}" in EXECUTE mode now?',
  "rule.confirm_enable":
    'Switch rule "{name}" to EXECUTE? Scheduled runs will then act on '
    + "matching mails (cap 500 per run, protected senders skipped, "
    + "undo available).",
  "rule.confirm_delete": 'Delete rule "{name}"?',
  "rule.edit_title": "Edit rule",
  "rule.new_title": "New rule",
  "rule.name": "Rule name",
  "rule.create": "Create (report mode)",
  "rule.match_count":
    "currently matches {groups} groups · {mails} mails (protected excluded)",
  "rule.match_unknown": "run a scan to see live match counts",
  "action.trash": "Move to Trash",
  "action.archive": "Archive",
  "action.move": "Move to folder",
  "action.mark_read": "Mark as read",
  "sched.manual": "manual",
  "sched.daily": "daily",
  "sched.weekly": "weekly",
  "mode.report": "report",
  "mode.execute": "execute",
  "retention.none": "All mails",
  "retention.keep_latest": "Keep newest N, act on the rest",
  "retention.older_than_days": "Only mails older than N days",
  "retention.n_placeholder": "N",
  "retention.help":
    "Restrict this action to mails beyond a keep-window instead of every "
    + "mail in the selected groups.",
  "retention.tag_keep_latest": "keep newest {n}",
  "retention.tag_older_than_days": "older than {n}d",
  "saved_filter.save_tip": "Save current filter as a preset",
  "saved_filter.name_prompt": "Name this preset",
  "saved_filter.edit_tip": "Edit this preset's filter",
  "saved_filter.editing": 'Editing "{name}"',
  "saved_filter.confirm_delete": 'Delete preset "{name}"?',
  "notice.atts_cancelled": "Attachment analysis cancelled.",
  "notice.unsub_cancelled": "Unsubscribe cancelled.",
  "atts.hint":
    "Find the mails hogging your storage. Analysis reads only the mail "
    + "structure (no content is downloaded).",
  "atts.summary": "{n} mails with attachments · {size} total",
  "atts.analyze": "Analyze attachments",
  "atts.reanalyze": "Re-analyze",
  "atts.intro":
    "Run the analysis to list mails by attachment size. Afterwards the "
    + "att:>10m filter also works on groups. Proton cannot strip single "
    + "attachments over IMAP - deleting removes the whole mail (undoable).",
  "atts.none": "No attachments found in the scanned folders.",
  "atts.running": "Analyzing attachments…",
  "unsub.running": "Unsubscribing…",
  "unsub.done":
    "Unsubscribe done: {done} done, {links} need confirmation, "
    + "{failed} failed.",
  "unsub.open_link": "Open unsubscribe page",
  "unsub.badge_link": "Confirm ↗",
  "unsub.mark_done": "Mark as done",
  "unsub.retry": "Retry unsubscribe",
  "unsub.badge_pending": "{n}/{of} unsubscribed",
  "unsub.badge_failed": "unsubscribe failed",
  "toast.unsub_started": "Unsubscribing from {n} sender(s)…",
  "toast.unsub_skipped":
    "({n} sender(s) already handled, protected, or over the per-run limit.)",
  "toast.unsub_nothing":
    "Nothing to unsubscribe from - every sender is already handled or "
    + "protected.",
  "dups.hint": "Same Message-ID, or identical sender + subject + size.",
  "dups.summary": "{n} duplicate sets · {size} reclaimable",
  "dups.keep_newest": "Select all but newest",
  "dups.wasted": "{size} reclaimable",
  "dups.newest": "newest",
  "dups.none": "No duplicates found - nice and tidy.",
  "stats.this_month": "trashed this month: {n} mails · {size}",
  "stats.per_year": "Mails per year",
  "stats.per_month": "Mails per month (last 12)",
  "stats.total_size": "total size",
  "stats.senders": "senders",
  "stats.avg_size": "avg mail size",
  "stats.unread": "unread",
  "stats.newsletters": "newsletters",
  "stats.replied_senders": "senders you replied to (of {total})",
  "stats.oldest": "oldest mail",
  "stats.categories": "By category",
  "stats.top_senders": "Top senders by count",
  "stats.ai": "AI verdicts (sender groups)",
  "stats.rated_mails":
    "· {n} mails rated individually ({safe} safe to delete)",
  "stats.top_domains": "Top domains by size",
  "stats.cleanup": "Cleanup by month",
  "stats.actions_line":
    "{trash} trashed ({size}) · {archive} archived · {move} moved · "
    + "{read} marked read",
  "stats.scans": "Recent scans",
  "sieve.button": "Sieve filter",
  "sieve.intro": "Auto-handle future mail from this sender in Proton:",
  "sieve.fileinto": "Move to folder",
  "sieve.discard": "Delete on arrival",
  "sieve.markread": "Mark as read",
  "sieve.copied": "Sieve filter copied - paste it in Proton's filter settings.",
  "sieve.open_proton": "Proton filter settings ↗",
  "Copy": "Copy",
  "notice.trash_restored": "Restored {n} mails from Trash to {dest}.",
  "trash.browse": "Browse Trash",
  "trash.search": "search subject / sender…",
  "trash.restore_to": "Restore to…",
  "trash.restored": "Restored {n} mails - rescan to see them in the views.",
  "trash.newest_shown": "newest {n} shown",
  "trash.empty": "Trash is empty.",
  "notice.ai_budget":
    "AI review stopped after {done}/{total} groups - monthly budget "
    + "reached (raise it in settings).",
  "budget.label": "Monthly AI budget ($, 0 = unlimited)",
  "budget.none": "no cap",
  "budget.month": "spent this month: {spent}",
  "categories.help":
    "One category per line: \"name: keyword1, keyword2\". A name matching "
    + "a built-in category (shipping, finance, shopping, social, travel, "
    + "dev/cloud) replaces its keywords; an empty keyword list disables "
    + "it; new names add categories. Applies on the next scan.",
  "new_sender.window_label": "\"New\" sender window (days)",
  "new_sender.window_help":
    "How many days a sender stays flagged \"New\" (is:new, the New badge) "
    + "after it's first seen in a scan.",
  "export.tip":
    "Download settings, rules, AI verdicts and the replied cache "
    + "(passwords and API keys are never exported)",
  "import.confirm":
    "Import this backup? Settings are overwritten, rules are replaced "
    + "(back in report mode), verdicts and replied data are merged. "
    + "Passwords/API keys are never imported.",
  "import.done": "Imported: {rules} rules, {verdicts} verdicts.",
  "no.matches": "No groups match this filter.",
  "onboard.title": "Welcome - three steps to a tidy mailbox",
  "onboard.step_bridge":
    "Pick your mail provider (Gmail, iCloud, Fastmail, … - or Proton "
    + "via Proton Mail Bridge; see the README for provider notes and "
    + "the Bridge Docker setup).",
  "onboard.step_creds":
    "Choose the provider preset and enter host, user and password "
    + "(most providers need an app password) in",
  "onboard.step_scan":
    "Hit Scan - nothing is ever deleted without your confirmation, and "
    + "deletions go to Trash first.",
  "onboard.test": "Test connection",
  "onboard.testing": "Testing connection…",
  "onboard.test_ok": "Connected - {n} folders visible. Ready to scan!",
  "onboard.test_fail": "Connection failed",
  "notify.toggle":
    "Desktop notifications when background jobs finish (only while the "
    + "tab is in the background)",
  "notify.denied": "Notifications were blocked by the browser.",
  "notify.delete_done": "Done: {n} mails processed.",
  "notify.ai_done": "AI review finished.",
  "notify.atts_done": "Attachment analysis finished.",
  "notify.unsub_done": "Bulk unsubscribe finished.",
  "preset.label": "Provider preset (prefills the fields below)",
  "preset.hint.proton":
    "Proton needs the Mail Bridge (paid plans): switch its IMAP mode to "
    + "SSL, export its certificate and point the CA file at it - see the "
    + "README.",
  "preset.hint.apppw":
    "Use an app-specific password, not your normal account password - "
    + "create one in the provider's security settings (links in the "
    + "README).",
  "preset.hint.imap_toggle":
    "IMAP must be enabled first in the provider's mail settings; then "
    + "use an app password if two-factor auth is on.",
  "preset.hint.oauth_gmail":
    "Gmail connects via OAuth only here (below) - register your own "
    + "free Google OAuth client, see the install guide.",
  "preset.hint.oauth_outlook_device":
    "Outlook connects via OAuth only here (below) - no setup needed, "
    + "see the install guide.",
  "preset.hint.oauth_outlook_byo":
    "Outlook connects via OAuth only here (below) - register your own "
    + "OAuth client in Entra ID, see the install guide.",
  "imap.security": "IMAP security",
  "smtp.host": "SMTP host (unsubscribe mails)",
  "smtp.host_placeholder": "empty = IMAP host",
  "smtp.security": "SMTP security",
  "sec.auto": "auto",
  "cafile.label": "Custom CA file (optional, e.g. the Bridge certificate)",
  "oauth.title": "Connect your {provider} account via OAuth",
  "oauth.client_id": "Client ID",
  "oauth.client_secret": "Client secret",
  "oauth.google_help":
    "Paste your Google OAuth client's ID and secret below, then click "
    + "Connect (setup steps in the install guide). A client left in "
    + "\"testing\" mode issues a refresh token that expires after 7 "
    + "days - request Google verification to remove that limit.",
  "oauth.ms_device_help":
    "No app registration needed: click below, then enter the code shown "
    + "at microsoft.com/devicelogin on any device.",
  "oauth.ms_byo_help":
    "Paste your Entra ID app's client ID below, then click Connect "
    + "(setup steps in the install guide) - a public client needs no "
    + "secret.",
  "oauth.connect": "Connect account",
  "oauth.connect_device": "Connect with a device code",
  "oauth.connected": "Connected",
  "oauth.disconnect": "Disconnect",
  "oauth.confirm_disconnect":
    "Disconnect this account from OAuth? You can reconnect anytime.",
  "oauth.device_instructions":
    "Open the link below on any device and enter this code:",
  "folder.role_excluded":
    "Special folder (detected by role) - always excluded from scans",
  "audit.empty": "Nothing recorded yet.",
  "audit.export": "Export audit log as CSV",
  "audit.by": "by {actor}",
  "audit.by_rule": "by rule “{name}”",
  "audit.page": "{from}–{to} of {total}",
  "audit.act.trash": "Trashed",
  "audit.act.archive": "Archived",
  "audit.act.move": "Moved",
  "audit.act.mark_read": "Marked as read",
  "audit.act.rule_report": "Rule report",
  "audit.act.rule_execute": "Rule executed",
  "audit.act.unsubscribe": "Unsubscribe",
  "audit.act.undo": "Undo",
  "audit.act.empty_trash": "Trash emptied",
  "audit.outcome.ok": "ok",
  "audit.outcome.error": "error",
  "audit.outcome.cancelled": "cancelled",
  "audit.outcome.partial": "partial",
  "audit.outcome.done": "done",
  "audit.outcome.link": "link",
  "audit.outcome.failed": "failed",
  "trash_group.tip": "Move every mail in this group to Trash",
  "menu.more": "More",
  "export.csv": "Export CSV",
  "export.csv_tip": "Export the current grouping as CSV",
  "bar.selected": "{n} groups selected · {mails} mails",
  "bar.limit_to": "Limit to:",
  "Cancel": "Cancel",
  "detail.n_selected": "{n} selected",
};
