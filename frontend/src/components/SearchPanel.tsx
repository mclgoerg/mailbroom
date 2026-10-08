import { Search } from "lucide-react";
import { useState } from "react";
import { api, mailKey } from "../api";
import { t } from "../i18n";
import type { Mail, SearchNote } from "../types";
import { MailRows, MessageView } from "./MailList";
import { Button, Checkbox, confirmTrashMails, EmptyState, Input, Modal,
  PanelHeader, Spinner, Toolbar } from "./ui";

export function SearchPanel({ bodySearch = false, bodyMode = "server",
  onClose, onDeleted }: {
  /** The account's body_search mode is "server" or "local": offer the
   *  mail-text toggle. */
  bodySearch?: boolean;
  bodyMode?: "server" | "local";
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [q, setQ] = useState("");
  const [mails, setMails] = useState<Mail[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [notes, setNotes] = useState<SearchNote[]>([]);
  const [inBody, setInBody] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<Mail | null>(null);

  const run = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    setNote("");
    setNotes([]);
    setSel(new Set());
    try {
      const r = await api.search(q.trim(), bodySearch && inBody);
      setMails(r.mails);
      setNotes(r.notes);
      setNote(r.mails.length === 500
        ? t("Showing the newest 500 matches.") : "");
    } catch (e: any) {
      setNote(`Error: ${e.message ?? e}`);
    }
    setBusy(false);
  };

  const toggle = (k: string) => {
    const next = new Set(sel);
    next.has(k) ? next.delete(k) : next.add(k);
    setSel(next);
  };

  const trashSelected = async () => {
    if (!mails || sel.size === 0) return;
    if (!await confirmTrashMails(sel.size)) return;
    try {
      const items = mails.filter((m) => sel.has(mailKey(m)))
        .map((m) => [m.folder, m.uid] as [string, number]);
      await api.deleteMessages(items);
      setMails(mails.filter((m) => !sel.has(mailKey(m))));
      setSel(new Set());
      setNote(t("note.background", { verb: t("Move to Trash") }));
      onDeleted();
    } catch (e: any) {
      setNote(`Error: ${e.message ?? e}`);
    }
  };

  return (
    <Modal onClose={onClose} full={!!view || !!mails?.length}>
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <Search size={18} /> {t("Search")}
        </span>}
        sub={mails !== null ? `${mails.length} ${t("matches")}` : ""}
        onClose={onClose}
      />

      {view ? (
        <MessageView mail={view} onBack={() => setView(null)} />
      ) : (
        <>
          <Toolbar>
            <Input
              autoFocus
              className="w-full sm:w-auto sm:min-w-32 sm:flex-1"
              placeholder={bodySearch && inBody
                ? t("search.placeholder_body") : t("search.placeholder")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()}
            />
            <Button onClick={run} disabled={busy || q.trim().length < 2}>
              {busy ? <Spinner className="text-white" /> : t("Search")}
            </Button>
            {bodySearch && (
              <Checkbox className="type-meta text-muted" checked={inBody}
                onChange={(e) => setInBody(e.target.checked)}
                label={t("search.body_toggle")} />
            )}
            {!!mails?.length && (
              <Button variant="secondary"
                onClick={() => setSel(sel.size === mails.length
                  ? new Set() : new Set(mails.map(mailKey)))}>
                {t("Select all")}
              </Button>
            )}
            {sel.size > 0 && (
              <Button variant="danger" onClick={trashSelected}>
                {t("Trash selected")} ({sel.size})
              </Button>
            )}
            {note && <span className="type-meta text-muted">{note}</span>}
          </Toolbar>
          {bodySearch && inBody && (
            <p className="px-4 pt-2 type-meta text-muted">
              {t(bodyMode === "local"
                ? "search.body_hint_local" : "search.body_hint")}
            </p>
          )}
          {notes.map((n) => (
            <p key={n.key + JSON.stringify(n.params)}
              className="px-4 pt-2 type-meta text-muted">
              {t(`search.note.${n.key}`, n.params)}
            </p>
          ))}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {mails === null && (
              <EmptyState icon={<Search size={18} />}
                title={t("search.empty_title")}
                hint={t(bodySearch
                  ? "search.empty_hint_body" : "search.empty_hint")} />
            )}
            {mails?.length === 0 && (
              <EmptyState icon={<Search size={18} />}
                title={t("search.none")} hint={t("search.none_hint")} />
            )}
            {!!mails?.length && (
              <MailRows mails={mails} sel={sel} onToggle={toggle}
                onOpen={setView} />
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
