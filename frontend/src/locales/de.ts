/* German translations. To add a language: copy this file, translate
 * the values, and register it in ../i18n.ts. */

export const DE: Record<string, string> = {
  "notice.scan_cancelled": "Scan abgebrochen.",
  "notice.action_cancelled": "Aktion abgebrochen.",
  "notice.cached_verdicts":
    "{n} zwischengespeicherte KI-Bewertungen übernommen (die KI-Prüfung bewertet nur neue Gruppen).",
  "notice.restored":
    "{restored} von {of} Mails wiederhergestellt ({label}).",
  "notice.restored_rescan":
    "{restored} von {of} Mails wiederhergestellt ({label}) - zum Anzeigen neu scannen.",
  "notice.emptied_trash":
    "Papierkorb geleert ({count} Mails endgültig gelöscht).",
  "notice.ai_all_cached":
    "Alle Gruppen haben bereits KI-Bewertungen - nichts zu prüfen.",
  "notice.ai_cancelled": "KI-Prüfung nach {done}/{total} Gruppen abgebrochen.",
  "confirm.act": "{verb}: {n} Mails aus {k} Gruppe(n)?",
  "confirm.act_mails": "{verb}: {n} ausgewählte Mails?",
  "confirm.unsubscribe":
    "Von den Absendern in {k} ausgewählten Gruppe(n) abbestellen?",
  "confirm.restore": "{count} Mails wiederherstellen ({label})?",
  "confirm.empty_trash":
    "Alle {n} Mails im Papierkorb ENDGÜLTIG löschen? Das kann nicht rückgängig gemacht werden.",
  "confirm.clear_verdicts": "Alle gespeicherten KI-Bewertungen löschen?",
  "confirm.reset_spend": "KI-Kostenzähler zurücksetzen?",
  "confirm.switch_profile":
    "Zum Kontoprofil „{name}“ wechseln? Danach neu scannen.",
  "note.ai_selected": "{note} - {n}/{of} ausgewählt",
  "note.ai_truncated": " (nur die ersten {n} Mails)",
  "note.background": "{verb} - läuft im Hintergrund…",
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
    + "haben - niemals Mail-Inhalte oder Anhänge.",
  "replied": "geantwortet",
  "replied.tip":
    "Sie haben diesem Absender schon geschrieben (aus Ihrem "
    + "Gesendet-Ordner ermittelt)",
  "new_sender.tip":
    "Kürzlich erstmals gesehen - nur ein Hinweis, es wurde automatisch "
    + "nichts unternommen",
  "chip.new_count": "Neu ({n})",
  "confirm.trash_protected":
    "Die Gruppe „{label}“ ist geschützt. Mails trotzdem in den "
    + "Papierkorb verschieben?",
  "confirm.protected_skipped": "({n} geschützte Gruppe(n) übersprungen.)",
  "toast.all_protected":
    "Alle ausgewählten Gruppen sind geschützt - nichts wurde gelöscht.",
  "pin.group_on": "Alle Mails dieser Gruppe schützen",
  "pin.group_off": "Schutz aller Mails aufheben",
  "pin.group_skipped":
    "{n} Mail(s) ohne Message-ID konnten nicht geschützt werden.",
  "confirm.unpin_group":
    "Den Schutz aller {n} geschützten Mail(s) dieser Gruppe aufheben?",
  "Sort: engagement": "Sortierung: Interaktion",
  "Eng.": "Inter.",
  "eng.col_tip":
    "Interaktion: wie viel du von diesem Absender wirklich liest und "
    + "beantwortest",
  "eng.popover_title": "Interaktions-Wert {score}/100 · {tier}",
  "eng.tip": "Interaktion {score}/100 ({tier}): {parts}",
  "eng.low": "niedrig",
  "eng.medium": "mittel",
  "eng.high": "hoch",
  "eng.read": "{n}% gelesen",
  "eng.replied": "geantwortet",
  "eng.never_replied": "nie geantwortet",
  "eng.bulk": "Newsletter/Massenmail",
  "eng.last": "letzte Mail {year}",
  "qb.eng_low": "kaum Interaktion",
  "qb.eng_medium": "teils Interaktion",
  "qb.eng_high": "oft Interaktion",
  "bar.all_pinned": "alles geschützt - nichts zu verschieben",
  "toast.all_pinned":
    "Alle ausgewählten Mails sind geschützt - nichts wurde geändert.",
  "confirm.pinned_skipped": "({n} geschützte Mail(s) übersprungen.)",
  "confirm.pinned_kept": "({n} geschützte Mail(s) bleiben unberührt.)",
  "confirm.act_pinned_mail":
    "{verb}: die geschützte Mail „{subject}“? Geschützte Mails sind von "
    + "Sammelaktionen ausgenommen - dies hebt ihren Schutz ausdrücklich auf.",
  "pin.protect_tip":
    "Diese Mail schützen - keine Sammelaktion, Regel oder KI-Auswahl "
    + "verschiebt sie",
  "pin.unprotect_tip": "Schutz dieser Mail aufheben",
  "pin.badge_tip": "{n} Mail(s) vor Sammelaktionen geschützt",
  "pin.n_protected": "{n} Mail(s) geschützt",
  "pin.error": "Schutz der Mail konnte nicht geändert werden",
  "pin.no_message_id":
    "Diese Mail hat keine Message-ID und ließe sich nach einem erneuten "
    + "Scan nicht wiedererkennen - sie kann nicht geschützt werden.",
  "pin.refused":
    "Die Auswahl enthält geschützte Mails - bestätige sie einzeln oder "
    + "hebe zuerst ihren Schutz auf.",
  "rule.pinned_skipped": "{n} geschützte Mails übersprungen",
  "qb.has_pinned": "mit geschützten Mails",
  "confirm.block":
    "„{label}“ blockieren? Dies legt eine dauerhafte Regel an, die "
    + "künftige Mails täglich automatisch in den Papierkorb verschiebt - "
    + "umkehrbar durch Löschen der Regel in Regeln.",
  "confirm.block_trash_existing":
    "Auch die {n} vorhandene(n) Mail(s) jetzt in den Papierkorb "
    + "verschieben?",
  "toast.blocked": "„{label}“ blockiert.",
  "block.tip":
    "Diesen Absender/diese Domain blockieren: legt eine dauerhafte Regel "
    + "an, die künftige Mails automatisch in den Papierkorb verschiebt",
  "Block": "Blockieren",
  "Blocked": "Blockiert",
  "confirm.unblock":
    "„{label}“ entblocken? Dies löscht die dauerhafte Regel - künftige "
    + "Mails werden nicht mehr automatisch in den Papierkorb verschoben.",
  "toast.unblocked": "„{label}“ entblockt.",
  "unblock.tip":
    "Entblocken: löscht die von Blockieren angelegte dauerhafte Regel",
  "Unblock": "Entblocken",
  "protect.tip":
    "Diesen Absender schützen - Massenlöschungen und KI-Vorschläge "
    + "überspringen ihn",
  "unprotect.tip": "Geschützt - klicken, um den Schutz aufzuheben",
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
  "Thread": "Konversation",
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
  "Sort: date": "Sortierung: Datum",
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
  "No scan yet - hit “Scan”.": "Noch kein Scan - auf „Scannen“ klicken.",
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
  "sel.unsub_pending": "Noch nicht abbestellt",
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
  "(no key - AI features hidden)": "(kein Schlüssel - KI ausgeblendet)",
  "Reset": "Zurücksetzen",
  "runs": "Läufe",
  "AI spend": "KI-Kosten",
  "Mail server (IMAP)": "Mailserver (IMAP)",
  "AI review (optional)": "KI-Prüfung (optional)",
  "AI is reviewing this group…": "Die KI prüft diese Gruppe…",
  "Unsubscribing…": "Bestelle ab…",
  "Opened the sender's unsubscribe page - confirm it there.":
    "Abbestellseite des Absenders geöffnet - dort bestätigen.",
  "Unsubscribed": "Abbestellt",
  "Marked as unsubscribed.": "Als abbestellt markiert.",
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
  "rules.empty": "Noch keine Regeln - unten eine anlegen.",
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
  "retention.none": "Alle Mails",
  "retention.keep_latest": "Neueste N behalten, Rest bearbeiten",
  "retention.older_than_days": "Nur Mails älter als N Tage",
  "retention.n_placeholder": "N",
  "retention.help":
    "Beschränkt diese Aktion auf Mails jenseits eines Aufbewahrungsfensters "
    + "statt auf jede Mail der ausgewählten Gruppen.",
  "retention.tag_keep_latest": "neueste {n} behalten",
  "retention.tag_older_than_days": "älter als {n}T",
  "saved_filter.save_tip": "Aktuellen Filter als Vorlage speichern",
  "saved_filter.name_prompt": "Name für diese Vorlage",
  "saved_filter.edit_tip": "Filter dieser Vorlage bearbeiten",
  "saved_filter.editing": '„{name}“ wird bearbeitet',
  "saved_filter.confirm_delete": 'Vorlage "{name}" löschen?',
  "Clear filter": "Filter leeren",
  "Edit": "Bearbeiten",
  "Delete": "Löschen",
  "Attachments": "Anhänge",
  "notice.atts_cancelled": "Anhang-Analyse abgebrochen.",
  "notice.unsub_cancelled": "Abbestellen abgebrochen.",
  "atts.hint":
    "Finden Sie die Mails, die Ihren Speicher belegen. Die Analyse liest "
    + "nur die Mail-Struktur (keine Inhalte werden geladen).",
  "atts.summary": "{n} Mails mit Anhängen · {size} gesamt",
  "atts.analyze": "Anhänge analysieren",
  "atts.reanalyze": "Neu analysieren",
  "atts.intro":
    "Analyse starten, um Mails nach Anhanggröße zu listen. Danach "
    + "funktioniert auch der Filter att:>10m auf Gruppen. Proton kann per "
    + "IMAP keine einzelnen Anhänge entfernen - Löschen entfernt die ganze "
    + "Mail (rückgängig machbar).",
  "atts.none": "Keine Anhänge in den gescannten Ordnern gefunden.",
  "atts.running": "Analysiere Anhänge…",
  "unsub.running": "Bestelle ab…",
  "unsub.done":
    "Abbestellen fertig: {done} erledigt, {links} brauchen Bestätigung, "
    + "{failed} fehlgeschlagen.",
  "unsub.open_link": "Abbestellseite öffnen",
  "unsub.badge_link": "Bestätigen ↗",
  "unsub.mark_done": "Als erledigt markieren",
  "unsub.retry": "Erneut versuchen",
  "unsub.badge_pending": "{n}/{of} abbestellt",
  "unsub.badge_failed": "Abbestellen fehlgeschlagen",
  "toast.unsub_started": "Bestelle bei {n} Absender(n) ab…",
  "toast.unsub_skipped":
    "({n} bereits erledigt, geschützt oder über dem Limit pro Lauf.)",
  "toast.unsub_nothing":
    "Nichts abzubestellen - alle Absender sind bereits erledigt oder "
    + "geschützt.",
  "Starting…": "Starte…",
  "Duplicates": "Duplikate",
  "dups.hint":
    "Gleiche Message-ID oder identischer Absender + Betreff + Größe.",
  "dups.summary": "{n} Duplikat-Gruppen · {size} freigebbar",
  "dups.keep_newest": "Alle außer der neuesten auswählen",
  "dups.wasted": "{size} freigebbar",
  "dups.newest": "neueste",
  "dups.none": "Keine Duplikate gefunden - schön aufgeräumt.",
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
    "Sieve-Filter kopiert - in Protons Filter-Einstellungen einfügen.",
  "sieve.open_proton": "Proton-Filtereinstellungen ↗",
  "Copy": "Kopieren",
  "notice.trash_restored":
    "{n} Mails aus dem Papierkorb nach {dest} wiederhergestellt.",
  "notice.trash_restored_rescan":
    "{n} Mails aus dem Papierkorb nach {dest} wiederhergestellt - zum Anzeigen neu scannen.",
  "trash.browse": "Papierkorb durchsuchen",
  "trash.search": "Betreff / Absender suchen…",
  "trash.restore_to": "Wiederherstellen nach…",
  "trash.restored":
    "{n} Mails wiederhergestellt - zum Anzeigen neu scannen.",
  "trash.restored_refreshing":
    "{n} Mails wiederhergestellt - die Ansichten aktualisieren sich automatisch.",
  "trash.newest_shown": "neueste {n} angezeigt",
  "trash.empty": "Der Papierkorb ist leer.",
  "notice.ai_budget":
    "KI-Prüfung nach {done}/{total} Gruppen gestoppt - Monatsbudget "
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
  "new_sender.window_label": "„Neu“-Fenster für Absender (Tage)",
  "new_sender.window_help":
    "Wie viele Tage ein Absender als „Neu“ markiert bleibt (is:new, das "
    + "Neu-Abzeichen), nachdem er erstmals in einem Scan gesehen wurde.",
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
  "view.all_mails": "Alle Mails",
  "mails.sort_date": "Datum",
  "mails.sort_size": "Größe",
  "mails.sort_sender": "Absender",
  "mails.filter": "Mails filtern…",
  "mails.filter_tip":
    "Einfache Wörter treffen Absender oder Betreff. Außerdem: "
    + "from:adresse domain:example.com folder:name age:>1y size:>1m "
    + "att:>1m is:unread is:read has:pinned",
  "mails.count": "{n} von {total} Mails",
  "mails.select_loaded": "Geladene auswählen ({n})",
  "mails.ignored":
    "Für einzelne Mails nicht angewendet: {list} (diese Filter gelten nur "
    + "für Gruppen).",
  "mails.load_more": "{n} weitere laden",
  "mails.none": "Keine Mails passen zu diesem Filter.",
  "no.matches": "Keine Gruppen passen zu diesem Filter.",
  "onboard.title": "Willkommen - in drei Schritten zum sauberen Postfach",
  "onboard.step_bridge":
    "Mail-Anbieter wählen (Gmail, iCloud, Fastmail, … - oder Proton über "
    + "die Proton Mail Bridge; Hinweise pro Anbieter und das "
    + "Bridge-Docker-Setup stehen im README).",
  "onboard.step_creds":
    "Anbieter-Preset wählen und Host, Benutzer und Passwort eintragen "
    + "(die meisten Anbieter brauchen ein App-Passwort) unter",
  "onboard.step_scan":
    "Auf Scannen klicken - gelöscht wird nur nach Bestätigung, und "
    + "Löschungen landen zuerst im Papierkorb.",
  "onboard.test": "Verbindung testen",
  "onboard.testing": "Teste Verbindung…",
  "onboard.test_ok": "Verbunden - {n} Ordner sichtbar. Bereit zum Scannen!",
  "onboard.test_fail": "Verbindung fehlgeschlagen",
  "notify.toggle":
    "Desktop-Benachrichtigungen, wenn Hintergrundjobs fertig sind (nur "
    + "bei Tab im Hintergrund)",
  "notify.denied": "Benachrichtigungen wurden vom Browser blockiert.",
  "notify.delete_done": "Fertig: {n} Mails verarbeitet.",
  "notify.ai_done": "KI-Prüfung abgeschlossen.",
  "notify.atts_done": "Anhang-Analyse abgeschlossen.",
  "notify.unsub_done": "Massenabbestellen abgeschlossen.",
  "preset.label": "Anbieter-Preset (füllt die Felder unten vor)",
  "preset.hint.proton":
    "Proton braucht die Mail Bridge (Bezahltarife): IMAP-Modus auf SSL "
    + "stellen, Zertifikat exportieren und als CA-Datei eintragen - "
    + "siehe README.",
  "preset.hint.apppw":
    "App-spezifisches Passwort verwenden, nicht das normale "
    + "Konto-Passwort - anlegen in den Sicherheitseinstellungen des "
    + "Anbieters (Links im README).",
  "preset.hint.imap_toggle":
    "IMAP muss zuerst in den Mail-Einstellungen des Anbieters aktiviert "
    + "werden; bei Zwei-Faktor-Authentifizierung App-Passwort verwenden.",
  "preset.hint.oauth_gmail":
    "Gmail verbindet hier nur per OAuth (unten) - eigenen, kostenlosen "
    + "Google-OAuth-Client registrieren, siehe Installationsanleitung.",
  "preset.hint.oauth_outlook_device":
    "Outlook verbindet hier nur per OAuth (unten) - keine Einrichtung "
    + "nötig, siehe Installationsanleitung.",
  "preset.hint.oauth_outlook_byo":
    "Outlook verbindet hier nur per OAuth (unten) - eigenen "
    + "OAuth-Client in Entra ID registrieren, siehe "
    + "Installationsanleitung.",
  "imap.security": "IMAP-Verschlüsselung",
  "smtp.host": "SMTP-Host (Abbestell-Mails)",
  "smtp.host_placeholder": "leer = IMAP-Host",
  "smtp.security": "SMTP-Verschlüsselung",
  "sec.auto": "automatisch",
  "cafile.label": "Eigene CA-Datei (optional, z.\u202fB. das Bridge-Zertifikat)",
  "oauth.title": "{provider}-Konto per OAuth verbinden",
  "oauth.client_id": "Client-ID",
  "oauth.client_secret": "Client-Secret",
  "oauth.google_help":
    "Client-ID und Client-Secret deines Google-OAuth-Clients unten "
    + "eintragen, dann auf Verbinden klicken (Einrichtung siehe "
    + "Installationsanleitung). Ein Client im Testmodus stellt ein "
    + "Refresh-Token aus, das nach 7 Tagen abl\u00e4uft - f\u00fcr "
    + "unbegrenzte G\u00fcltigkeit bei Google die Verifizierung beantragen.",
  "oauth.ms_device_help":
    "Keine App-Registrierung n\u00f6tig: unten klicken, dann den "
    + "angezeigten Code auf microsoft.com/devicelogin auf einem "
    + "beliebigen Ger\u00e4t eingeben.",
  "oauth.ms_byo_help":
    "Client-ID deiner Entra-ID-App unten eintragen, dann auf Verbinden "
    + "klicken (Einrichtung siehe Installationsanleitung) - ein "
    + "\u00f6ffentlicher Client ben\u00f6tigt kein Secret.",
  "oauth.connect": "Konto verbinden",
  "oauth.connect_device": "Mit Ger\u00e4tecode verbinden",
  "oauth.connected": "Verbunden",
  "oauth.disconnect": "Trennen",
  "oauth.confirm_disconnect":
    "Dieses Konto von OAuth trennen? Eine erneute Verbindung ist "
    + "jederzeit m\u00f6glich.",
  "oauth.device_instructions":
    "Den folgenden Link auf einem beliebigen Ger\u00e4t \u00f6ffnen und diesen "
    + "Code eingeben:",
  "folder.role_excluded":
    "Spezialordner (per Rolle erkannt) - wird nie mitgescannt",
  "account.label": "Zu bearbeitendes Konto",
  "account.add": "Konto hinzufügen",
  "account.hint":
    "Jedes Konto wird getrennt gescannt und aufgeräumt - Ansichten "
    + "vermischen sich nie. Bei mehreren Konten oben im Kopf umschalten.",
  "account.new_prompt": "Name für das neue Konto (z. B. \"gmail\"):",
  "account.confirm_delete":
    'Konto "{name}" entfernen? Seine Regeln behalten den Kontonamen und '
    + "laufen nicht mehr; Mails auf dem Server bleiben unangetastet.",
  "menu.accounts": "Konten",
  "update.available": "Eine neue Version von Mailbroom ist verfügbar.",
  "update.reload": "Neu laden",
  "menu.version": "v{version} (Build {id})",
  "scan.age": "gescannt vor {ago}",
  "login.section": "Anmeldung (optional)",
  "login.help":
    "Schützt die API mit einem Login. \"Keine\" vertraut dem Netzwerk "
    + "bzw. einer Reverse-Proxy-Anmeldung (wie bisher). Passwort = ein "
    + "gemeinsames Passwort. SSO/OIDC = Anmeldung über einen "
    + "OpenID-Connect-Anbieter (Pocket ID, Authentik, Keycloak, …); die "
    + "App dort vorher mit der Callback-URL <origin>/api/oidc/callback "
    + "registrieren.",
  "login.mode": "Anmeldemethode",
  "login.mode_none": "Keine (Reverse Proxy / vertrautes Netz)",
  "login.mode_password": "Passwort",
  "login.mode_oidc": "SSO (OpenID Connect)",
  "login.password_label": "Anmelde-Passwort",
  "login.oidc_issuer": "Issuer-URL",
  "login.oidc_client": "Client-ID",
  "login.oidc_secret": "Client-Secret",
  "login.oidc_redirect": "Redirect-Basis-URL (optional)",
  "login.oidc_redirect_ph": "automatisch: aus den Request-Headern",
  "login.oidc_allowed": "Erlaubte Nutzer (eine E-Mail/Subject pro Zeile)",
  "login.oidc_allowed_help":
    "Leere Liste = jedes Konto, das der Identity Provider anmeldet, darf "
    + "die App nutzen. Mit Einträgen kommen nur diese E-Mails/Subjects "
    + "hinein.",
  "login.submit": "Anmelden",
  "login.sso": "Mit SSO anmelden",
  "login.logout": "Abmelden",
  "login.admin_tip": "Admin - verwaltet die Server-Einstellungen",
  "menu.profile": "Profil & Einstellungen",
  "tab.account": "Mail-Konto",
  "tab.general": "Allgemein",
  "tab.ai": "AI",
  "tab.server": "Server (Admin)",
  "menu.theme": "Zu {next}em Design wechseln",
  "menu.light": "hell",
  "menu.dark": "dunkl",
  "login.oidc_admin": "Admin-Identität (E-Mail oder Subject)",
  "login.oidc_admin_ph": "leer: erste Anmeldung übernimmt sie",
  "login.tenancy_note":
    "Mit SSO bekommt jeder Nutzer einen EIGENEN Arbeitsbereich (Konten, "
    + "Scans, Einstellungen). Der Admin behält diesen hier.",
  "shared.section": "Gemeinsamer AI-Schlüssel (alle Nutzer)",
  "shared.help":
    "Optional einen serverseitigen AI-Schlüssel teilen: Nutzer ohne "
    + "eigenen Schlüssel verwenden ihn automatisch, begrenzt pro Nutzer "
    + "und Monat durch das Standard-Budget unten (Nutzer dürfen ihr "
    + "Limit senken, nie erhöhen).",
  "shared.enabled": "Diesen Schlüssel mit allen Nutzern teilen",
  "shared.budget": "Standard-Monatsbudget pro Nutzer ($)",
  "ai.shared_key_ph": "nutzt den gemeinsamen Server-Schlüssel",
  "usage.section": "Nutzerstatistik",
  "usage.help":
    "Nutzung pro Arbeitsbereich - nur Zahlen, AI-Kosten und "
    + "Speicherplatz. Mailbroom zeigt dir nie Maildaten, Kontonamen "
    + "oder Absender anderer Nutzer.",
  "usage.user": "Nutzer / Arbeitsbereich",
  "usage.mails": "Mails (letzter Scan)",
  "usage.cleaned": "Aufgeräumt (Monat)",
  "usage.ai_month": "AI-Kosten (Monat)",
  "usage.last_scan": "Letzter Scan",
  "usage.disk": "Speicher",
  "usage.shared": "geteilter Schlüssel",
  "sort.desc_tip": "Absteigend sortiert - Klick für aufsteigend",
  "sort.asc_tip": "Aufsteigend sortiert - Klick für absteigend",
  "qb.tip": "Filter zusammenklicken statt Syntax merken",
  "qb.title": "Filter-Baukasten",
  "qb.hint": "jede hinzugefügte Bedingung muss AUCH zutreffen (UND)",
  "qb.add": "Hinzufügen",
  "qb.clear": "Leeren",
  "qb.done": "Fertig",
  "qb.tag": "Kategorie",
  "qb.ai": "AI-Urteil",
  "qb.ai_safe": "sicher löschbar",
  "qb.ai_review": "prüfen",
  "qb.ai_keep": "behalten",
  "qb.age": "Älter als",
  "qb.months": "Monate",
  "qb.years": "Jahre",
  "qb.unread": "Ungelesen ≥",
  "qb.att": "Anhänge ≥",
  "qb.flags": "Nur Gruppen…",
  "qb.is_unsub": "mit Abmeldelink",
  "qb.is_unsubscribed": "vollständig abbestellt",
  "qb.is_not_unsubscribed": "noch nicht abbestellt",
  "qb.is_noreply": "nie geantwortet",
  "qb.is_replied": "geantwortet",
  "qb.is_protected": "geschützt",
  "qb.is_new": "neue Absender",
  "ai.shared_note":
    "Kein eigener Schlüssel - AI läuft über den gemeinsamen "
    + "Server-Schlüssel (dein Monatslimit: {cap}).",
  "account.rename": "Umbenennen…",
  "account.rename_prompt": 'Neuer Name für Konto "{name}":',
  "account.renamed": 'Konto umbenannt in "{name}".',
  "folders.title": "Zu scannende Ordner - Konto \u201e{name}\u201c",
  "folders.discover": "Erkennen",
  "folders.discover_tip":
    "Ordnerliste dieses Kontos neu vom Server laden (nutzt die "
    + "GESPEICHERTEN Zugangsdaten - neue erst speichern)",
  "folders.err_hint":
    "- die Ordner-Erkennung braucht gespeicherte, funktionierende "
    + "Zugangsdaten für dieses Konto; erst speichern, dann Erkennen.",
  "digest.title": "Aktivitäts-Übersicht per E-Mail",
  "digest.schedule": "Zeitplan",
  "digest.off": "Aus",
  "digest.recipient": "Empfänger",
  "digest.recipient_placeholder": "eigene Adresse dieses Kontos",
  "digest.time": "Uhrzeit (24h, lokale Zeit des Servers)",
  "digest.help":
    "Eine Zusammenfassung dessen, was Mailbroom für dieses Konto seit "
    + "der letzten Übersicht getan hat - durchgeführte Aktionen, "
    + "freigewordene Mails/Speicherplatz, Regel-Vorschauen (Treffer von "
    + "Regeln, die noch im Berichtsmodus laufen, also noch nicht "
    + "angewendet wurden) und Abbestell-Ergebnisse. Entfällt komplett, "
    + "wenn nichts passiert ist.",
  "digest.send_test": "Test-Übersicht senden",
  "digest.test_sent": "Gesendet!",
  "digest.test_sent_demo":
    "Vorschau mit Beispieldaten gesendet (es gibt noch nichts echtes zu "
    + "berichten) - zählt nicht als echte Übersicht.",
  "auto_scan.title": "Automatisches Scannen",
  "auto_scan.enabled": "Aktiviert",
  "auto_scan.on": "An",
  "auto_scan.every": "Alle",
  "auto_scan.unit_minutes": "Minuten",
  "auto_scan.unit_hours": "Stunden",
  "search.placeholder_body": "Betreff, Absender und Mailtext durchsuchen…",
  "search.body_toggle": "Auch im Mailtext suchen",
  "search.body_hint":
    "Die Suche im Mailtext fragt Ihren Mailserver und kann einen "
    + "Moment dauern.",
  "search.note.partial":
    "Nicht alle Ordner wurden rechtzeitig durchsucht - die Treffer sind "
    + "evtl. unvollständig.",
  "search.note.folder_failed":
    "„{folder}“ konnte nicht durchsucht werden - übersprungen.",
  "search.note.stale_folder":
    "„{folder}“ hat sich seit dem letzten Scan geändert - zum Einbeziehen "
    + "neu scannen.",
  "search.note.charset_fallback":
    "Dieser Server unterstützt keine UTF-8-Suche - Umlaute und andere "
    + "Sonderzeichen werden evtl. nicht gefunden.",
  "body_search.title": "Mailtext-Suche",
  "body_search.label": "Im Mailtext suchen",
  "body_search.server": "Mailserver fragen",
  "body_search.disabled": "Aus (nur Betreff und Absender)",
  "body_search.help":
    "Die Mailtext-Suche läuft bei jeder Anfrage auf Ihrem Mailserver - "
    + "Mailbroom speichert nichts. Bei entfernten Anbietern kann sie "
    + "langsam sein; Proton Bridge antwortet lokal. Ausschalten, um nur "
    + "nach Betreff und Absender zu suchen.",
  "auto_scan.align": "Startminute (0-59)",
  "auto_scan.help":
    "Scannt dieses Konto in festen Abständen neu, unabhängig von "
    + "Regel-Zeitplänen - hält die „Neu“-Markierung und die "
    + "Aktivitäts-Übersicht aktuell, ohne dass die App geöffnet sein muss. "
    + "Die „Startminute“ richtet den Takt an einer festen Uhrzeit aus "
    + "(z. B. alle 3 Stunden zur Minute 10 -> 00:10, 03:10, 06:10, ...) "
    + "statt ab dem Speicherzeitpunkt zu driften. Wird automatisch "
    + "übersprungen, solange das Konto mit etwas anderem beschäftigt ist, "
    + "und beim nächsten Takt einfach erneut versucht.",
  "Audit Log": "Prüfprotokoll",
  "Previous": "Zurück",
  "Next": "Weiter",
  "user": "Nutzer",
  "audit.empty": "Noch nichts aufgezeichnet.",
  "audit.export": "Prüfprotokoll als CSV exportieren",
  "audit.by": "von {actor}",
  "audit.by_rule": "von Regel „{name}“",
  "audit.page": "{from}–{to} von {total}",
  "audit.act.trash": "In den Papierkorb verschoben",
  "audit.act.archive": "Archiviert",
  "audit.act.move": "Verschoben",
  "audit.act.mark_read": "Als gelesen markiert",
  "audit.act.rule_report": "Regel-Bericht",
  "audit.act.rule_execute": "Regel ausgeführt",
  "audit.act.unsubscribe": "Abbestellt",
  "audit.act.undo": "Rückgängig gemacht",
  "audit.act.empty_trash": "Papierkorb geleert",
  "audit.outcome.ok": "ok",
  "audit.outcome.error": "Fehler",
  "audit.outcome.cancelled": "abgebrochen",
  "audit.outcome.partial": "teilweise",
  "audit.outcome.done": "erledigt",
  "audit.outcome.link": "Link",
  "audit.outcome.failed": "fehlgeschlagen",
  "Close": "Schließen",
  "Remove": "Entfernen",
  "View details": "Details anzeigen",
  "trash_group.tip": "Alle Mails dieser Gruppe in den Papierkorb verschieben",
  "menu.more": "Mehr",
  "export.csv": "CSV exportieren",
  "export.csv_tip": "Aktuelle Gruppierung als CSV exportieren",
  "bar.selected": "{n} Gruppen ausgewählt · {mails} Mails",
  "bar.limit_to": "Beschränken auf:",
  "Cancel": "Abbrechen",
  "detail.n_selected": "{n} ausgewählt",
};
