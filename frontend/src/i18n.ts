/* Minimal i18n: English keys (or notice.* template keys), German
 * translations, {param} interpolation, localStorage-persisted. */

export type Lang = "en" | "de";

/* Keys that are not literal English text (backend notice codes etc.). */
const EN: Record<string, string> = {
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
  "dups.hint": "Same Message-ID, or identical sender + subject + size.",
  "dups.summary": "{n} duplicate sets · {size} reclaimable",
  "dups.keep_newest": "Select all but newest",
  "dups.wasted": "{size} reclaimable",
  "dups.newest": "newest",
  "dups.none": "No duplicates found — nice and tidy.",
};

const DE: Record<string, string> = {
  "notice.scan_cancelled": "Scan abgebrochen.",
  "notice.action_cancelled": "Aktion abgebrochen.",
  "notice.cached_verdicts":
    "{n} zwischengespeicherte KI-Bewertungen übernommen (die KI-Prüfung bewertet nur neue Gruppen).",
  "notice.restored":
    "{restored} von {of} Mails wiederhergestellt ({label}) — zum Anzeigen neu scannen.",
  "notice.emptied_trash":
    "Papierkorb geleert ({count} Mails endgültig gelöscht).",
  "notice.ai_all_cached":
    "Alle Gruppen haben bereits KI-Bewertungen — nichts zu prüfen.",
  "notice.ai_cancelled": "KI-Prüfung nach {done}/{total} Gruppen abgebrochen.",
  "confirm.act": "{verb}: {n} Mails aus {k} Gruppe(n)?",
  "confirm.act_mails": "{verb}: {n} ausgewählte Mails?",
  "confirm.restore": "{count} Mails wiederherstellen ({label})?",
  "confirm.empty_trash":
    "Alle {n} Mails im Papierkorb ENDGÜLTIG löschen? Das kann nicht rückgängig gemacht werden.",
  "confirm.clear_verdicts": "Alle gespeicherten KI-Bewertungen löschen?",
  "confirm.reset_spend": "KI-Kostenzähler zurücksetzen?",
  "confirm.switch_profile":
    "Zum Kontoprofil „{name}“ wechseln? Danach neu scannen.",
  "note.ai_selected": "{note} — {n}/{of} ausgewählt",
  "note.ai_truncated": " (nur die ersten {n} Mails)",
  "note.background": "{verb} — läuft im Hintergrund…",
  "show_more": "{n} weitere anzeigen ({hidden} ausgeblendet)",
  "ai_done": "KI fertig ({in} rein / {out} raus{cost}) · gesamt {total}",
  "done_moved": "Fertig: {n} Mails verarbeitet.",
  "note.ai_progress": "KI prüft… {done}/{total} Mails",
  "ai.disclaimer":
    "Die KI-Prüfung sendet Mail-METADATEN an den konfigurierten "
    + "KI-Anbieter (z. B. Anthropic, OpenAI, Microsoft Foundry oder ein "
    + "lokales Modell): Absendernamen "
    + "und -adressen, Anzahl, Größen, Daten, Lesestatus, Kategorien, "
    + "Betreffzeilen, Schutz-Markierungen und ob Sie einem Absender je "
    + "geantwortet haben. Mail-Inhalte und Anhänge werden NIE gesendet. "
    + "Fortfahren?",
  "ai.data_note":
    "An den KI-Anbieter gesendet: Absendernamen/-adressen, Anzahl, "
    + "Größen, Daten, Lesestatus, Kategorien, Betreffzeilen, "
    + "Schutz-Markierungen und ob Sie einem Absender je geantwortet "
    + "haben — niemals Mail-Inhalte oder Anhänge.",
  "replied": "geantwortet",
  "replied.tip":
    "Sie haben diesem Absender schon geschrieben (aus Ihrem "
    + "Gesendet-Ordner ermittelt)",
  "confirm.trash_protected":
    "Die Gruppe „{label}“ ist geschützt. Mails trotzdem in den "
    + "Papierkorb verschieben?",
  "confirm.protected_skipped": "({n} geschützte Gruppe(n) übersprungen.)",
  "toast.all_protected":
    "Alle ausgewählten Gruppen sind geschützt — nichts wurde gelöscht.",
  "protect.tip":
    "Diesen Absender schützen — Massenlöschungen und KI-Vorschläge "
    + "überspringen ihn",
  "unprotect.tip": "Geschützt — klicken, um den Schutz aufzuheben",
  "protected": "geschützt",
  "Protected senders": "Geschützte Absender",
  "protected.help":
    "Ein Eintrag pro Zeile: eine Adresse (user@example.com) oder eine "
    + "Domain (@example.com). Geschützte Absender werden von "
    + "Massenlöschungen und Auswahl-Voreinstellungen übersprungen; die KI "
    + "stuft sie nie als sicher löschbar ein.",

  "Scan": "Scannen",
  "Sender": "Absender",
  "Domain": "Domain",
  "Subject": "Betreff",
  "AI review": "KI-Prüfung",
  "Select…": "Auswählen…",
  "AI-safe groups": "KI: sicher löschbar",
  "Inactive > 6 months": "Inaktiv > 6 Monate",
  "Inactive > 1 year": "Inaktiv > 1 Jahr",
  "Inactive > 2 years": "Inaktiv > 2 Jahre",
  "Older than 6 months": "Älter als 6 Monate",
  "Older than 1 year": "Älter als 1 Jahr",
  "Older than 2 years": "Älter als 2 Jahre",
  "All / none": "Alle / keine",
  "Clear selection": "Auswahl aufheben",
  "Sort: mails": "Sortierung: Mails",
  "Sort: size": "Sortierung: Größe",
  "Sort: last activity": "Sortierung: Aktivität",
  "Sort: unread %": "Sortierung: Ungelesen %",
  "Sort: name": "Sortierung: Name",
  "filter groups…": "Gruppen filtern…",
  "Trash": "Papierkorb",
  "Trash selected": "Auswahl löschen",
  "Empty Trash": "Papierkorb leeren",
  "Undo": "Rückgängig",
  "Settings": "Einstellungen",
  "Search all mails": "Alle Mails durchsuchen",
  "Search": "Suchen",
  "Select all": "Alle auswählen",
  "AI select deletable": "KI: Löschbares markieren",
  "Unsubscribe": "Abbestellen",
  "Archive": "Archivieren",
  "Move to folder…": "In Ordner verschieben…",
  "Mark read": "Als gelesen markieren",
  "Move to Trash": "In den Papierkorb",
  "Move": "Verschieben",
  "Mark as read": "Als gelesen markieren",
  "Restore": "Wiederherstellen",
  "Action…": "Aktion…",
  "mails": "Mails",
  "groups": "Gruppen",
  "matches": "Treffer",
  "Mails": "Mails",
  "Size": "Größe",
  "Last": "Zuletzt",
  "Type": "Typ",
  "AI": "KI",
  "unread": "ungelesen",
  "(filtered)": "(gefiltert)",
  "(no subject)": "(kein Betreff)",
  "No scan yet — hit “Scan”.": "Noch kein Scan — auf „Scannen“ klicken.",
  "Scanning…": "Scanne…",
  "Moving…": "Verschiebe…",
  "Restoring…": "Stelle wieder her…",
  "Emptying Trash…": "Leere Papierkorb…",
  "loading…": "lade…",
  "cancel": "abbrechen",
  "back to list": "zurück zur Liste",
  "dismiss": "ausblenden",
  "Date": "Datum",
  "Language": "Sprache",
  "Theme": "Design",
  "Clear AI verdict cache": "KI-Bewertungscache leeren",
  "ai.rate": "KI: Mails bewerten",
  "sel.ai_safe": "KI: sicher löschbar",
  "sel.ai_review": "KI: prüfen",
  "endpoint.label": "Endpunkt / Basis-URL",
  "key.optional": "(optional bei lokalen Modellen)",
  "note.ai_resume":
    "bereits bewertete Mails sind gespeichert; erneut klicken zum Fortsetzen",
  "filter.all": "Alle Bewertungen",
  "v.delete_safe": "sicher löschbar",
  "v.review": "prüfen",
  "v.keep": "behalten",
  "v.unrated": "unbewertet",
  "ratings.title": "KI-Bewertungen pro Mail (Gruppe öffnen für Details)",
  "page.of": "Seite {p} / {n}",
  "per page": "pro Seite",
  "All": "Alle",
  "Save": "Speichern",
  "Saved.": "Gespeichert.",
  "AI verdict cache cleared.": "KI-Bewertungscache geleert.",
  "Account profile": "Kontoprofil",
  "New": "Neu",
  "Delete…": "Löschen…",
  "Host": "Host",
  "IMAP port": "IMAP-Port",
  "SMTP port (unsubscribe mails)": "SMTP-Port (Abbestell-Mails)",
  "User": "Benutzer",
  "Password": "Passwort",
  "(unchanged)": "(unverändert)",
  "required": "erforderlich",
  "Folders to scan": "Zu scannende Ordner",
  "Load folders": "Ordner laden",
  "Excluded by rule:": "Durch Regel ausgeschlossen:",
  "Provider": "Anbieter",
  "Model": "Modell",
  "API key": "API-Schlüssel",
  "(no key — AI features hidden)": "(kein Schlüssel — KI ausgeblendet)",
  "Reset": "Zurücksetzen",
  "runs": "Läufe",
  "AI spend": "KI-Kosten",
  "IMAP (Proton Mail Bridge)": "IMAP (Proton Mail Bridge)",
  "AI review (optional)": "KI-Prüfung (optional)",
  "AI is reviewing this group…": "Die KI prüft diese Gruppe…",
  "Unsubscribing…": "Bestelle ab…",
  "Opened the sender's unsubscribe page — confirm it there.":
    "Abbestellseite des Absenders geöffnet — dort bestätigen.",
  "Unsubscribed": "Abbestellt",
  "search all scanned mails (subject / sender)…":
    "alle gescannten Mails durchsuchen (Betreff / Absender)…",
  "Search every scanned mail by subject or sender.":
    "Jede gescannte Mail nach Betreff oder Absender durchsuchen.",
  "Showing the newest 500 matches.": "Die neuesten 500 Treffer.",
  "Name for the new account profile:": "Name für das neue Kontoprofil:",
  "Export current grouping as CSV":
    "Aktuelle Gruppierung als CSV exportieren",
  "total": "gesamt",
  "Rules": "Regeln",
  "notice.rule_report":
    "Regel „{name}“ (Bericht): {groups} Gruppen · {mails} Mails wären "
    + "betroffen.",
  "notice.rule_executed":
    "Regel „{name}“ ausgeführt: {acted} Mails eingereiht ({groups} Gruppen).",
  "rules.help":
    "Eine Regel speichert einen Gruppenfilter (gleiche Syntax wie das "
    + "Filterfeld) plus eine Aktion. Neue Regeln BERICHTEN nur, was sie tun "
    + "würden; nach Prüfung eines Berichts kann auf Ausführen umgeschaltet "
    + "werden. Läufe sind auf 500 Mails begrenzt, geschützte Absender "
    + "werden übersprungen, alles landet wie üblich im Papierkorb/Undo.",
  "rules.empty": "Noch keine Regeln — unten eine anlegen.",
  "rule.never_ran": "noch nie gelaufen",
  "rule.run_report":
    "Bericht: {groups} Gruppen · {mails} Mails wären betroffen",
  "rule.run_executed":
    "ausgeführt: {acted} Mails eingereiht ({groups} Gruppen, {mails} Treffer)",
  "rule.capped": "{n} Mails über dem Limit pro Lauf",
  "rule.protected_skipped": "{n} geschützte übersprungen",
  "rule.run_now": "Jetzt ausführen",
  "rule.enable_execute": "Ausführen aktivieren",
  "rule.back_to_report": "Zurück zu Bericht",
  "rule.need_report": "Zuerst mindestens einen Bericht ausführen",
  "rule.confirm_execute": "Regel „{name}“ jetzt im AUSFÜHREN-Modus starten?",
  "rule.confirm_enable":
    "Regel „{name}“ auf AUSFÜHREN umschalten? Geplante Läufe verarbeiten "
    + "dann passende Mails (max. 500 pro Lauf, geschützte Absender "
    + "übersprungen, Undo verfügbar).",
  "rule.confirm_delete": "Regel „{name}“ löschen?",
  "rule.edit_title": "Regel bearbeiten",
  "rule.new_title": "Neue Regel",
  "rule.name": "Regelname",
  "rule.create": "Anlegen (Bericht-Modus)",
  "rule.match_count":
    "trifft aktuell {groups} Gruppen · {mails} Mails (ohne geschützte)",
  "rule.match_unknown": "Für Live-Trefferzahlen zuerst scannen",
  "action.trash": "In den Papierkorb",
  "action.archive": "Archivieren",
  "action.move": "In Ordner verschieben",
  "action.mark_read": "Als gelesen markieren",
  "sched.manual": "manuell",
  "sched.daily": "täglich",
  "sched.weekly": "wöchentlich",
  "mode.report": "Bericht",
  "mode.execute": "Ausführen",
  "Edit": "Bearbeiten",
  "Delete": "Löschen",
  "Attachments": "Anhänge",
  "notice.atts_cancelled": "Anhang-Analyse abgebrochen.",
  "atts.hint":
    "Finden Sie die Mails, die Ihren Speicher belegen. Die Analyse liest "
    + "nur die Mail-Struktur (keine Inhalte werden geladen).",
  "atts.summary": "{n} Mails mit Anhängen · {size} gesamt",
  "atts.analyze": "Anhänge analysieren",
  "atts.reanalyze": "Neu analysieren",
  "atts.intro":
    "Analyse starten, um Mails nach Anhanggröße zu listen. Danach "
    + "funktioniert auch der Filter att:>10m auf Gruppen. Proton kann per "
    + "IMAP keine einzelnen Anhänge entfernen — Löschen entfernt die ganze "
    + "Mail (rückgängig machbar).",
  "atts.none": "Keine Anhänge in den gescannten Ordnern gefunden.",
  "Duplicates": "Duplikate",
  "dups.hint":
    "Gleiche Message-ID oder identischer Absender + Betreff + Größe.",
  "dups.summary": "{n} Duplikat-Gruppen · {size} freigebbar",
  "dups.keep_newest": "Alle außer der neuesten auswählen",
  "dups.wasted": "{size} freigebbar",
  "dups.newest": "neueste",
  "dups.none": "Keine Duplikate gefunden — schön aufgeräumt.",
};

let lang: Lang =
  (typeof localStorage !== "undefined" &&
    (localStorage.getItem("pmc_lang") as Lang)) || "en";

export const getLang = (): Lang => lang;

export function setLang(next: Lang): void {
  lang = next;
  localStorage.setItem("pmc_lang", next);
}

export function t(key: string,
                  params?: Record<string, string | number>): string {
  let s = (lang === "de" ? DE[key] : undefined) ?? EN[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}
