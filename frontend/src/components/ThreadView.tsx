import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, mailKey } from "../api";
import { t } from "../i18n";
import { splitQuoted } from "../quoted";
import type { ConversationResp, Mail, MessageDetail } from "../types";
import { Button, Spinner } from "./ui";

type Body = MessageDetail | "loading" | { error: string };

/** One conversation, oldest first, as a stack of collapsible mails: the
 *  thread's scanned mails plus the user's own replies from Sent. Bodies are
 *  fetched live when a mail is expanded (same as the single-mail view) and
 *  their quoted history is folded away. */
export function ThreadView({ mail, onBack }: {
  mail: Mail;                       // the mail the reader was opened from
  onBack: () => void;
}) {
  const [conv, setConv] = useState<ConversationResp | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set([mailKey(mail)]));
  const [bodies, setBodies] = useState<Record<string, Body>>({});
  const [quoted, setQuoted] = useState<Set<string>>(new Set());
  const focusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    api.thread(mail.folder, mail.uid)
      .then((c) => alive && setConv(c))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, [mail.folder, mail.uid]);

  // Fetch the body of every expanded mail once.
  useEffect(() => {
    if (!conv) return;
    for (const m of conv.mails) {
      const k = mailKey(m);
      if (!open.has(k) || bodies[k]) continue;
      setBodies((b) => ({ ...b, [k]: "loading" }));
      api.message(m.folder, m.uid)
        .then((d) => setBodies((b) => ({ ...b, [k]: d })))
        .catch((e) => setBodies((b) => ({
          ...b, [k]: { error: String(e.message ?? e) } })));
    }
  }, [conv, open, bodies]);

  // Bring the mail we came from into view once the list is there.
  useEffect(() => {
    if (conv) focusRef.current?.scrollIntoView?.({ block: "start" });
  }, [conv]);

  const toggle = (k: string) => {
    const next = new Set(open);
    next.has(k) ? next.delete(k) : next.add(k);
    setOpen(next);
  };
  const keys = useMemo(() => (conv?.mails ?? []).map(mailKey), [conv]);
  const allOpen = keys.length > 0 && keys.every((k) => open.has(k));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b
        border-line px-4 py-3 text-xs text-muted">
        <span className="min-w-0 flex-1 truncate font-medium text-body">
          {conv?.label ?? t("thread.title")}
        </span>
        {conv && <span>{t("thread.n_mails", { n: conv.mails.length })}</span>}
        {conv && conv.mails.length > 1 && (
          <button className="underline hover:text-body"
            onClick={() => setOpen(allOpen ? new Set() : new Set(keys))}>
            {allOpen ? t("thread.collapse_all") : t("thread.expand_all")}
          </button>
        )}
      </div>
      {conv?.notes.map((n) => (
        <p key={n.key} className="px-4 pt-2 text-xs text-muted">
          {t(`thread.note.${n.key}`, n.params)}
        </p>
      ))}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {error && <div className="p-4 text-sm text-rose-400">{error}</div>}
        {!conv && !error && (
          <div className="p-6 text-center"><Spinner /></div>
        )}
        {conv?.mails.map((m) => {
          const k = mailKey(m);
          const isOpen = open.has(k);
          const body = bodies[k];
          return (
            <div key={k} ref={k === mailKey(mail) ? focusRef : undefined}
              className={`mb-2 overflow-hidden rounded-md border ${
                m.sent ? "border-accent/40" : "border-line"} bg-panel`}>
              <button
                className="flex w-full min-w-0 cursor-pointer items-center
                  gap-2 px-3 py-2 text-left hover:bg-chip"
                aria-expanded={isOpen}
                onClick={() => toggle(k)}>
                {isOpen ? <ChevronDown size={15} className="shrink-0" />
                  : <ChevronRight size={15} className="shrink-0" />}
                {!m.seen && !m.sent && (
                  <span title={t("unread")} className="inline-block size-2
                    shrink-0 rounded-full bg-accent" />
                )}
                <span className={`min-w-0 flex-1 truncate text-sm ${
                  !m.seen && !m.sent ? "font-semibold" : ""}`}>
                  {m.sent ? t("thread.you") : m.addr}
                  <span className="text-faint"> · {m.subject
                    || t("(no subject)")}</span>
                </span>
                <span className="shrink-0 text-xs whitespace-nowrap
                  text-faint">{m.date}</span>
              </button>
              {isOpen && (
                <div className="border-t border-line px-3 py-2">
                  {body === "loading" || !body ? <Spinner />
                    : "error" in body ? (
                      <div className="text-sm text-rose-400">{body.error}</div>
                    ) : (
                      <MailText text={body.text}
                        showQuoted={quoted.has(k)}
                        onToggleQuoted={() => {
                          const next = new Set(quoted);
                          next.has(k) ? next.delete(k) : next.add(k);
                          setQuoted(next);
                        }} />
                    )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="border-t border-line px-4 py-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={15} className="mr-1 inline align-text-bottom" />
          {t("back to list")}
        </Button>
      </div>
    </div>
  );
}

function MailText({ text, showQuoted, onToggleQuoted }: {
  text: string; showQuoted: boolean; onToggleQuoted: () => void;
}) {
  const segs = useMemo(() => splitQuoted(text), [text]);
  const hasQuoted = segs.some((s) => s.quoted);
  return (
    <div className="text-sm leading-relaxed">
      {segs.map((s, i) => (
        s.quoted ? (showQuoted && (
          <pre key={i} className="my-1 whitespace-pre-wrap border-l-2
            border-line pl-2 font-sans text-muted">{s.text}</pre>
        )) : (
          <pre key={i} className="whitespace-pre-wrap font-sans">{s.text}</pre>
        )
      ))}
      {hasQuoted && (
        <button className="mt-1 text-xs text-muted underline
          hover:text-body" onClick={onToggleQuoted}>
          {showQuoted ? t("thread.hide_quoted") : t("thread.show_quoted")}
        </button>
      )}
    </div>
  );
}
