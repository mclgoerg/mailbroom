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
  "notice.emptied_trash_one": "Papierkorb geleert (1 Mail endgültig gelöscht).",
  "notice.ai_all_cached":
    "Alle Gruppen haben bereits KI-Bewertungen - nichts zu prüfen.",
  "notice.ai_cancelled": "KI-Prüfung nach {done}/{total} Gruppen abgebrochen.",
  "confirm.act_mails": "{verb}: {n} ausgewählte Mails?",
  "confirm.act_mails_one": "{verb}: 1 ausgewählte Mail?",
  "confirm.unsubscribe":
    "Von den Absendern in {n} ausgewählten Gruppen abbestellen?",
  "confirm.unsub_pooled_skipped":
    "{n} gebündelte Zeilen werden übersprungen: öffne eine, um einen einzelnen "
    + "Absender abzubestellen.",
  "toast.unsub_pooled":
    "Abbestellen geht pro Absender: öffne eine gebündelte Zeile und nutze das "
    + "Abbestellen des Absenders.",
  "confirm.unsubscribe_one":
    "Von den Absendern der ausgewählten Gruppe abbestellen?",
  "confirm.restore": "{count} Mails wiederherstellen ({label})?",
  "confirm.restore_one": "1 Mail wiederherstellen ({label})?",
  "ai.usage": "Nutzung",
  "ai.reset_spend": "Kosten zurücksetzen…",
  "ai.clear_verdicts": "KI-Bewertungscache leeren…",
  "confirm.clear_verdicts": "Alle gespeicherten KI-Bewertungen löschen",
  "confirm.clear_verdicts_body":
    "Die Gruppen werden beim nächsten KI-Review neu bewertet - das "
    + "verbraucht Tokens.",
  "confirm.clear_verdicts_confirm": "Cache leeren",
  "confirm.reset_spend": "KI-Kostenzähler zurücksetzen",
  "confirm.reset_spend_body":
    "Die KI-Gesamtkosten ({cost}) und die Kosten dieses Monats ({month}), "
    + "die auf Ihr Monatsbudget angerechnet werden, beginnen wieder bei null.",
  "confirm.reset_spend_confirm": "Kosten zurücksetzen",
  "confirm.switch_profile":
    "Zum Kontoprofil „{name}“ wechseln? Danach neu scannen.",
  "note.ai_selected": "{note} - {n}/{of} ausgewählt",
  "note.ai_truncated": " (nur die ersten {n} Mails)",
  "note.background": "{verb} - läuft im Hintergrund…",
  "show_more": "{n} weitere anzeigen ({hidden} ausgeblendet)",
  "ai_done": "KI fertig ({in} rein / {out} raus{cost}) · gesamt {total}",
  "done_moved": "Fertig: {n} Mails verarbeitet.",
  "done_moved_one": "Fertig: 1 Mail verarbeitet.",
  "note.ai_progress": "KI prüft… {done}/{total} Mails",
  "ai.disclaimer":
    "Die KI-Prüfung sendet Mail-METADATEN an den konfigurierten "
    + "KI-Anbieter (z. B. Anthropic, OpenAI, Microsoft Foundry oder ein "
    + "lokales Modell): Absendernamen "
    + "und -adressen, Anzahl, Größen, Daten, Lesestatus, Kategorien, "
    + "Betreffzeilen, Schutz-Markierungen und ob Sie einem Absender je "
    + "geantwortet haben. Mail-Inhalte und Anhänge werden NIE gesendet. "
    + "Die KI-Sortierung von „Sonstige“ sendet je Absender Name und "
    + "Adresse, Anzahl, ob ein Abmeldelink angeboten wird und bis zu drei "
    + "aktuelle Betreffzeilen – dazu Ihre eigenen Sortier-Anweisungen aus "
    + "den Einstellungen. Wenn Sie einen Filter in Worten beschreiben, "
    + "gehen nur Ihr Satz, die Filter-Syntax und die Namen Ihrer Kategorien "
    + "an die KI – keine Maildaten.",
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
  "chip.still_count": "Schreibt weiter ({n})",
  "still.badge": "Schreibt weiter",
  "still.title": "Schreibt nach dem Abbestellen weiter",
  "still.text": "{n} Mails, seit du am {date} abbestellt hast",
  "still.text_one": "1 Mail, seit du am {date} abbestellt hast",
  "still.text_many": "{n} Mails von {senders} Absendern, seit du abbestellt hast (erste am {date})",
  "qw.title": "Schnelle Erfolge",
  "qw.free_up": "bis zu {size} frei",
  "qw.show": "Schnelle Erfolge anzeigen",
  "qw.hide": "Schnelle Erfolge ausblenden",
  "qw.card_meta": "{mails} Mails - {size}",
  "qw.protected_skipped": "{n} geschützte übersprungen",
  "qw.review": "Ansehen",
  "qw.clean_up": "Aufräumen",
  "qw.not_now": "Nicht jetzt",
  "qw.more": "{n} weitere",
  "qw.less": "Weniger anzeigen",
  "qw.old_newsletters": "Alte Newsletter, die du nie öffnest",
  "qw.old_newsletters_hint":
    "Massenversender, meist ungelesen, seit über 6 Monaten still",
  "qw.quiet_low": "Ruhige Absender, mit denen du kaum interagierst",
  "qw.quiet_low_hint": "Seit über einem Jahr nichts Neues, geringe Interaktion",
  "qw.unsubscribed": "Mails von Absendern, die du abbestellt hast",
  "qw.unsubscribed_hint": "Bereits abbestellt - der Rest kann weg",
  "qw.big_attachments": "Große Anhänge, älter als zwei Jahre",
  "qw.big_attachments_hint": "Absender mit über 10 MB Anhängen",
  "qw.ai_safe": "Laut KI sicher löschbar",
  "qw.ai_safe_hint": "Von deiner KI-Prüfung als sicher löschbar bewertet",
  "confirm.trash_protected":
    "Die Gruppe „{label}“ ist geschützt. Mails trotzdem in den "
    + "Papierkorb verschieben?",
  "toast.all_protected":
    "Alle ausgewählten Gruppen sind geschützt - nichts wurde gelöscht.",
  "pin.group_on": "Alle Mails dieser Gruppe schützen",
  "pin.group_off": "Schutz aller Mails aufheben",
  "pin.group_skipped":
    "{n} Mails ohne Message-ID konnten nicht geschützt werden.",
  "pin.group_skipped_one":
    "1 Mail ohne Message-ID konnte nicht geschützt werden.",
  "confirm.unpin_group":
    "Den Schutz aller {n} geschützten Mails dieser Gruppe aufheben?",
  "confirm.unpin_group_one":
    "Den Schutz der 1 geschützten Mail dieser Gruppe aufheben?",
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
  "pin.protect_tip":
    "Diese Mail schützen - keine Sammelaktion, Regel oder KI-Auswahl "
    + "verschiebt sie",
  "pin.unprotect_tip": "Schutz dieser Mail aufheben",
  "pin.badge_tip": "{n} Mails vor Sammelaktionen geschützt",
  "pin.badge_tip_one": "1 Mail vor Sammelaktionen geschützt",
  "pin.n_protected": "{n} Mails geschützt",
  "pin.n_protected_one": "1 Mail geschützt",
  "pin.error": "Schutz der Mail konnte nicht geändert werden",
  "pin.no_message_id":
    "Diese Mail hat keine Message-ID und ließe sich nach einem erneuten "
    + "Scan nicht wiedererkennen - sie kann nicht geschützt werden.",
  "pin.refused":
    "Die Auswahl enthält geschützte Mails - bestätige sie einzeln oder "
    + "hebe zuerst ihren Schutz auf.",
  "rule.pinned_skipped": "{n} geschützte Mails übersprungen",
  "rule.pinned_skipped_one": "1 geschützte Mail übersprungen",
  "qb.has_pinned": "mit geschützten Mails",
  "qb.has_tracker": "die Öffnen oder Klicks verfolgen",
  "tracker.menu": "Tracker",
  "tracker.title": "Tracker",
  "tracker.sub": "Wer deine Öffnungen und Klicks verfolgt",
  "tracker.explainer":
    "Ein Tracking-Pixel verrät dem Absender, wann und wo du die Mail "
    + "geöffnet hast. Mailbroom lädt niemals Bilder aus dem Netz nach.",
  "tracker.headline":
    "{pct} % der geprüften Mails enthalten ein Tracking-Pixel",
  "tracker.headline_none":
    "In den geprüften Mails wurden keine Tracking-Pixel gefunden",
  "tracker.checked": "{n} von {total} Mails geprüft",
  "tracker.with_pixel": "mit Tracking-Pixel",
  "tracker.with_click": "mit Klick-Tracking",
  "tracker.senders": "Absender mit Tracking",
  "tracker.top_senders": "Absender mit dem meisten Tracking",
  "tracker.top_hosts": "Tracking-Hosts",
  "tracker.sender_meta": "{n} von {of} Mails mit Tracking",
  "tracker.sender_meta_one": "1 von {of} Mails mit Tracking",
  "tracker.n_senders": "{n} Absender",
  "tracker.n_senders_one": "1 Absender",
  "tracker.tag_pixel": "Öffnen",
  "tracker.tag_click": "Klicks",
  "tracker.pick": "Mails von {name} anzeigen",
  "tracker.nothing_found":
    "In den {n} geprüften Mails wurde kein Tracking gefunden.",
  "tracker.scan_first": "Scanne zuerst dein Postfach",
  "tracker.none_title": "Noch kein Mail-Textindex",
  "tracker.none_hint":
    "Tracking wird beim Aufbau des lokalen Textindex erkannt. Es wird "
    + "nichts zusätzlich abgerufen.",
  "tracker.enable_local":
    "Stelle die Mailtext-Suche in den Einstellungen auf \u201elokaler "
    + "Index\u201c und baue dort den Index auf - das Tracking wird dabei "
    + "erkannt.",
  "tracker.build": "Textindex aufbauen",
  "tracker.unchecked_title": "Noch nicht geprüft",
  "tracker.unchecked_hint":
    "Diese Mails wurden indexiert, bevor es die Tracker-Erkennung gab. "
    + "Prüfe sie, um den Bericht zu sehen.",
  "tracker.check_older": "Ältere Mails prüfen",
  "tracker.checking": "Mails werden geprüft\u2026",
  "tracker.confirm_note":
    "Sucht außerdem im HTML jeder Mail nach Tracking-Pixeln und "
    + "Klick-Tracking-Links. Es wird nichts nachgeladen oder irgendwohin "
    + "gesendet.",
  "tracker.opens": "Verfolgt Öffnungen",
  "tracker.clicks": "Verfolgt Klicks",
  "tracker.both": "Verfolgt Öffnungen und Klicks",
  "tracker.pop_pixel":
    "{n} von {of} geprüften Mails enthalten ein Tracking-Pixel",
  "tracker.pop_click":
    "{n} von {of} geprüften Mails enthalten Klick-Tracking-Links",
  "tracker.pop_hosts": "Hosts: {hosts}",
  "tracker.pop_hint":
    "Lokal beim Aufbau des Textindex gefunden. Es wurde nichts nachgeladen.",
  "confirm.block_trash_existing":
    "Auch die {n} vorhandenen Mails jetzt in den Papierkorb verschieben?",
  "confirm.block_trash_existing_one":
    "Auch die 1 vorhandene Mail jetzt in den Papierkorb verschieben?",
  "toast.blocked": "„{label}“ blockiert.",
  "block.tip":
    "Diesen Absender/diese Domain blockieren: legt eine dauerhafte Regel "
    + "an, die künftige Mails automatisch in den Papierkorb verschiebt",
  "Block": "Blockieren",
  "Blocked": "Blockiert",
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
  "trash.counting": "Zähle…",
  "trash.already_empty": "Der Papierkorb ist leer.",
  "Emptying Trash…": "Leere Papierkorb…",
  "loading…": "lade…",
  "cancel": "abbrechen",
  "back to list": "zurück zur Liste",
  "dismiss": "ausblenden",
  "Date": "Datum",
  "Language": "Sprache",
  "Theme": "Design",
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
  "ratings.aria": "KI-Bewertungen pro Mail: {parts}",
  "ratings.popover_title": "KI-Bewertungen pro Mail",
  "ratings.popover_hint":
    "Anzahl der Mails dieser Gruppe je Bewertung. Gruppe öffnen für Details.",
  "trash.open_label": "Papierkorb ({n} Mails)",
  "trash.open_label_one": "Papierkorb (1 Mail)",
  "page.first": "Erste Seite",
  "page.prev": "Vorherige Seite",
  "page.next": "Nächste Seite",
  "page.last": "Letzte Seite",
  "page.of": "Seite {p} / {n}",
  "per page": "pro Seite",
  "All": "Alle",
  "Save": "Speichern",
  "Saved.": "Gespeichert.",
  "AI verdict cache cleared.": "KI-Bewertungscache geleert.",
  "Account profile": "Kontoprofil",
  "New": "Neu",
  "Host": "Host",
  "IMAP port": "IMAP-Port",
  "SMTP port": "SMTP-Port",
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
  "rule.capped_one": "1 Mail über dem Limit pro Lauf",
  "rule.protected_skipped": "{n} geschützte übersprungen",
  "rule.run_now": "Jetzt ausführen",
  "rule.enable_execute": "Ausführen aktivieren",
  "rule.back_to_report": "Zurück zu Bericht",
  "rule.need_report": "Zuerst mindestens einen Bericht ausführen",
  "rule.confirm_execute": "Regel „{name}“ jetzt im AUSFÜHREN-Modus starten?",
  "rule.confirm_delete": "Regel „{name}“ löschen?",
  "rule.edit_title": "Regel bearbeiten",
  "rule.new_title": "Neue Regel",
  "rule.name": "Regelname",
  "rule.create": "Regel anlegen (nur Bericht)",
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
  "atts.summary_one": "1 Mail mit Anhängen · {size} gesamt",
  "atts.analyze": "Anhänge analysieren",
  "atts.reanalyze": "Neu analysieren",
  "atts.intro":
    "Analyse starten, um Mails nach Anhanggröße zu listen. Danach "
    + "funktioniert auch der Filter att:>10m auf Gruppen. Proton kann per "
    + "IMAP keine einzelnen Anhänge entfernen - Löschen entfernt die ganze "
    + "Mail (rückgängig machbar).",
  "atts.none": "Keine Anhänge gefunden",
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
  "toast.unsub_started": "Bestelle bei {n} Absendern ab…",
  "toast.unsub_started_one": "Bestelle bei 1 Absender ab…",
  "toast.unsub_skipped":
    "({n} bereits erledigt, geschützt oder über dem Limit pro Lauf.)",
  "toast.unsub_skipped_one":
    "(1 bereits erledigt, geschützt oder über dem Limit pro Lauf.)",
  "toast.unsub_nothing":
    "Nichts abzubestellen - alle Absender sind bereits erledigt oder "
    + "geschützt.",
  "Starting…": "Starte…",
  "Duplicates": "Duplikate",
  "dups.hint":
    "Gleiche Message-ID oder identischer Absender + Betreff + Größe.",
  "dups.summary": "{n} Duplikat-Gruppen · {size} freigebbar",
  "dups.summary_one": "1 Duplikat-Gruppe · {size} freigebbar",
  "dups.keep_newest": "Alle außer der neuesten auswählen",
  "dups.wasted": "{size} freigebbar",
  "dups.newest": "neueste",
  "dups.none": "Keine Duplikate gefunden",
  "Statistics": "Statistik",
  "stats.this_month": "diesen Monat in den Papierkorb verschoben: {n} Mails",
  "stats.this_month_one": "diesen Monat in den Papierkorb verschoben: 1 Mail",
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
  "stats.rated_mails_one":
    "· 1 Mail einzeln bewertet ({safe} sicher löschbar)",
  "stats.top_domains": "Top-Domains nach Größe",
  "stats.cleanup": "Aufräumen pro Monat",
  "stats.actions_line":
    "{trash} in den Papierkorb · {archive} archiviert · {move} verschoben "
    + "· {read} gelesen markiert",
  "stats.actions_purged": " · {purge} endgültig gelöscht ({size} frei)",
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
  "notice.trash_restored_one":
    "1 Mail aus dem Papierkorb nach {dest} wiederhergestellt.",
  "notice.trash_restored_rescan":
    "{n} Mails aus dem Papierkorb nach {dest} wiederhergestellt - zum Anzeigen neu scannen.",
  "notice.trash_restored_rescan_one":
    "1 Mail aus dem Papierkorb nach {dest} wiederhergestellt - zum Anzeigen neu scannen.",
  "trash.browse": "Papierkorb durchsuchen",
  "Junk": "Spam",
  "fp.delete_permanently": "Endgültig löschen…",
  "fp.older": "Ältere löschen…",
  "fp.older_title": "Alte Mails endgültig löschen",
  "fp.older_label": "Vor mehr als so vielen Tagen empfangen",
  "fp.older_invalid": "Bitte eine ganze Zahl von Tagen von 1 bis 36500 eingeben.",
  "fp.older_btn": "Mails zählen",
  "fp.empty_junk": "Spam leeren",
  "fp.purge_title": "Endgültig aus „{folder}“ löschen?",
  "fp.purge_title_empty": "„{folder}“ endgültig leeren?",
  "fp.purge_body_junk":
    "Diese Mails werden zuerst in den Papierkorb verschoben und dort auf "
    + "dem Server gelöscht. Das lässt sich nicht rückgängig machen.",
  "fp.purge_body_trash":
    "Diese Mails werden auf dem Server gelöscht. Das lässt sich nicht "
    + "rückgängig machen.",
  "fp.purge_scope_older": "Mails, die vor mehr als {n} Tagen empfangen wurden.",
  "fp.purge_scope_older_one": "Mails, die vor mehr als 1 Tag empfangen wurden.",
  "fp.purge_b_delete": "{n} Mails werden endgültig gelöscht",
  "fp.purge_b_delete_one": "1 Mail wird endgültig gelöscht",
  "fp.purge_b_protected": "{n} Mails geschützter Absender werden übersprungen",
  "fp.purge_b_protected_one": "1 Mail eines geschützten Absenders wird übersprungen",
  "fp.purge_b_pinned": "{n} geschützte Mails werden übersprungen",
  "fp.purge_b_pinned_one": "1 geschützte Mail wird übersprungen",
  "fp.purge_btn": "Endgültig löschen ({n})",
  "fp.purge_none": "Nichts zu löschen.",
  "fp.purge_none_skipped":
    "Nichts zu löschen. {skipped}. Zum Löschen zuerst den Schutz aufheben.",
  "fp.purge_nothing_left":
    "Es war nichts mehr zu löschen - die Mails sind schon weg.",
  "fp.purged": "{n} Mails endgültig gelöscht",
  "fp.purged_one": "1 Mail endgültig gelöscht",
  "fp.purged_skipped": "{n} Mails endgültig gelöscht ({k} übersprungen)",
  "fp.purged_skipped_one": "1 Mail endgültig gelöscht ({k} übersprungen)",
  "fp.purge_unverified":
    "{n} Mails in den Papierkorb verschoben, aber ihre endgültige Löschung "
    + "ließ sich nicht sicher überprüfen. Es wurde nichts endgültig "
    + "gelöscht - sie liegen noch im Papierkorb. Das Verschieben lässt sich "
    + "rückgängig machen.",
  "fp.purge_unverified_one":
    "1 Mail in den Papierkorb verschoben, aber ihre endgültige Löschung "
    + "ließ sich nicht sicher überprüfen. Es wurde nichts endgültig "
    + "gelöscht - sie liegt noch im Papierkorb. Das Verschieben lässt sich "
    + "rückgängig machen.",
  "audit.act.purge": "Endgültig gelöscht",
  "stats.freed_month":
    "diesen Monat endgültig gelöscht: {n} Mails · {size} frei",
  "stats.freed_month_one":
    "diesen Monat endgültig gelöscht: 1 Mail · {size} frei",
  "fp.menu": "Spam & Papierkorb",
  "fp.which": "Ordner",
  "fp.grouping": "Gruppieren nach",
  "fp.by_sender": "Nach Absender",
  "fp.mails": "Mails",
  "fp.not_junk": "Kein Spam",
  "fp.action": "Aktion…",
  "fp.to_trash": "In den Papierkorb verschieben",
  "fp.not_junk_done": "{n} Mails in den Posteingang verschoben",
  "fp.not_junk_done_one": "1 Mail in den Posteingang verschoben",
  "fp.protect_sender": "{n} Absender schützen",
  "fp.protect_sender_one": "Absender schützen",
  "fp.junk_empty": "Spam-Ordner ist leer",
  "fp.junk_empty_hint":
    "Mails, die Ihr Anbieter als Spam einstuft, erscheinen hier - so lassen sich Fehlalarme retten.",
  "fp.protected_refused":
    "Einige dieser Mails stammen von geschützten Absendern oder sind angeheftet. Trotzdem in den Papierkorb verschieben?",
  "fp.confirm_protected_title": "Geschützte Mails in den Papierkorb verschieben?",
  "fp.confirm_protected_btn": "Trotzdem verschieben",
  "junk.browse": "Spam durchsuchen",
  "junk.open_label": "Spam ({n} Mails)",
  "junk.open_label_one": "Spam (1 Mail)",
  "notice.junk_rescued": "{n} Mails aus dem Spam-Ordner in den Posteingang verschoben.",
  "notice.junk_rescued_one": "1 Mail aus dem Spam-Ordner in den Posteingang verschoben.",
  "notice.junk_rescued_rescan":
    "{n} Mails aus dem Spam-Ordner in den Posteingang verschoben - zum Anzeigen neu scannen.",
  "notice.junk_rescued_rescan_one":
    "1 Mail aus dem Spam-Ordner in den Posteingang verschoben - zum Anzeigen neu scannen.",
  "trash.restore_to": "Wiederherstellen nach…",
  "trash.restored": "{n} Mails wiederhergestellt - zum Anzeigen neu scannen.",
  "trash.restored_one": "1 Mail wiederhergestellt - zum Anzeigen neu scannen.",
  "trash.restored_refreshing":
    "{n} Mails wiederhergestellt - die Ansichten aktualisieren sich automatisch.",
  "trash.restored_refreshing_one":
    "1 Mail wiederhergestellt - die Ansichten aktualisieren sich automatisch.",
  "trash.newest_shown": "neueste {n} angezeigt",
  "trash.empty": "Der Papierkorb ist leer",
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
    + "deaktiviert sie; neue Namen ergänzen Kategorien. Eine Kategorie, die "
    + "du anlegst oder änderst, bestimmt auch die Zeilen im Tab Smart. Gilt "
    + "sofort im Tab Absender und Smart, in den anderen Tabs ab dem nächsten "
    + "Scan.",
  "new_sender.window_label": "„Neu“-Fenster für Absender (Tage)",
  "new_sender.window_help":
    "Wie viele Tage ein Absender als „Neu“ markiert bleibt (is:new, das "
    + "Neu-Abzeichen), nachdem er erstmals in einem Scan gesehen wurde.",
  "Export": "Exportieren",
  "Import…": "Importieren…",
  "export.tip":
    "Einstellungen, Regeln, KI-Bewertungen, Antwort-Cache und die "
    + "eingeordneten Absender herunterladen – die Datei listet "
    + "Absenderadressen (Passwörter und API-Schlüssel nie enthalten)",
  "backup.title": "Sichern & Wiederherstellen",
  "backup.help":
    "Der Export lädt Einstellungen, Regeln, KI-Bewertungen, den "
    + "Antwort-Cache und die eingeordneten Absender als Datei herunter; der "
    + "Import spielt eine solche Datei wieder ein. Die Datei listet "
    + "Absenderadressen – halte sie privat. Passwörter und API-Schlüssel sind "
    + "nie Teil eines Backups.",
  "import.title": "Dieses Backup importieren",
  "import.settings": "Einstellungen werden überschrieben.",
  "import.rules": "Regeln werden ersetzt (wieder im Bericht-Modus).",
  "import.merged": "Bewertungen, Antwortdaten und eingeordnete Absender werden zusammengeführt.",
  "import.secrets": "Passwörter und API-Schlüssel werden nie importiert.",
  "import.confirm": "Backup importieren",
  "import.done": "Importiert: {rules} Regeln, {verdicts} Bewertungen, {knowledge} eingeordnete Absender.",
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
  "thread.title": "Konversation",
  "thread.read": "Konversation lesen",
  "thread.you": "Sie",
  "thread.n_mails": "{n} Mails",
  "thread.n_mails_one": "1 Mail",
  "thread.expand_all": "Alle aufklappen",
  "thread.collapse_all": "Alle zuklappen",
  "thread.show_quoted": "Zitierten Text anzeigen",
  "thread.hide_quoted": "Zitierten Text ausblenden",
  "thread.note.sent_unavailable":
    "Ihre eigenen Antworten konnten nicht aus dem Ordner „Gesendet“ geladen "
    + "werden - es werden nur die empfangenen Mails angezeigt.",
  "no.matches": "Keine Gruppen passen zu diesem Filter",
  "err.generic": "Fehler: {msg}",
  "err.ai": "KI-Fehler: {msg}",
  "err.unsub": "Abbestell-Fehler: {msg}",
  "err.undo": "Fehler beim Rückgängigmachen: {msg}",
  "err.connection": "Verbindungsfehler: {msg}",
  "toast.moved_trash": "{n} Mails in den Papierkorb verschoben",
  "toast.moved_trash_one": "1 Mail in den Papierkorb verschoben",
  "status.filter_none": "0 von {n} Gruppen passen",
  "status.filter_none_one": "0 von 1 Gruppe passt",
  "status.no_mails": "In den gescannten Ordnern wurden keine Mails gefunden.",
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
  "notify.delete_done_one": "Fertig: 1 Mail verarbeitet.",
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
  "smtp.host": "SMTP-Host",
  "smtp.help":
    "SMTP wird nur zum Senden von Abbestell-Mails genutzt; der SMTP-Host "
    + "ist standardmäßig der IMAP-Host.",
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
  "oauth.disconnect_title": "Dieses Konto von OAuth trennen",
  "oauth.disconnect_body": "Eine erneute Verbindung ist jederzeit möglich.",
  "oauth.device_instructions":
    "Den folgenden Link auf einem beliebigen Ger\u00e4t \u00f6ffnen und diesen "
    + "Code eingeben:",
  "folder.role_excluded":
    "Spezialordner (per Rolle erkannt) - wird nie mitgescannt",
  "folder.view_excluded":
    "Virtuelle Ansicht auf Mails, die woanders liegen - wird nie "
    + "mitgescannt, damit nichts doppelt z\u00e4hlt",
  "folder.lookalike_excluded":
    "Sieht aus wie ein zweiter Spezialordner (die Rolle hat schon ein "
    + "anderer Ordner) - wird nie mitgescannt, seine Mails werden nicht "
    + "zum Aufr\u00e4umen angeboten",
  "folder.view": "Ansicht",
  "role.trash": "Papierkorb",
  "role.junk": "Spam",
  "role.sent": "Gesendet",
  "role.drafts": "Entw\u00fcrfe",
  "role.archive": "Archiv",
  "role.all": "Alle Nachrichten",
  "folders.scan": "Zu scannende Ordner",
  "folders.special": "Spezialordner",
  "folders.special_hint":
    "Nicht Teil des Aufr\u00e4um-Scans. Der pro Rolle angezeigte Ordner ist der, "
    + "in den Mailbroom Mails verschiebt - und der, den dauerhafte Aktionen "
    + "verwenden.",
  "folders.none": "Keine Ordner gefunden.",
  "folder.src.flag": "Server-Markierung",
  "folder.src.name": "nach Name",
  "folder.src.override": "von dir gew\u00e4hlt",
  "folder.view_row": "Ansichten anderer Ordner - werden nie gescannt",
  "folder.archive_scanned":
    "Das Archiv wird weiterhin gescannt - unten ankreuzen.",
  "folder.ambiguous":
    "Mehr als ein Ordner kommt als dein Ordner \u201e{role}\u201c in Frage. "
    + "Bis du w\u00e4hlst, verwendet Mailbroom \u201e{pick}\u201c f\u00fcr "
    + "Verschiebungen dorthin und l\u00f6scht nicht endg\u00fcltig und leert ihn "
    + "nicht.",
  "folder.choose": "Noch nicht best\u00e4tigt - ausw\u00e4hlen\u2026",
  "folder.choose_label": "Welcher Ordner ist dein Ordner \u201e{role}\u201c?",
  "folder.confirmed":
    "Du hast diesen Ordner gew\u00e4hlt. Dauerhafte Aktionen f\u00fcr "
    + "\u201e{role}\u201c (etwa Papierkorb leeren) verwenden genau ihn.",
  "folder.choice_note":
    "Der Ordner, den du hier w\u00e4hlst, wird f\u00fcr dauerhafte Aktionen "
    + "verwendet.",
  "folder.auto": "Automatische Wahl verwenden",
  "folder.choice_saved":
    "Ordner \u201e{role}\u201c ist jetzt \u201e{name}\u201c.",
  "folder.choice_reset":
    "Ordner \u201e{role}\u201c wird wieder automatisch gew\u00e4hlt.",
  "folder.lookalike_tag": "sieht auch aus wie \u201e{role}\u201c",
  "folder.move_contents": "Inhalt nach \u201e{role}\u201c verschieben",
  "folder.move_needs_choice":
    "W\u00e4hle zuerst oben den Ordner \u201e{role}\u201c.",
  "folder.move_title": "{n} Mails nach \u201e{role}\u201c verschieben?",
  "folder.move_title_one": "1 Mail nach \u201e{role}\u201c verschieben?",
  "folder.move_body":
    "Die Mails in \u201e{folder}\u201c werden nach \u201e{target}\u201c "
    + "verschoben - nicht gel\u00f6scht. Du kannst das gleich danach "
    + "r\u00fcckg\u00e4ngig machen.",
  "folder.move_confirm": "{n} Mails verschieben",
  "folder.move_confirm_one": "1 Mail verschieben",
  "folder.move_empty":
    "\u201e{folder}\u201c ist leer - nichts zu verschieben.",
  "folder.moved": "{n} Mails nach \u201e{role}\u201c verschoben.",
  "folder.moved_one": "1 Mail nach \u201e{role}\u201c verschoben.",
  "folder.err.not_candidate":
    "Dieser Ordner kann f\u00fcr diese Rolle nicht gew\u00e4hlt werden.",
  "folder.err.ambiguous":
    "W\u00e4hle zuerst den richtigen Ordner f\u00fcr diese Rolle, dann "
    + "versuche es erneut.",
  "folder.err.not_lookalike":
    "Dieser Ordner sieht nicht mehr wie ein zweiter Spezialordner aus - "
    + "Liste neu laden.",
  "folder.err.move_unsafe":
    "Dieser Server kann weder verschieben noch einzelne Mails sicher "
    + "entfernen, deshalb wird das Verschieben abgelehnt - nichts wurde "
    + "ge\u00e4ndert.",
  "folder.undone": "{n} Mails zur\u00fcck verschoben.",
  "folder.undone_one": "1 Mail zur\u00fcck verschoben.",
  "audit.act.move_contents": "Ordnerinhalt verschoben",
  "account.label": "Zu bearbeitendes Konto",
  "account.add": "Konto hinzufügen",
  "account.hint":
    "Jedes Konto wird getrennt gescannt und aufgeräumt - Ansichten "
    + "vermischen sich nie. Bei mehreren Konten oben im Kopf umschalten.",
  "account.new_prompt": "Name für das neue Konto (z. B. \"gmail\"):",
  "account.new_title": "Konto hinzufügen",
  "account.rename_title": "Konto umbenennen",
  "account.rename_confirm": "Umbenennen",
  "account.err_empty": "Bitte einen Namen eingeben.",
  "account.err_dup": 'Ein Konto namens "{name}" gibt es schon.',
  "account.remove_title": "Konto entfernen",
  "account.remove_help":
    "Entfernt dieses Konto aus Mailbroom. Mails auf dem Server bleiben "
    + "unangetastet.",
  "account.delete": 'Konto "{name}" löschen…',
  "account.delete_title": 'Konto "{name}" löschen',
  "account.delete_data":
    "Mailbroom löscht die Anmeldedaten und Verbindungseinstellungen, "
    + "Scan-Ergebnisse, den lokalen Suchindex, gespeicherte Filter, Pins, "
    + "Abbestell-Einträge, bekannte Absender sowie Digest- und "
    + "Auto-Scan-Einstellungen.",
  "account.delete_rules":
    "Seine Mail-Regeln behalten den Kontonamen, laufen aber nicht mehr; "
    + "seine Lösch-Regeln für Spam und Papierkorb werden gelöscht.",
  "account.delete_mails": "Mails auf dem Server bleiben unangetastet.",
  "account.delete_confirm": "Konto löschen",
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
  "tab.account_short": "Konto",
  "tab.general_short": "Allgemein",
  "tab.ai_short": "KI",
  "tab.server_short": "Server",
  "tab.account": "Mail-Konto",
  "tab.general": "Allgemein",
  "tab.ai": "KI",
  "tab.server": "Server (Admin)",
  "menu.theme": "Zu {next}em Design wechseln",
  "menu.light": "hell",
  "menu.dark": "dunkl",
  "login.oidc_admin": "Admin-Identität (E-Mail oder Subject)",
  "login.oidc_admin_ph": "leer: erste Anmeldung übernimmt sie",
  "login.tenancy_note":
    "Mit SSO bekommt jeder Nutzer einen EIGENEN Arbeitsbereich (Konten, "
    + "Scans, Einstellungen). Der Admin behält diesen hier.",
  "shared.section": "Gemeinsamer KI-Schlüssel (alle Nutzer)",
  "shared.help":
    "Optional einen serverseitigen KI-Schlüssel teilen: Nutzer ohne "
    + "eigenen Schlüssel verwenden ihn automatisch, begrenzt pro Nutzer "
    + "und Monat durch das Standard-Budget unten (Nutzer dürfen ihr "
    + "Limit senken, nie erhöhen).",
  "shared.enabled": "Diesen Schlüssel mit allen Nutzern teilen",
  "shared.budget": "Standard-Monatsbudget pro Nutzer ($)",
  "ai.shared_key_ph": "nutzt den gemeinsamen Server-Schlüssel",
  "usage.section": "Nutzerstatistik",
  "usage.help":
    "Nutzung pro Arbeitsbereich - nur Zahlen, KI-Kosten und "
    + "Speicherplatz. Mailbroom zeigt dir nie Maildaten, Kontonamen "
    + "oder Absender anderer Nutzer.",
  "usage.user": "Nutzer / Arbeitsbereich",
  "usage.mails": "Mails (letzter Scan)",
  "usage.cleaned": "Aufgeräumt (Monat)",
  "usage.ai_month": "KI-Kosten (Monat)",
  "usage.last_scan": "Letzter Scan",
  "usage.disk": "Speicher",
  "usage.shared": "geteilter Schlüssel",
  "sort.menu_state": "{key}, {dir}",
  "sort.menu": "Sortieren",
  "sort.ascending": "Aufsteigend",
  "sort.descending": "Absteigend",
  "view.group_by": "Gruppieren nach",
  "Tools": "Werkzeuge",
  "chip.inactive": "Inaktiv:",
  "chip.inactive_6m": "6 Mo.",
  "chip.inactive_1y": "1 J.",
  "chip.inactive_2y": "2 J.",
  "sort.desc_tip": "Absteigend sortiert - Klick für aufsteigend",
  "sort.asc_tip": "Aufsteigend sortiert - Klick für absteigend",
  "qb.tip": "Filter zusammenklicken statt Syntax merken",
  "qb.title": "Filter erstellen",
  "qb.hint": "jede hinzugefügte Bedingung muss AUCH zutreffen (UND)",
  "qb.add": "Hinzufügen",
  "qb.clear": "Leeren",
  "qb.done": "Fertig",
  "qb.tag": "Kategorie",
  "qb.ai": "KI-Urteil",
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
  "qb.is_still_mailing": "schreibt nach dem Abbestellen weiter",
  "ai.shared_note":
    "Kein eigener Schlüssel - KI läuft über den gemeinsamen "
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
  "search.placeholder_body": "Betreff, Absender und Mailtext suchen",
  "search.body_toggle": "Auch im Mailtext suchen",
  "search.placeholder":
    "Betreff oder Absender suchen",
  "search.empty_title":
    "Postfach durchsuchen",
  "search.empty_hint":
    "Findet gescannte Mails nach Betreff oder Absender. Die Suche im Mailtext ist für dieses Konto ausgeschaltet.",
  "search.empty_hint_body":
    "Findet gescannte Mails nach Betreff oder Absender. Mit „Auch im Mailtext suchen“ wird auch der Nachrichtentext durchsucht.",
  "search.none":
    "Keine Treffer",
  "search.none_hint":
    "Versuchen Sie eine andere Schreibweise oder einen kürzeren Suchbegriff.",
  "trash.no_match":
    "Keine passenden Mails",
  "trash.empty_hint":
    "Gelöschte Mails bleiben hier, bis Sie den Papierkorb leeren.",
  "atts.not_analyzed":
    "Noch nicht analysiert",
  "atts.none_hint":
    "Nach dem Scannen neuer Mails „Neu analysieren“ verwenden.",
  "dups.none_hint":
    "Keine Mail teilt sich eine Message-ID oder hat denselben Absender, Betreff und dieselbe Größe wie eine andere.",
  "audit.empty_hint":
    "Aktionen wie Mails in den Papierkorb verschieben, Regelläufe und Rückgängig erscheinen hier.",
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
  "body_search.local": "Lokaler Wortindex",
  "body_search.local_help":
    "Gedacht für große Postfächer und langsame Anbieter: baut einmal einen "
    + "lokalen Index auf und sucht danach sofort. Er speichert KEINEN lesbaren Mailtext, nur "
    + "geschlüsselte Hashes der Wörter jeder Mail (der Schlüssel stammt aus "
    + "MAILBROOM_SECRET_KEY). Die Suche findet ganze Wörter (Groß-/Kleinschreibung "
    + "und Akzente egal, mehrere Wörter müssen alle vorkommen), keine "
    + "Wortteile. Scans halten den Index aktuell; Ausschalten löscht ihn.",
  "index.need_key":
    "Der lokale Index braucht MAILBROOM_SECRET_KEY auf dem Server.",
  "index.save_first":
    "Erst die Einstellungen speichern, dann hier den Index aufbauen.",
  "index.none": "Noch kein Index aufgebaut.",
  "index.key_changed":
    "Der Index wurde mit einem anderen geheimen Schlüssel gebaut und ist "
    + "unbrauchbar - neu aufbauen.",
  "index.building": "Indexiere…",
  "index.status": "{docs} Mails indexiert, zuletzt aktualisiert {ts}.",
  "index.disk": "Belegter Speicherplatz: {size}",
  "index.build": "Index aufbauen",
  "index.update": "Jetzt aktualisieren",
  "index.rebuild": "Neu aufbauen",
  "index.delete": "Index löschen",
  "index.confirm_read":
    "Liest den Text von {n} gescannten Mails dieses Kontos von Ihrem "
    + "Mailserver (je die ersten ~256 KB) und speichert lokal nur "
    + "geschlüsselte Wort-Hashes - keinen lesbaren Text.",
  "index.confirm_disk":
    "Belegt etwa {size} Speicherplatz (bis zu {max} bei textlastigen "
    + "Mails); auf dem Datenträger sind {free} frei.",
  "index.confirm_time": "Das kann dauern.",
  "index.estimate":
    "Geschätzter Speicherplatz: etwa {size} für {n} Mails (bis zu {max} bei "
    + "textlastigen Mails); {free} frei auf dem Datenträger.",
  "index.confirm_tight":
    "Achtung: das passt möglicherweise nicht auf den Datenträger.",
  "index.delete_title": "Den lokalen Index löschen",
  "index.delete_body":
    "Der Wortindex des Kontos \"{name}\" wird entfernt. Sie können ihn jederzeit "
    + "neu aufbauen.",
  "notice.index_cancelled":
    "Indexierung abgebrochen - bereits Indexiertes bleibt erhalten.",
  "search.body_hint_local":
    "Durchsucht den lokalen Wortindex: nur ganze Wörter, alle müssen vorkommen.",
  "search.note.index_missing":
    "Der lokale Index wurde noch nicht aufgebaut - in den Einstellungen "
    + "aufbauen. Es werden nur Treffer in Betreff und Absender angezeigt.",
  "search.note.index_key":
    "Der lokale Index wurde mit einem anderen geheimen Schlüssel gebaut - in "
    + "den Einstellungen neu aufbauen. Es werden nur Treffer in Betreff und "
    + "Absender angezeigt.",
  "search.note.index_behind":
    "{n} neuere Mails sind noch nicht im Index - die Treffer sind evtl. "
    + "unvollständig.",
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
  "audit.empty": "Noch nichts aufgezeichnet",
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
  "menu.more": "Mehr",
  "export.csv": "CSV exportieren",
  "export.csv_tip": "Aktuelle Gruppierung als CSV exportieren",
  "bar.selected": "{n} Gruppen · {mails} Mails",
  "bar.selected_one": "1 Gruppe · {mails} Mails",
  "bar.clear": "Abwählen",
  "bar.export": "CSV-Export",
  "bar.label": "Aktionen für die Auswahl",
  "bar.limit_to": "Beschränken auf:",
  "Cancel": "Abbrechen",
  "detail.n_selected": "{n} ausgewählt",
  "detail.region": "Details: {label}",
  "Dismiss": "Schließen",
  "Refresh": "Aktualisieren",
  "OK": "OK",
  "Select {label}": "{label} auswählen",
  "Select mail": "Mail auswählen",
  "ai.consent_title": "Mail-Metadaten an den KI-Anbieter senden?",
  "Continue": "Fortfahren",
  "btn.mail_protect": "Mail schützen",
  "btn.mail_protected": "Mail geschützt",
  "btn.protect": "Schützen",
  "btn.protected": "Geschützt",
  "confirm.btn_n": "{verb} ({n})",
  "confirm.act_pinned_mail":
    "Die geschützte Mail „{subject}“ ist von Sammelaktionen ausgenommen - "
    + "dies hebt ihren Schutz ausdrücklich auf.",
  "confirm.empty_trash_body":
    "{n} Mails im Papierkorb werden endgültig gelöscht. Das lässt sich "
    + "nicht rückgängig machen.",
  "confirm.empty_trash_body_one":
    "Die 1 Mail im Papierkorb wird endgültig gelöscht. Das lässt sich nicht "
    + "rückgängig machen.",
  "confirm.empty_trash_btn": "Endgültig löschen ({n})",
  "confirm.btn_anyway": "Trotzdem: {verb}",
  "confirm.b_mails_groups": "{n} Mails aus {k} Gruppen sind betroffen",
  "confirm.b_mails_groups_one": "1 Mail aus {k} Gruppen ist betroffen",
  "select.named": "{subject} auswählen",
  "confirm.b_mails_one_group": "{n} Mails in 1 Gruppe sind betroffen",
  "confirm.b_mails_one_group_one": "1 Mail in 1 Gruppe ist betroffen",
  "bar.groups": "{n} Gruppen",
  "bar.groups_one": "1 Gruppe",
  "bar.selected_one_mail": "1 Gruppe · 1 Mail",
  "n.mails": "{n} Mails",
  "n.mails_one": "1 Mail",
  "n.senders": "{n} Absender",
  "n.senders_one": "1 Absender",
  "n.groups": "{n} Gruppen",
  "n.groups_one": "1 Gruppe",
  "filter.syntax_hint":
    "Kombinierbar: tag:shipping ai:safe age:>1y unread:>80 is:unsub Text",
  "tenant.row_tip":
    "{id} - {accounts} Konten, {scans} Scans, {rules} Regeln, {verdicts} KI-Bewertungen",
  "confirm.b_subject": "„{subject}“",
  "confirm.b_selected": "{n} ausgewählte Mails",
  "confirm.b_selected_one": "1 ausgewählte Mail",
  "confirm.b_protected_groups_skipped": "{n} geschützte Gruppen übersprungen",
  "confirm.b_protected_groups_skipped_one": "1 geschützte Gruppe übersprungen",
  "confirm.b_pinned_kept": "{n} geschützte Mails bleiben unberührt",
  "confirm.b_pinned_kept_one": "1 geschützte Mail bleibt unberührt",
  "confirm.b_pinned_skipped": "{n} geschützte Mails übersprungen",
  "confirm.b_pinned_skipped_one": "1 geschützte Mail übersprungen",
  "confirm.unsubscribe_btn": "Abbestellen",
  "confirm.restore_btn": "Wiederherstellen",
  "confirm.empty_trash_title": "Papierkorb leeren?",
  "confirm.unpin_btn": "Schutz aufheben",
  "confirm.block_title": "„{label}“ blockieren?",
  "confirm.block_body":
    "Dies legt eine dauerhafte Regel an, die künftige Mails täglich "
    + "automatisch in den Papierkorb verschiebt - umkehrbar durch Löschen "
    + "der Regel in Regeln.",
  "confirm.block_only": "Nur blockieren",
  "confirm.unblock_title": "„{label}“ entblocken?",
  "confirm.unblock_body":
    "Dies löscht die dauerhafte Regel - künftige Mails werden nicht mehr "
    + "automatisch in den Papierkorb verschoben.",
  "saved_filter.name_label": "Name",
  "saved_filter.name_required": "Bitte einen Namen eingeben.",
  "saved_filter.confirm_btn": "Löschen",
  "rule.enable_title": "Regel „{name}“ auf AUSFÜHREN umschalten?",
  "rule.enable_body":
    "Geplante Läufe verarbeiten dann passende Mails (max. 500 pro Lauf, "
    + "geschützte Absender übersprungen, Undo verfügbar).",
  "trash_all.btn": "Alle {n} in den Papierkorb",
  "trash_all.btn_one": "1 Mail in den Papierkorb",
  "trash_all.tip": "Alle {n} Mails dieser Gruppe in den Papierkorb verschieben",
  "trash_all.tip_one": "Die 1 Mail dieser Gruppe in den Papierkorb verschieben",
  "trash_this.btn": "Diese Mail in den Papierkorb",
  "block.btn": "Absender blockieren",
  "rule.f_grouping": "Gruppierung",
  "rule.f_filter": "Filter",
  "rule.f_action": "Aktion",
  "rule.f_schedule": "Zeitplan",
  "rule.f_apply": "Anwenden auf",
  "rule.f_retention_n": "Anzahl",
  "rule.f_dest": "Ordner",
  "rule.f_name": "Name",
  "rule.f_scope": "Gilt für",
  "rule.scope_mail": "Posteingang & Ordner",
  "action.purge": "Endgültig löschen",
  "rule.purge_warning":
    "Löscht Mails auf dem Server, endgültig - das lässt sich nicht "
    + "rückgängig machen. Geschützte Absender und geschützte Mails werden "
    + "nie angefasst. Eine neue Regel meldet nur, was sie löschen würde, "
    + "bis sie auf Ausführen umgeschaltet wird.",
  "rule.purge_filter_help":
    "Trifft die Absender in diesem Ordner: Freitext, from:, age: (neueste "
    + "Mail des Absenders) und unread:. Ein leerer Filter bedeutet ALLE "
    + "Absender. Hier nicht verfügbar: tag:, ai:, eng:, att:, is:, has: und domain:. "
    + "„Vor mehr als N Tagen empfangen“ gilt für jede einzelne Mail. Im "
    + "Berichtsmodus ausführen, um die Vorschau zu sehen.",
  "rule.purge_edit_reset":
    "Wird Ordner, Filter oder Alter geändert, wechselt die Regel zurück in "
    + "den Berichtsmodus - so läuft nur, was zuvor geprüft wurde.",
  "rule.run_report_btn": "Bericht erstellen",
  "rule.purge_run_report":
    "Bericht: {n} Mails würden endgültig gelöscht · Absender: {groups}",
  "rule.purge_run_report_one":
    "Bericht: 1 Mail würde endgültig gelöscht · Absender: {groups}",
  "rule.purge_run_exec":
    "ausgeführt: {n} Mails endgültig gelöscht ({matched} gefunden)",
  "rule.purge_run_exec_one":
    "ausgeführt: 1 Mail endgültig gelöscht ({matched} gefunden)",
  "rule.purge_unverified":
    "{n} Mails in den Papierkorb verschoben, aber nicht gelöscht (nicht "
    + "überprüfbar)",
  "rule.purge_unverified_one":
    "1 Mail in den Papierkorb verschoben, aber nicht gelöscht (nicht "
    + "überprüfbar)",
  "rule.purge_run_body":
    "Das löscht passende Mails endgültig auf dem Server, bis zu {cap} Mails "
    + "pro Lauf. Geschützte Absender und geschützte Mails werden nie "
    + "angefasst. Das lässt sich nicht rückgängig machen. Danach kann die "
    + "Regel zurück in den Berichtsmodus geschaltet werden.",
  "rule.purge_run_body_one":
    "Das löscht passende Mails endgültig auf dem Server, bis zu {cap} Mail "
    + "pro Lauf. Geschützte Absender und geschützte Mails werden nie "
    + "angefasst. Das lässt sich nicht rückgängig machen. Danach kann die "
    + "Regel zurück in den Berichtsmodus geschaltet werden.",
  "rule.purge_enable_body":
    "Ab jetzt löscht diese Regel Mails endgültig auf dem Server, bis zu {cap} "
    + "Mails pro Lauf (auch nach Zeitplan). Geschützte Absender und "
    + "geschützte Mails werden nie angefasst. Der Wechsel zurück in den "
    + "Berichtsmodus ist jederzeit möglich.",
  "rule.purge_enable_body_one":
    "Ab jetzt löscht diese Regel Mails endgültig auf dem Server, bis zu {cap} "
    + "Mail pro Lauf (auch nach Zeitplan). Geschützte Absender und "
    + "geschützte Mails werden nie angefasst. Der Wechsel zurück in den "
    + "Berichtsmodus ist jederzeit möglich.",
  "rule.purge_confirm_btn": "Endgültig löschen (bis zu {cap})",
  "rule.purge_all_senders":
    "Der Filter ist leer: Die Regel gilt für ALLE Absender im Ordner {folder}.",
  "rule.purge_all_short": "alle Absender",
  "rule.reset_edited":
    "Zurück im Berichtsmodus: Ordner, Filter oder Alter wurden geändert. "
    + "Vor dem Umschalten auf Ausführen erneut einen Bericht erstellen.",
  "rule.reset_account":
    "Zurück im Berichtsmodus: Das Konto wurde umbenannt, oder Server oder "
    + "Login haben sich geändert. Vor dem Umschalten auf Ausführen erneut "
    + "einen Bericht erstellen.",
  "rule.reset_folder":
    "Zurück im Berichtsmodus: Der Spam-/Papierkorb-Ordner hat sich seit dem "
    + "letzten Bericht geändert. Es wurde nichts gelöscht. Erneut einen "
    + "Bericht erstellen.",
  "qb.age_sender": "Neueste Mail des Absenders älter als",

  "ai.review_body":
    "Schon bewertet: {rated} von {total}. Beim Neubewerten gehen sie erneut "
    + "an die KI, ihre Bewertungen werden ersetzt und es werden erneut "
    + "Tokens (und Budget) verbraucht.",
  "ai.review_new": "Nur neue prüfen ({n})",
  "ai.review_rerate": "Alle neu bewerten ({n})",

  // Smart-Gruppierung (Tab "Smart": große Absender behalten eine Zeile, der
  // lange Schwanz kleiner Absender wird nach Firma / Inhalt gebündelt).
  "Smart": "Smart",
  "smart.kind.protected": "Geschützte Absender",
  "smart.kind.replied": "Leute, denen du schreibst",
  "smart.kind.orders": "Bestellungen & Lieferungen",
  "smart.kind.appointments": "Termine & Buchungen",
  "smart.kind.jobs": "Bewerbungen",
  "smart.kind.support": "Support & Anfragen",
  "smart.kind.accounts": "Konten & Sicherheit",
  "smart.kind.newsletter": "Newsletter",
  "smart.kind.individuals": "Privatpersonen",
  "smart.kind.other": "Sonstige Absender",
  "smart.cat": "Kategorie: {name}",
  "smart.why.company":
    "Mehrere Absender von {domain}, als eine Firma gebündelt, weil sie zusammen mindestens {min} Mails haben.",
  "smart.why.protected":
    "Absender mit weniger als {min} Mails, die du geschützt hast.",
  "smart.why.replied":
    "Absender mit weniger als {min} Mails, denen du geschrieben hast.",
  "smart.why.orders":
    "Absender mit weniger als {min} Mails, meist zu Bestellungen, Versand "
    + "und Rechnungen.",
  "smart.why.appointments":
    "Absender mit weniger als {min} Mails, meist zu Terminen, "
    + "Reservierungen und Buchungen.",
  "smart.why.jobs":
    "Absender mit weniger als {min} Mails, meist zu Bewerbungen.",
  "smart.why.support":
    "Absender mit weniger als {min} Mails, meist Supportfälle und "
    + "Anfragen.",
  "smart.why.accounts":
    "Absender mit weniger als {min} Mails, meist Anmeldungen und "
    + "Sicherheitscodes.",
  "smart.why.category":
    "Absender mit weniger als {min} Mails in der Kategorie \u201e{name}\u201c.",
  "smart.why.newsletter":
    "Absender mit weniger als {min} Mails, die einen Abmeldelink anbieten "
    + "oder Werbung schicken.",
  "smart.why.individuals":
    "Absender mit weniger als {min} Mails, die von einer privaten Adresse "
    + "schreiben (Gmail, Outlook, GMX, \u2026).",
  "smart.why.other":
    "Absender mit weniger als {min} Mails, deren Mails unklar sind oder von "
    + "mehreren Dingen handeln.",
  "smart.purposes": "Worum es in den Mails geht: {list}",
  "smart.purpose.orders": "Bestellungen",
  "smart.purpose.appointments": "Termine",
  "smart.purpose.jobs": "Bewerbungen",
  "smart.purpose.support": "Support",
  "smart.purpose.accounts": "Konten",
  "smart.purpose.newsletter": "Newsletter",
  "smart.purpose.unclassified": "Nicht zugeordnet",
  "smart.protected_moved":
    "{label} ist jetzt geschützt \u2013 die Mails liegen unter "
    + "\u201eGeschützte Absender\u201c.",
  // Smart-Absenderliste (was in einer gebündelten Zeile steckt, und warum).
  "smart.about.orders": "Bestellungen und Lieferungen",
  "smart.about.appointments": "Termine und Buchungen",
  "smart.about.jobs": "Bewerbungen",
  "smart.about.support": "Support und Anfragen",
  "smart.about.accounts": "Konten und Sicherheit",
  "smart.about.newsletter": "Newsletter und Werbung",
  "smart.about.individuals": "private Korrespondenz",
  "smart.about.other": "nichts Bestimmtes",
  "aisort.btn": "Mit KI sortieren",
  "aisort.title": "Die Absender in „Sonstige“ mit KI sortieren?",
  "aisort.nothing": "Nichts mehr zu sortieren: die KI hat jeden Absender in „Sonstige“ gesehen.",
  "aisort.b_units":
    "{n} Absender, die die Regeln nicht einordnen konnten (die Absender einer Firma werden zusammen gefragt)",
  "aisort.b_units_one":
    "1 Absender, den die Regeln nicht einordnen konnten",
  "aisort.b_cost": "Etwa {tin} Tokens rein, {tout} raus – ungefähr {cost}",
  "aisort.b_instructions": "Deine eigenen Anweisungen aus den Einstellungen sind dabei",
  "aisort.b_only":
    "Sie wählt nur eine der festen Arten. Es wird keine Mail verschoben oder "
    + "gelöscht, und du kannst die Sortierung wieder entfernen.",
  "aisort.go": "{n} Absender sortieren",
  "aisort.sorted_n": "{n} Absender wurden von der KI sortiert.",
  "aisort.checked_n": "Die KI hat {n} Absender angesehen und in „Sonstige“ gelassen.",
  "aisort.cleared_none": "KI-Sortierung entfernt.",
  "aisort.clear": "KI-Sortierung entfernen",
  "aisort.cleared": "KI-Sortierung entfernt: {n} Absender sind wieder dort, wo die Regeln sie hingelegt haben.",
  "aisort.clear_confirm":
    "Die KI-Sortierung von {n} Absendern entfernen? Behaltene Antworten bleiben eingeordnet.",
  "aisort.started": "KI-Sortierung gestartet.",
  "notice.ai_sort_done": "KI-Sortierung fertig: {placed} von {total} Absendern eingeordnet.",
  "notice.ai_sort_cancelled": "KI-Sortierung nach {done} von {total} Absendern abgebrochen; was sortiert ist, bleibt.",
  "notice.ai_sort_budget": "Monatsbudget der KI nach {done} von {total} Absendern erreicht; was sortiert ist, bleibt.",
  "ai.sort_instructions": "Deine Anweisungen für die KI-Sortierung (optional)",
  "ai.sort_instructions_help":
    "Wird den festen Anweisungen hinzugefügt, wenn die KI die Absender in "
    + "„Sonstige“ sortiert, z. B. „Mails von meinem Vermieter sind Support, "
    + "nicht Privatpersonen.“ Die KI wählt weiterhin nur eine der festen "
    + "Arten. Wird zusammen mit den Absenderdaten an deinen KI-Anbieter "
    + "gesendet; bis zu 1500 Zeichen.",
  "smart.reason.own": "Hat genug Mails für eine eigene Zeile.",
  "smart.reason.protected": "Du hast diesen Absender geschützt.",
  "smart.reason.replied": "Du hast diesem Absender geschrieben.",
  "smart.reason.company":
    "Gehört zu {co}: zusammen haben die Absender genug Mails für eine Zeile.",
  "smart.reason.purpose": "{n} von {of} Mails handeln von {what}.",
  "smart.reason.weak":
    "Nur {n} von {of} Mails handeln von {what} \u2013 zu wenig für eine Aussage.",
  "smart.reason.competing": "Seine Mails handeln von mehreren Dingen gleichzeitig.",
  "smart.reason.category": "In deiner Kategorie \u201e{name}\u201c.",
  "smart.reason.category_conflict": "Passt zu mehreren deiner Kategorien.",
  "smart.reason.newsletter": "Bietet einen Abmeldelink an oder schickt Werbung.",
  "smart.reason.individual": "Schreibt von einer privaten Adresse.",
  "smart.reason.ai": "Von der KI einsortiert als {what}.",
  "smart.reason.ai_other": "Von der KI geprüft: aus den Betreffs nicht klar.",
  "smart.reason.ai_other_sure": "Von der KI geprüft: gehört zu den sonstigen Absendern.",
  "smart.reason.notification":
    "Automatische Benachrichtigungen aus einem Forum oder Entwickler-Tool.",
  "smart.reason.rule": "Du hast diesen Absender unter {what} einsortiert.",
  "smart.reason.rule_co": "Du hast seine Firma unter {what} einsortiert.",
  "smart.reason.kept_ai": "Unter {what} einsortiert durch eine behaltene KI-Antwort.",
  "smart.reason.none": "In seinen Mails steht nichts, worum es geht.",
  "smart.reason.with_company":
    "Zusammen mit den anderen Absendern von {co} eingeordnet.",
  "senders.tab": "Absender ({n})",
  "senders.mails_tab": "Mails ({n})",
  "senders.view": "Was angezeigt wird",
  "senders.search": "Absender suchen\u2026",
  "senders.sort": "Absender sortieren",
  "senders.sort_count": "Meiste Mails",
  "senders.sort_last": "Neueste",
  "senders.sort_size": "Größte",
  "senders.sort_label": "Name",
  "senders.none": "Keine Absender gefunden.",
  "senders.select_shown": "Alle {n} angezeigten auswählen",
  "senders.selected": "{n} von {total} Absendern ausgewählt ({mails} Mails)",
  "senders.protect": "Schützen",
  "senders.back": "Zurück zu den Absendern",
  "senders.protected_toast":
    "{n} Absender geschützt \u2013 ihre Mails liegen unter \u201eGeschützte Absender\u201c.",
  "confirm.b_mails_senders": "{n} Mails von {k} Absendern sind betroffen",
  "confirm.b_mails_one_sender": "{n} Mails von 1 Absender sind betroffen",
  "confirm.b_protected_senders_skipped": "{n} geschützte Absender übersprungen",
  "smart.title": "Smart-Gruppierung",
  "smart.min_label": "Eigene Zeile ab N Mails",
  "smart.min_help":
    "Im Tab Smart behält ein Absender mit mindestens so vielen Mails eine "
    + "eigene Zeile; kleinere Absender werden nach Firma und nach dem "
    + "Inhalt ihrer Mails gebündelt. 2\u201350, Standard 10. Gilt sofort, "
    + "kein neuer Scan nötig.",
  // Private Absender-Kenntnisse: Absender in Smart einordnen, KI-Antworten behalten.
  "know.file_action": "In Smart einordnen als…",
  "know.file_help": "Es wird keine Mail verschoben.",
  "know.blocked.company":
    "Firmenzeilen werden nach ihrer Struktur eingeordnet, hier wirkt Einordnen nicht.",
  "know.blocked.protected":
    "Geschützte Absender bleiben in ihrem eigenen Bereich, hier wirkt Einordnen nicht.",
  "know.blocked.replied":
    "Menschen, denen du schreibst, bleiben in ihrem eigenen Bereich, hier wirkt Einordnen nicht.",
  "know.scope_title": "Nur die markierten Absender einordnen oder ganze Firmen?",
  "know.scope_body":
    "Einige der markierten Absender gehören zu einer Firmengruppe. Ordnest du "
    + "nur die markierten ein, verlassen sie die Gruppe; ordnest du die Firma "
    + "ein, wird alles von dieser Firma eingeordnet, auch Absender, die später "
    + "schreiben. Es wird in beiden Fällen keine Mail verschoben.",
  "know.scope_sender": "Nur die markierten Absender",
  "know.scope_company": "Die ganze Firma ({n} Absender)",
  "know.scope_company_one": "Die ganze Firma (1 Absender)",
  "know.filed": "{n} Absender in {kind} einsortiert.",
  "know.filed_one": "1 Absender in {kind} einsortiert.",
  "know.undone": "Einordnung rückgängig gemacht.",
  "know.kind_category": "Kategorie „{name}“",
  "know.keep_btn": "Diese Antworten behalten ({n} Absender)",
  "know.keep_btn_one": "Diese Antworten behalten (1 Absender)",
  "know.keep_title": "Die KI-Antworten für {n} Absender behalten?",
  "know.keep_title_one": "Die KI-Antwort für 1 Absender behalten?",
  "know.keep_b_rules":
    "Sie werden deine eigenen Regeln für diese Absender und bleiben, bis du "
    + "sie entfernst.",
  "know.keep_b_clearer":
    "Eindeutigere Hinweise in ihren Mails setzen sich weiterhin gegen eine "
    + "behaltene Antwort durch.",
  "know.keep_b_only":
    "„KI-Sortierung entfernen“ rührt behaltene Antworten nicht an. "
    + "Es wird keine Mail verschoben.",
  "know.keep_go": "Für {n} Absender behalten",
  "know.keep_go_one": "Für 1 Absender behalten",
  "know.kept": "KI-Antworten für {n} Absender behalten.",
  "know.kept_one": "KI-Antwort für 1 Absender behalten.",
  "know.kept_skipped":
    "{n} Absender blieben, wie sie sind: sie haben eine eigene Einordnung von dir, oder ihre Adresse lässt sich nicht einordnen.",
  "know.kept_skipped_one":
    "1 Absender blieb, wie er ist: er hat eine eigene Einordnung von dir, oder seine Adresse lässt sich nicht einordnen.",
  "know.kept_none": "Gerade gilt keine KI-Antwort.",
  "know.box_title": "So ordnet Mailbroom diesen Absender ein",
  "know.box_now": "Gerade in „{row}“.",
  "know.box_select": "Diesen Absender einordnen unter",
  "know.box_auto": "Automatisch",
  "know.src_user": "Von dir eingeordnet",
  "know.src_ai": "Behaltene KI-Antwort",
  "know.box_company": "Deine Regel für seine Firma entscheidet.",
  "know.reset": "Auf automatisch zurücksetzen",
  "know.reset_company": "Seine Firma auf automatisch zurücksetzen",
  "know.reset_done": "Wieder automatisch.",
  "know.no_effect": "Deine Einordnung wirkt gerade nicht: {why}",
  "know.no_effect_ai": "Die behaltene KI-Antwort wirkt gerade nicht: {why}",
  "know.reason.own_row": "dieser Absender hat genug Mails für eine eigene Zeile.",
  "know.reason.company_row": "seine Firma hat eine eigene Zeile.",
  "know.reason.protected": "dieser Absender ist geschützt.",
  "know.reason.replied": "du hast diesem Absender geschrieben.",
  "know.reason.rules_confident": "die Regeln sind sich jetzt sicher.",
  "know.reason.decided_by_rules":
    "die Regeln haben es schon entschieden (Newsletter, private Adresse oder Benachrichtigung).",
  "know.reason.shadowed": "eine genauere Regel von dir entscheidet.",
  "know.reason.freemail":
    "eine KI-Antwort gibt einer privaten Adresse nie einen Zweck.",
  "know.reason.in_company_group":
    "er gehört zu einer Firmengruppe, die eine behaltene Antwort nie aufteilt.",
  "know.reason.not_applied": "sie wird hier nicht angewendet.",
  "know.reason.inactive_category": "ihre Kategorie gibt es nicht mehr.",
  "know.reason.invalid_key": "sie nennt keine Firma und keine Adresse mehr.",
  "know.reason.invalid_kind": "ihre Art ist nicht bekannt.",
  "know.err.bad_request": "Die Anfrage wurde nicht verstanden.",
  "know.err.bad_key": "Das ist keine Absenderadresse und keine Firma.",
  "know.err.bad_kind": "Diese Art ist nicht verfügbar (vielleicht gibt es die Kategorie nicht mehr).",
  "know.err.bad_note": "Die Notiz ist zu lang (höchstens 200 Zeichen).",
  "know.err.full": "Die Liste der eingeordneten Absender ist voll.",
  "know.err.ai_running": "Ein KI-Lauf ist aktiv – versuche es nach dem Ende noch einmal.",
  "know.err.unscanned": "Scanne zuerst jedes Konto.",
  // Einstellungen > Absender: was Mailbroom über deine Absender weiß.
  "tab.senders": "Eingeordnete Absender",
  "tab.senders_short": "Absender",
  "know.table_title": "Was Mailbroom über deine Absender weiß",
  "know.table_help":
    "Wo du Absender und Firmen in Smart eingeordnet hast, und die "
    + "KI-Antworten, die du behalten hast. Das bleibt auf diesem Server und "
    + "wird nie an eine KI geschickt. Änderungen hier gelten sofort – es gibt "
    + "nichts zu speichern.",
  "know.empty_title": "Noch nichts eingeordnet",
  "know.empty_hint":
    "Ordne einen Absender in Smart ein (markieren, dann „In Smart einordnen "
    + "als…“) oder behalte eine KI-Antwort, dann steht er hier. Das bleibt "
    + "auf diesem Server.",
  "know.search": "Eingeordnete Absender suchen…",
  "know.none": "Keine Einträge gefunden.",
  "know.sort_label": "Einträge sortieren",
  "know.col_key": "Absender oder Firma",
  "know.col_kind": "Eingeordnet unter",
  "know.col_src": "Quelle",
  "know.col_senders": "Absender",
  "know.col_status": "Status",
  "know.col_ts": "Neueste",
  "know.company": "Firma",
  "know.kind_label": "Eingeordnet unter",
  "know.note_label": "Notiz",
  "know.note_placeholder": "Optionale Notiz (höchstens 200 Zeichen)",
  "know.edit": "Bearbeiten",
  "know.delete": "Löschen",
  "know.saved": "Gespeichert.",
  "know.select": "{name} auswählen",
  "know.select_all": "Alle angezeigten auswählen",
  "know.selected": "{n} ausgewählt",
  "know.delete_sel": "Auswahl löschen ({n})",
  "know.delete_title": "{n} Einträge löschen?",
  "know.delete_title_one": "1 Eintrag löschen?",
  "know.delete_body":
    "Die Absender sind danach wieder dort, wo die Regeln sie hingelegt "
    + "haben. Du kannst das gleich danach rückgängig machen.",
  "know.delete_go": "{n} Einträge löschen",
  "know.delete_go_one": "1 Eintrag löschen",
  "know.deleted": "{n} Einträge entfernt.",
  "know.deleted_one": "Eintrag entfernt.",
  "know.status.active": "Wirkt",
  "know.status.no_effect": "Ohne Wirkung: {why}",
  "know.status.inactive": "Inaktiv: {why}",
  "know.status.inert": "Unbrauchbar: {why}",
  "know.status.unused": "Kein Absender in deinen Postfächern passt",
  "know.status.unknown": "Noch nicht jedes Postfach ist gescannt",
  "know.status_short.active": "Wirkt",
  "know.status_short.no_effect": "Ohne Wirkung",
  "know.status_short.inactive": "Inaktiv",
  "know.status_short.inert": "Unbrauchbar",
  "know.status_short.unused": "Unbenutzt",
  "know.status_short.unknown": "Unbekannt",
  "know.unused_btn": "Unbenutzte entfernen ({n})",
  "know.unused_blocked":
    "Scanne zuerst jedes Konto ({n} noch nicht gescannt): bis dahin kann "
    + "kein Eintrag als unbenutzt gelten.",
  "know.unused_title": "{n} unbenutzte Einträge entfernen?",
  "know.unused_title_one": "1 unbenutzten Eintrag entfernen?",
  "know.unused_body":
    "Kein Absender in einem deiner Postfächer passt zu ihnen. Einträge von "
    + "Absendern, die nur eine eigene Zeile oder eine Firmenzeile haben, sind "
    + "nicht unbenutzt und bleiben. Das lässt sich nicht rückgängig machen.",
  "know.unused_go": "{n} Einträge entfernen",
  "know.unused_go_one": "1 Eintrag entfernen",
  "know.unused_done": "{n} unbenutzte Einträge entfernt.",
  "know.unused_done_one": "1 unbenutzter Eintrag entfernt.",
  "know.keep_all": "Alle KI-Antworten behalten",
  "know.forget_btn": "Behaltene KI-Antworten vergessen ({n} Absender)",
  "know.forget_btn_one": "Behaltene KI-Antworten vergessen (1 Absender)",
  "know.forget_btn_unused": "Behaltene KI-Antworten vergessen ({n} Antworten)",
  "know.forget_btn_unused_one": "Behaltene KI-Antworten vergessen (1 Antwort)",
  "know.forget_title": "Die behaltenen KI-Antworten für {n} Absender vergessen?",
  "know.forget_title_one": "Die behaltene KI-Antwort für 1 Absender vergessen?",
  "know.forget_title_unused": "{n} behaltene KI-Antworten vergessen, die gerade keinen Absender einordnen?",
  "know.forget_title_unused_one": "1 behaltene KI-Antwort vergessen, die gerade keinen Absender einordnet?",
  "know.forget_b_back": "Die Absender sind wieder dort, wo die Regeln sie hingelegt haben.",
  "know.forget_b_own": "Was du selbst eingeordnet hast, bleibt.",
  "know.forget_go": "Für {n} Absender vergessen",
  "know.forget_go_one": "Für 1 Absender vergessen",
  "know.forget_go_unused": "{n} Antworten vergessen",
  "know.forget_go_unused_one": "1 Antwort vergessen",
  "know.forgot": "Behaltene KI-Antworten für {n} Absender vergessen.",
  "know.forgot_one": "Behaltene KI-Antwort für 1 Absender vergessen.",
  "know.forgot_unused": "{n} behaltene KI-Antworten vergessen.",
  "know.forgot_unused_one": "1 behaltene KI-Antwort vergessen.",
  "know.download": "Herunterladen",
  "know.upload": "Hochladen…",
  "know.upload_bad": "In dieser Datei stehen keine eingeordneten Absender.",
  "know.upload_title": "Diese Datei mit deinen eingeordneten Absendern zusammenführen?",
  "know.upload_b_n": "Die Datei enthält {n} Einträge.",
  "know.upload_b_n_one": "Die Datei enthält 1 Eintrag.",
  "know.upload_b_merge":
    "Deine bestehenden Einträge bleiben; gibt es denselben Absender oder "
    + "dieselbe Firma in beiden, gewinnt der neuere.",
  "know.upload_go": "Zusammenführen",
  "know.uploaded": "Zusammengeführt: {n} Einträge hinzugefügt oder aktualisiert.",
  "know.uploaded_one": "Zusammengeführt: 1 Eintrag hinzugefügt oder aktualisiert.",
  "know.more": "Mehr anzeigen (noch {n})",
  "know.load_error": "Die eingeordneten Absender konnten nicht geladen werden: {msg}",
  "know.forget_b_gone":
    "Eine vergessene Antwort ist endgültig weg – sortiere erneut mit KI, um neue zu bekommen. Das lässt sich nicht rückgängig machen.",
  "know.keep_b_account":
    "Die Antworten des Kontos, das du gerade ansiehst, werden behalten; andere Konten behalten ihre, bis du sie dort behältst.",
  "know.upload_b_rest":
    "Alles andere in einem vollständigen Backup wird hier ignoriert (der Import unter Allgemein stellt das wieder her).",
  "know.download_tip":
    "Diese Liste als Datei herunterladen. Sie listet Absenderadressen und Notizen – halte sie privat.",
  "know.col_actions": "Aktionen",
  // -- Fehler der Ordner-Funktionen (Backend-Codes, siehe api.ts ERROR_CODES)
  "ferr.role_archive": "Archiv",
  "ferr.busy_action":
    "Es läuft noch eine andere Aktion – versuche es erneut, sobald "
    + "sie fertig ist.",
  "ferr.busy_purge":
    "Es läuft bereits ein endgültiges Löschen – versuche "
    + "es erneut, sobald es fertig ist.",
  "ferr.busy_scan":
    "Ein Scan läuft – versuche es erneut, sobald er fertig ist.",
  "ferr.busy_rule":
    "Eine andere Regel läuft – versuche es erneut, sobald sie "
    + "fertig ist.",
  "ferr.count_required":
    "Der Ordner wurde noch nicht gezählt – lade ihn neu und "
    + "bestätige erneut.",
  "ferr.role_missing":
    "Auf dem Server wurde kein Ordner für „{folder}“ gefunden.",
  "ferr.inbox_missing": "Auf dem Server wurde kein Posteingang gefunden.",
  "ferr.junk_needs_trash":
    "Auf dem Server wurde kein Papierkorb gefunden – Spam wird "
    + "endgültig über den Papierkorb gelöscht.",
  "ferr.role_unconfirmed":
    "Für „{folder}“ kommen mehrere Ordner infrage – wähle zuerst in "
    + "den Einstellungen den richtigen.",
  "ferr.junk_is_trash": "Spam und Papierkorb sind derselbe Ordner.",
  "ferr.folder_changed":
    "Der Ordner „{folder}“ hat sich auf dem Server geändert – lade die "
    + "Liste neu und versuche es erneut.",
  "ferr.folder_changed_rescan":
    "Der Ordner „{folder}“ hat sich auf dem Server geändert – scanne "
    + "neu und versuche es erneut.",
  "ferr.partial_unsafe":
    "Dieser Server kann einzelne Mails eines Ordners nicht sicher löschen, "
    + "deshalb wurde nichts gelöscht.",
  "ferr.partial_unsafe_changed":
    "Dieser Server kann einzelne Mails eines Ordners nicht sicher löschen, "
    + "und der Ordner hat sich seit dem Zählen geändert – lade "
    + "ihn neu und versuche es erneut. Es wurde nichts gelöscht.",
  "ferr.cannot_open":
    "Der Ordner „{folder}“ konnte auf dem Server nicht geöffnet werden.",
  "ferr.cannot_list": "Die Mailliste des Ordners konnte nicht gelesen werden.",
  "ferr.cannot_flag":
    "Der Server hat das Markieren der Mails zum Löschen nicht "
    + "akzeptiert.",
  "ferr.cannot_expunge":
    "Der Server hat die markierten Mails nicht entfernt.",
  "ferr.cannot_move": "Der Server hat das Verschieben abgelehnt.",
  "ferr.cannot_remove_copies":
    "Der Server hat die kopierten Mails nicht aus Spam entfernt.",
  "ferr.cannot_read_moved":
    "Die verschobenen Mails im Papierkorb konnten nicht gelesen werden.",
  "ferr.uv_unreadable":
    "Der Zustand des Ordners „{folder}“ konnte nicht gelesen werden – es "
    + "wird nichts gelöscht.",
  "ferr.no_known_selected":
    "Keine der ausgewählten Mails ist noch im Ordner – lade ihn neu.",
  "ferr.unknown_target": "Der Zielordner „{folder}“ existiert nicht.",
  "ferr.target_is_trash": "Das Ziel ist der Papierkorb selbst.",
  "ferr.nothing_to_undo":
    "Es gibt nichts mehr rückgängig zu machen.",
  "ferr.deleted_then_failed":
    "{cause} ({n} Mails wurden vor dem Fehler endgültig gelöscht)",
  "ferr.deleted_then_failed_one":
    "{cause} (1 Mail wurde vor dem Fehler endgültig gelöscht)",
  "ferr.stranded_then_failed":
    "{cause} ({n} Mails wurden in den Papierkorb verschoben und nicht "
    + "gelöscht)",
  "ferr.stranded_then_failed_one":
    "{cause} (1 Mail wurde in den Papierkorb verschoben und nicht "
    + "gelöscht)",
  "ferr.moved_then_failed":
    "{cause} ({n} Mails wurden vor dem Fehler verschoben)",
  "ferr.moved_then_failed_one":
    "{cause} (1 Mail wurde vor dem Fehler verschoben)",
  "ferr.rule_report_first":
    "Führe diese Regel zuerst im Berichtsmodus aus.",
  "ferr.rule_folder_changed":
    "Der Spam- oder Papierkorb-Ordner hat sich seit dem letzten Bericht "
    + "geändert – die Regel ist wieder im Berichtsmodus, es wurde "
    + "nichts gelöscht.",
  "ferr.rule_purge_grouping":
    "Spam- und Papierkorb-Regeln gelten für Absender.",
  "ferr.rule_purge_keep_latest":
    "„Neueste N behalten“ gibt es für Spam- und "
    + "Papierkorb-Regeln nicht.",
  "ferr.rule_purge_needs_age":
    "Eine Spam- oder Papierkorb-Regel braucht ein Alter (Mails älter "
    + "als N Tage).",
  "ferr.rule_purge_filter":
    "Dieser Filter ist für Spam- und Papierkorb-Regeln nicht "
    + "verfügbar: {names}",
  "ferr.rule_purge_filter_domain":
    "Dieser Filter ist für Spam- und Papierkorb-Regeln nicht "
    + "verfügbar: {names} (er trifft nie auf Absender – nutze "
    + "stattdessen Freitext wie den Domainnamen).",
  "undo.from_junk": "{n} Mails aus Spam",
  "undo.from_junk_one": "1 Mail aus Spam",
  "undo.from_trash": "{n} Mails aus dem Papierkorb",
  "undo.from_trash_one": "1 Mail aus dem Papierkorb",
  // Klartext -> Filter (components/AiFilterPanel.tsx)
  "aif.button": "Filter beschreiben",
  "aif.title": "Filter beschreiben",
  "aif.sub": "Ihre KI schreibt den Filter - Sie prüfen ihn vorher",
  "aif.label": "Beschreiben Sie, wonach Sie suchen",
  "aif.placeholder":
    "z. B. Shop-Newsletter, die ich seit einem Jahr nicht geöffnet habe",
  "aif.disclosure":
    "Nur dieser Satz und die Filter-Syntax gehen an Ihren KI-Anbieter - "
    + "keine Maildaten.",
  "aif.chars": "{n} / {max}",
  "aif.send": "Senden",
  "aif.thinking": "Filter wird geschrieben…",
  "aif.query_label": "Filter (editierbar)",
  "aif.preview_label": "Trifft aktuell zu auf",
  "aif.groups": "{n} Gruppen",
  "aif.groups_one": "1 Gruppe",
  "aif.mails": "{n} Mails",
  "aif.mails_one": "1 Mail",
  "aif.incl_protected": "davon {n} geschützt",
  "aif.no_match": "Dieser Filter trifft auf nichts zu.",
  "aif.no_scan": "Scannen Sie Ihr Postfach, um zu sehen, wie viel zutrifft.",
  "aif.unsupported": "Nicht ausdrückbar: {items}",
  "aif.cost": "KI-Kosten: {cost}",
  "aif.apply": "Anwenden",
  "aif.save_preset": "Als Vorlage speichern",
  "aif.save_rule": "Als Regel speichern…",
  "aif.back": "Zurück",
  "aif.nothing_selected": "Anwenden filtert nur die Liste - es wird nichts "
    + "ausgewählt oder geändert.",
  "aif.preset_saved": "Vorlage gespeichert.",
  "aif.err.not_configured": "Richten Sie zuerst in den Einstellungen einen KI-Anbieter ein.",
  "aif.err.text_empty": "Beschreiben Sie zuerst, wonach Sie suchen.",
  "aif.err.text_too_long": "Bitte höchstens 300 Zeichen.",
  "aif.err.budget":
    "Das monatliche KI-Budget ist aufgebraucht - erhöhen Sie es in den "
    + "Einstellungen, um fortzufahren.",
  "space.title": "Speicherkarte",
  "space.total": "{size} in {mails} Mails",
  "space.total_one": "{size} in {mails} Mail",
  "space.empty": "Noch nichts zu zeigen - starte zuerst einen Scan.",
  "space.color_by": "Einfärben nach",
  "space.by_engagement": "Interaktion",
  "space.by_age": "Alter der letzten Mail",
  "space.by_ai": "KI-Urteil",
  "space.select": "Auswählen",
  "space.crumbs": "Pfad der Speicherkarte",
  "space.all": "Alle Mails",
  "space.map": "Postfach nach Größe",
  "space.legend": "Farblegende",
  "space.eng_low": "Selten geöffnet",
  "space.eng_mid": "Manchmal geöffnet",
  "space.eng_high": "Oft gelesen",
  "space.age_old": "Letzte Mail vor über 2 Jahren",
  "space.age_mid": "Vor 6-24 Monaten",
  "space.age_new": "In den letzten 6 Monaten",
  "space.ai_safe": "Unbedenklich löschbar",
  "space.ai_review": "Prüfen",
  "space.ai_keep": "Behalten",
  "space.ai_none": "Nicht bewertet",
  "space.other": "Sonstige ({n})",
  "space.tile": "{name}, {size}, {mails} Mails",
  "space.tile_one": "{name}, {size}, {mails} Mail",
  "space.tile_protected": "{n} geschützte Absender",
  "space.tile_protected_one": "1 geschützter Absender",
  "space.tile_selected": "ausgewählt",
  "space.tick": "{name} auswählen",
  "space.top": "Die größten auf dieser Ebene",
  "space.protected_note": "Geschützte Absender lassen sich hier nicht auswählen.",
  "space.selected": "{n} Absender - {size} ausgewählt",
  "space.selected_one": "1 Absender - {size} ausgewählt",
  "space.filter_cleared": "Filter zurückgesetzt, damit deine Auswahl sichtbar ist.",
  "triage.menu": "Triage",
  "triage.menu_sub": "Gruppen durchwischen, am Ende anwenden",
  "triage.title": "Triage",
  "triage.progress": "Karte {n} von {total}",
  "triage.summary_title": "Deine Entscheidungen",
  "triage.trash": "Papierkorb",
  "triage.keep": "Behalten",
  "triage.unsub": "Abbestellen",
  "triage.protect": "Schützen",
  "triage.undo": "Letzte Entscheidung rückgängig",
  "triage.done": "Fertig",
  "triage.mails": "Mails",
  "triage.size": "Größe",
  "triage.protected_label": "Geschützt",
  "triage.protected_kept": "Geschützt - bleibt erhalten",
  "triage.hint":
    "Nach links wischen = Papierkorb, nach rechts = behalten, nach oben = abbestellen. Die Schaltflächen und die Pfeiltasten funktionieren auch.",
  "triage.nothing_yet": "Noch nichts entschieden",
  "triage.s_trash": "{n} Gruppen in den Papierkorb · {size}",
  "triage.s_trash_one": "1 Gruppe in den Papierkorb · {size}",
  "triage.s_unsub": "{n} abbestellen",
  "triage.s_protect": "{n} schützen",
  "triage.s_trash_mails":
    "{mails} Mails aus {n} Gruppen in den Papierkorb verschieben (bis zu {size})",
  "triage.s_trash_mails_one":
    "{mails} Mails aus 1 Gruppe in den Papierkorb verschieben (bis zu {size})",
  "triage.s_unsub_long": "{n} Absender abbestellen",
  "triage.s_unsub_long_one": "1 Absender abbestellen",
  "triage.s_protect_long": "{n} Einträge zur Schutzliste hinzufügen",
  "triage.s_protect_long_one": "1 Eintrag zur Schutzliste hinzufügen",
  "triage.kept_note": "{n} bleiben unverändert.",
  "triage.unseen_note": "{n} Karten noch nicht angesehen.",
  "triage.nothing_to_apply":
    "Nichts anzuwenden - jede Gruppe bleibt, wie sie ist.",
  "triage.back": "Zurück zu den Karten",
  "triage.apply": "Anwenden",
  "triage.discard_title": "{n} Entscheidungen verwerfen?",
  "triage.discard_title_one": "1 Entscheidung verwerfen?",
  "triage.discard_body": "In deinem Postfach wurde nichts verändert.",
  "triage.discard": "Verwerfen",
  "triage.confirm_title": "Triage-Entscheidungen anwenden?",
  "triage.c_trash":
    "{mails} Mails aus {n} Gruppen in den Papierkorb verschieben",
  "triage.c_trash_one": "{mails} Mails aus 1 Gruppe in den Papierkorb verschieben",
  "triage.c_unsub": "{n} Absender abbestellen",
  "triage.c_unsub_one": "1 Absender abbestellen",
  "triage.c_protect": "{n} Einträge zur Schutzliste hinzufügen",
  "triage.c_protect_one": "1 Eintrag zur Schutzliste hinzufügen",
  "triage.c_undo": "Das Verschieben in den Papierkorb lässt sich anschließend rückgängig machen",
  "triage.apply_btn": "Anwenden",
};
