import { useState } from "react";
import { api, mailKey } from "../api";
import { t } from "../i18n";
import type { Mail } from "../types";
import { MailRows, MessageView } from "./MailList";
import { Button, Modal, Spinner } from "./ui";

export function SearchPanel({ onClose, onDeleted }: {
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [q, setQ] = useState("");
  const [mails, setMails] = useState<Mail[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<Mail | null>(null);

  const run = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    setNote("");
    setSel(new Set());
    try {
      const r = await api.search(q.trim());
      setMails(r);
      setNote(r.length === 500 ? t("Showing the newest 500 matches.") : "");
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
        <input
          autoFocus
          className="min-h-9 flex-1 rounded-md border border-line
            bg-panel2 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
          placeholder={t("search all scanned mails (subject / sender)…")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
        />
        <Button onClick={run} disabled={busy || q.trim().length < 2}>
          {busy ? <Spinner className="!text-white" /> : t("Search")}
        </Button>
        <Button variant="ghost" onClick={onClose}>✕</Button>
      </div>

      {view ? (
        <MessageView mail={view} onBack={() => setView(null)} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b
            border-line px-4 py-2">
            <Button variant="ghost" disabled={!mails?.length}
              onClick={() => setSel(sel.size === (mails?.length ?? 0)
                ? new Set() : new Set((mails ?? []).map(mailKey)))}>
              {t("Select all")}
            </Button>
            <Button variant="danger" onClick={trashSelected}
              disabled={sel.size === 0}>
              {t("Trash selected")}{sel.size > 0 && ` (${sel.size})`}
            </Button>
            <span className="text-xs text-muted">
              {mails !== null && `${mails.length} ${t("matches")}`} {note}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {mails === null && (
              <div className="p-6 text-center text-sm text-muted">
                {t("Search every scanned mail by subject or sender.")}
              </div>
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
