import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { api, fmtSize, mailKey } from "../api";
import { getLang, t } from "../i18n";
import { fmtDate } from "../lib";
import type { DupSet, Mail } from "../types";
import { MessageView } from "./MailList";
import { Button, confirmTrashMails, EmptyState, Loading, MailRow, Modal,
  PanelHeader, Tag, Toolbar } from "./ui";

/** Duplicate finder: same Message-ID anywhere, or identical
 *  (sender, subject, size). "Keep newest" selects everything else. */
export function DuplicatesPanel({ onClose, onDeleted }: {
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [sets, setSets] = useState<DupSet[] | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [view, setView] = useState<Mail | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    let alive = true;
    api.duplicates()
      .then((s) => alive && setSets(s))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, []);

  const wastedTotal = (sets ?? []).reduce((n, s) => n + s.wasted, 0);

  const toggle = (k: string) => {
    const next = new Set(sel);
    next.has(k) ? next.delete(k) : next.add(k);
    setSel(next);
  };

  // Mails inside a set arrive newest-first: select everything but [0].
  const selectAllButNewest = () => {
    const next = new Set<string>();
    (sets ?? []).forEach((s) =>
      s.mails.slice(1).forEach((m) => next.add(mailKey(m))));
    setSel(next);
  };

  const trash = async () => {
    if (!sets || sel.size === 0) return;
    if (!await confirmTrashMails(sel.size)) return;
    try {
      const items: [string, number][] = [];
      sets.forEach((s) => s.mails.forEach((m) => {
        if (sel.has(mailKey(m))) items.push([m.folder, m.uid]);
      }));
      await api.deleteMessages(items, "trash");
      setSets(sets
        .map((s) => ({ ...s,
          mails: s.mails.filter((m) => !sel.has(mailKey(m))) }))
        .filter((s) => s.mails.length > 1));
      setSel(new Set());
      setNote(t("note.background", { verb: t("Move to Trash") }));
      onDeleted();
    } catch (e: any) {
      setNote(`Error: ${e.message ?? e}`);
    }
  };

  return (
    <Modal onClose={onClose} full={!!view || !sets || sets.length > 0}>
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <Copy size={18} /> {t("Duplicates")}
        </span>}
        sub={sets
          ? t("dups.summary", { n: sets.length, size: fmtSize(wastedTotal) })
          : t("dups.hint")}
        onClose={onClose}
      />

      {view ? (
        <MessageView mail={view} onBack={() => setView(null)} />
      ) : (
        <>
          {(!!sets?.length || note) && (
            <Toolbar>
              {!!sets?.length && (
                <Button variant="secondary" onClick={selectAllButNewest}>
                  {t("dups.keep_newest")}
                </Button>
              )}
              {sel.size > 0 && (
                <Button variant="danger" onClick={trash}>
                  {t("Trash selected")} ({sel.size})
                </Button>
              )}
              {note && <span className="type-meta text-muted">{note}</span>}
            </Toolbar>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {error && <div className="p-4 type-body text-danger-fg">{error}</div>}
            {!sets && !error && <Loading />}
            {sets && sets.length === 0 && (
              <EmptyState icon={<Copy size={18} />} title={t("dups.none")}
                hint={t("dups.none_hint")} />
            )}
            {sets?.map((s, si) => (
              <div key={si}
                className="my-2 rounded-card border border-line bg-panel2 p-2">
                <div className="mb-1 flex items-baseline gap-2 px-1 type-meta
                  text-muted">
                  <span className="min-w-0 flex-1 truncate">
                    {s.mails[0].addr}
                  </span>
                  <span className="whitespace-nowrap">
                    ×{s.mails.length} · {t("dups.wasted",
                      { size: fmtSize(s.wasted) })}
                  </span>
                </div>
                {s.mails.map((m, mi) => (
                  <MailRow key={mailKey(m)} checked={sel.has(mailKey(m))}
                    onToggle={() => toggle(mailKey(m))}
                    onOpen={() => setView(m)}
                    subject={m.subject || t("(no subject)")}
                    meta={[fmtDate(m.date || "", new Date(),
                      { lang: getLang(), time: true }), m.folder,
                    fmtSize(m.size)].filter(Boolean).join(" · ")}
                    trailing={mi === 0
                      ? <Tag tone="safe">{t("dups.newest")}</Tag> : undefined} />
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
