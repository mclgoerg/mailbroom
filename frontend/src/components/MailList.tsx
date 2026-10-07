import { ArrowLeft, MessagesSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, fmtSize, mailKey } from "../api";
import type { Mail, MessageDetail } from "../types";
import { getLang, t } from "../i18n";
import { fmtDate } from "../lib";
import { AiTag, Button, Checkbox, PinButton, Spinner } from "./ui";
import { ThreadView } from "./ThreadView";

const RENDER_CAP = 500;

export function MessageView({ mail, onBack }: {
  mail: Mail; onBack: () => void;
}) {
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);

  useEffect(() => {
    let alive = true;
    setReading(false);
    setDetail(null);
    api.message(mail.folder, mail.uid)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, [mail.folder, mail.uid]);

  if (reading) {
    return <ThreadView mail={mail} initial={detail ?? undefined}
      onBack={() => setReading(false)} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-4 py-3 type-meta
        whitespace-pre-wrap text-muted">
        {error || (detail
          ? `From: ${detail.from}\nDate: ${detail.date}\nSubject: ${detail.subject}`
          : <Spinner />)}
      </div>
      <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap
        p-4 font-sans type-body leading-relaxed">
        {detail?.text}
      </pre>
      <div className="flex flex-wrap items-center gap-2 border-t border-line
        px-4 py-2">
        <Button variant="secondary" onClick={onBack}>
          <ArrowLeft size={16} className="mr-1 inline align-text-bottom" />
          {t("back to list")}
        </Button>
        {detail?.thread && (
          <Button variant="secondary" onClick={() => setReading(true)}>
            <MessagesSquare size={16}
              className="mr-1 inline align-text-bottom" />
            {t("thread.read")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function MailRows({ mails, sel, onToggle, onOpen, onPin, detailed,
  paged }: {
  mails: Mail[];
  sel: Set<string>;
  onToggle: (k: string) => void;
  onOpen: (m: Mail) => void;
  // Pin toggle per row; absent = no pin control (search results etc.).
  onPin?: (m: Mail) => void;
  // Always show folder and sender on the meta line (the flat all-mails
  // list), instead of only when they vary across the visible mails.
  detailed?: boolean;
  // The caller pages the list itself: no client-side render cap / "show
  // more" (it would sit next to the caller's own load-more button).
  paged?: boolean;
}) {
  const [cap, setCap] = useState(RENDER_CAP);
  // Sender/folder only earn a spot on the meta line when they actually
  // vary across the visible mails - a single-sender group (the common
  // case) stays as uncluttered as a plain date/size line.
  const variesSender = useMemo(
    () => new Set(mails.map((m) => m.addr)).size > 1, [mails]);
  const variesFolder = useMemo(
    () => new Set(mails.map((m) => m.folder)).size > 1, [mails]);
  const multiSender = !!detailed || variesSender;
  const multiFolder = !!detailed || variesFolder;
  return (
    <>
      {(paged ? mails : mails.slice(0, cap)).map((m) => {
        const meta = [fmtDate(m.date || "", new Date(), { lang: getLang() })];
        if (multiFolder) meta.push(m.folder);
        if (multiSender) meta.push(m.addr);
        meta.push(fmtSize(m.size));
        return (
          <div key={mailKey(m)} data-pinned={m.pinned ? "true" : undefined}
            className={`flex gap-3 border-b border-line/60 px-1 py-2.5 ${
              m.pinned ? "border-l-2 border-l-accent bg-panel" : ""}`}>
            <Checkbox className="-my-1 coarse:-ml-3 coarse:-mr-2"
              checked={sel.has(mailKey(m))}
              onChange={() => onToggle(mailKey(m))} />
            <div className="min-w-0 flex-1">
              <button
                className="flex w-full min-w-0 cursor-pointer items-center
                  gap-1.5 text-left type-body hover:underline"
                onClick={() => onOpen(m)}>
                {!m.seen && (
                  <span title={t("unread")} className="inline-block size-2
                    shrink-0 rounded-full bg-accent" />
                )}
                <span className={`truncate ${!m.seen ? "font-semibold" : ""}`}>
                  {m.subject || t("(no subject)")}
                </span>
              </button>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5
                type-meta text-muted">
                <span className="min-w-0 truncate"
                  title={(m.date || "").slice(0, 10)}>
                  {meta.join(" · ")}
                </span>
                {m.ai && (
                  <span className="shrink-0">
                    <AiTag ai={{ verdict: m.ai, reason: "" }} />
                  </span>
                )}
              </div>
            </div>
            {onPin && (
              <PinButton on={!!m.pinned} onClick={() => onPin(m)} />
            )}
          </div>
        );
      })}
      {!paged && mails.length > cap && (
        <div className="py-3 text-center">
          <Button variant="secondary" onClick={() => setCap(cap + RENDER_CAP)}>
            {t("show_more", { n: Math.min(RENDER_CAP, mails.length - cap),
              hidden: mails.length - cap })}
          </Button>
        </div>
      )}
    </>
  );
}

export { olderThan } from "../lib";
