import { useEffect, useState } from "react";
import { api, fmtSize, mailKey } from "../api";
import type { Mail, MessageDetail } from "../types";
import { t } from "../i18n";
import { AiTag, Button, Spinner } from "./ui";

const RENDER_CAP = 500;

export function MessageView({ mail, onBack }: {
  mail: Mail; onBack: () => void;
}) {
  const [detail, setDetail] = useState<MessageDetail | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setDetail(null);
    api.message(mail.folder, mail.uid)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, [mail.folder, mail.uid]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-4 py-3 text-xs
        whitespace-pre-wrap text-muted">
        {error || (detail
          ? `From: ${detail.from}\nDate: ${detail.date}\nSubject: ${detail.subject}`
          : <Spinner />)}
      </div>
      <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap
        p-4 font-sans text-sm leading-relaxed">
        {detail?.text}
      </pre>
      <div className="border-t border-line px-4 py-2">
        <Button variant="ghost" onClick={onBack}>← {t("back to list")}</Button>
      </div>
    </div>
  );
}

export function MailRows({ mails, sel, onToggle, onOpen }: {
  mails: Mail[];
  sel: Set<string>;
  onToggle: (k: string) => void;
  onOpen: (m: Mail) => void;
}) {
  const [cap, setCap] = useState(RENDER_CAP);
  return (
    <>
      {mails.slice(0, cap).map((m) => (
        <div key={mailKey(m)}
          className="flex flex-wrap items-baseline gap-2 border-b
            border-line/60 px-1 py-2">
          <input type="checkbox" checked={sel.has(mailKey(m))}
            onChange={() => onToggle(mailKey(m))} />
          <span className="text-xs whitespace-nowrap text-muted">
            {(m.date || "").slice(0, 10)}
          </span>
          <button
            className="min-w-0 flex-1 basis-full cursor-pointer truncate
              text-left text-sm hover:underline sm:basis-0"
            onClick={() => onOpen(m)}>
            {!m.seen && (
              <span title={t("unread")} className="mr-1.5 inline-block size-2
                rounded-full bg-accent align-middle" />
            )}
            {m.subject || t("(no subject)")}
          </button>
          {m.ai && <AiTag ai={{ verdict: m.ai, reason: "" }} />}
          <span className="text-xs whitespace-nowrap text-faint">
            {fmtSize(m.size)}
          </span>
        </div>
      ))}
      {mails.length > cap && (
        <div className="py-3 text-center">
          <Button variant="ghost" onClick={() => setCap(cap + RENDER_CAP)}>
            Show {Math.min(RENDER_CAP, mails.length - cap)} more
            ({mails.length - cap} hidden)
          </Button>
        </div>
      )}
    </>
  );
}

export { olderThan } from "../lib";
