import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { api, fmtSize, mailKey } from "../api";
import { t } from "../i18n";
import { confirmTrashMails } from "../mailActions";
import type { DupSet, Mail } from "../types";
import { MessageView } from "./MailList";
import { Button, EmptyState, Loading, MailRow, Modal,
  PanelHeader, SectionLabel, Tag, Toolbar } from "./ui";

/** Duplicate finder: exact sets (same Message-ID anywhere, ...) with "Select
 *  all but newest", then a separate list of POSSIBLE duplicates (same sender
 *  and subject within minutes) that is never selected for the user. */
export function DuplicatesPanel({ onClose, onDeleted }: {
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [sets, setSets] = useState<DupSet[] | null>(null);
  const [possible, setPossible] = useState<DupSet[]>([]);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [view, setView] = useState<Mail | null>(null);
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!working) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const state = await api.state();
        if (!alive) return;
        if (state.delete.status === "running") {
          timer = setTimeout(poll, 800);
          return;
        }
        const [exact, likely] = await Promise.all([
          api.duplicates(), api.possibleDuplicates()]);
        if (!alive) return;
        setSets(exact);
        setPossible(likely);
        setSel(new Set());
        setNote(state.delete.error ? t("err.generic", { msg: state.delete.error }) : "");
        setWorking(false);
        onDeleted();
      } catch (e: any) {
        if (!alive) return;
        setNote(t("err.generic", { msg: e.message ?? e }));
        setWorking(false);
      }
    };
    timer = setTimeout(poll, 800);
    return () => { alive = false; clearTimeout(timer); };
  }, [working]);

  useEffect(() => {
    let alive = true;
    api.duplicates()
      .then(async (s) => {
        // the second list is a bonus: its failure must not hide the first
        const p = await api.possibleDuplicates().catch(() => []);
        if (alive) { setPossible(p); setSets(s); }
      })
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, []);

  const wastedTotal = (sets ?? []).reduce((n, s) => n + s.wasted, 0);

  const toggle = (k: string) => {
    if (working) return;
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
    if (!sets || sel.size === 0 || working) return;
    if (!await confirmTrashMails(sel.size)) return;
    try {
      const items: [string, number][] = [];
      [...sets, ...possible].forEach((s) => s.mails.forEach((m) => {
        if (sel.has(mailKey(m))) items.push([m.folder, m.uid]);
      }));
      await api.deleteMessages(items, "trash");
      setWorking(true);
      setNote(t("note.background", { verb: t("Move to Trash") }));
      onDeleted();
    } catch (e: any) {
      setNote(t("err.generic", { msg: e.message ?? e }));
    }
  };

  const setBlock = (s: DupSet, key: string, exact: boolean) => (
    <div key={key} className="my-2 border-y border-line bg-panel2">
      <div className="flex items-baseline gap-2 px-3 pt-2 type-meta
        text-muted md:px-2">
        <span className="min-w-0 flex-1 truncate">{s.mails[0].addr}</span>
        <span className="whitespace-nowrap">
          ×{s.mails.length}{exact && <> · {t("dups.wasted",
            { size: fmtSize(s.wasted) })}</>}
        </span>
      </div>
      {s.mails.map((m, mi) => (
        <MailRow key={mailKey(m)} checked={sel.has(mailKey(m))}
          onToggle={() => toggle(mailKey(m))}
          onOpen={() => setView(m)}
          subject={m.subject || t("(no subject)")}
          unread={!m.seen} dateIso={m.date || ""} dateTime
          selectLabel={t("select.named",
            { subject: m.subject || t("(no subject)") })}
          meta={[fmtSize(m.size), m.folder].join(" · ")}
          trailing={exact && mi === 0
            ? <Tag tone="safe">{t("dups.newest")}</Tag> : undefined} />
      ))}
    </div>
  );

  return (
    <Modal onClose={onClose} size="lg" full={!!view || !sets || sets.length > 0 || possible.length > 0}>
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
          {(!!sets?.length || sel.size > 0 || note) && (
            <Toolbar>
              {!!sets?.length && (
                <Button variant="secondary" disabled={working} onClick={selectAllButNewest}>
                  {t("dups.keep_newest")}
                </Button>
              )}
              {sel.size > 0 && (
                <Button variant="danger" disabled={working} onClick={trash}>
                  {t("Trash selected")} ({sel.size})
                </Button>
              )}
              {note && <span className="type-meta text-muted">{note}</span>}
            </Toolbar>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto pb-4">
            {error && <div className="p-4 type-body text-danger-fg">{error}</div>}
            {!sets && !error && <Loading />}
            {sets && sets.length === 0 && possible.length === 0 && (
              <EmptyState icon={<Copy size={18} />} title={t("dups.none")}
                hint={t("dups.none_hint")} />
            )}
            {sets?.map((s, si) => setBlock(s, `e${si}`, true))}
            {possible.length > 0 && (
              <div data-testid="possible-dups">
                <SectionLabel className="px-3 pt-3 md:px-2">
                  {t("dups.possible_title")}
                </SectionLabel>
                <p className="px-3 pb-1 type-meta text-muted md:px-2">
                  {t("dups.possible_hint")}
                </p>
                {possible.map((s, si) => setBlock(s, `p${si}`, false))}
              </div>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
