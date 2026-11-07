import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { api, fmtSize, mailKey } from "../api";
import { t } from "../i18n";
import { confirmTrashMails } from "../mailActions";
import type { DupSet, Mail } from "../types";
import { MessageView } from "./MailList";
import { Button, EmptyState, Loading, MailRow, Modal,
  PanelHeader, SectionLabel, Tag, Toolbar } from "./ui";

/** Duplicate finder in three sections: identical copies (same Message-ID,
 *  same size) with "Select all but newest"; different versions (same
 *  Message-ID but different sizes, or id-less matches); and possible
 *  duplicates (same sender and subject within minutes). Only the first is
 *  ever selected for the user. */
export function DuplicatesPanel({ onClose, onDeleted }: {
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [sets, setSets] = useState<DupSet[] | null>(null);
  const [versions, setVersions] = useState<DupSet[]>([]);
  const [possible, setPossible] = useState<DupSet[]>([]);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [view, setView] = useState<Mail | null>(null);
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);

  // The versions and possible lists are a bonus: their failure must not
  // hide the identical list (or keep a stale selection alive).
  const loadAll = async () => {
    const s = await api.duplicates();
    const [v, p] = await Promise.all([
      api.duplicateVersions().catch(() => []),
      api.possibleDuplicates().catch(() => [])]);
    return { s, v, p };
  };
  const setLists = (l: { s: DupSet[]; v: DupSet[]; p: DupSet[] }) => {
    setSets(l.s); setVersions(l.v); setPossible(l.p);
  };

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
        const lists = await loadAll();
        if (!alive) return;
        setLists(lists);
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
    loadAll()
      .then((l) => alive && setLists(l))
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

  // Mails inside a set arrive newest-first: in every identical set select
  // everything but [0] (and untick [0], so one copy always stays). Rows the
  // user ticked in the other two sections keep their state.
  const selectAllButNewest = () => {
    const next = new Set(sel);
    (sets ?? []).forEach((s) => s.mails.forEach((m, i) =>
      i === 0 ? next.delete(mailKey(m)) : next.add(mailKey(m))));
    setSel(next);
  };

  const trash = async () => {
    if (!sets || sel.size === 0 || working) return;
    if (!await confirmTrashMails(sel.size)) return;
    try {
      const items: [string, number][] = [];
      [...sets, ...versions, ...possible].forEach((s) => s.mails.forEach((m) => {
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

  const setBlock = (s: DupSet, key: string,
    kind: "identical" | "versions" | "possible") => {
    const exact = kind === "identical";
    // tag a copy only when it is strictly larger than every other one
    const top = Math.max(...s.mails.map((m) => m.size));
    const largest = s.mails.filter((m) => m.size === top).length === 1
      ? s.mails.findIndex((m) => m.size === top) : -1;
    return (
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
              ? <Tag tone="safe">{t("dups.newest")}</Tag>
              : kind === "versions" && mi === largest
                ? <Tag>{t("dups.largest")}</Tag> : undefined} />
        ))}
      </div>
    );
  };

  const section = (id: string, title: string, hint: string,
    list: DupSet[], kind: "identical" | "versions" | "possible") => (
    list.length > 0 && (
      <div data-testid={id}>
        <SectionLabel className="px-3 pt-3 md:px-2">{title}</SectionLabel>
        <p className="px-3 pb-1 type-meta text-muted md:px-2">{hint}</p>
        {list.map((s, si) => setBlock(s, `${kind}${si}`, kind))}
      </div>
    )
  );

  return (
    <Modal onClose={onClose} size="lg" full={!!view || !sets || sets.length > 0 || versions.length > 0
      || possible.length > 0}>
      <PanelHeader
        title={<span className="inline-flex items-center gap-2">
          <Copy size={18} /> {t("Duplicates")}
        </span>}
        sub={sets?.length
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
            {sets && sets.length === 0 && versions.length === 0
              && possible.length === 0 && (
              <EmptyState icon={<Copy size={18} />} title={t("dups.none")}
                hint={t("dups.none_hint")} />
            )}
            {section("identical-dups", t("dups.identical_title"),
              t("dups.identical_hint"), sets ?? [], "identical")}
            {section("versions-dups", t("dups.versions_title"),
              t("dups.versions_hint"), versions, "versions")}
            {section("possible-dups", t("dups.possible_title"),
              t("dups.possible_hint"), possible, "possible")}
          </div>
        </>
      )}
    </Modal>
  );
}
