import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { fmtSize, fmtUsd, mailKey, olderThan, sieveSnippet,
  type SieveAction } from "../lib";
import type { AppState, Group, Grouping, GroupUnsub, Mail } from "../types";
import { MailRows, MessageView } from "./MailList";
import { Button, ensureAiAck, Input, Loading, Modal, PanelHeader,
  ProtectButton, Select, Spinner, Toolbar } from "./ui";

export function DetailPanel({ grouping, group, aiEnabled, protectedNow,
  unsubscribedNow, onProtect, onBlock, onUnblock, blocked, folders,
  sieve = true, onClose, onDeleted }: {
  grouping: Grouping;
  group: Group;
  aiEnabled: boolean;
  protectedNow: boolean;                 // live value; `group` is a snapshot
  unsubscribedNow: GroupUnsub | null;     // live value; `group` is a snapshot
  onProtect?: (g: Group) => void;        // absent in subject mode
  onBlock?: (g: Group) => void;          // sender/domain groupings only
  onUnblock?: (g: Group) => void;
  blocked?: boolean;
  folders: AppState["folders_raw"];
  sieve?: boolean;                       // Sieve export is Proton-only
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [mails, setMails] = useState<Mail[] | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<Mail | null>(null);
  const [sortBy, setSortBy] = useState<"date" | "size">("date");
  const [moveDest, setMoveDest] = useState("");
  const [vFilter, setVFilter] = useState("all");
  const [sieveOpen, setSieveOpen] = useState(false);
  const [sieveAction, setSieveAction] = useState<SieveAction>("fileinto");
  const [sieveFolder, setSieveFolder] = useState("Archive");
  const cancelAi = useRef(false);

  useEffect(() => {
    let alive = true;   // guard against a slow response for a previous group
    api.group(grouping, group.key)
      .then((m) => alive && setMails(m))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => { alive = false; };
  }, [grouping, group.key]);

  const shown = useMemo(() => {
    if (!mails) return null;
    const filtered = vFilter === "all" ? mails
      : vFilter === "unrated" ? mails.filter((m) => !m.ai)
      : mails.filter((m) => m.ai === vFilter);
    return sortBy === "size"
      ? [...filtered].sort((a, b) => b.size - a.size)
      : filtered;
  }, [mails, sortBy, vFilter]);

  const vCounts = useMemo(() => {
    const c = { delete_safe: 0, review: 0, keep: 0, unrated: 0 };
    (mails ?? []).forEach((m) =>
      c[(m.ai ?? "unrated") as keyof typeof c]++);
    return c;
  }, [mails]);

  const toggle = (k: string) => {
    const next = new Set(sel);
    next.has(k) ? next.delete(k) : next.add(k);
    setSel(next);
  };

  // Selection presets operate on the VISIBLE (filtered) mails only.
  const selectPreset = (preset: string) => {
    if (!shown) return;
    if (preset === "all") {
      setSel(sel.size === shown.length ? new Set()
        : new Set(shown.map(mailKey)));
    } else if (preset === "none") {
      setSel(new Set());
    } else if (preset.startsWith("older")) {
      const months = Number(preset.slice(5));
      setSel(new Set(shown.filter((m) => olderThan(m, months)).map(mailKey)));
    }
  };

  const aiSelect = async () => {
    if (!mails || !ensureAiAck()) return;
    setBusy(true);
    cancelAi.current = false;
    // Rate unrated mails in batches: verdicts land on the rows as they
    // arrive (and are cached server-side by Message-ID), progress is live,
    // and the run can be cancelled between batches.
    let current = mails;
    let done = current.filter((m) => m.ai).length;
    const total = current.length;
    let cost = 0;
    let lastNote = "";
    setNote(t("note.ai_progress", { done, total }));
    try {
      // Small batches: one request must finish well within browser/proxy
      // timeouts (Safari kills fetches around 60s). Rated batches are
      // cached server-side, so a failed run resumes where it stopped.
      for (;;) {
        if (cancelAi.current) break;
        let r;
        try {
          r = await api.aiGroup(grouping, group.key, 0, 50);
        } catch {
          r = await api.aiGroup(grouping, group.key, 0, 25);  // retry smaller
        }
        if (r.reviewed === 0) break;
        const map = new Map<string, Mail["ai"]>(r.verdicts.map(
          ([f, u, v]) => [`${f} ${u}`, v]));
        current = current.map((m) =>
          map.has(mailKey(m)) ? { ...m, ai: map.get(mailKey(m))! } : m);
        setMails(current);
        done += r.reviewed;
        cost += r.usage.cost ?? 0;
        lastNote = r.note;
        setNote(t("note.ai_progress", { done, total }));
        if (r.remaining === 0) break;
      }
      const safe = current.filter((m) => m.ai === "delete_safe");
      setSel(new Set(safe.map(mailKey)));
      setNote(t("note.ai_selected",
          { note: lastNote, n: safe.length, of: done })
        + (cost ? ` · ${fmtUsd(cost)}` : ""));
    } catch (e: any) {
      setNote(`AI error: ${e.message ?? e} - ${t("note.ai_resume")}`);
    }
    setBusy(false);
  };

  const unsubscribe = async () => {
    setBusy(true);
    setNote(t("Unsubscribing…"));
    try {
      const r = await api.unsubscribe(grouping, group.key);
      if (r.action === "link") {
        window.open(r.detail, "_blank", "noopener");
        setNote(t("Opened the sender's unsubscribe page - confirm it there."));
      } else {
        setNote(`${t("Unsubscribed")} (${r.method}).`);
      }
      onDeleted();   // refresh App's state so the persisted status shows up
    } catch (e: any) {
      setNote(`Unsubscribe error: ${e.message ?? e}`);
    }
    setBusy(false);
  };

  const ackUnsubscribe = async () => {
    const addr = unsubscribedNow?.addr || group.key;
    setBusy(true);
    try {
      await api.unsubscribeAck(addr);
      setNote(t("Marked as unsubscribed."));
      onDeleted();
    } catch (e: any) {
      setNote(`Error: ${e.message ?? e}`);
    }
    setBusy(false);
  };

  const act = async (action: string, dest = "") => {
    if (!mails || sel.size === 0) return;
    const verb = { trash: t("Move to Trash"), archive: t("Archive"),
      move: `${t("Move")} → ${dest}`,
      mark_read: t("Mark as read") }[action] ?? action;
    if (!confirm(t("confirm.act_mails", { verb, n: sel.size }))) return;
    const wholeGroup = sel.size === mails.length && action !== "mark_read";
    try {
      const items = mails.filter((m) => sel.has(mailKey(m)))
        .map((m) => [m.folder, m.uid] as [string, number]);
      await api.deleteMessages(items, action, dest);  // background job
      if (wholeGroup) {
        // The group will be empty - go straight back to the overview.
        onDeleted();
        onClose();
        return;
      }
      if (action !== "mark_read") {
        setMails(mails.filter((m) => !sel.has(mailKey(m))));
      } else {
        setMails(mails.map((m) =>
          sel.has(mailKey(m)) ? { ...m, seen: true } : m));
      }
      setSel(new Set());
      setNote(t("note.background", { verb }));
      onDeleted();
    } catch (e: any) {
      setNote(`Error: ${e.message ?? e}`);
    }
  };

  const onAction = (v: string) => {
    if (v === "move") setMoveDest("?");   // reveal the folder picker
    else if (v) act(v);
  };

  return (
    <Modal onClose={onClose} full>
      <PanelHeader
        title={group.label}
        sub={<>
          {shown && mails && shown.length !== mails.length
            ? `${shown.length} / ${mails.length}`
            : mails ? mails.length : group.count} {t("mails")} ·{" "}
          {fmtSize(group.size)}
          {protectedNow && <> · 🛡️ {t("protected")}</>}
          {blocked && <> · 🚫 {t("Blocked")}</>}
        </>}
        actions={<>
          {onBlock && !blocked && (
            <Button variant="ghost" title={t("block.tip")}
              onClick={() => onBlock(group)}>
              {t("Block")}
            </Button>
          )}
          {onUnblock && blocked && (
            <Button variant="ghost" title={t("unblock.tip")}
              onClick={() => onUnblock(group)}>
              {t("Unblock")}
            </Button>
          )}
          {onProtect && (
            <ProtectButton on={protectedNow}
              onClick={() => onProtect({ ...group, protected: protectedNow })} />
          )}
        </>}
        onClose={onClose}
      />

      {view ? (
        <MessageView mail={view} onBack={() => setView(null)} />
      ) : (
        <>
          <Toolbar>
            <Select value=""
              onChange={(e) => selectPreset(e.target.value)}>
              <option value="" disabled>{t("Select…")}</option>
              <option value="all">{t("All / none")}</option>
              <option value="older6">{t("Older than 6 months")}</option>
              <option value="older12">{t("Older than 1 year")}</option>
              <option value="older24">{t("Older than 2 years")}</option>
              <option value="none">{t("Clear selection")}</option>
            </Select>
            <Select value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "date" | "size")}>
              <option value="date">{t("Date")}</option>
              <option value="size">{t("Size")}</option>
            </Select>
            <Select value={vFilter}
              onChange={(e) => {
                setVFilter(e.target.value);
                setSel(new Set());   // never keep hidden mails selected
              }}>
              <option value="all">{t("filter.all")}</option>
              <option value="delete_safe">
                🟢 {t("v.delete_safe")} ({vCounts.delete_safe})
              </option>
              <option value="review">
                🟡 {t("v.review")} ({vCounts.review})
              </option>
              <option value="keep">🔴 {t("v.keep")} ({vCounts.keep})</option>
              <option value="unrated">
                {t("v.unrated")} ({vCounts.unrated})
              </option>
            </Select>
            {aiEnabled && (busy ? (
              <Button variant="ghost"
                onClick={() => { cancelAi.current = true; }}>
                <Spinner /> {t("cancel")}
              </Button>
            ) : (
              <Button variant="ghost" onClick={aiSelect}>
                {t("ai.rate")}
              </Button>
            ))}
            {group.unsub && (
              unsubscribedNow?.status === "done" ? (
                <span className="rounded bg-chip px-2 py-1 text-xs
                  text-chiptext">
                  ✓ {t("Unsubscribed")}
                </span>
              ) : unsubscribedNow?.status === "link" ? (
                <>
                  <Button variant="ghost" disabled={busy} onClick={() =>
                    window.open(unsubscribedNow.link, "_blank", "noopener")}>
                    {t("unsub.open_link")}
                  </Button>
                  <Button variant="ghost" onClick={ackUnsubscribe}
                    disabled={busy}>
                    {t("unsub.mark_done")}
                  </Button>
                </>
              ) : (
                <Button variant="ghost" onClick={unsubscribe} disabled={busy}>
                  {unsubscribedNow?.status === "failed"
                    ? t("unsub.retry") : t("Unsubscribe")}
                </Button>
              )
            )}
            {sieve && grouping !== "subject" && (
              <Button variant="ghost" onClick={() => setSieveOpen(!sieveOpen)}>
                {t("sieve.button")}
              </Button>
            )}
            {moveDest === "?" ? (
              <Select value=""
                onChange={(e) => { setMoveDest(""); act("move", e.target.value); }}>
                <option value="" disabled>{t("Move to folder…")}</option>
                {folders.map((f) => <option key={f} value={f}>{f}</option>)}
              </Select>
            ) : (
              <Select value=""
                disabled={sel.size === 0}
                onChange={(e) => { onAction(e.target.value); }}>
                <option value="" disabled>{t("Action…")}</option>
                <option value="archive">{t("Archive")}</option>
                <option value="move">{t("Move to folder…")}</option>
                <option value="mark_read">{t("Mark read")}</option>
              </Select>
            )}
            <Button variant="danger" onClick={() => act("trash")}
              disabled={busy || sel.size === 0}>
              {t("Trash selected")}{sel.size > 0 && ` (${sel.size})`}
            </Button>
            {note && (
              <div className="w-full text-xs text-muted">{note}</div>
            )}
            {sieve && sieveOpen && grouping !== "subject" && (
              <div className="w-full rounded-md border border-line
                bg-panel2 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted">{t("sieve.intro")}</span>
                  <Select value={sieveAction}
                    onChange={(e) =>
                      setSieveAction(e.target.value as SieveAction)}>
                    <option value="fileinto">{t("sieve.fileinto")}</option>
                    <option value="discard">{t("sieve.discard")}</option>
                    <option value="markread">{t("sieve.markread")}</option>
                  </Select>
                  {sieveAction === "fileinto" && (
                    <Input className="w-40" value={sieveFolder}
                      placeholder="Archive"
                      onChange={(e) => setSieveFolder(e.target.value)} />
                  )}
                  <Button variant="ghost" onClick={() => {
                    navigator.clipboard?.writeText(sieveSnippet(
                      grouping, group.key, sieveAction, sieveFolder));
                    setNote(t("sieve.copied"));
                  }}>{t("Copy")}</Button>
                  <a className="text-xs text-accent underline"
                    href="https://account.proton.me/mail/filters"
                    target="_blank" rel="noopener">
                    {t("sieve.open_proton")}
                  </a>
                </div>
                <pre className="overflow-x-auto rounded bg-surface p-2
                  text-xs leading-relaxed">
                  {sieveSnippet(grouping, group.key, sieveAction, sieveFolder)}
                </pre>
              </div>
            )}
          </Toolbar>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            {error && <div className="p-4 text-sm text-rose-400">{error}</div>}
            {!shown && !error && <Loading />}
            {shown && (
              <MailRows mails={shown} sel={sel} onToggle={toggle}
                onOpen={setView} />
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
