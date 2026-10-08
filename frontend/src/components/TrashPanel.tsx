import { RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, fmtSize, mailKey } from "../api";
import { t } from "../i18n";
import type { AppState, Mail, TrashResp } from "../types";
import { MessageView } from "./MailList";
import { Button, EmptyState, Input, Loading, MailRow, Modal, PanelHeader,
  Select, Spinner, Toolbar } from "./ui";

/** Trash browser: live Trash contents (also mail deleted outside the app),
 *  with search and restore-to-folder. */
export function TrashPanel({ state, onClose, onChanged, onEmptyTrash }: {
  state: AppState;
  onClose: () => void;
  onChanged: () => void;
  /** The shared "Empty Trash" flow (confirm + permanent delete), given the
   *  live total this panel just listed; resolves true once emptied. */
  onEmptyTrash: (total: number) => Promise<boolean>;
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
    <Modal onClose={onClose} size="lg"
      full={!!view || !shown || shown.length > 0 || !!q}>
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
          {trash && (trash.mails.length > 0 || note) && (
            <Toolbar>
              <Input className="w-full sm:w-auto sm:min-w-32 sm:flex-1"
                placeholder={t("search.placeholder")}
                value={q} onChange={(e) => setQ(e.target.value)} />
              {sel.size > 0 && (
                <Select value="" disabled={busy}
                  onChange={(e) => restore(e.target.value)}>
                  <option value="" disabled>
                    {t("trash.restore_to")} ({sel.size})
                  </option>
                  {(state.folders_raw ?? []).map((f, i) => (
                    <option key={f} value={f}>{state.folders[i] ?? f}</option>
                  ))}
                </Select>
              )}
              {busy && <Spinner />}
              {note && <span className="w-full type-meta text-muted">{note}</span>}
            </Toolbar>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto pb-4">
            {error && <div className="p-4 type-body text-danger-fg">{error}</div>}
            {!shown && !error && <Loading />}
            {shown && shown.length === 0 && (
              <EmptyState icon={<Trash2 size={18} />}
                title={t(trash?.mails.length ? "trash.no_match" : "trash.empty")}
                hint={trash?.mails.length ? undefined : t("trash.empty_hint")} />
            )}
            {shown?.map((m) => (
              <MailRow key={mailKey(m)} checked={sel.has(mailKey(m))}
                onToggle={() => toggle(mailKey(m))} onOpen={() => setView(m)}
                unread={!m.seen} subject={m.subject || t("(no subject)")}
                dateIso={m.date || ""}
                selectLabel={t("select.named",
                  { subject: m.subject || t("(no subject)") })}
                meta={[m.addr, fmtSize(m.size)].join(" · ")} />
            ))}
          </div>
          {trash && trash.total > 0 && (
            <div className="flex justify-end border-t border-line px-4 py-2">
              <Button variant="danger-quiet" disabled={busy}
                onClick={async () => {
                  if (await onEmptyTrash(trash.total)) load();
                }}>
                {t("Empty Trash")} ({trash.total})…
              </Button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
