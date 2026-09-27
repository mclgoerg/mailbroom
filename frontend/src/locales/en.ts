/* English strings. Keys that are literal English text fall back to
 * the key itself, so this file only lists template/notice keys. */

export const EN: Record<string, string> = {
  "notice.scan_cancelled": "Scan cancelled.",
  "notice.action_cancelled": "Action cancelled.",
  "notice.cached_verdicts":
    "{n} cached AI verdicts applied (AI review only evaluates new groups).",
  "notice.restored":
    "Restored {restored} of {of} mails ({label}) — rescan to see them again.",
  "notice.emptied_trash": "Emptied Trash ({count} mails permanently deleted).",
  "notice.ai_all_cached":
    "All groups already have cached AI verdicts — nothing to review.",
  "notice.ai_cancelled": "AI review cancelled after {done}/{total} groups.",
  "confirm.act": "{verb}: {n} mails from {k} group(s)?",
  "confirm.act_mails": "{verb}: {n} selected mails?",
  "confirm.restore": "Restore {count} mails ({label})?",
  "confirm.empty_trash":
    "PERMANENTLY delete all {n} mails in Trash? This cannot be undone.",
  "confirm.clear_verdicts": "Clear all cached AI verdicts?",
  "confirm.reset_spend": "Reset the AI spend counter?",
  "confirm.switch_profile": 'Switch to account profile "{name}"? Rescan afterwards.',
  "note.ai_selected": "{note} — selected {n}/{of}",
  "note.ai_truncated": " (first {n} mails only)",
  "note.background": "{verb} — running in the background…",
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
    + "and whether you ever replied to a sender — never mail bodies or "
    + "attachments.",
  "confirm.trash_protected":
    'The group "{label}" is protected. Move its mails to Trash anyway?',
  "confirm.protected_skipped": "({n} protected group(s) skipped.)",
  "toast.all_protected":
    "All selected groups are protected — nothing was deleted.",
  "protect.tip":
    "Protect this sender — bulk deletes and AI suggestions will skip it",
  "unprotect.tip": "Protected — click to remove protection",
  "protected": "protected",
  "replied": "replied",
  "replied.tip":
    "You have written to this sender before (found in your Sent folder)",
  "protected.help":
    "One entry per line: an address (user@example.com) or a domain "
    + "(@example.com). Protected senders are skipped by bulk deletions and "
    + "selection presets, and the AI never rates them safe to delete.",
  "ai.rate": "AI rate mails",
  "sel.ai_safe": "AI: safe to delete",
  "sel.ai_review": "AI: review",
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
  "rules.empty": "No rules yet — create one below.",
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
  "notice.atts_cancelled": "Attachment analysis cancelled.",
  "atts.hint":
    "Find the mails hogging your storage. Analysis reads only the mail "
    + "structure (no content is downloaded).",
  "atts.summary": "{n} mails with attachments · {size} total",
  "atts.analyze": "Analyze attachments",
  "atts.reanalyze": "Re-analyze",
  "atts.intro":
    "Run the analysis to list mails by attachment size. Afterwards the "
    + "att:>10m filter also works on groups. Proton cannot strip single "
    + "attachments over IMAP — deleting removes the whole mail (undoable).",
  "atts.none": "No attachments found in the scanned folders.",
  "atts.running": "Analyzing attachments…",
  "dups.hint": "Same Message-ID, or identical sender + subject + size.",
  "dups.summary": "{n} duplicate sets · {size} reclaimable",
  "dups.keep_newest": "Select all but newest",
  "dups.wasted": "{size} reclaimable",
  "dups.newest": "newest",
  "dups.none": "No duplicates found — nice and tidy.",
  "stats.current": "Currently scanned: {mails} mails · {size}",
  "stats.this_month": "trashed this month: {n} mails · {size}",
  "stats.per_year": "Mails per year",
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
  "sieve.copied": "Sieve filter copied — paste it in Proton's filter settings.",
  "sieve.open_proton": "Proton filter settings ↗",
  "Copy": "Copy",
  "notice.trash_restored": "Restored {n} mails from Trash to {dest}.",
  "trash.browse": "Browse Trash",
  "trash.search": "search subject / sender…",
  "trash.restore_to": "Restore to…",
  "trash.restored": "Restored {n} mails — rescan to see them in the views.",
  "trash.newest_shown": "newest {n} shown",
  "trash.empty": "Trash is empty.",
  "notice.ai_budget":
    "AI review stopped after {done}/{total} groups — monthly budget "
    + "reached (raise it in settings).",
  "budget.label": "Monthly AI budget ($, 0 = unlimited)",
  "budget.none": "no cap",
  "budget.month": "spent this month: {spent}",
  "categories.help":
    "One category per line: \"name: keyword1, keyword2\". A name matching "
    + "a built-in category (shipping, finance, shopping, social, travel, "
    + "dev/cloud) replaces its keywords; an empty keyword list disables "
    + "it; new names add categories. Applies on the next scan.",
  "export.tip":
    "Download settings, rules, AI verdicts and the replied cache "
    + "(passwords and API keys are never exported)",
  "import.confirm":
    "Import this backup? Settings are overwritten, rules are replaced "
    + "(back in report mode), verdicts and replied data are merged. "
    + "Passwords/API keys are never imported.",
  "import.done": "Imported: {rules} rules, {verdicts} verdicts.",
  "no.matches": "No groups match this filter.",
  "onboard.title": "Welcome — three steps to a tidy mailbox",
  "onboard.step_bridge":
    "Run Proton Mail Bridge (its IMAP endpoint must be reachable from "
    + "this app — see the README for the Docker setup).",
  "onboard.step_creds":
    "Enter the Bridge IMAP host, port, user and password in",
  "onboard.step_scan":
    "Hit Scan — nothing is ever deleted without your confirmation, and "
    + "deletions go to Trash first.",
  "onboard.test": "Test connection",
  "onboard.testing": "Testing connection…",
  "onboard.test_ok": "Connected — {n} folders visible. Ready to scan!",
  "onboard.test_fail": "Connection failed",
  "notify.toggle":
    "Desktop notifications when background jobs finish (only while the "
    + "tab is in the background)",
  "notify.denied": "Notifications were blocked by the browser.",
  "notify.delete_done": "Done: {n} mails processed.",
  "notify.ai_done": "AI review finished.",
  "notify.atts_done": "Attachment analysis finished.",
};
