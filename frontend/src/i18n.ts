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
    + "mail counts, sizes, dates, read state, category tags and subject "
    + "lines. Mail bodies and attachments are NEVER sent. Continue?",
  "ai.data_note":
    "Sent to the AI provider: sender names/addresses, counts, sizes, "
    + "dates, read state, tags and subject lines — never mail bodies or "
    + "attachments.",
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
    + "und -adressen, Anzahl, Größen, Daten, Lesestatus, Kategorien und "
    + "Betreffzeilen. Mail-Inhalte und Anhänge werden NIE gesendet. "
    + "Fortfahren?",
  "ai.data_note":
    "An den KI-Anbieter gesendet: Absendernamen/-adressen, Anzahl, "
    + "Größen, Daten, Lesestatus, Kategorien und Betreffzeilen — niemals "
    + "Mail-Inhalte oder Anhänge.",

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
