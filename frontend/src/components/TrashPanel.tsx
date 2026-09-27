import { useEffect, useMemo, useState } from "react";
import { api, fmtSize, mailKey } from "../api";
import { t } from "../i18n";
import type { AppState, Mail, TrashResp } from "../types";
import { MessageView } from "./MailList";
import { Button, Modal, Spinner } from "./ui";

/** Trash browser: live Trash contents (also mail deleted outside the app),
 *  with search and restore-to-folder. */
export function TrashPanel({ state, onClose, onChanged }: {
  state: AppState;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [trash, setTrash] = useState<TrashResp | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [view, setView] = useState<Mail | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    setTrash(null);
    setSel(new Set());
    api.trash()
      .then(setTrash)
      .catch((e) => setError(String(e.message ?? e)));
  };
  useEffect(load, []);

  const shown = useMemo(() => {
    if (!trash) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return trash.mails;
    return trash.mails.filter((m) =>
      m.subject.toLowerCase().includes(needle) || m.addr.includes(needle));
  }, [trash, q]);

  const toggle = (k: string) => {
    const next = new Set(sel);
    next.has(k) ? next.delete(k) : next.add(k);
    setSel(next);
  };

  const restore = async (dest: string) => {
    if (!trash || !dest || sel.size === 0) return;
    setBusy(true);
    setNote("");
    try {
      const uids = trash.mails.filter((m) => sel.has(mailKey(m)))
        .map((m) => m.uid);
      const r = await api.trashRestore(uids, dest, trash.uv);
      setNote(t("trash.restored", { n: r.restored }));
      setTrash({ ...trash, total: trash.total - r.restored,
        mails: trash.mails.filter((m) => !sel.has(mailKey(m))) });
      setSel(new Set());
      onChanged();
    } catch (e: any) {
      setNote(`Error: ${e.message ?? e}`);
    }
    setBusy(false);
  };

  const sel9 = `min-h-9 rounded-md border border-line bg-panel2 px-2 py-1.5
    text-sm`;

  return (
    <Modal onClose={onClose} full>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">🗑 {t("Trash")}</div>
          <div className="text-xs text-muted">
            {trash
              ? `${trash.total} ${t("mails")}`
                + (trash.total > trash.mails.length
                   ? ` (${t("trash.newest_shown",
                       { n: trash.mails.length })})` : "")
              : t("loading…")}
          </div>
        </div>
        <Button variant="ghost" onClick={load}>⟳</Button>
        <Button variant="ghost" onClick={onClose}>✕</Button>
      </div>

      {view ? (
        <MessageView mail={view} onBack={() => setView(null)} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b
            border-line px-4 py-2">
            <input className={`${sel9} min-w-32 flex-1`}
              placeholder={t("trash.search")}
              value={q} onChange={(e) => setQ(e.target.value)} />
            <select className={sel9} value="" disabled={!sel.size || busy}
              onChange={(e) => restore(e.target.value)}>
              <option value="" disabled>
                {t("trash.restore_to")}{sel.size ? ` (${sel.size})` : ""}
              </option>
              {(state.folders_raw ?? []).map((f, i) => (
                <option key={f} value={f}>{state.folders[i] ?? f}</option>
              ))}
            </select>
            {busy && <Spinner />}
            {note && <span className="w-full text-xs text-muted">{note}</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {error && <div className="p-4 text-sm text-rose-400">{error}</div>}
            {!shown && !error && (
              <div className="p-4 text-sm text-muted"><Spinner /></div>
            )}
            {shown && shown.length === 0 && (
              <div className="p-4 text-sm text-muted">{t("trash.empty")}</div>
            )}
            {shown?.map((m) => (
              <div key={mailKey(m)}
                className="flex flex-wrap items-baseline gap-2 border-b
                  border-line/60 px-1 py-2">
                <input type="checkbox" checked={sel.has(mailKey(m))}
                  onChange={() => toggle(mailKey(m))} />
                <span className="text-xs whitespace-nowrap text-muted">
                  {(m.date || "").slice(0, 10)}
                </span>
                <button className="min-w-0 flex-1 basis-full cursor-pointer
                    truncate text-left text-sm hover:underline sm:basis-0"
                  onClick={() => setView(m)}>
                  {m.subject || t("(no subject)")}
                  <span className="block truncate text-xs text-faint">
                    {m.addr}
                  </span>
                </button>
                <span className="text-xs whitespace-nowrap text-faint">
                  {fmtSize(m.size)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
