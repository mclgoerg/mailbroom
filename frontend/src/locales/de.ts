/* German translations. To add a language: copy this file, translate
 * the values, and register it in ../i18n.ts. */

export const DE: Record<string, string> = {
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
  "Mail server (IMAP)": "Mailserver (IMAP)",
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
  "atts.running": "Analysiere Anhänge…",
  "Starting…": "Starte…",
  "Duplicates": "Duplikate",
  "dups.hint":
    "Gleiche Message-ID oder identischer Absender + Betreff + Größe.",
  "dups.summary": "{n} Duplikat-Gruppen · {size} freigebbar",
  "dups.keep_newest": "Alle außer der neuesten auswählen",
  "dups.wasted": "{size} freigebbar",
  "dups.newest": "neueste",
  "dups.none": "Keine Duplikate gefunden — schön aufgeräumt.",
  "Statistics": "Statistik",
  "stats.this_month": "diesen Monat gelöscht: {n} Mails · {size}",
  "stats.per_year": "Mails pro Jahr",
  "stats.per_month": "Mails pro Monat (letzte 12)",
  "stats.total_size": "Gesamtgröße",
  "stats.senders": "Absender",
  "stats.avg_size": "Ø Mailgröße",
  "stats.unread": "ungelesen",
  "stats.newsletters": "Newsletter",
  "stats.replied_senders": "Absender mit Antwort (von {total})",
  "stats.oldest": "älteste Mail",
  "stats.categories": "Nach Kategorie",
  "stats.top_senders": "Top-Absender nach Anzahl",
  "stats.ai": "KI-Bewertungen (Absender-Gruppen)",
  "stats.rated_mails":
    "· {n} Mails einzeln bewertet ({safe} sicher löschbar)",
  "stats.top_domains": "Top-Domains nach Größe",
  "stats.cleanup": "Aufräumen pro Monat",
  "stats.actions_line":
    "{trash} gelöscht ({size}) · {archive} archiviert · {move} verschoben "
    + "· {read} gelesen markiert",
  "stats.scans": "Letzte Scans",
  "sieve.button": "Sieve-Filter",
  "sieve.intro":
    "Künftige Mails dieses Absenders automatisch in Proton behandeln:",
  "sieve.fileinto": "In Ordner verschieben",
  "sieve.discard": "Bei Empfang löschen",
  "sieve.markread": "Als gelesen markieren",
  "sieve.copied":
    "Sieve-Filter kopiert — in Protons Filter-Einstellungen einfügen.",
  "sieve.open_proton": "Proton-Filtereinstellungen ↗",
  "Copy": "Kopieren",
  "notice.trash_restored":
    "{n} Mails aus dem Papierkorb nach {dest} wiederhergestellt.",
  "trash.browse": "Papierkorb durchsuchen",
  "trash.search": "Betreff / Absender suchen…",
  "trash.restore_to": "Wiederherstellen nach…",
  "trash.restored":
    "{n} Mails wiederhergestellt — zum Anzeigen neu scannen.",
  "trash.newest_shown": "neueste {n} angezeigt",
  "trash.empty": "Der Papierkorb ist leer.",
  "notice.ai_budget":
    "KI-Prüfung nach {done}/{total} Gruppen gestoppt — Monatsbudget "
    + "erreicht (in den Einstellungen erhöhen).",
  "budget.label": "Monatliches KI-Budget ($, 0 = unbegrenzt)",
  "budget.none": "kein Limit",
  "budget.month": "diesen Monat ausgegeben: {spent}",
  "Custom categories": "Eigene Kategorien",
  "categories.help":
    "Eine Kategorie pro Zeile: „name: stichwort1, stichwort2“. Ein Name "
    + "einer eingebauten Kategorie (shipping, finance, shopping, social, "
    + "travel, dev/cloud) ersetzt deren Stichwörter; eine leere Liste "
    + "deaktiviert sie; neue Namen ergänzen Kategorien. Gilt ab dem "
    + "nächsten Scan.",
  "Export": "Exportieren",
  "Import…": "Importieren…",
  "export.tip":
    "Einstellungen, Regeln, KI-Bewertungen und Antwort-Cache "
    + "herunterladen (Passwörter und API-Schlüssel nie enthalten)",
  "import.confirm":
    "Dieses Backup importieren? Einstellungen werden überschrieben, "
    + "Regeln ersetzt (wieder im Bericht-Modus), Bewertungen und "
    + "Antwortdaten zusammengeführt. Passwörter/API-Schlüssel werden nie "
    + "importiert.",
  "import.done": "Importiert: {rules} Regeln, {verdicts} Bewertungen.",
  "no.matches": "Keine Gruppen passen zu diesem Filter.",
  "onboard.title": "Willkommen — in drei Schritten zum sauberen Postfach",
  "onboard.step_bridge":
    "Mail-Anbieter wählen (Gmail, iCloud, Fastmail, … — oder Proton über "
    + "die Proton Mail Bridge; Hinweise pro Anbieter und das "
    + "Bridge-Docker-Setup stehen im README).",
  "onboard.step_creds":
    "Anbieter-Preset wählen und Host, Benutzer und Passwort eintragen "
    + "(die meisten Anbieter brauchen ein App-Passwort) unter",
  "onboard.step_scan":
    "Auf Scannen klicken — gelöscht wird nur nach Bestätigung, und "
    + "Löschungen landen zuerst im Papierkorb.",
  "onboard.test": "Verbindung testen",
  "onboard.testing": "Teste Verbindung…",
  "onboard.test_ok": "Verbunden — {n} Ordner sichtbar. Bereit zum Scannen!",
  "onboard.test_fail": "Verbindung fehlgeschlagen",
  "notify.toggle":
    "Desktop-Benachrichtigungen, wenn Hintergrundjobs fertig sind (nur "
    + "bei Tab im Hintergrund)",
  "notify.denied": "Benachrichtigungen wurden vom Browser blockiert.",
  "notify.delete_done": "Fertig: {n} Mails verarbeitet.",
  "notify.ai_done": "KI-Prüfung abgeschlossen.",
  "notify.atts_done": "Anhang-Analyse abgeschlossen.",
  "preset.label": "Anbieter-Preset (füllt die Felder unten vor)",
  "preset.hint.proton":
    "Proton braucht die Mail Bridge (Bezahltarife): IMAP-Modus auf SSL "
    + "stellen, Zertifikat exportieren und als CA-Datei eintragen — "
    + "siehe README.",
  "preset.hint.apppw":
    "App-spezifisches Passwort verwenden, nicht das normale "
    + "Konto-Passwort — anlegen in den Sicherheitseinstellungen des "
    + "Anbieters (Links im README).",
  "preset.hint.imap_toggle":
    "IMAP muss zuerst in den Mail-Einstellungen des Anbieters aktiviert "
    + "werden; bei Zwei-Faktor-Authentifizierung App-Passwort verwenden.",
  "imap.security": "IMAP-Verschlüsselung",
  "smtp.host": "SMTP-Host (Abbestell-Mails)",
  "smtp.host_placeholder": "leer = IMAP-Host",
  "smtp.security": "SMTP-Verschlüsselung",
  "sec.auto": "automatisch",
  "cafile.label": "Eigene CA-Datei (optional, z.\u202fB. das Bridge-Zertifikat)",
  "folder.role_excluded":
    "Spezialordner (per Rolle erkannt) — wird nie mitgescannt",
};
