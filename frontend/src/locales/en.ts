/* English strings. Keys that are literal English text fall back to
 * the key itself, so this file only lists template/notice keys. */

export const EN: Record<string, string> = {
  "notice.scan_cancelled": "Scan cancelled.",
  "notice.action_cancelled": "Action cancelled.",
  "notice.cached_verdicts":
    "{n} cached AI verdicts applied (AI review only evaluates new groups).",
  "notice.restored":
    "Restored {restored} of {of} mails ({label}).",
  "notice.restored_rescan":
    "Restored {restored} of {of} mails ({label}) - rescan to see them again.",
  "notice.emptied_trash": "Emptied Trash ({count} mails permanently deleted).",
  "notice.emptied_trash_one": "Emptied Trash (1 mail permanently deleted).",
  "notice.ai_all_cached":
    "All groups already have cached AI verdicts - nothing to review.",
  "notice.ai_cancelled": "AI review cancelled after {done}/{total} groups.",
  "confirm.act_mails": "{verb}: {n} selected mails?",
  "confirm.act_mails_one": "{verb}: 1 selected mail?",
  "confirm.unsubscribe":
    "Unsubscribe from the senders of {n} selected groups?",
  "confirm.unsub_pooled_skipped":
    "{n} pooled rows are skipped: open one to unsubscribe from a single sender.",
  "toast.unsub_pooled":
    "Unsubscribing works one sender at a time: open a pooled row and use "
    + "its sender's Unsubscribe.",
  "confirm.unsubscribe_one":
    "Unsubscribe from the senders of the selected group?",
  "confirm.restore": "Restore {count} mails ({label})?",
  "confirm.restore_one": "Restore 1 mail ({label})?",
  "ai.usage": "Usage",
  "ai.reset_spend": "Reset spend…",
  "ai.clear_verdicts": "Clear AI verdict cache…",
  "confirm.clear_verdicts": "Clear all cached AI verdicts",
  "confirm.clear_verdicts_body":
    "Groups are evaluated again by the next AI review, which uses tokens.",
  "confirm.clear_verdicts_confirm": "Clear cache",
  "confirm.reset_spend": "Reset the AI spend counter",
  "confirm.reset_spend_body":
    "Total AI spend ({cost}) and this month's spend ({month}), which counts "
    + "against your monthly budget, start again at zero.",
  "confirm.reset_spend_confirm": "Reset spend",
  "account.label": "Account to edit",
  "account.add": "Add account",
  "account.hint":
    "Each account is scanned and cleaned separately - views never mix. "
    + "Switch accounts in the header once more than one is set up.",
  "account.new_prompt": "Name for the new account (e.g. \"gmail\"):",
  "account.new_title": "Add account",
  "account.rename_title": "Rename account",
  "account.rename_confirm": "Rename",
  "account.err_empty": "Enter a name.",
  "account.err_dup": 'An account named "{name}" already exists.',
  "account.remove_title": "Remove account",
  "account.remove_help":
    "Removes this account from Mailbroom. Mails on the server are untouched.",
  "account.delete": 'Delete account "{name}"…',
  "account.delete_title": 'Delete account "{name}"',
  "account.delete_data":
    "Mailbroom deletes its sign-in and connection settings, scan results, "
    + "local search index, saved filters, pins, unsubscribe records, known "
    + "senders, digest and auto-scan settings.",
  "account.delete_rules":
    "Its rules keep the account name but stop running.",
  "account.delete_mails": "Mails on the server are untouched.",
  "account.delete_confirm": "Delete account",
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
  "tab.account_short": "Account",
  "tab.general_short": "General",
  "tab.ai_short": "AI",
  "tab.server_short": "Server",
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
  "sort.menu_state": "{key}, {dir}",
  "sort.menu": "Sort",
  "sort.ascending": "Ascending",
  "sort.descending": "Descending",
  "view.group_by": "Group by",
  "chip.inactive": "Inactive:",
  "chip.inactive_6m": "6 mo",
  "chip.inactive_1y": "1 yr",
  "chip.inactive_2y": "2 yr",
  "sort.desc_tip": "Sorted descending - click for ascending",
  "sort.asc_tip": "Sorted ascending - click for descending",
  "qb.tip": "Build a filter - click conditions together",
  "qb.title": "Build a filter",
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
  "search.placeholder_body": "Search subject, sender and mail text",
  "search.body_toggle": "Also search mail text",
  "search.placeholder":
    "Search subject or sender",
  "search.empty_title":
    "Search your mailbox",
  "search.empty_hint":
    "Finds scanned mails by subject or sender. Searching mail text is switched off for this account.",
  "search.empty_hint_body":
    "Finds scanned mails by subject or sender. Tick “Also search mail text” to include the message text.",
  "search.none":
    "No matches",
  "search.none_hint":
    "Try a different spelling or a shorter search.",
  "trash.no_match":
    "No matching mails",
  "trash.empty_hint":
    "Deleted mails stay here until you empty Trash.",
  "atts.not_analyzed":
    "Not analyzed yet",
  "atts.none_hint":
    "Use “Re-analyze” after new mail has been scanned.",
  "dups.none_hint":
    "No mail shares a Message-ID or has the same sender, subject and size as another.",
  "audit.empty_hint":
    "Actions such as moving mails to Trash, rule runs and undo will be listed here.",
  "search.body_hint":
    "Searching mail text asks your mail server and may take a moment.",
  "search.note.partial":
    "Not every folder was searched in time - results may be incomplete.",
  "search.note.folder_failed":
    "Could not search \"{folder}\" - skipped.",
  "search.note.stale_folder":
    "\"{folder}\" changed since the last scan - rescan to include it.",
  "search.note.charset_fallback":
    "This server does not support UTF-8 search - accented characters may "
    + "not match.",
  "body_search.title": "Mail text search",
  "body_search.label": "Search inside mail text",
  "body_search.server": "Ask the mail server",
  "body_search.local": "Local word index",
  "body_search.local_help":
    "Meant for large mailboxes and slow providers: builds a local index "
    + "once, then searches instantly. It stores NO readable mail text, only keyed hashes of each "
    + "mail's words (the key comes from MAILBROOM_SECRET_KEY). Searches match "
    + "whole words (case and accents ignored, several words must all "
    + "appear), not parts of words. Scans keep the index up to date; "
    + "switching this off deletes it.",
  "index.need_key":
    "The local index needs MAILBROOM_SECRET_KEY to be set on the server.",
  "index.save_first":
    "Save the settings first, then build the index here.",
  "index.none": "No index built yet.",
  "index.key_changed":
    "The index was built with a different secret key and cannot be used - "
    + "rebuild it.",
  "index.building": "Indexing…",
  "index.status": "{docs} mails indexed, last updated {ts}.",
  "index.disk": "Disk space used: {size}",
  "index.build": "Build index",
  "index.update": "Update now",
  "index.rebuild": "Rebuild",
  "index.delete": "Delete index",
  "index.confirm_read":
    "Reads the text of {n} scanned mails of this account from your mail "
    + "server (the first ~256 KB of each) and stores only keyed word hashes "
    + "locally - no readable text.",
  "index.confirm_disk":
    "Takes roughly {size} of disk space (up to {max} for text-heavy mail); "
    + "{free} are free on the data volume.",
  "index.confirm_time": "This can take a while.",
  "index.estimate":
    "Estimated disk space: about {size} for {n} mails (up to {max} for "
    + "text-heavy mail); {free} free on the data volume.",
  "index.confirm_tight":
    "Warning: that may not fit on the data volume.",
  "index.delete_title": "Delete the local index",
  "index.delete_body":
    "The word index of account \"{name}\" is removed. You can build it again "
    + "at any time.",
  "notice.index_cancelled": "Indexing cancelled - what was indexed is kept.",
  "search.body_hint_local":
    "Searches the local word index: whole words only, all must appear.",
  "search.note.index_missing":
    "The local index has not been built yet - build it in Settings. Showing "
    + "subject and sender matches only.",
  "search.note.index_key":
    "The local index was built with a different secret key - rebuild it in "
    + "Settings. Showing subject and sender matches only.",
  "search.note.index_behind":
    "{n} newer mails are not in the index yet - results may be incomplete.",
  "body_search.disabled": "Off (subject and sender only)",
  "body_search.help":
    "Mail-text search runs on your mail server for each query - Mailbroom "
    + "stores nothing. It can be slow on remote providers; Proton Bridge "
    + "answers locally. Turn it off to keep search to subject and sender.",
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
  "done_moved_one": "Done: 1 mail processed.",
  "note.ai_progress": "AI is reviewing… {done}/{total} mails",
  "ai.disclaimer":
    "AI review sends mail METADATA to your configured AI provider "
    + "(e.g. Anthropic, OpenAI, Microsoft Foundry, or your local model): "
    + "sender names and addresses, "
    + "mail counts, sizes, dates, read state, category tags, subject "
    + "lines, protected-sender markers and whether you ever replied to a "
    + "sender. Mail bodies and attachments are NEVER sent. AI sorting of "
    + "the Other row sends, per sender, its name and address, its mail "
    + "count, whether it offers an unsubscribe link and up to three "
    + "recent subject lines - plus your own sorting instructions from "
    + "Settings.",
  "ai.data_note":
    "Sent to the AI provider: sender names/addresses, counts, sizes, "
    + "dates, read state, tags, subject lines, protected-sender markers "
    + "and whether you ever replied to a sender - never mail bodies or "
    + "attachments.",
  "confirm.trash_protected":
    'The group "{label}" is protected. Move its mails to Trash anyway?',
  "toast.all_protected":
    "All selected groups are protected - nothing was deleted.",
  "pin.group_on": "Protect all mails in this group",
  "pin.group_off": "Remove protection from all mails",
  "pin.group_skipped":
    "{n} mails without a Message-ID could not be protected.",
  "pin.group_skipped_one":
    "1 mail without a Message-ID could not be protected.",
  "confirm.unpin_group":
    "Remove the protection from all {n} protected mails of this group?",
  "confirm.unpin_group_one":
    "Remove the protection from the 1 protected mail of this group?",
  "Sort: engagement": "Sort: engagement",
  "Eng.": "Eng.",
  "eng.col_tip":
    "Engagement: how much you actually read and answer this sender",
  "eng.popover_title": "Engagement score {score}/100 · {tier}",
  "eng.tip": "Engagement {score}/100 ({tier}): {parts}",
  "eng.low": "low",
  "eng.medium": "medium",
  "eng.high": "high",
  "eng.read": "{n}% read",
  "eng.replied": "replied",
  "eng.never_replied": "never replied",
  "eng.bulk": "newsletter/bulk",
  "eng.last": "last mail {year}",
  "qb.eng_low": "rarely engaged with",
  "qb.eng_medium": "sometimes engaged with",
  "qb.eng_high": "often engaged with",
  "bar.all_pinned": "all protected - nothing to move",
  "toast.all_pinned":
    "All selected mails are protected - nothing was changed.",
  "pin.protect_tip":
    "Protect this mail - no bulk action, rule or AI pick will move it",
  "pin.unprotect_tip": "Remove this mail's protection",
  "pin.badge_tip": "{n} mails protected from bulk actions",
  "pin.badge_tip_one": "1 mail protected from bulk actions",
  "pin.n_protected": "{n} mails protected",
  "pin.n_protected_one": "1 mail protected",
  "pin.error": "Could not change the mail's protection",
  "pin.no_message_id":
    "This mail has no Message-ID header, so it could not be recognised "
    + "again after a rescan - it can't be protected.",
  "pin.refused":
    "The selection contains protected mails - confirm them one at a time "
    + "or remove their protection first.",
  "rule.pinned_skipped": "{n} protected mails skipped",
  "rule.pinned_skipped_one": "1 protected mail skipped",
  "qb.has_pinned": "with protected mails",
  "confirm.block_trash_existing":
    "Also move its {n} existing mails to Trash now?",
  "confirm.block_trash_existing_one":
    "Also move its 1 existing mail to Trash now?",
  "toast.blocked": 'Blocked "{label}".',
  "block.tip":
    "Block this sender/domain: creates a standing rule that auto-trashes "
    + "future mail",
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
  "ratings.aria": "Per-mail AI ratings: {parts}",
  "ratings.popover_title": "Per-mail AI ratings",
  "ratings.popover_hint":
    "Counts of this group's mails by rating. Open the group for details.",
  "trash.open_label": "Trash ({n} mails)",
  "trash.open_label_one": "Trash (1 mail)",
  "page.first": "First page",
  "page.prev": "Previous page",
  "page.next": "Next page",
  "page.last": "Last page",
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
  "rule.capped_one": "1 mail beyond the per-run cap",
  "rule.protected_skipped": "{n} protected skipped",
  "rule.run_now": "Run now",
  "rule.enable_execute": "Enable execute",
  "rule.back_to_report": "Back to report mode",
  "rule.need_report": "Run at least one report first",
  "rule.confirm_execute": 'Run rule "{name}" in EXECUTE mode now?',
  "rule.confirm_delete": 'Delete rule "{name}"?',
  "rule.edit_title": "Edit rule",
  "rule.new_title": "New rule",
  "rule.name": "Rule name",
  "rule.create": "Create rule (report only)",
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
  "atts.summary_one": "1 mail with attachments · {size} total",
  "atts.analyze": "Analyze attachments",
  "atts.reanalyze": "Re-analyze",
  "atts.intro":
    "Run the analysis to list mails by attachment size. Afterwards the "
    + "att:>10m filter also works on groups. Proton cannot strip single "
    + "attachments over IMAP - deleting removes the whole mail (undoable).",
  "atts.none": "No attachments found",
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
  "toast.unsub_started": "Unsubscribing from {n} senders…",
  "toast.unsub_started_one": "Unsubscribing from 1 sender…",
  "toast.unsub_skipped":
    "({n} senders already handled, protected, or over the per-run limit.)",
  "toast.unsub_skipped_one":
    "(1 sender already handled, protected, or over the per-run limit.)",
  "toast.unsub_nothing":
    "Nothing to unsubscribe from - every sender is already handled or "
    + "protected.",
  "dups.hint": "Same Message-ID, or identical sender + subject + size.",
  "dups.summary": "{n} duplicate sets · {size} reclaimable",
  "dups.summary_one": "1 duplicate set · {size} reclaimable",
  "dups.keep_newest": "Select all but newest",
  "dups.wasted": "{size} reclaimable",
  "dups.newest": "newest",
  "dups.none": "No duplicates found",
  "stats.this_month": "moved to Trash this month: {n} mails",
  "stats.this_month_one": "moved to Trash this month: 1 mail",
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
  "stats.rated_mails_one":
    "· 1 mail rated individually ({safe} safe to delete)",
  "stats.top_domains": "Top domains by size",
  "stats.cleanup": "Cleanup by month",
  "stats.actions_line":
    "{trash} moved to Trash · {archive} archived · {move} moved · "
    + "{read} marked read",
  "stats.actions_purged": " · {purge} deleted permanently ({size} freed)",
  "stats.scans": "Recent scans",
  "sieve.button": "Sieve filter",
  "sieve.intro": "Auto-handle future mail from this sender in Proton:",
  "sieve.fileinto": "Move to folder",
  "sieve.discard": "Delete on arrival",
  "sieve.markread": "Mark as read",
  "sieve.copied": "Sieve filter copied - paste it in Proton's filter settings.",
  "sieve.open_proton": "Proton filter settings ↗",
  "Copy": "Copy",
  "notice.trash_restored":
    "Restored {n} mails from Trash to {dest}.",
  "notice.trash_restored_one": "Restored 1 mail from Trash to {dest}.",
  "notice.trash_restored_rescan":
    "Restored {n} mails from Trash to {dest} - rescan to see them again.",
  "notice.trash_restored_rescan_one":
    "Restored 1 mail from Trash to {dest} - rescan to see it again.",
  "trash.browse": "Browse Trash",
  "fp.delete_permanently": "Delete permanently…",
  "fp.older": "Delete older than…",
  "fp.older_title": "Delete old mails permanently",
  "fp.older_label": "Received more than this many days ago",
  "fp.older_invalid": "Enter a whole number of days from 1 to 36500.",
  "fp.older_btn": "Count mails",
  "fp.empty_junk": "Empty Junk",
  "fp.purge_title": "Permanently delete from {folder}?",
  "fp.purge_title_empty": "Empty {folder} permanently?",
  "fp.purge_body_junk":
    "These mails are moved to Trash first and then deleted there, on the "
    + "server. This cannot be undone.",
  "fp.purge_body_trash":
    "These mails are deleted on the server. This cannot be undone.",
  "fp.purge_scope_older": "Mails received more than {n} days ago.",
  "fp.purge_scope_older_one": "Mails received more than 1 day ago.",
  "fp.purge_b_delete": "{n} mails will be deleted permanently",
  "fp.purge_b_delete_one": "1 mail will be deleted permanently",
  "fp.purge_b_protected": "{n} mails from protected senders are skipped",
  "fp.purge_b_protected_one": "1 mail from a protected sender is skipped",
  "fp.purge_b_pinned": "{n} protected mails are skipped",
  "fp.purge_b_pinned_one": "1 protected mail is skipped",
  "fp.purge_btn": "Delete permanently ({n})",
  "fp.purge_none": "Nothing to delete.",
  "fp.purge_none_skipped":
    "Nothing to delete. {skipped}. Remove the protection first to delete "
    + "them.",
  "fp.purge_nothing_left":
    "Nothing was left to delete - the mails were already gone.",
  "fp.purged": "Permanently deleted {n} mails",
  "fp.purged_one": "Permanently deleted 1 mail",
  "fp.purged_skipped": "Permanently deleted {n} mails ({k} skipped)",
  "fp.purged_skipped_one": "Permanently deleted 1 mail ({k} skipped)",
  "fp.purge_unverified":
    "Moved {n} mails to Trash, but could not verify them for permanent "
    + "deletion. Nothing was deleted permanently - they are still in Trash. "
    + "You can undo the move.",
  "fp.purge_unverified_one":
    "Moved 1 mail to Trash, but could not verify it for permanent "
    + "deletion. Nothing was deleted permanently - it is still in Trash. "
    + "You can undo the move.",
  "audit.act.purge": "Deleted permanently",
  "stats.freed_month":
    "permanently deleted this month: {n} mails · {size} freed",
  "stats.freed_month_one":
    "permanently deleted this month: 1 mail · {size} freed",
  "fp.menu": "Junk & Trash",
  "fp.which": "Folder",
  "fp.grouping": "Group by",
  "fp.by_sender": "By sender",
  "fp.mails": "Mails",
  "fp.not_junk": "Not junk",
  "fp.action": "Action…",
  "fp.to_trash": "Move to Trash",
  "fp.not_junk_done": "Moved {n} mails to your inbox",
  "fp.not_junk_done_one": "Moved 1 mail to your inbox",
  "fp.protect_sender": "Protect {n} senders",
  "fp.protect_sender_one": "Protect sender",
  "fp.junk_empty": "Junk is empty",
  "fp.junk_empty_hint":
    "Mail your provider flags as junk shows up here, so you can rescue false alarms.",
  "fp.protected_refused":
    "Some of these mails are from protected senders or are pinned. Move them to Trash anyway?",
  "fp.confirm_protected_title": "Move protected mails to Trash?",
  "fp.confirm_protected_btn": "Move anyway",
  "junk.browse": "Browse Junk",
  "junk.open_label": "Junk ({n} mails)",
  "junk.open_label_one": "Junk (1 mail)",
  "notice.junk_rescued": "Moved {n} mails from Junk to your inbox.",
  "notice.junk_rescued_one": "Moved 1 mail from Junk to your inbox.",
  "notice.junk_rescued_rescan":
    "Moved {n} mails from Junk to your inbox - rescan to see them in the views.",
  "notice.junk_rescued_rescan_one":
    "Moved 1 mail from Junk to your inbox - rescan to see it in the views.",
  "trash.restore_to": "Restore to…",
  "trash.restored": "Restored {n} mails - rescan to see them in the views.",
  "trash.restored_one": "Restored 1 mail - rescan to see it in the views.",
  "trash.restored_refreshing":
    "Restored {n} mails - the views update automatically.",
  "trash.restored_refreshing_one":
    "Restored 1 mail - the views update automatically.",
  "trash.newest_shown": "newest {n} shown",
  "trash.empty": "Trash is empty",
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
    + "it; new names add categories. A category you define or edit also "
    + "decides the rows of the Smart tab. Applies right away to the Sender "
    + "and Smart tabs, to the other tabs on the next scan.",
  "new_sender.window_label": "\"New\" sender window (days)",
  "new_sender.window_help":
    "How many days a sender stays flagged \"New\" (is:new, the New badge) "
    + "after it's first seen in a scan.",
  "export.tip":
    "Download settings, rules, AI verdicts, the replied cache and the senders "
    + "you filed - the file lists sender addresses (passwords and API keys "
    + "are never exported)",
  "backup.title": "Backup & restore",
  "backup.help":
    "Export downloads your settings, rules, AI verdicts, the replied cache "
    + "and the senders you filed as a file; import restores such a file. The "
    + "file lists sender addresses - keep it private. Passwords and API keys "
    + "are never part of a backup.",
  "import.title": "Import this backup",
  "import.settings": "Settings are overwritten.",
  "import.rules": "Rules are replaced (back in report mode).",
  "import.merged": "AI verdicts, replied data and filed senders are merged.",
  "import.secrets": "Passwords and API keys are never imported.",
  "import.confirm": "Import backup",
  "import.done": "Imported: {rules} rules, {verdicts} verdicts, {knowledge} filed senders.",
  "view.all_mails": "All mails",
  "mails.sort_date": "Date",
  "mails.sort_size": "Size",
  "mails.sort_sender": "Sender",
  "mails.filter": "filter mails…",
  "mails.filter_tip":
    "Plain words match sender or subject. Also: from:addr domain:example.com "
    + "folder:name age:>1y size:>1m att:>1m is:unread is:read has:pinned",
  "mails.count": "{n} of {total} mails",
  "mails.select_loaded": "Select loaded ({n})",
  "mails.ignored":
    "Not applied to single mails: {list} (these filters only work on groups).",
  "mails.load_more": "Load {n} more",
  "mails.none": "No mails match this filter.",
  "thread.title": "Conversation",
  "thread.read": "Read conversation",
  "thread.you": "You",
  "thread.n_mails": "{n} mails",
  "thread.n_mails_one": "1 mail",
  "thread.expand_all": "Expand all",
  "thread.collapse_all": "Collapse all",
  "thread.show_quoted": "Show quoted text",
  "thread.hide_quoted": "Hide quoted text",
  "thread.note.sent_unavailable":
    "Your own replies could not be loaded from the Sent folder - only the "
    + "received mails are shown.",
  "no.matches": "No groups match this filter",
  "err.generic": "Error: {msg}",
  "err.ai": "AI error: {msg}",
  "err.unsub": "Unsubscribe error: {msg}",
  "err.undo": "Undo error: {msg}",
  "err.connection": "Connection error: {msg}",
  "toast.moved_trash": "Moved {n} mails to Trash",
  "toast.moved_trash_one": "Moved 1 mail to Trash",
  "status.filter_none": "0 of {n} groups match",
  "status.filter_none_one": "0 of 1 group matches",
  "status.no_mails": "No mails found in the scanned folders.",
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
  "notify.delete_done_one": "Done: 1 mail processed.",
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
  "smtp.host": "SMTP host",
  "smtp.help":
    "SMTP is only used to send unsubscribe mails; the SMTP host defaults to "
    + "the IMAP host.",
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
  "oauth.disconnect_title": "Disconnect this account from OAuth",
  "oauth.disconnect_body": "You can reconnect anytime.",
  "oauth.device_instructions":
    "Open the link below on any device and enter this code:",
  "folder.role_excluded":
    "Special folder (detected by role) - always excluded from scans",
  "folder.view_excluded":
    "Virtual view of mail kept elsewhere - never scanned, so nothing is "
    + "counted twice",
  "folder.lookalike_excluded":
    "Looks like a second special folder (another folder already holds "
    + "that role) - never scanned, so its mail is not offered for cleanup",
  "folder.view": "view",
  "role.trash": "Trash",
  "role.junk": "Junk",
  "role.sent": "Sent",
  "role.drafts": "Drafts",
  "role.archive": "Archive",
  "role.all": "All mail",
  "folders.scan": "Folders to scan",
  "folders.special": "Special folders",
  "folders.special_hint":
    "Not part of the cleanup scan. The folder shown for each role is the one "
    + "Mailbroom moves mail into - and the one permanent actions use.",
  "folders.none": "No folders found.",
  "folder.src.flag": "server flag",
  "folder.src.name": "by name",
  "folder.src.override": "you chose",
  "folder.view_row": "Views of other folders - never scanned",
  "folder.archive_scanned": "Archive is still scanned - tick it below.",
  "folder.ambiguous":
    "More than one folder could be your {role} folder. Until you choose, "
    + "Mailbroom uses \u201c{pick}\u201d for moves to {role} and refuses to "
    + "delete permanently or empty it.",
  "folder.choose": "Not confirmed yet - choose\u2026",
  "folder.choose_label": "Which folder is your {role} folder?",
  "folder.confirmed":
    "You chose this folder. Permanent actions on {role} (such as Empty "
    + "Trash) use exactly this one.",
  "folder.choice_note":
    "The folder you pick here is the one permanent actions will use.",
  "folder.auto": "Use automatic choice",
  "folder.choice_saved": "{role} folder set to \u201c{name}\u201d.",
  "folder.choice_reset": "{role} folder is chosen automatically again.",
  "folder.lookalike_tag": "also looks like {role}",
  "folder.move_contents": "Move contents to {role}",
  "folder.move_needs_choice": "Choose the {role} folder above first.",
  "folder.move_title": "Move {n} mails to {role}?",
  "folder.move_title_one": "Move 1 mail to {role}?",
  "folder.move_body":
    "The mails in \u201c{folder}\u201d are moved into \u201c{target}\u201d "
    + "- not deleted. You can undo this right after.",
  "folder.move_confirm": "Move {n} mails",
  "folder.move_confirm_one": "Move 1 mail",
  "folder.move_empty": "\u201c{folder}\u201d is empty - nothing to move.",
  "folder.moved": "Moved {n} mails to {role}.",
  "folder.moved_one": "Moved 1 mail to {role}.",
  "folder.err.not_candidate": "That folder cannot be chosen for this role.",
  "folder.err.ambiguous":
    "Choose the right folder for this role first, then try again.",
  "folder.err.not_lookalike":
    "This folder no longer looks like a second special folder - reload the "
    + "list.",
  "folder.err.move_unsafe":
    "This server can neither MOVE nor safely delete single mails, so the "
    + "move is refused - nothing was changed.",
  "folder.undone": "Moved {n} mails back.",
  "folder.undone_one": "Moved 1 mail back.",
  "audit.act.move_contents": "Folder contents moved",
  "audit.empty": "Nothing recorded yet",
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
  "trash.counting": "Counting…",
  "trash.already_empty": "Trash is empty.",
  "audit.act.empty_trash": "Trash emptied",
  "audit.outcome.ok": "ok",
  "audit.outcome.error": "error",
  "audit.outcome.cancelled": "cancelled",
  "audit.outcome.partial": "partial",
  "audit.outcome.done": "done",
  "audit.outcome.link": "link",
  "audit.outcome.failed": "failed",
  "menu.more": "More",
  "export.csv": "Export CSV",
  "export.csv_tip": "Export the current grouping as CSV",
  "bar.selected": "{n} groups · {mails} mails",
  "bar.selected_one": "1 group · {mails} mails",
  "bar.clear": "Clear selection",
  "bar.export": "Export CSV",
  "bar.label": "Selection actions",
  "bar.limit_to": "Limit to:",
  "Cancel": "Cancel",
  "detail.n_selected": "{n} selected",
  "detail.region": "Details: {label}",
  "Dismiss": "Dismiss",
  "Refresh": "Refresh",
  "OK": "OK",
  "Select {label}": "Select {label}",
  "Select mail": "Select mail",
  "ai.consent_title": "Send mail metadata to the AI provider?",
  "Continue": "Continue",
  "btn.mail_protect": "Protect mail",
  "btn.mail_protected": "Mail protected",
  "btn.protect": "Protect",
  "btn.protected": "Protected",
  "confirm.btn_n": "{verb} ({n})",
  "confirm.act_pinned_mail":
    'The protected mail "{subject}" is exempt from bulk actions - this '
    + "explicitly overrides its protection.",
  "confirm.empty_trash_body":
    "{n} mails in Trash will be permanently deleted. This cannot be undone.",
  "confirm.empty_trash_body_one":
    "The 1 mail in Trash will be permanently deleted. This cannot be undone.",
  "confirm.empty_trash_btn": "Delete permanently ({n})",
  "confirm.btn_anyway": "{verb} anyway",
  "confirm.b_mails_groups": "{n} mails from {k} groups will be affected",
  "confirm.b_mails_groups_one": "1 mail from {k} groups will be affected",
  "select.named": "Select {subject}",
  "confirm.b_mails_one_group": "{n} mails in 1 group will be affected",
  "confirm.b_mails_one_group_one": "1 mail in 1 group will be affected",
  "bar.groups": "{n} groups",
  "bar.groups_one": "1 group",
  "bar.selected_one_mail": "1 group · 1 mail",
  "n.mails": "{n} mails",
  "n.mails_one": "1 mail",
  "n.senders": "{n} senders",
  "n.senders_one": "1 sender",
  "n.groups": "{n} groups",
  "n.groups_one": "1 group",
  "filter.syntax_hint":
    "Combinable: tag:shipping ai:safe age:>1y unread:>80 is:unsub text",
  "tenant.row_tip":
    "{id} - {accounts} accounts, {scans} scans, {rules} rules, {verdicts} AI verdicts",
  "confirm.b_subject": '"{subject}"',
  "confirm.b_selected": "{n} selected mails",
  "confirm.b_selected_one": "1 selected mail",
  "confirm.b_protected_groups_skipped": "{n} protected groups skipped",
  "confirm.b_protected_groups_skipped_one": "1 protected group skipped",
  "confirm.b_pinned_kept": "{n} protected mails stay untouched",
  "confirm.b_pinned_kept_one": "1 protected mail stays untouched",
  "confirm.b_pinned_skipped": "{n} protected mails skipped",
  "confirm.b_pinned_skipped_one": "1 protected mail skipped",
  "confirm.unsubscribe_btn": "Unsubscribe",
  "confirm.restore_btn": "Restore",
  "confirm.empty_trash_title": "Empty Trash?",
  "confirm.unpin_btn": "Remove protection",
  "confirm.block_title": 'Block "{label}"?',
  "confirm.block_body":
    "This creates a standing rule that automatically moves its future mail "
    + "to Trash on the daily schedule - reversible by deleting the rule in "
    + "Rules.",
  "confirm.block_only": "Only block",
  "confirm.unblock_title": 'Unblock "{label}"?',
  "confirm.unblock_body":
    "This deletes the standing rule - future mail is no longer "
    + "auto-trashed.",
  "saved_filter.name_label": "Name",
  "saved_filter.name_required": "Enter a name.",
  "saved_filter.confirm_btn": "Delete",
  "rule.enable_title": 'Switch rule "{name}" to EXECUTE?',
  "rule.enable_body":
    "Scheduled runs will then act on matching mails (cap 500 per run, "
    + "protected senders skipped, undo available).",
  "trash_all.btn": "Trash all {n}",
  "trash_all.btn_one": "Trash 1 mail",
  "trash_all.tip": "Move all {n} mails of this group to Trash",
  "trash_all.tip_one": "Move the 1 mail of this group to Trash",
  "trash_this.btn": "Trash this mail",
  "block.btn": "Block sender",
  "rule.f_grouping": "Grouping",
  "rule.f_filter": "Filter",
  "rule.f_action": "Action",
  "rule.f_schedule": "Schedule",
  "rule.f_apply": "Apply to",
  "rule.f_retention_n": "Number",
  "rule.f_dest": "Folder",
  "rule.f_name": "Name",

  "ai.review_body":
    "Already rated: {rated} of {total}. Re-rating sends them to the AI again, "
    + "replaces their verdicts and uses tokens (and budget) again.",
  "ai.review_new": "Review new only ({n})",
  "ai.review_rerate": "Re-rate all ({n})",

  // Smart grouping (the "Smart" tab: big senders keep a row, the long tail
  // of small senders is pooled by company / by what their mails are about).
  "smart.kind.protected": "Protected senders",
  "smart.kind.replied": "People you write to",
  "smart.kind.orders": "Orders & deliveries",
  "smart.kind.appointments": "Appointments & bookings",
  "smart.kind.jobs": "Job applications",
  "smart.kind.support": "Support & inquiries",
  "smart.kind.accounts": "Accounts & security",
  "smart.kind.newsletter": "Newsletters",
  "smart.kind.individuals": "Individuals",
  "smart.kind.other": "Other senders",
  "smart.cat": "Category: {name}",
  "smart.why.company":
    "Several senders of {domain}, grouped as one company because together they have at least {min} mails.",
  "smart.why.protected":
    "Senders with fewer than {min} mails that you have protected.",
  "smart.why.replied":
    "Senders with fewer than {min} mails that you have written to.",
  "smart.why.orders":
    "Senders with fewer than {min} mails, mostly about orders, shipping and "
    + "invoices.",
  "smart.why.appointments":
    "Senders with fewer than {min} mails, mostly about appointments, "
    + "reservations and bookings.",
  "smart.why.jobs":
    "Senders with fewer than {min} mails, mostly about job applications.",
  "smart.why.support":
    "Senders with fewer than {min} mails, mostly support requests and "
    + "inquiries.",
  "smart.why.accounts":
    "Senders with fewer than {min} mails, mostly sign-ups and security codes.",
  "smart.why.category":
    "Senders with fewer than {min} mails in the category \u201c{name}\u201d.",
  "smart.why.newsletter":
    "Senders with fewer than {min} mails that offer an unsubscribe link or "
    + "send promotions.",
  "smart.why.individuals":
    "Senders with fewer than {min} mails writing from a private address "
    + "(Gmail, Outlook, GMX, \u2026).",
  "smart.why.other":
    "Senders with fewer than {min} mails whose mails are unclear or about "
    + "several things at once.",
  "smart.purposes": "What the mails are about: {list}",
  "smart.purpose.orders": "Orders",
  "smart.purpose.appointments": "Appointments",
  "smart.purpose.jobs": "Applications",
  "smart.purpose.support": "Support",
  "smart.purpose.accounts": "Accounts",
  "smart.purpose.newsletter": "Newsletters",
  "smart.purpose.unclassified": "Unclassified",
  "smart.protected_moved":
    "{label} is protected now - its mails moved to \u201cProtected senders\u201d.",
  // Smart sender list (what is inside a pooled row, and why).
  "smart.about.orders": "orders and deliveries",
  "smart.about.appointments": "appointments and bookings",
  "smart.about.jobs": "job applications",
  "smart.about.support": "support and inquiries",
  "smart.about.accounts": "accounts and security",
  "smart.about.newsletter": "newsletters and promotions",
  "smart.about.individuals": "private correspondence",
  "smart.about.other": "nothing in particular",
  "aisort.btn": "Sort with AI",
  "aisort.title": "Sort the senders left in Other with AI?",
  "aisort.nothing": "Nothing left to sort: the AI has seen every sender in Other.",
  "aisort.b_units":
    "{n} senders the rules could not place (the senders of one company are asked about together)",
  "aisort.b_units_one":
    "1 sender the rules could not place",
  "aisort.b_cost": "About {tin} tokens in, {tout} out - roughly {cost}",
  "aisort.b_instructions": "Your own instructions from Settings are included",
  "aisort.b_only":
    "It only picks one of the fixed kinds. No mail is moved or deleted, "
    + "and you can remove the sorting again.",
  "aisort.go": "Sort {n} senders",
  "aisort.sorted_n": "{n} senders were sorted by AI.",
  "aisort.checked_n": "The AI looked at {n} senders and left them in Other.",
  "aisort.cleared_none": "AI sorting removed.",
  "aisort.clear": "Remove AI sorting",
  "aisort.cleared": "AI sorting removed: {n} senders are back where the rules put them.",
  "aisort.clear_confirm":
    "Remove the AI sorting of {n} senders? Answers you kept stay filed.",
  "aisort.started": "AI sorting started.",
  "notice.ai_sort_done": "AI sorting done: {placed} of {total} senders placed.",
  "notice.ai_sort_cancelled": "AI sorting cancelled after {done} of {total} senders; what was sorted stays.",
  "notice.ai_sort_budget": "Monthly AI budget reached after {done} of {total} senders; what was sorted stays.",
  "ai.sort_instructions": "Your instructions for AI sorting (optional)",
  "ai.sort_instructions_help":
    "Added to the fixed instructions when the AI sorts the senders left in "
    + "Other, e.g. \"Mails from my landlord are support, not individuals.\" "
    + "The AI still only picks one of the fixed kinds. Sent to your AI "
    + "provider together with the sender data; up to 1500 characters.",
  "smart.reason.own": "Has enough mails for its own row.",
  "smart.reason.protected": "You protected this sender.",
  "smart.reason.replied": "You have written to this sender.",
  "smart.reason.company":
    "Part of {co}: together its senders have enough mails for one row.",
  "smart.reason.purpose": "{n} of {of} mails are about {what}.",
  "smart.reason.weak": "Only {n} of {of} mails are about {what} - too few to say.",
  "smart.reason.competing": "Its mails are about several things at once.",
  "smart.reason.category": "In your category \u201c{name}\u201d.",
  "smart.reason.category_conflict": "Matches several of your categories.",
  "smart.reason.newsletter": "Offers an unsubscribe link or sends promotions.",
  "smart.reason.individual": "Writes from a private address.",
  "smart.reason.ai": "Sorted by AI as {what}.",
  "smart.reason.ai_other": "Checked by AI: the subjects do not make it clear.",
  "smart.reason.ai_other_sure": "Checked by AI: belongs in Other.",
  "smart.reason.notification":
    "Automatic notifications from a forum or developer tool.",
  "smart.reason.rule": "You filed this sender under {what}.",
  "smart.reason.rule_co": "You filed its company under {what}.",
  "smart.reason.kept_ai": "Filed under {what} by a kept AI answer.",
  "smart.reason.none": "Nothing in its mails says what it is about.",
  "smart.reason.with_company":
    "Placed together with the other senders of {co}.",
  "senders.tab": "Senders ({n})",
  "senders.mails_tab": "Mails ({n})",
  "senders.view": "What to show",
  "senders.search": "Search senders\u2026",
  "senders.sort": "Sort senders",
  "senders.sort_count": "Most mails",
  "senders.sort_last": "Newest",
  "senders.sort_size": "Largest",
  "senders.sort_label": "Name",
  "senders.none": "No senders match.",
  "senders.select_shown": "Select all {n} shown",
  "senders.selected": "{n} of {total} senders selected ({mails} mails)",
  "senders.protect": "Protect",
  "senders.back": "Back to the senders",
  "senders.protected_toast":
    "{n} senders protected \u2013 their mails moved to \u201cProtected senders\u201d.",
  "confirm.b_mails_senders": "{n} mails from {k} senders will be affected",
  "confirm.b_mails_one_sender": "{n} mails from 1 sender will be affected",
  "confirm.b_protected_senders_skipped": "{n} protected senders skipped",
  "smart.title": "Smart grouping",
  "smart.min_label": "Own row from N mails",
  "smart.min_help":
    "In the Smart tab a sender with at least this many mails keeps its own "
    + "row; smaller senders are pooled by company and by what their mails "
    + "are about. 2\u201350, default 10. Applies right away, no rescan "
    + "needed.",
  // Private sender knowledge: filing senders in Smart and keeping AI answers.
  "know.file_action": "File in Smart as…",
  "know.file_help": "No mail is moved.",
  "know.blocked.company":
    "Company rows are placed by their structure, so filing has no effect here.",
  "know.blocked.protected":
    "Protected senders stay in their own bucket, so filing has no effect here.",
  "know.blocked.replied":
    "People you write to stay in their own bucket, so filing has no effect here.",
  "know.scope_title": "File only the ticked senders, or whole companies?",
  "know.scope_body":
    "Some of the ticked senders belong to a company group. Filing only the "
    + "ticked ones takes them out of the group; filing the company files "
    + "everything of that company, senders that write later included. No "
    + "mail is moved either way.",
  "know.scope_sender": "Just the ticked senders",
  "know.scope_company": "The whole company ({n} senders)",
  "know.scope_company_one": "The whole company (1 sender)",
  "know.filed": "Filed {n} senders under {kind}.",
  "know.filed_one": "Filed 1 sender under {kind}.",
  "know.undone": "Filing undone.",
  "know.kind_category": "Category “{name}”",
  "know.keep_btn": "Keep these answers ({n} senders)",
  "know.keep_btn_one": "Keep these answers (1 sender)",
  "know.keep_title": "Keep the AI’s answers for {n} senders?",
  "know.keep_title_one": "Keep the AI’s answer for 1 sender?",
  "know.keep_b_rules":
    "They become your own rules for these senders and stay until you remove "
    + "them.",
  "know.keep_b_clearer":
    "Clearer evidence in their mails still wins over a kept answer.",
  "know.keep_b_only":
    "“Remove AI sorting” does not touch kept answers. No mail is moved.",
  "know.keep_go": "Keep for {n} senders",
  "know.keep_go_one": "Keep for 1 sender",
  "know.kept": "Kept the AI’s answers for {n} senders.",
  "know.kept_one": "Kept the AI’s answer for 1 sender.",
  "know.kept_skipped":
    "{n} senders were left as they are: they have a filing of your own, or their address cannot be filed.",
  "know.kept_skipped_one":
    "1 sender was left as it is: it has a filing of your own, or its address cannot be filed.",
  "know.kept_none": "No AI answer applies right now.",
  "know.box_title": "How Mailbroom files this sender",
  "know.box_now": "Now in “{row}”.",
  "know.box_select": "File this sender under",
  "know.box_auto": "Automatic",
  "know.src_user": "Filed by you",
  "know.src_ai": "Kept AI answer",
  "know.box_company": "Your rule for its company decides.",
  "know.reset": "Reset to automatic",
  "know.reset_company": "Reset its company to automatic",
  "know.reset_done": "Back to automatic.",
  "know.no_effect": "Your filing has no effect right now: {why}",
  "know.no_effect_ai": "The kept AI answer has no effect right now: {why}",
  "know.reason.own_row": "this sender has enough mails for its own row.",
  "know.reason.company_row": "its company has a row of its own.",
  "know.reason.protected": "this sender is protected.",
  "know.reason.replied": "you have written to this sender.",
  "know.reason.rules_confident": "the rules are sure about it now.",
  "know.reason.decided_by_rules":
    "the rules already decided it (newsletter, private address or notification).",
  "know.reason.shadowed": "a more specific rule of yours decides.",
  "know.reason.freemail": "an AI answer never gives a private address a purpose.",
  "know.reason.in_company_group":
    "it belongs to a company group, which a kept answer never splits.",
  "know.reason.not_applied": "it is not applied here.",
  "know.reason.inactive_category": "its category no longer exists.",
  "know.reason.invalid_key": "it no longer names a company or an address.",
  "know.reason.invalid_kind": "its kind is not known.",
  "know.err.bad_request": "That request was not understood.",
  "know.err.bad_key": "That is not a sender address or a company.",
  "know.err.bad_kind": "That kind is not available (a category may be gone).",
  "know.err.bad_note": "The note is too long (200 characters at most).",
  "know.err.full": "The list of filed senders is full.",
  "know.err.ai_running": "An AI run is going - try again when it is done.",
  "know.err.unscanned": "Scan every account first.",
  // Settings > Senders: what Mailbroom knows about your senders.
  "tab.senders": "Filed senders",
  "tab.senders_short": "Senders",
  "know.table_title": "What Mailbroom knows about your senders",
  "know.table_help":
    "Where you filed senders and companies in Smart, and the AI answers you "
    + "kept. It stays on this server and is never sent to an AI. Changes "
    + "here apply at once - there is nothing to save.",
  "know.empty_title": "Nothing filed yet",
  "know.empty_hint":
    "File a sender in Smart (tick it, then “File in Smart as…”) or keep an "
    + "AI sorting answer, and it is listed here. It stays on this server.",
  "know.search": "Search filed senders…",
  "know.none": "No entries match.",
  "know.sort_label": "Sort entries",
  "know.col_key": "Sender or company",
  "know.col_kind": "Filed under",
  "know.col_src": "Source",
  "know.col_senders": "Senders",
  "know.col_status": "Status",
  "know.col_ts": "Newest",
  "know.company": "Company",
  "know.kind_label": "Filed under",
  "know.note_label": "Note",
  "know.note_placeholder": "Optional note (200 characters at most)",
  "know.edit": "Edit",
  "know.delete": "Delete",
  "know.saved": "Saved.",
  "know.select": "Select {name}",
  "know.select_all": "Select all shown",
  "know.selected": "{n} selected",
  "know.delete_sel": "Delete selected ({n})",
  "know.delete_title": "Delete {n} entries?",
  "know.delete_title_one": "Delete 1 entry?",
  "know.delete_body":
    "The senders go back to where the rules put them. You can undo this "
    + "right after.",
  "know.delete_go": "Delete {n} entries",
  "know.delete_go_one": "Delete 1 entry",
  "know.deleted": "{n} entries removed.",
  "know.deleted_one": "Entry removed.",
  "know.status.active": "In effect",
  "know.status.no_effect": "No effect: {why}",
  "know.status.inactive": "Inactive: {why}",
  "know.status.inert": "Unusable: {why}",
  "know.status.unused": "No sender in your mailboxes matches",
  "know.status.unknown": "Not every mailbox is scanned yet",
  "know.status_short.active": "In effect",
  "know.status_short.no_effect": "No effect",
  "know.status_short.inactive": "Inactive",
  "know.status_short.inert": "Unusable",
  "know.status_short.unused": "Unused",
  "know.status_short.unknown": "Unknown",
  "know.unused_btn": "Remove unused ({n})",
  "know.unused_blocked":
    "Scan every account first ({n} not scanned yet): until then an entry "
    + "cannot be called unused.",
  "know.unused_title": "Remove {n} unused entries?",
  "know.unused_title_one": "Remove 1 unused entry?",
  "know.unused_body":
    "No sender in any of your mailboxes matches them. Entries of senders "
    + "that merely sit in a row of their own or in a company row are not "
    + "unused and stay. This cannot be undone.",
  "know.unused_go": "Remove {n} entries",
  "know.unused_go_one": "Remove 1 entry",
  "know.unused_done": "Removed {n} unused entries.",
  "know.unused_done_one": "Removed 1 unused entry.",
  "know.keep_all": "Keep all AI answers",
  "know.forget_btn": "Forget kept AI answers ({n} senders)",
  "know.forget_btn_one": "Forget kept AI answers (1 sender)",
  "know.forget_btn_unused": "Forget kept AI answers ({n} answers)",
  "know.forget_btn_unused_one": "Forget kept AI answers (1 answer)",
  "know.forget_title": "Forget the kept AI answers for {n} senders?",
  "know.forget_title_one": "Forget the kept AI answer for 1 sender?",
  "know.forget_title_unused": "Forget {n} kept AI answers that currently file no sender?",
  "know.forget_title_unused_one": "Forget 1 kept AI answer that currently files no sender?",
  "know.forget_b_back": "The senders go back to where the rules put them.",
  "know.forget_b_own": "What you filed yourself stays.",
  "know.forget_go": "Forget for {n} senders",
  "know.forget_go_one": "Forget for 1 sender",
  "know.forget_go_unused": "Forget {n} answers",
  "know.forget_go_unused_one": "Forget 1 answer",
  "know.forgot": "Forgot the kept AI answers for {n} senders.",
  "know.forgot_one": "Forgot the kept AI answer for 1 sender.",
  "know.forgot_unused": "Forgot {n} kept AI answers.",
  "know.forgot_unused_one": "Forgot 1 kept AI answer.",
  "know.download": "Download",
  "know.upload": "Upload…",
  "know.upload_bad": "That file has no filed senders.",
  "know.upload_title": "Merge this file into your filed senders?",
  "know.upload_b_n": "The file holds {n} entries.",
  "know.upload_b_n_one": "The file holds 1 entry.",
  "know.upload_b_merge":
    "Your existing entries stay; when both have the same sender or company "
    + "the newer one wins.",
  "know.upload_go": "Merge",
  "know.uploaded": "Merged: {n} entries added or updated.",
  "know.uploaded_one": "Merged: 1 entry added or updated.",
  "know.more": "Show more ({n} left)",
  "know.load_error": "Could not load the filed senders: {msg}",
  "know.forget_b_gone":
    "A forgotten answer is gone for good - run AI sorting again to get new ones. This cannot be undone.",
  "know.keep_b_account":
    "The answers of the account you are looking at are kept; other accounts keep theirs until you keep them there.",
  "know.upload_b_rest":
    "Anything else in a full backup is ignored here (Import in General restores that).",
  "know.download_tip":
    "Download this list as a file. It lists sender addresses and notes - keep it private.",
  "know.col_actions": "Actions",
};
