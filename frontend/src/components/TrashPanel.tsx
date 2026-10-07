import { RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, fmtSize, mailKey } from "../api";
import { t } from "../i18n";
import type { AppState, Mail, TrashResp } from "../types";
import { MessageView } from "./MailList";
import { Button, Checkbox, EmptyState, Input, Loading, Modal, PanelHeader,
  Select, Spinner, Toolbar } from "./ui";

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
      setNote(t(r.rescan ? "trash.restored_refreshing" : "trash.restored",
        { n: r.restored }));
      setTrash({ ...trash, total: trash.total - r.restored,
        mails: trash.mails.filter((m) => !sel.has(mailKey(m))) });
      setSel(new Set());
      onChanged();
    } catch (e: any) {
      setNote(`Error: ${e.message ?? e}`);
    }
    setBusy(false);
  };

  return (
    <Modal onClose={onClose} full>
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <Trash2 size={18} /> {t("Trash")}
        </span>}
        sub={trash
          ? `${trash.total} ${t("mails")}`
            + (trash.total > trash.mails.length
               ? ` (${t("trash.newest_shown", { n: trash.mails.length })})`
               : "")
          : t("loading…")}
        actions={<Button variant="secondary" size="icon" label={t("Refresh")}
          onClick={load}><RefreshCw size={18} /></Button>}
        onClose={onClose}
      />

      {view ? (
        <MessageView mail={view} onBack={() => setView(null)} />
      ) : (
        <>
          <Toolbar>
            <Input className="min-w-32 flex-1"
              placeholder={t("trash.search")}
              value={q} onChange={(e) => setQ(e.target.value)} />
            <Select value="" disabled={!sel.size || busy}
              onChange={(e) => restore(e.target.value)}>
              <option value="" disabled>
                {t("trash.restore_to")}{sel.size ? ` (${sel.size})` : ""}
              </option>
              {(state.folders_raw ?? []).map((f, i) => (
                <option key={f} value={f}>{state.folders[i] ?? f}</option>
              ))}
            </Select>
            {busy && <Spinner />}
            {note && <span className="w-full type-meta text-muted">{note}</span>}
          </Toolbar>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {error && <div className="p-4 type-body text-danger-fg">{error}</div>}
            {!shown && !error && <Loading />}
            {shown && shown.length === 0 && (
              <EmptyState>{t("trash.empty")}</EmptyState>
            )}
            {shown?.map((m) => (
              <div key={mailKey(m)}
                className="flex flex-wrap items-baseline gap-2 border-b
                  border-line/60 px-1 py-2">
                <Checkbox checked={sel.has(mailKey(m))} className="-my-1 self-center"
                  onChange={() => toggle(mailKey(m))} />
                <span className="type-meta whitespace-nowrap text-muted">
                  {(m.date || "").slice(0, 10)}
                </span>
                <button className="min-w-0 flex-1 basis-full cursor-pointer
                    truncate text-left type-body hover:underline sm:basis-0"
                  onClick={() => setView(m)}>
                  {m.subject || t("(no subject)")}
                  <span className="block truncate type-meta text-muted">
                    {m.addr}
                  </span>
                </button>
                <span className="type-meta whitespace-nowrap text-muted">
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
