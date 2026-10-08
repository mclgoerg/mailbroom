import { Paperclip } from "lucide-react";
import { useEffect, useState } from "react";
import { api, fmtSize, mailKey } from "../api";
import { getLang, t } from "../i18n";
import { fmtDate } from "../lib";
import type { AppState, AttMail, Mail } from "../types";
import { MessageView } from "./MailList";
import { Button, confirmTrashMails, EmptyState, Loading, MailRow, Modal,
  PanelHeader, Spinner, Tag, Toolbar } from "./ui";

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
    if (!await confirmTrashMails(sel.size)) return;
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

  // An empty panel (nothing analyzed yet / nothing found) shrinks to its
  // message; a list keeps the fixed height.
  const emptyPanel = mails?.length === 0
    || (!mails && atts?.status !== "done");

  return (
    <Modal onClose={onClose} full={!!view || running || !emptyPanel}>
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
          {(sel.size > 0 || atts?.status === "error" || note) && (
            <Toolbar>
              {sel.size > 0 && (
                <Button variant="danger" onClick={() => act("trash")}>
                  {t("Trash selected")} ({sel.size})
                </Button>
              )}
              {atts?.status === "error" && (
                <span className="type-meta text-danger-fg">{atts.error}</span>
              )}
              {note && <span className="type-meta text-muted">{note}</span>}
            </Toolbar>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {!mails && !running && atts?.status !== "done" && (
              <EmptyState icon={<Paperclip size={18} />}
                title={t("atts.not_analyzed")} hint={t("atts.intro")} />
            )}
            {running && (
              <Loading label={starting ? t("Starting…") : atts.progress} />
            )}
            {!running && atts?.status === "done" && mails === null && (
              <Loading />
            )}
            {mails && mails.length === 0 && (
              <EmptyState icon={<Paperclip size={18} />}
                title={t("atts.none")} hint={t("atts.none_hint")} />
            )}
            {mails?.map((m) => (
              <MailRow key={mailKey(m)} checked={sel.has(mailKey(m))}
                onToggle={() => toggle(mailKey(m))} onOpen={() => setView(m)}
                subject={m.subject || t("(no subject)")}
                meta={[fmtDate(m.date || "", new Date(), { lang: getLang() }),
                  m.addr, m.atts.map((a) => `${a.name} (${fmtSize(a.size)})`)
                    .join(", ")].filter(Boolean).join(" · ")}
                trailing={<Tag tone="attach">📎 {fmtSize(m.att_size)}</Tag>} />
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
