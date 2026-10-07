import { ArrowDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, mailKey } from "../api";
import { t } from "../i18n";
import { actionVerb, itemsOf, planMailAction } from "../mailActions";
import type { AppState, Mail } from "../types";
import { MailRows, MessageView } from "./MailList";
import { Button, EmptyState, Input, Loading, Modal, Select }
  from "./ui";

type MailSort = "date" | "size" | "sender";
const SORTS: { k: MailSort; label: string }[] = [
  { k: "date", label: "mails.sort_date" },
  { k: "size", label: "mails.sort_size" },
  { k: "sender", label: "mails.sort_sender" },
];
const PAGE = 100;
// Sender reads A→Z first; date and size biggest/newest first.
const naturalDir = (k: MailSort): "asc" | "desc" =>
  k === "sender" ? "asc" : "desc";

/** The flat "All mails" view: every scanned mail of the account in one
 *  paged, sorted, filterable list (GET /api/mails - the scan index, no IMAP
 *  traffic). Rows are the search panel's MailRows; selection drives the
 *  same delete_messages actions (with the same pinned-mail confirm flow) as
 *  the group detail view. */
export function AllMailsView({ state, onChanged }: {
  state: AppState;
  onChanged: () => void;
}) {
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");                 // debounced q
  const [sortK, setSortK] = useState<MailSort>(() => {
    const k = localStorage.getItem("pmc_mails_sort") as MailSort | null;
    return k && SORTS.some((o) => o.k === k) ? k : "date";
  });
  const [dir, setDir] = useState<"asc" | "desc">(() => {
    const d = localStorage.getItem("pmc_mails_dir");
    return d === "asc" || d === "desc" ? d : "desc";
  });
  const [mails, setMails] = useState<Mail[]>([]);
  const [total, setTotal] = useState(0);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [view, setView] = useState<Mail | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [moveDest, setMoveDest] = useState("");
  // What the list on screen was loaded for: a rescan/deletion (groups_rev)
  // refreshes in place, keeping as many pages as were loaded; a new
  // query or sort starts over at the first page.
  const loaded = useRef({ key: "", count: 0 });

  useEffect(() => {
    localStorage.setItem("pmc_mails_sort", sortK);
    localStorage.setItem("pmc_mails_dir", dir);
  }, [sortK, dir]);

  useEffect(() => {
    const h = setTimeout(() => setDq(q.trim()), 250);
    return () => clearTimeout(h);
  }, [q]);

  useEffect(() => {
    if (!sel.size) setMoveDest("");
  }, [sel.size]);

  const fetchKey = `${dq}\u0000${sortK}\u0000${dir}`;
  useEffect(() => {
    let alive = true;     // a slow response for a previous query is dropped
    const sameQuery = loaded.current.key === fetchKey;
    const limit = sameQuery
      ? Math.min(Math.max(loaded.current.count, PAGE), 1000) : PAGE;
    if (!sameQuery) setLoading(true);
    api.mails({ offset: 0, limit, sort: sortK, dir, q: dq })
      .then((r) => {
        if (!alive) return;
        loaded.current = { key: fetchKey, count: r.mails.length };
        setMails(r.mails);
        setTotal(r.total);
        setIgnored(r.ignored);
        setError("");
        const present = new Set(r.mails.map(mailKey));
        setSel((s) => new Set([...s].filter((k) => present.has(k))));
      })
      .catch((e) => alive && setError(String(e.message ?? e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // groups_rev: a scan finished or a delete/restore patched the index.
  }, [fetchKey, state.groups_rev, state.account]);

  const loadMore = async () => {
    setMore(true);
    try {
      const r = await api.mails({ offset: mails.length, limit: PAGE,
        sort: sortK, dir, q: dq });
      const have = new Set(mails.map(mailKey));
      const next = [...mails, ...r.mails.filter((m) => !have.has(mailKey(m)))];
      loaded.current = { key: fetchKey, count: next.length };
      setMails(next);
      setTotal(r.total);
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
    setMore(false);
  };

  const toggle = (k: string) => {
    const next = new Set(sel);
    next.has(k) ? next.delete(k) : next.add(k);
    setSel(next);
  };

  const togglePin = async (m: Mail) => {
    try {
      await api.pin(m.folder, m.uid, !m.pinned);
      setMails((cur) => cur.map((x) =>
        mailKey(x) === mailKey(m) ? { ...x, pinned: !m.pinned } : x));
      // A freshly pinned mail drops out of the selection: it must not stay
      // ticked unnoticed.
      if (!m.pinned && sel.has(mailKey(m))) {
        const next = new Set(sel);
        next.delete(mailKey(m));
        setSel(next);
      }
    } catch (e: any) {
      setNote(`${t("pin.error")}: ${e.message ?? e}`);
    }
  };

  const act = async (action: string, dest = "") => {
    const chosen = mails.filter((m) => sel.has(mailKey(m)));
    if (!chosen.length) return;
    const verb = actionVerb(action, dest);
    const plan = planMailAction(chosen, action, verb);
    if (plan.kind === "cancelled") return;
    if (plan.kind === "all_pinned") {
      setNote(t("toast.all_pinned"));
      return;
    }
    const { acting, force } = plan;
    const keys = new Set(acting.map(mailKey));
    setBusy(true);
    try {
      await api.deleteMessages(itemsOf(acting), action, dest, force);
      if (action === "mark_read") {
        setMails((cur) => cur.map((m) =>
          keys.has(mailKey(m)) ? { ...m, seen: true } : m));
      } else {
        setMails((cur) => cur.filter((m) => !keys.has(mailKey(m))));
        setTotal((n) => Math.max(0, n - keys.size));
      }
      setSel(new Set());
      setNote(t("note.background", { verb }));
      onChanged();
    } catch (e: any) {
      setNote(`Error: ${e.message ?? e}`);
    }
    setBusy(false);
  };

  const onAction = (v: string) => {
    if (v === "move") setMoveDest("?");   // reveal the folder picker
    else if (v) act(v);
  };

  const sortControl = () => (
    <div className="flex shrink-0 items-stretch overflow-hidden rounded-md
      border border-line">
      <Select className="min-w-0 flex-1 !rounded-none !border-0"
        value={sortK}
        onChange={(e) => {
          const k = e.target.value as MailSort;
          setSortK(k);
          setDir(naturalDir(k));
        }}>
        {SORTS.map((o) => (
          <option key={o.k} value={o.k}>{t(o.label)}</option>
        ))}
      </Select>
      <button
        className="flex w-9 shrink-0 items-center justify-center border-l
          border-line bg-panel2 text-accent hover:bg-chip"
        title={t(dir === "desc" ? "sort.desc_tip" : "sort.asc_tip")}
        aria-label={t(dir === "desc" ? "sort.desc_tip" : "sort.asc_tip")}
        onClick={() => setDir(dir === "desc" ? "asc" : "desc")}>
        <ArrowDown aria-hidden size={16}
          className={`transition-transform duration-200
            ${dir === "asc" ? "rotate-180" : ""}`} />
      </button>
    </div>
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Input className="w-full pr-8" value={q}
            placeholder={t("mails.filter")}
            title={t("mails.filter_tip")}
            onChange={(e) => setQ(e.target.value)} />
          {!!q && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2
              text-muted hover:text-body"
              title={t("Clear filter")} aria-label={t("Clear filter")}
              onClick={() => setQ("")}>
              <X size={14} />
            </button>
          )}
        </div>
        {sortControl()}
      </div>
      <div className="mb-2 flex min-h-5 flex-wrap items-center gap-x-3
        text-xs text-muted">
        <span>{t("mails.count", { n: mails.length, total })}</span>
        {mails.length > 0 && (
          <button className="underline hover:text-body"
            onClick={() => setSel(sel.size === mails.length
              ? new Set() : new Set(mails.map(mailKey)))}>
            {sel.size === mails.length
              ? t("Clear selection")
              : t("mails.select_loaded", { n: mails.length })}
          </button>
        )}
        {note && <span>{note}</span>}
      </div>
      {ignored.length > 0 && (
        <p className="mb-2 text-xs text-muted">
          {t("mails.ignored", { list: ignored.join(" ") })}
        </p>
      )}

      {error && <div className="p-4 text-sm text-rose-400">{error}</div>}
      {loading && !mails.length && !error && <Loading />}
      {!loading && !error && mails.length === 0 && (
        <EmptyState>
          {dq ? t("mails.none") : t("No scan yet - hit “Scan”.")}
        </EmptyState>
      )}
      <MailRows mails={mails} sel={sel} onToggle={toggle} onOpen={setView}
        onPin={togglePin} detailed paged />
      {mails.length < total && (
        <div className="py-3 text-center">
          <Button variant="secondary" disabled={more} onClick={loadMore}>
            {t("mails.load_more", { n: Math.min(PAGE, total - mails.length) })}
          </Button>
        </div>
      )}
      {sel.size > 0 && <div className="h-28" aria-hidden />}

      {sel.size > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-(--z-bulkbar) border-t border-line
          bg-panel px-3 py-2 shadow-[0_-4px_16px_rgba(0,0,0,0.3)]"
          style={{ paddingBottom:
            "calc(env(safe-area-inset-bottom) + 0.5rem)" }}>
          <div className="mx-auto max-w-6xl">
            <div className="mb-2 flex items-center gap-2 text-xs text-muted">
              <span>{t("detail.n_selected", { n: sel.size })}</span>
              <button className="underline hover:text-body"
                onClick={() => setSel(new Set())}>
                {t("Clear selection")}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Action… stays mounted when "Move to folder…" is picked;
                  the folder picker is a separate control (see DetailPanel). */}
              <Select value="" className="min-w-0 flex-1" disabled={busy}
                onChange={(e) => onAction(e.target.value)}>
                <option value="" disabled>{t("Action…")}</option>
                <option value="archive">{t("Archive")}</option>
                <option value="move">{t("Move to folder…")}</option>
                <option value="mark_read">{t("Mark read")}</option>
              </Select>
              {moveDest === "?" && (
                <>
                  <Select value="" className="min-w-0 flex-1"
                    onChange={(e) => {
                      if (e.target.value) act("move", e.target.value);
                      setMoveDest("");
                    }}>
                    <option value="" disabled>{t("Move to folder…")}</option>
                    {(state.folders_raw ?? []).map((f, i) => (
                      <option key={f} value={f}>{state.folders[i] ?? f}</option>
                    ))}
                  </Select>
                  <Button variant="secondary" className="!px-2 shrink-0"
                    title={t("Cancel")} onClick={() => setMoveDest("")}>
                    <X size={15} />
                  </Button>
                </>
              )}
              <Button variant="danger" disabled={busy}
                className="ml-auto shrink-0" onClick={() => act("trash")}>
                {t("Trash selected")} ({sel.size})
              </Button>
            </div>
          </div>
        </div>
      )}

      {view && (
        <Modal onClose={() => setView(null)} full>
          <MessageView mail={view} onBack={() => setView(null)} />
        </Modal>
      )}
    </div>
  );
}
