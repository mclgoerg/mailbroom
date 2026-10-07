import { X } from "lucide-react";
import { useState } from "react";
import { api, mailKey } from "../api";
import { t } from "../i18n";
import type { Mail, SearchNote } from "../types";
import { MailRows, MessageView } from "./MailList";
import { Button, EmptyState, Input, Modal, Spinner, Toolbar } from "./ui";

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
    if (!confirm(t("confirm.act_mails", { verb: t("Move to Trash"), n: sel.size }))) return;
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
    <Modal onClose={onClose} full>
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Input
          autoFocus
          className="flex-1"
          placeholder={bodySearch && inBody
            ? t("search.placeholder_body")
            : t("search all scanned mails (subject / sender)…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
        />
        <Button onClick={run} disabled={busy || q.trim().length < 2}>
          {busy ? <Spinner className="!text-white" /> : t("Search")}
        </Button>
        <Button variant="ghost" onClick={onClose} title={t("Close")}>
          <X size={17} />
        </Button>
      </div>

      {view ? (
        <MessageView mail={view} onBack={() => setView(null)} />
      ) : (
        <>
          <Toolbar>
            <Button variant="ghost" disabled={!mails?.length}
              onClick={() => setSel(sel.size === (mails?.length ?? 0)
                ? new Set() : new Set((mails ?? []).map(mailKey)))}>
              {t("Select all")}
            </Button>
            <Button variant="danger" onClick={trashSelected}
              disabled={sel.size === 0}>
              {t("Trash selected")}{sel.size > 0 && ` (${sel.size})`}
            </Button>
            {bodySearch && (
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" checked={inBody}
                  onChange={(e) => setInBody(e.target.checked)} />
                {t("search.body_toggle")}
              </label>
            )}
            <span className="text-xs text-muted">
              {mails !== null && `${mails.length} ${t("matches")}`} {note}
            </span>
          </Toolbar>
          {bodySearch && inBody && (
            <p className="px-4 pb-1 text-xs text-muted">
              {t(bodyMode === "local"
                ? "search.body_hint_local" : "search.body_hint")}
            </p>
          )}
          {notes.map((n) => (
            <p key={n.key + JSON.stringify(n.params)}
              className="px-4 pb-1 text-xs text-muted">
              {t(`search.note.${n.key}`, n.params)}
            </p>
          ))}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {mails === null && (
              <EmptyState>
                {t("Search every scanned mail by subject or sender.")}
              </EmptyState>
            )}
            {mails && (
              <MailRows mails={mails} sel={sel} onToggle={toggle}
                onOpen={setView} />
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
