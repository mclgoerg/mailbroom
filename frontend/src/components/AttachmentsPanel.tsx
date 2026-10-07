import { Paperclip } from "lucide-react";
import { useEffect, useState } from "react";
import { api, fmtSize, mailKey } from "../api";
import { t } from "../i18n";
import type { AppState, AttMail, Mail } from "../types";
import { MessageView } from "./MailList";
import { Button, Checkbox, EmptyState, Loading, Modal, PanelHeader, Spinner,
  Tag, Toolbar } from "./ui";

/** Attachment explorer: lazy BODYSTRUCTURE analysis, then the mailbox's
 *  attachment-heaviest mails. Proton IMAP cannot strip attachments, so the
 *  actions delete/move whole mails (reversible, as everywhere). */
export function AttachmentsPanel({ state, onClose, onDeleted }: {
  state: AppState;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [mails, setMails] = useState<AttMail[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [view, setView] = useState<Mail | null>(null);
  const [note, setNote] = useState("");
  // Covers the gap between clicking Analyze and the next state update, so
  // there is feedback within a blink even before the job reports progress.
  const [starting, setStarting] = useState(false);

  const atts = state.atts;
  const running = starting || atts?.status === "running";

  // When the analysis finishes (state tick), load the result list.
  useEffect(() => {
    if (!starting && atts?.status === "done" && mails === null) {
      api.attachments().then(setMails).catch((e) =>
        setNote(`Error: ${e.message ?? e}`));
    }
  }, [starting, atts?.status, mails]);

  const analyze = async () => {
    setNote("");
    setStarting(true);
    try {
      await api.startAttachments();
      await onDeleted();   // pull fresh state: job now shows as running
      setMails(null);      // ready for the fresh list once it's done
    } catch (e: any) {
      setNote(`Error: ${e.message ?? e}`);
    }
    setStarting(false);
  };

  const cancel = async () => {
    try { await api.cancel("atts"); } catch { /* too late */ }
  };

  const act = async (action: string) => {
    if (!mails || sel.size === 0) return;
    if (!confirm(t("confirm.act_mails", {
      verb: t("Move to Trash"), n: sel.size }))) return;
    try {
      const items = mails.filter((m) => sel.has(mailKey(m)))
        .map((m) => [m.folder, m.uid] as [string, number]);
      await api.deleteMessages(items, action);
      setMails(mails.filter((m) => !sel.has(mailKey(m))));
      setSel(new Set());
      setNote(t("note.background", { verb: t("Move to Trash") }));
      onDeleted();
    } catch (e: any) {
      setNote(`Error: ${e.message ?? e}`);
    }
  };

  const toggle = (k: string) => {
    const next = new Set(sel);
    next.has(k) ? next.delete(k) : next.add(k);
    setSel(next);
  };

  return (
    <Modal onClose={onClose} full>
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <Paperclip size={18} /> {t("Attachments")}
        </span>}
        sub={atts?.status === "done"
          ? t("atts.summary", { n: atts.mails, size: fmtSize(atts.size) })
          : t("atts.hint")}
        actions={running ? (
          <Button variant="secondary" onClick={cancel}>
            <Spinner /> {starting ? t("Starting…") : atts.progress}{" "}
            - {t("cancel")}
          </Button>
        ) : (
          <Button variant="secondary" onClick={analyze}
            disabled={state.status !== "done"}>
            {atts?.status === "done" ? t("atts.reanalyze") : t("atts.analyze")}
          </Button>
        )}
        onClose={onClose}
      />

      {view ? (
        <MessageView mail={view} onBack={() => setView(null)} />
      ) : (
        <>
          <Toolbar>
            <Button variant="danger" disabled={sel.size === 0}
              onClick={() => act("trash")}>
              {t("Trash selected")}{sel.size > 0 && ` (${sel.size})`}
            </Button>
            {atts?.status === "error" && (
              <span className="type-meta text-danger-fg">{atts.error}</span>
            )}
            {note && <span className="type-meta text-muted">{note}</span>}
          </Toolbar>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {!mails && !running && atts?.status !== "done" && (
              <EmptyState>{t("atts.intro")}</EmptyState>
            )}
            {running && (
              <Loading label={starting ? t("Starting…") : atts.progress} />
            )}
            {!running && atts?.status === "done" && mails === null && (
              <Loading />
            )}
            {mails && mails.length === 0 && (
              <EmptyState>{t("atts.none")}</EmptyState>
            )}
            {mails?.map((m) => (
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
                  title={m.addr}
                  onClick={() => setView(m)}>
                  {m.subject || t("(no subject)")}
                  <span className="block truncate type-meta text-muted">
                    {m.addr} · {m.atts.map((a) =>
                      `${a.name} (${fmtSize(a.size)})`).join(", ")}
                  </span>
                </button>
                <Tag tone="attach">
                  📎 {fmtSize(m.att_size)}
                </Tag>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
