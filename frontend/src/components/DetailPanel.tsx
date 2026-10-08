import { MessagesSquare, MoreHorizontal, Pin, PinOff, Shield, Wand2, X }
  from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { actionVerb, planMailAction } from "../mailActions";
import { fmtSize, fmtUsd, mailKey, olderThan, sieveSnippet,
  type SieveAction } from "../lib";
import type { AppState, Group, Grouping, GroupUnsub, Mail } from "../types";
import { MailRows, MessageView } from "./MailList";
import { ThreadView } from "./ThreadView";
import { Button, Chip, confirmDialog, ensureAiAck, Input, LINK, LINK_ACCENT, Loading, Menu,
  MenuItem, Modal, PanelHeader, PinButton, ProtectButton, Select, Spinner }
  from "./ui";

// Rating filter chips: same green/yellow/red/unrated buckets as the
// select they replace, now an exclusive pill row (like the overview's
// quick-select chips) instead of a dropdown.
const RATING_FILTERS: { key: string; label: string }[] = [
  { key: "delete_safe", label: "🟢 " + t("v.delete_safe") },
  { key: "review", label: "🟡 " + t("v.review") },
  { key: "keep", label: "🔴 " + t("v.keep") },
  { key: "unrated", label: t("v.unrated") },
];

export function DetailPanel({ grouping, group, aiEnabled, protectedNow,
  unsubscribedNow, onTrash, onProtect, onBlock, onUnblock, blocked, folders,
  sieve = true, onClose, onDeleted }: {
  grouping: Grouping;
  group: Group;
  aiEnabled: boolean;
  protectedNow: boolean;                 // live value; `group` is a snapshot
  unsubscribedNow: GroupUnsub | null;     // live value; `group` is a snapshot
  // One-tap whole-group trash (distinct from the mail-list "Trash selected"
  // below, which only acts on individually checked mails). Resolves false
  // if the user declined the confirmation, in which case the panel stays
  // open instead of closing on a no-op.
  onTrash: (g: Group) => Promise<boolean>;
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
  const [reading, setReading] = useState<Mail | null>(null);
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

  // The folder picker must never be a dead end (same lesson as the
  // overview's bulk-action bar): clearing the selection also resets it.
  useEffect(() => {
    if (!sel.size) setMoveDest("");
  }, [sel.size]);

  const shown = useMemo(() => {
    if (!mails) return null;
    const filtered = vFilter === "all" ? mails
      : vFilter === "unrated" ? mails.filter((m) => !m.ai)
      : mails.filter((m) => m.ai === vFilter);
    return sortBy === "size"
      ? [...filtered].sort((a, b) => b.size - a.size)
      : filtered;
  }, [mails, sortBy, vFilter]);

  // Pinned mails are never part of a bulk selection (select-all, "older
  // than", AI picks) - they can only be ticked by hand, and acting on them
  // then needs its own confirmation (see act()).
  const selectable = useMemo(
    () => (shown ?? []).filter((m) => !m.pinned), [shown]);
  const pinnedCount = useMemo(
    () => (mails ?? []).filter((m) => m.pinned).length, [mails]);

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
      const allSel = selectable.length > 0
        && selectable.every((m) => sel.has(mailKey(m)));
      setSel(allSel ? new Set() : new Set(selectable.map(mailKey)));
    } else if (preset === "none") {
      setSel(new Set());
    } else if (preset.startsWith("older")) {
      const months = Number(preset.slice(5));
      setSel(new Set(selectable.filter((m) => olderThan(m, months))
        .map(mailKey)));
    }
  };

  const aiSelect = async () => {
    if (!mails || !await ensureAiAck()) return;
    setBusy(true);
    cancelAi.current = false;
    // With an active selection, rate ONLY those mails (and afterward narrow
    // the selection down to the safe ones within it) rather than the whole
    // group - picking "AI rate mails" shouldn't silently replace a
    // selection the user already built by hand.
    const scope = sel.size > 0 ? new Set(sel) : null;
    const pool = (ms: Mail[]) =>
      scope ? ms.filter((m) => scope.has(mailKey(m))) : ms;
    // Rate unrated mails in batches: verdicts land on the rows as they
    // arrive (and are cached server-side by Message-ID), progress is live,
    // and the run can be cancelled between batches.
    let current = mails;
    let done = pool(current).filter((m) => m.ai).length;
    const total = pool(current).length;
    let cost = 0;
    let lastNote = "";
    setNote(t("note.ai_progress", { done, total }));
    try {
      // Small batches: one request must finish well within browser/proxy
      // timeouts (Safari kills fetches around 60s). Rated batches are
      // cached server-side, so a failed run resumes where it stopped.
      for (;;) {
        if (cancelAi.current) break;
        const uids = scope
          ? pool(current).filter((m) => !m.ai)
              .map((m) => [m.folder, m.uid] as [string, number])
          : undefined;
        if (scope && uids!.length === 0) break;
        let r;
        try {
          r = await api.aiGroup(grouping, group.key, 0, 50, uids);
        } catch {
          // retry smaller
          r = await api.aiGroup(grouping, group.key, 0, 25, uids);
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
      const safe = pool(current)
        .filter((m) => m.ai === "delete_safe" && !m.pinned);
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

  const togglePin = async (m: Mail) => {
    try {
      await api.pin(m.folder, m.uid, !m.pinned);
      setMails((cur) => cur && cur.map((x) =>
        mailKey(x) === mailKey(m) ? { ...x, pinned: !m.pinned } : x));
      // A freshly pinned mail drops out of the selection: it must not stay
      // ticked unnoticed.
      if (!m.pinned && sel.has(mailKey(m))) {
        const next = new Set(sel);
        next.delete(mailKey(m));
        setSel(next);
      }
      onDeleted();   // refresh App's state so the group row's pin count moves
    } catch (e: any) {
      setNote(`${t("pin.error")}: ${e.message ?? e}`);
    }
  };

  // Pin/unpin every mail currently in the group (the group's own shield
  // covers future mail; this covers what is in it now).
  const pinAll = async (pinned: boolean) => {
    if (!pinned && !await confirmDialog({
      title: t("confirm.unpin_group", { n: pinnedCount }),
      confirmLabel: t("confirm.unpin_btn") })) return;
    try {
      const r = await api.pinGroup(grouping, group.key, pinned);
      setMails(await api.group(grouping, group.key));
      setSel(new Set());
      setNote(r.skipped > 0
        ? t("pin.group_skipped", { n: r.skipped }) : "");
      onDeleted();
    } catch (e: any) {
      setNote(`${t("pin.error")}: ${e.message ?? e}`);
    }
  };

  const act = (action: string, dest = "") => {
    if (!mails || sel.size === 0) return Promise.resolve();
    return actOn(mails.filter((m) => sel.has(mailKey(m))), action, dest);
  };

  // `chosen` is the checked mails, or the single mail open in the reader
  // ("Trash this mail") - both go through the same confirm/pinned flow.
  const actOn = async (chosen: Mail[], action: string, dest = "",
      single = false) => {
    if (!mails) return;
    const verb = actionVerb(action, dest);
    const plan = await planMailAction(chosen, action, verb);
    if (plan.kind === "cancelled") return;
    if (plan.kind === "all_pinned") {
      setNote(t("toast.all_pinned"));
      return;
    }
    const { acting, force } = plan;
    const actingKeys = new Set(acting.map(mailKey));
    const wholeGroup = acting.length === mails.length
      && action !== "mark_read";
    try {
      const items = acting.map((m) => [m.folder, m.uid] as [string, number]);
      await api.deleteMessages(items, action, dest, force);  // background job
      if (wholeGroup) {
        // The group will be empty - go straight back to the overview.
        onDeleted();
        onClose();
        return;
      }
      if (action !== "mark_read") {
        setMails(mails.filter((m) => !actingKeys.has(mailKey(m))));
        // The mail open in the reader is gone: back to the list.
        setView(null);
        setReading(null);
      } else {
        setMails(mails.map((m) =>
          actingKeys.has(mailKey(m)) ? { ...m, seen: true } : m));
      }
      // A single-mail action (reader) only drops that mail from the
      // selection; the checked-mails flow clears it as before.
      if (single) {
        setSel((cur) => {
          const next = new Set(cur);
          actingKeys.forEach((k) => next.delete(k));
          return next;
        });
      } else setSel(new Set());
      setNote(t("note.background", { verb }));
      onDeleted();
    } catch (e: any) {
      setNote(`Error: ${e.message ?? e}`);
    }
  };

  const onAction = (v: string) => {
    if (v === "move") setMoveDest("?");   // reveal the folder picker
    else if (v === "ai_review") aiSelect();
    else if (v) act(v);
  };

  // Message-scoped footer actions (reader / thread view): the pin state is
  // read live from `mails`, since `view` / `reading` are snapshots.
  const mailActions = (m: Mail) => {
    const live = mails?.find((x) => mailKey(x) === mailKey(m)) ?? m;
    return <>
      <PinButton showLabel on={!!live.pinned} onClick={() => togglePin(live)} />
      <Button variant="danger-quiet" onClick={() => actOn([live], "trash", "", true)}>
        {t("trash_this.btn")}
      </Button>
    </>;
  };
  // Only mails "Trash all" will really move: protected ones stay untouched.
  const groupCount = mails
    ? mails.filter((m) => !m.pinned).length
    : group.count - (group.pinned ?? 0);

  return (
    <Modal onClose={onClose} full>
      <PanelHeader
        title={group.label}
        sub={<>
          {shown && mails && shown.length !== mails.length
            ? `${shown.length} / ${mails.length}`
            : mails ? mails.length : group.count} {t("mails")} ·{" "}
          {fmtSize(group.size)}
          {protectedNow && (
            <span className="inline-flex items-center gap-1">
              {" "}· <Shield size={14} /> {t("protected")}
            </span>
          )}
          {blocked && <> · 🚫 {t("Blocked")}</>}
        </>}
        actions={onProtect && (
          <ProtectButton showLabel on={protectedNow}
            onClick={() => onProtect({ ...group, protected: protectedNow })} />
        )}
        onClose={onClose}
      />

      {reading ? (
        <ThreadView mail={reading} onBack={() => setReading(null)}
          actions={mailActions(reading)} />
      ) : view ? (
        <MessageView mail={view} onBack={() => setView(null)}
          actions={mailActions(view)} />
      ) : (
        <>
          <div className="flex flex-col gap-2 border-b border-line px-4 py-2">
            {/* Row 1: rating filter chips (exclusive, like a segmented
                control) - its own row since it already wraps onto 2 lines
                at phone width; anything sharing the row with `ml-auto`
                ended up stranded alone on a 2nd line, flush right with a
                big empty gap to its left. */}
            <div className="flex flex-wrap items-center gap-2">
              <Chip className="shrink-0" on={vFilter === "all"}
                onClick={() => { setVFilter("all"); setSel(new Set()); }}>
                {t("filter.all")} ({mails ? mails.length : group.count})
              </Chip>
              {RATING_FILTERS.filter((f) =>
                vCounts[f.key as keyof typeof vCounts] > 0).map((f) => (
                <Chip key={f.key} className="shrink-0" on={vFilter === f.key}
                  onClick={() => { setVFilter(f.key); setSel(new Set()); }}>
                  {f.label} ({vCounts[f.key as keyof typeof vCounts]})
                </Chip>
              ))}
              {/* Not in the header's sub line: that one is truncated to a
                  few words on a phone, which hid the count entirely. */}
              {pinnedCount > 0 && (
                <span className="inline-flex items-center gap-1 type-meta
                  text-muted" title={t("pin.badge_tip", { n: pinnedCount })}>
                  <Pin size={14} /> {t("pin.n_protected", { n: pinnedCount })}
                </span>
              )}
            </div>

            {/* Row 2: sort + build-a-selection + per-group secondary
                actions, grouped together as one "list controls" row. */}
            <div className="flex flex-wrap items-center gap-2">
              <Select value={sortBy} className="w-auto shrink-0"
                onChange={(e) => setSortBy(e.target.value as "date" | "size")}>
                <option value="date">{t("Sort: date")}</option>
                <option value="size">{t("Sort: size")}</option>
              </Select>
              <Select value="" className="w-auto shrink-0"
                onChange={(e) => selectPreset(e.target.value)}>
                <option value="" disabled>{t("Select…")}</option>
                <option value="all">{t("All / none")}</option>
                <option value="older6">{t("Older than 6 months")}</option>
                <option value="older12">{t("Older than 1 year")}</option>
                <option value="older24">{t("Older than 2 years")}</option>
                <option value="none">{t("Clear selection")}</option>
              </Select>
              {group.unsub && (
                unsubscribedNow?.status === "done" ? (
                  <span className="rounded-badge bg-chip px-2 py-1 type-meta
                    text-chiptext">
                    ✓ {t("Unsubscribed")}
                  </span>
                ) : unsubscribedNow?.status === "link" ? (
                  <>
                    <Button variant="secondary" disabled={busy} onClick={() =>
                      window.open(unsubscribedNow.link, "_blank", "noopener")}>
                      {t("unsub.open_link")}
                    </Button>
                    <Button variant="secondary" onClick={ackUnsubscribe}
                      disabled={busy}>
                      {t("unsub.mark_done")}
                    </Button>
                  </>
                ) : (
                  <Button variant="secondary" onClick={unsubscribe} disabled={busy}>
                    {unsubscribedNow?.status === "failed"
                      ? t("unsub.retry") : t("Unsubscribe")}
                  </Button>
                )
              )}
              <Menu label={t("menu.more")} trigger={<MoreHorizontal size={18} />}>
                {/* AI rate mails only lives here while nothing is selected
                    (rate the whole group - secondary/occasional, like the
                    overview's own overflow entry). Once something IS
                    selected it promotes to the Action… select below instead
                    of staying in two places at once - Cancel stays
                    reachable here regardless, since a scoped run can still
                    be mid-flight while selected. */}
                {aiEnabled && busy && (
                  <MenuItem onClick={() => { cancelAi.current = true; }}>
                    <Spinner className="mr-1 inline align-text-bottom" />{" "}
                    {t("cancel")}
                  </MenuItem>
                )}
                {aiEnabled && !busy && sel.size === 0 && (
                  <MenuItem onClick={aiSelect}>
                    <Wand2 size={16} className="mr-1 inline align-text-bottom" />
                    {t("ai.rate")}
                  </MenuItem>
                )}
                {grouping === "thread" && mails && mails.length > 0 && (
                  <MenuItem onClick={() => setReading(mails[0])}>
                    <MessagesSquare size={16}
                      className="mr-1 inline align-text-bottom" />
                    {t("thread.read")}
                  </MenuItem>
                )}
                {mails && mails.length > 0 && pinnedCount < mails.length && (
                  <MenuItem onClick={() => pinAll(true)}>
                    <Pin size={16} className="mr-1 inline align-text-bottom" />
                    {t("pin.group_on")}
                  </MenuItem>
                )}
                {pinnedCount > 0 && (
                  <MenuItem onClick={() => pinAll(false)}>
                    <PinOff size={16}
                      className="mr-1 inline align-text-bottom" />
                    {t("pin.group_off")}
                  </MenuItem>
                )}
                {sieve && (grouping === "sender" || grouping === "domain") && (
                  <MenuItem onClick={() => setSieveOpen(!sieveOpen)}>
                    {t("sieve.button")}
                  </MenuItem>
                )}
              </Menu>
              {note && (
                <div className="w-full type-meta text-muted">{note}</div>
              )}
            </div>

            {sieve && sieveOpen && (grouping === "sender" || grouping === "domain") && (
              <div className="rounded-card border border-line bg-panel2 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="type-meta text-muted">{t("sieve.intro")}</span>
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
                  <Button variant="secondary" onClick={() => {
                    navigator.clipboard?.writeText(sieveSnippet(
                      grouping, group.key, sieveAction, sieveFolder));
                    setNote(t("sieve.copied"));
                  }}>{t("Copy")}</Button>
                  <a className={`type-meta ${LINK_ACCENT}`}
                    href="https://account.proton.me/mail/filters"
                    target="_blank" rel="noopener">
                    {t("sieve.open_proton")}
                  </a>
                </div>
                <pre className="overflow-x-auto rounded-control bg-surface p-2
                  type-meta leading-relaxed">
                  {sieveSnippet(grouping, group.key, sieveAction, sieveFolder)}
                </pre>
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {error && <div className="p-4 type-body text-danger-fg">{error}</div>}
            {!shown && !error && <Loading />}
            {shown && (
              <MailRows mails={shown} sel={sel} onToggle={toggle}
                onOpen={setView} onPin={togglePin} />
            )}
          </div>

          {/* Contextual bulk-action bar: the ONLY bulk-action chrome for the
              mail list, matching the overview's convention - it does not
              exist at all until something is selected. The panel is
              already a bounded flex column (Modal), so this sits as a
              normal flex child at the bottom rather than needing `fixed`. */}
          {sel.size > 0 && (
            <div className="border-t border-line bg-panel2 px-4 py-2"
              style={{ paddingBottom:
                "calc(env(safe-area-inset-bottom) + 0.5rem)" }}>
              <div className="mb-2 flex items-center gap-2 type-meta text-muted">
                <span>{t("detail.n_selected", { n: sel.size })}</span>
                <button className={LINK}
                  onClick={() => setSel(new Set())}>
                  {t("Clear selection")}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* The Action… select stays mounted even once "Move to
                    folder…" is picked (matching the overview's bulk bar) -
                    swapping it out for the folder-picker in place made the
                    native iOS option list occasionally show the wrong
                    (stale) options, since both selects shared one DOM
                    node. The folder picker is a separate, additional
                    control instead. */}
                <Select value="" className="min-w-0 flex-1" disabled={busy}
                  onChange={(e) => onAction(e.target.value)}>
                  <option value="" disabled>{t("Action…")}</option>
                  <option value="archive">{t("Archive")}</option>
                  <option value="move">{t("Move to folder…")}</option>
                  <option value="mark_read">{t("Mark read")}</option>
                  {aiEnabled && <option value="ai_review">{t("ai.rate")}</option>}
                </Select>
                {moveDest === "?" && (
                  <>
                    <Select value="" className="min-w-0 flex-1"
                      onChange={(e) => {
                        if (e.target.value) act("move", e.target.value);
                        setMoveDest("");
                      }}>
                      <option value="" disabled>{t("Move to folder…")}</option>
                      {folders.map((f) => <option key={f} value={f}>{f}</option>)}
                    </Select>
                    <Button variant="secondary" size="icon" label={t("Cancel")}
                      className="shrink-0" onClick={() => setMoveDest("")}>
                      <X size={18} />
                    </Button>
                  </>
                )}
                <Button variant="danger" disabled={busy}
                  className="ml-auto shrink-0"
                  onClick={() => act("trash")}>
                  {t("Trash selected")} ({sel.size})
                </Button>
              </div>
            </div>
          )}

          {/* Group-scoped actions. They live here (not in the header) so
              "Trash all N" names its scope and sits away from Close. Hidden
              while a selection exists: the selection bar above is then the
              one place to act (no two red buttons stacked). */}
          {sel.size === 0 && <div className="flex flex-wrap items-center gap-2 border-t
            border-line px-4 py-2"
            style={{ paddingBottom:
              "calc(env(safe-area-inset-bottom) + 0.5rem)" }}>
            {onBlock && !blocked && (
              <Button variant="secondary" title={t("block.tip")}
                onClick={() => onBlock(group)}>
                {t("block.btn")}
              </Button>
            )}
            {onUnblock && blocked && (
              <Button variant="secondary" title={t("unblock.tip")}
                onClick={() => onUnblock(group)}>
                {t("Unblock")}
              </Button>
            )}
            {groupCount > 0 && (
              <Button variant="danger" className="ml-auto"
                title={t("trash_all.tip", { n: groupCount })}
                onClick={async () => { if (await onTrash(group)) onClose(); }}>
                {t("trash_all.btn", { n: groupCount })}
              </Button>
            )}
          </div>}
        </>
      )}
    </Modal>
  );
}
