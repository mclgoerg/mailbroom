import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeft size={15} className="mr-1 inline align-text-bottom" />
          {t("back to list")}
        </Button>
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
  // Sender/folder only earn a spot on the meta line when they actually
  // vary across the visible mails - a single-sender group (the common
  // case) stays as uncluttered as a plain date/size line.
  const multiSender = useMemo(
    () => new Set(mails.map((m) => m.addr)).size > 1, [mails]);
  const multiFolder = useMemo(
    () => new Set(mails.map((m) => m.folder)).size > 1, [mails]);
  return (
    <>
      {mails.slice(0, cap).map((m) => {
        const meta = [(m.date || "").slice(0, 10)];
        if (multiFolder) meta.push(m.folder);
        if (multiSender) meta.push(m.addr);
        meta.push(fmtSize(m.size));
        return (
          <div key={mailKey(m)}
            className="flex gap-3 border-b border-line/60 px-1 py-2.5">
            <input type="checkbox" className="mt-1 shrink-0"
              checked={sel.has(mailKey(m))}
              onChange={() => onToggle(mailKey(m))} />
            <div className="min-w-0 flex-1">
              <button
                className="flex w-full min-w-0 cursor-pointer items-center
                  gap-1.5 text-left text-sm hover:underline"
                onClick={() => onOpen(m)}>
                {!m.seen && (
                  <span title={t("unread")} className="inline-block size-2
                    shrink-0 rounded-full bg-accent" />
                )}
                <span className={`truncate ${!m.seen ? "font-semibold" : ""}`}>
                  {m.subject || t("(no subject)")}
                </span>
              </button>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs
                text-faint">
                <span className="min-w-0 flex-1 truncate">
                  {meta.join(" · ")}
                </span>
                {m.ai && <AiTag ai={{ verdict: m.ai, reason: "" }} />}
              </div>
            </div>
          </div>
        );
      })}
      {mails.length > cap && (
        <div className="py-3 text-center">
          <Button variant="ghost" onClick={() => setCap(cap + RENDER_CAP)}>
            {t("show_more", { n: Math.min(RENDER_CAP, mails.length - cap),
              hidden: mails.length - cap })}
          </Button>
        </div>
      )}
    </>
  );
}

export { olderThan } from "../lib";
