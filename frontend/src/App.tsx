import { ArrowDown, BarChart3, BookmarkPlus, ChevronDown, ClipboardList,
  Copy, Download, Info, Mail, Moon, MoreHorizontal, Paperclip, Pencil, Plus,
  Power,
  ScrollText, Search, Settings as SettingsIcon, Sparkles, Star, Sun,
  Trash2, User, Wand2, X }
  from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, downloadFile, setAccount as apiSetAccount, withAccount }
  from "./api";
import { AuditLogPanel } from "./components/AuditLogPanel";
import { DetailPanel } from "./components/DetailPanel";
import { Login } from "./components/Login";
import { AttachmentsPanel } from "./components/AttachmentsPanel";
import { DuplicatesPanel } from "./components/DuplicatesPanel";
import { GroupTable, type SortKey } from "./components/GroupTable";
import { RulesModal } from "./components/RulesModal";
import { AllMailsView } from "./components/AllMailsView";
import { SearchPanel } from "./components/SearchPanel";
import { SettingsModal } from "./components/SettingsModal";
import { StatsPanel } from "./components/StatsPanel";
import { QueryBuilder } from "./components/QueryBuilder";
import { TrashPanel } from "./components/TrashPanel";
import { AccountAvatar, applyTheme, Button, Chip, currentTheme, EmptyState,
  ensureAiAck, Input, isModalOpen, LINK, LINK_ACCENT, Menu, MenuHeading,
  MenuItem, Notice, ProgressBar, Select, Spinner, useToast,
  type ToastVariant } from "./components/ui";
import { t } from "./i18n";
import { applyStatus, fmtAgo, fmtSize, fmtUsd, matchGroup, parseFilter,
  parseProgress, retainedMailKeys } from "./lib";
import type { AppState, AuthProbe, Config, FilterPreset, Group, Grouping,
  StatusMsg } from "./types";

const GROUPING_LABEL: Record<Grouping, string> = {
  sender: "Sender", domain: "Domain", subject: "Subject",
  thread: "Thread",
};
// Groupings keyed by something that is neither an address nor a domain:
// no protect/block/Sieve shortcuts (those need a sender or a domain).
const KEYED_BY_MAIL = (g: Grouping) => g === "subject" || g === "thread";

const SORT_OPTIONS: { k: SortKey; label: string }[] = [
  { k: "count", label: "Sort: mails" },
  { k: "size", label: "Sort: size" },
  { k: "last", label: "Sort: last activity" },
  { k: "unreadPct", label: "Sort: unread %" },
  { k: "engagement", label: "Sort: engagement" },
  { k: "label", label: "Sort: name" },
];

// Quick-select presets, rendered as one-tap chips: each ADDS matching
// groups to the selection (it is not a toggle) AND narrows the filter
// box to the same condition, so the selected handful isn't left
// scattered across a long unfiltered list.
const PRESET_CHIPS: { key: string; label: string }[] = [
  { key: "aisafe", label: "AI-safe groups" },
  { key: "older6", label: "Inactive > 6 months" },
  { key: "older12", label: "Inactive > 1 year" },
  { key: "older24", label: "Inactive > 2 years" },
  { key: "unsub_pending", label: "sel.unsub_pending" },
];

const sortValue = (g: Group, k: SortKey): number | string => {
  if (k === "unreadPct") return g.count ? g.unread / g.count : 0;
  return g[k];
};

const actionVerb = (a: string): string =>
  ({ trash: t("Move to Trash"), archive: t("Archive"), move: t("Move"),
     mark_read: t("Mark as read") } as Record<string, string>)[a] ?? a;

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  // null = probing; the app only talks to the API once authed.
  const [auth, setAuth] = useState<AuthProbe | null>(null);
  // Active account: every view shows EXACTLY one account, never a mix.
  const [account, setAccountState] = useState(
    () => localStorage.getItem("pmc_account") || "");
  const [mode, setMode] = useState<Grouping>("sender");
  // The flat "All mails" view sits beside the grouping tabs; the choice
  // survives reloads like the sort settings.
  const [flat, setFlat] = useState(
    () => localStorage.getItem("pmc_view") === "mails");
  useEffect(() => {
    localStorage.setItem("pmc_view", flat ? "mails" : "groups");
  }, [flat]);
  const [filter, setFilter] = useState("");
  // Sort field + direction survive reloads; every field has a natural
  // default direction (name A→Z, everything else biggest/newest first)
  // and the toolbar toggle / a second header click flips it.
  const [sortK, setSortK] = useState<SortKey>(() => {
    const k = localStorage.getItem("pmc_sort_k") as SortKey | null;
    return k && SORT_OPTIONS.some((o) => o.k === k) ? k : "count";
  });
  const [sortDir, setSortDir] = useState(
    () => Number(localStorage.getItem("pmc_sort_dir")) || -1);
  useEffect(() => {
    localStorage.setItem("pmc_sort_k", sortK);
    localStorage.setItem("pmc_sort_dir", String(sortDir));
  }, [sortK, sortDir]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Which quick-select chip's 3-tap cycle (filter -> select -> clear,
  // see selectPreset) is mid-way through, and at which step - tracked
  // explicitly rather than derived from whether the matches HAPPEN to
  // already be selected, which breaks the cycle the second time around
  // (a prior activation - or an unrelated manual selection - can already
  // satisfy "everything matching is selected", skipping straight to
  // clearing without a true select step in between).
  const [activeChip, setActiveChip] =
    useState<{ key: string; step: "filtered" | "selected" } | null>(null);
  const [detail, setDetail] = useState<Group | null>(null);
  // Editing a saved filter preset: a dedicated query (NOT the main filter
  // box - that was confusing, see the chip row below) edited with the
  // same Input+QueryBuilder pairing the filter box itself uses.
  const [editingPreset, setEditingPreset] = useState<FilterPreset | null>(
    null);
  const [editQuery, setEditQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [attsOpen, setAttsOpen] = useState(false);
  const [dupsOpen, setDupsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);
  const [moveDest, setMoveDest] = useState("");
  // The folder picker must never be a dead end: clearing the selection
  // (the bar disappearing entirely) also resets it, so re-selecting
  // something always starts back at the plain Action… control instead of
  // reopening mid-move with no way back short of reloading.
  useEffect(() => {
    if (!selected.size) setMoveDest("");
  }, [selected.size]);
  // Retention restriction for bulk group actions: act on everything beyond
  // a keep-window instead of the whole group (mutually exclusive variants).
  const [retention, setRetention] =
    useState<"none" | "keep_latest" | "older_than_days">("none");
  const [retentionN, setRetentionN] = useState("");
  // Current retention selector as (keep_latest, older_than_days), both null
  // when unset/invalid - "none" means act on every mail, today's behavior.
  const retentionParams = (): [number | null, number | null] => {
    const n = Number(retentionN);
    if (retention === "keep_latest" && n > 0) return [n, null];
    if (retention === "older_than_days" && n > 0) return [null, n];
    return [null, null];
  };
  const [focusIdx, setFocusIdx] = useState(-1);
  // Transient "doing it now" text shown with the running-job progress until
  // the backend reports real progress; results and errors are toasts.
  const [pending, setPending] = useState("");
  const toast = useToast();
  const notify = (msg: string, variant: ToastVariant = "info") =>
    toast.show(msg, { variant });
  const fail = (e: any, key = "err.generic") =>
    notify(t(key, { msg: e.message ?? e }), "error");
  const connToast = useRef<number | null>(null);   // one lost-connection toast
  const [theme, setTheme] = useState<"dark" | "light">(currentTheme());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sse = useRef<EventSource | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const fetching = useRef(false);   // one full-state fetch at a time
  const stateRef = useRef<AppState | null>(null);

  const refresh = useCallback(async () => {
    clearTimeout(timer.current);
    if (fetching.current) return;
    fetching.current = true;
    try {
      const st = await api.state();
      stateRef.current = st;
      setState(st);
      if (connToast.current != null) {
        toast.dismiss(connToast.current);
        connToast.current = null;
      }
      // Polling fallback only drives itself when SSE isn't connected.
      if (!sse.current && (st.status === "scanning"
          || st.ai.status === "running" || st.delete.status === "running"
          || st.atts?.status === "running"
          || st.unsub?.status === "running")) {
        timer.current = setTimeout(refresh, 1200);
      }
    } catch (e: any) {
      // Polling retries every few seconds: show the error once, not per try.
      if (connToast.current == null) {
        connToast.current = toast.show(
          t("err.connection", { msg: e.message ?? e }), { variant: "error" });
      }
      if (!sse.current) timer.current = setTimeout(refresh, 4000);
    } finally {
      fetching.current = false;
    }
  }, [toast]);

  // Drop a stale saved account (e.g. deleted meanwhile) once cfg is known.
  useEffect(() => {
    if (cfg && (!account || !cfg.accounts[account])) {
      switchAccount(cfg.default_account);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg]);

  const switchAccount = (name: string) => {
    localStorage.setItem("pmc_account", name);
    apiSetAccount(name);
    // Switching swaps the ENTIRE view: no state may leak across accounts.
    stateRef.current = null;
    setState(null);
    setSelected(new Set());
    setDetail(null);
    setFilter("");
    setFocusIdx(-1);
    setAccountState(name);   // effect below reconnects SSE for this account
  };

  useEffect(() => {
    api.authProbe()
      .then(setAuth)
      .catch(() => setAuth({ mode: "none", authed: true }));
  }, []);
  const authOk = !!auth && (auth.mode === "none" || auth.authed);

  useEffect(() => {
    if (!authOk) return;
    apiSetAccount(account);
    api.getConfig().then(setCfg).catch(() => {});
    // Prefer server-sent events; fall back to polling if they fail.
    try {
      const es = new EventSource(withAccount("/api/events"));
      // The stream carries only the slim status (a few KB); the big group
      // lists are fetched once and again whenever groups_rev moves.
      es.onmessage = (ev) => {
        const slim = JSON.parse(ev.data) as StatusMsg;
        const merged = applyStatus(stateRef.current, slim);
        if (merged) {
          stateRef.current = merged;
          setState(merged);
        } else {
          refresh();
        }
      };
      es.onerror = () => {
        es.close();
        if (sse.current === es) sse.current = null;
        refresh();
      };
      sse.current = es;
    } catch {
      /* EventSource unavailable */
    }
    refresh();
    return () => {
      clearTimeout(timer.current);
      sse.current?.close();
      sse.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, account, authOk]);

  /* Web notifications (opt-in via settings): fire when a background job
     finishes while the tab is hidden. */
  const prevJobs = useRef<{ d?: string; a?: string; t?: string; u?: string }>(
    {});
  useEffect(() => {
    if (!state) return;
    const fire = (body: string) => {
      if (localStorage.getItem("pmc_notify") !== "1") return;
      if (typeof Notification === "undefined"
          || Notification.permission !== "granted" || !document.hidden) return;
      try {
        new Notification("Mailbroom", { body, icon: "/icon.svg" });
      } catch { /* not supported */ }
    };
    const p = prevJobs.current;
    if (p.d === "running" && state.delete.status === "done")
      fire(t("notify.delete_done", { n: state.delete.moved }));
    if (p.a === "running" && state.ai.status === "done")
      fire(t("notify.ai_done"));
    if (p.t === "running" && state.atts?.status === "done")
      fire(t("notify.atts_done"));
    if (p.u === "running" && state.unsub?.status === "done")
      fire(t("notify.unsub_done"));
    prevJobs.current = { d: state.delete.status, a: state.ai.status,
      t: state.atts?.status, u: state.unsub?.status };
  }, [state]);

  /* Job outcomes as toasts. Only a CHANGE of a job's status toasts (a page
     load or account switch that finds an old "done" stays quiet); a scan
     error is the one exception, there is no other trace of it. */
  const seenJobs = useRef<{ scan?: string; d?: string; a?: string;
    u?: string; undo?: string } | null>(null);
  useEffect(() => {
    if (!state) { seenJobs.current = null; return; }
    const prev = seenJobs.current;
    const last = state.undo[state.undo.length - 1];
    const undoKey = last ? `${last.ts}|${last.count}|${last.label}` : "";
    // Undo entries are also recorded mid-job, so while a move runs the
    // baseline stays the key from before it started.
    seenJobs.current = { scan: state.status, d: state.delete.status,
      a: state.ai.status, u: state.unsub?.status,
      undo: state.delete.status === "running" && prev ? prev.undo : undoKey };
    if (state.status === "error" && prev?.scan !== "error")
      notify(t("err.generic", { msg: state.error }), "error");
    if (!prev) return;
    const { delete: del, ai, unsub } = state;
    if (del.status !== prev.d) {
      if (del.status === "error") {
        notify(t("err.generic", { msg: del.error }), "error");
      } else if (del.status === "done" && del.moved > 0) {
        // Offer Undo only for the entry THIS job recorded, found again by
        // identity at click time (the list may have shifted by then).
        const entry = undoKey !== prev.undo ? last : undefined;
        toast.show(entry?.action === "trash"
          ? t("toast.moved_trash", { n: del.moved })
          : t("done_moved", { n: del.moved }), {
          variant: "success",
          action: entry ? { label: t("Undo"), onClick: () => {
            const i = stateRef.current?.undo.findIndex((u) =>
              u.ts === entry.ts && u.count === entry.count
              && u.label === entry.label) ?? -1;
            if (i >= 0) undo(i);
          } } : undefined,
        });
      }
    }
    if (unsub && unsub.status !== prev.u) {
      if (unsub.status === "error")
        notify(t("err.unsub", { msg: unsub.error }), "error");
      else if (unsub.status === "done" && unsub.total > 0)
        notify(t("unsub.done", { done: unsub.done, links: unsub.links,
          failed: unsub.failed }), "success");
    }
    if (ai.status !== prev.a) {
      if (ai.status === "error") {
        notify(t("err.ai", { msg: ai.error }), "error");
      } else if (ai.status === "done" && ai.usage) {
        const u = ai.usage;
        notify(t("ai_done", { in: u.input_tokens, out: u.output_tokens,
          cost: u.cost ? ` ≈ ${fmtUsd(u.cost)}` : "",
          total: fmtUsd(u.total_cost ?? 0) }), "success");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  /* The toast stack sits above the bulk bar: publish its height. */
  const bulkBar = useRef<HTMLDivElement>(null);
  const hasSelection = selected.size > 0;
  useEffect(() => {
    const root = document.documentElement.style;
    const el = bulkBar.current;
    if (!hasSelection || !el) { root.removeProperty("--bulkbar-h"); return; }
    const sync = () => root.setProperty("--bulkbar-h", `${el.offsetHeight}px`);
    sync();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => { ro.disconnect(); root.removeProperty("--bulkbar-h"); };
  }, [hasSelection]);

  /* Update check: installed PWAs have no service worker here, so an
     already-open tab can only learn a new build is live by asking the
     server directly - a real, never-cached fetch (see api.version) -
     rather than depending on the browser ever re-fetching index.html. */
  const [updateAvailable, setUpdateAvailable] = useState(false);
  // The build this tab actually loaded with - shown in the profile menu so
  // a stuck/stale tab is visible at a glance instead of guessed at.
  const [buildId, setBuildId] = useState<string | null>(null);
  const buildRef = useRef<string | null>(null);
  useEffect(() => {
    if (!authOk) return;
    let cancelled = false;
    const check = () => api.version().then(({ build }) => {
      if (cancelled) return;
      if (buildRef.current == null) { buildRef.current = build; setBuildId(build); }
      else if (build !== buildRef.current) setUpdateAvailable(true);
    }).catch(() => { /* offline/unreachable - try again next tick */ });
    check();
    const id = setInterval(check, 20_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [authOk]);

  // Unfiltered: used by the quick-select chips below, which must always
  // reflect the same full mailbox regardless of whatever filter is
  // currently showing - otherwise filtering down to one chip's
  // condition can make an UNRELATED chip disappear or change its count.
  const allGroups = useMemo(() =>
    Object.values(state?.groups?.[mode] ?? {}), [state, mode]);

  const groups = useMemo(() => {
    const f = parseFilter(filter);
    const filtered = allGroups.filter((g) => matchGroup(g, f));
    return filtered.sort((a, b) => {
      const va = sortValue(a, sortK), vb = sortValue(b, sortK);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return cmp * sortDir || b.count - a.count;
    });
  }, [allGroups, filter, sortK, sortDir]);

  // Block rules are visible, ordinary rules: a "block:<key>" query is
  // `from:<key>`/`domain:<key>` with origin "block" - derive which group
  // keys are currently blocked (and their rule id, for one-click unblock)
  // so rows/detail can show a badge+Unblock button and hide the Block one.
  const blockedRules = useMemo(() => {
    const map = new Map<string, string>();
    if (KEYED_BY_MAIL(mode)) return map;
    const prefix = mode === "sender" ? "from:" : "domain:";
    for (const r of state?.rules ?? []) {
      if (r.origin === "block" && r.grouping === mode
          && r.query.startsWith(prefix)) {
        map.set(r.query.slice(prefix.length), r.id);
      }
    }
    return map;
  }, [state?.rules, mode]);

  // How many mails `keys` would actually move: the full group counts when
  // no retention restriction applies, or (when one does) the real count
  // fetched per group and reduced by the same keep-window logic the
  // backend applies (lib.ts's retainedMailKeys mirrors mailops.py).
  // Pinned mails never move (except for mark_read), so they are left out
  // of the count too (`skipPinned`).
  const retentionAdjustedCount = async (keys: string[],
      keepLatest: number | null, olderThanDays: number | null,
      skipPinned = true): Promise<number> => {
    const all = state?.groups[mode] ?? {};
    const naive = (k: string) =>
      (all[k]?.count ?? 0) - (skipPinned ? all[k]?.pinned ?? 0 : 0);
    if (!keepLatest && !olderThanDays) {
      return keys.reduce((n, k) => n + naive(k), 0);
    }
    const counts = await Promise.all(keys.map(async (k) => {
      try {
        const mails = await api.group(mode, k);
        return mails.length - retainedMailKeys(
          mails, keepLatest, olderThanDays, skipPinned).size;
      } catch {
        return naive(k);                // fetch failed: fall back to "all"
      }
    }));
    return counts.reduce((a, b) => a + b, 0);
  };

  // Count over ALL groups of the mode, not the filtered view - actions apply
  // to every selected key, including ones a filter is hiding. Without
  // retention this is instant (just a sum already in `state`). With
  // retention active, the real count needs a fetch - rather than flash
  // the naive total and then correct it (confusing to watch), selCount
  // stays at its last settled value and selCountPending gates display
  // until the new one is ready.
  const [selCount, setSelCount] = useState(0);
  const [selCountPending, setSelCountPending] = useState(false);
  useEffect(() => {
    const all = state?.groups?.[mode] ?? {};
    const keys = [...selected];
    const [keepLatest, olderThanDays] = retentionParams();
    if (!keys.length || (!keepLatest && !olderThanDays)) {
      setSelCount(keys.reduce(
        (n, k) => n + (all[k]?.count ?? 0) - (all[k]?.pinned ?? 0), 0));
      setSelCountPending(false);
      return;
    }
    setSelCountPending(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      retentionAdjustedCount(keys, keepLatest, olderThanDays)
        .then((n) => {
          if (cancelled) return;
          setSelCount(n);
          setSelCountPending(false);
        });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
    // groups_rev/account (not the whole `state` object) are the actual
    // signals that group data changed - the SSE stream pushes a new
    // `state` reference on every slim status tick (job progress, etc.)
    // even when nothing relevant moved, which made this flap between the
    // naive and adjusted count forever instead of settling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.groups_rev, state?.account, mode, selected, retention,
      retentionN]);

  // Everything in the selection is pinned: nothing would move. Shown in
  // the bar itself, right where the user just acted.
  const selAllPinned = !selCountPending && selected.size > 0 && selCount === 0
    && !retentionParams().some(Boolean)
    && [...selected].some((k) => (state?.groups[mode]?.[k]?.pinned ?? 0) > 0);

  const scanning = state?.status === "scanning";
  const aiRunning = state?.ai.status === "running";
  const deleting = state?.delete.status === "running";
  const attsRunning = state?.atts?.status === "running";
  const unsubRunning = state?.unsub?.status === "running";
  const aiEnabled = !!cfg?.ai.available;
  const acct = cfg?.accounts[account] ?? null;
  const multiAccount = !!cfg && Object.keys(cfg.accounts).length > 1;
  const anyModal = !!detail || searchOpen || settingsOpen || rulesOpen
    || attsOpen || dupsOpen || statsOpen || auditOpen || trashOpen;

  const startScan = async () => {
    setSelected(new Set());
    // Instant feedback: the real progress replaces this on the next tick.
    setPending(t("Starting…"));
    try { await api.scan(); refresh(); }
    catch (e: any) { fail(e); }
    setPending("");
  };

  // No `keys` = every unrated group in the current grouping (today's
  // behavior, reachable from the "⋯" overflow menu); a `keys` list scopes
  // the run to just those groups (the contextual bar's selection-aware
  // entry).
  const startAi = async (keys?: string[]) => {
    if (!ensureAiAck()) return;
    setPending(t("Starting…"));
    try { await api.aiReview(mode, keys); refresh(); }
    catch (e: any) { fail(e, "err.ai"); }
    setPending("");
  };

  const cancel = async () => {
    const target = scanning ? "scan" : aiRunning ? "ai"
      : attsRunning ? "atts" : unsubRunning ? "unsub" : "delete";
    try { await api.cancel(target); refresh(); } catch { /* too late */ }
  };

  const undo = async (index: number) => {
    const entry = stateRef.current?.undo[index];
    if (!entry) return;
    setUndoOpen(false);
    if (!confirm(t("confirm.restore",
      { count: entry.count, label: entry.label }))) return;
    setPending(t("Restoring…"));
    try { await api.undo(index); refresh(); }
    catch (e: any) { fail(e, "err.undo"); }
    setPending("");
  };

  const emptyTrash = async () => {
    const n = state?.trash_count ?? 0;
    if (!confirm(t("confirm.empty_trash", { n }))) return;
    setPending(t("Emptying Trash…"));
    try { await api.emptyTrash(); refresh(); }
    catch (e: any) { fail(e); }
    setPending("");
  };

  // The filter-box DSL equivalent of each quick-select preset - the
  // single source of truth for "what does this chip mean", used both to
  // narrow the view (below) and, via matchGroup, to decide what counts
  // as "matching" for selection. Keeps the two from drifting apart.
  const presetFilterQuery = (preset: string): string => {
    if (preset === "aisafe") return "ai:safe";
    if (preset.startsWith("older")) {
      const months = Number(preset.slice(5));
      return `age:>${months % 12 === 0 ? `${months / 12}y` : `${months}m`}`;
    }
    if (preset === "unsub_pending") return "is:unsub is:not-unsubscribed";
    if (preset === "new") return "is:new";
    return "";
  };

  // Chips are NOT additive/combinable - each tap always reflects the
  // full mailbox (allGroups), never "on top of" whatever another chip
  // left behind. A combination needs a typed or saved filter instead.
  // Each chip cycles through three VISUALLY DISTINCT taps:
  //   1. not currently showing this chip's filter -> show it (view only,
  //      selection untouched - lets you eyeball matches first)
  //   2. showing it, but not everything matching is selected yet ->
  //      select every match (except protected ones, same as always)
  //   3. showing it AND everything matching already selected -> UN-select
  //      exactly those matches and go back to the full, unfiltered list.
  // Step 3 deliberately undoes step 2 (rather than leaving the selection
  // as-is) so a second activation of the same chip starts from the same
  // clean slate as the first - otherwise steps 1 and 2 look identical
  // the second time around (the matches are already ticked from last
  // time), and only step 3 produces a visible change.
  const selectPreset = (preset: string) => {
    if (preset === "none") { setSelected(new Set()); setActiveChip(null);
      return; }
    const query = presetFilterQuery(preset);
    // Only trust a remembered step for THIS chip if the filter box still
    // shows what that step left it in - a manual edit, a different chip,
    // or an account/mode switch all fall back to step 1 automatically.
    const isActive = activeChip?.key === preset && filter === query;
    if (!isActive) {
      setFilter(query);
      setActiveChip({ key: preset, step: "filtered" });
      return;
    }
    const f = parseFilter(query);
    const matchingKeys = allGroups
      .filter((g) => matchGroup(g, f) && !g.protected).map((g) => g.key);
    const next = new Set(selected);
    if (activeChip.step === "filtered") {
      matchingKeys.forEach((k) => next.add(k));
      setSelected(next);
      setActiveChip({ key: preset, step: "selected" });
    } else {
      matchingKeys.forEach((k) => next.delete(k));
      setSelected(next);
      setFilter("");
      setActiveChip(null);
    }
  };

  // Saved filter presets: unlike selectPreset() above (which ADDS to the
  // selection), tapping one REPLACES the filter query - they are one-tap
  // recall for a named search, not a selection shortcut.
  const saveFilterPreset = async () => {
    const name = prompt(t("saved_filter.name_prompt"))?.trim();
    if (!name) return;
    try {
      await api.createPreset(name, filter);
      refresh();
    } catch (e: any) {
      fail(e);
    }
  };

  const deleteFilterPreset = async (id: string, name: string) => {
    if (!confirm(t("saved_filter.confirm_delete", { name }))) return;
    try {
      await api.deletePreset(id);
      refresh();
    } catch (e: any) {
      fail(e);
    }
  };

  const saveEditedPreset = async () => {
    if (!editingPreset) return;
    try {
      await api.updatePreset(editingPreset.id, editingPreset.name,
        editQuery.trim());
      setEditingPreset(null);
      refresh();
    } catch (e: any) {
      fail(e);
    }
  };

  // Returns whether the action actually proceeded (false = the user
  // declined the confirmation, or every selected group turned out
  // protected) - callers that need to react afterward (e.g. closing a
  // panel once its group is gone) check this instead of assuming success.
  const act = async (keys: string[], action: string, dest = "",
      keepLatest: number | null = null,
      olderThanDays: number | null = null): Promise<boolean> => {
    const all = state?.groups[mode] ?? {};
    let force = false;
    let effective = keys;
    if (action === "trash") {
      const prot = keys.filter((k) => all[k]?.protected);
      if (prot.length === 1 && keys.length === 1) {
        // Explicitly trashing one protected group: allow, after its own
        // warning (the backend requires force for this).
        if (!confirm(t("confirm.trash_protected",
          { label: all[keys[0]]?.label ?? keys[0] }))) return false;
        force = true;
      } else if (prot.length) {
        effective = keys.filter((k) => !all[k]?.protected);
        if (!effective.length) {
          notify(t("toast.all_protected"));
          return false;
        }
      }
    }
    const skipPinned = action !== "mark_read";
    const pins = skipPinned
      ? effective.reduce((n, k) => n + (all[k]?.pinned ?? 0), 0) : 0;
    const n = await retentionAdjustedCount(
      effective, keepLatest, olderThanDays, skipPinned);
    if (n === 0 && pins > 0) {
      notify(t("toast.all_pinned"));
      return false;
    }
    const verb = actionVerb(action) + (dest ? ` → ${dest}` : "");
    const skipNote = (effective.length !== keys.length
      ? " " + t("confirm.protected_skipped",
          { n: keys.length - effective.length }) : "")
      + (pins ? " " + t("confirm.pinned_kept", { n: pins }) : "");
    if (!force && !confirm(
      t("confirm.act", { verb, n, k: effective.length }) + skipNote))
      return false;
    try {
      await api.deleteGroups(mode, effective, action, dest, force,
        keepLatest, olderThanDays);
      setSelected(new Set());
      refresh();   // runs in the background; SSE/polling follows it
      return true;
    } catch (e: any) {
      fail(e);
      return false;
    }
  };

  // Unlike act() (move/trash), the selection is deliberately kept afterward:
  // "select -> Unsubscribe -> Trash" stays a two-click flow on the same set.
  const unsubscribeSelected = async () => {
    if (!selected.size) return;
    if (!confirm(t("confirm.unsubscribe", { k: selected.size }))) return;
    try {
      const r = await api.unsubscribeBulk(mode, [...selected]);
      const skipped = r.skipped_protected + r.skipped_done + r.capped;
      notify(r.queued
        ? t("toast.unsub_started", { n: r.queued })
          + (skipped ? " " + t("toast.unsub_skipped", { n: skipped }) : "")
        : t("toast.unsub_nothing"));
      refresh();
    } catch (e: any) {
      fail(e);
    }
  };

  // Sender mode protects the exact address, domain mode the whole domain.
  // Subject groups have no stable sender, so they get no protect toggle.
  const toggleProtect = KEYED_BY_MAIL(mode) ? undefined : async (g: Group) => {
    const entry = mode === "domain" ? `@${g.key}` : g.key;
    try {
      const r = await api.protect(entry, !g.protected);
      setCfg((c) => (c ? { ...c, protected: r.protected } : c));
      refresh();
    } catch (e: any) {
      fail(e);
    }
  };

  // Sender/domain only (same restriction as protect - subject groups have
  // no stable sender to build a from:/domain: rule from).
  const blockGroup = KEYED_BY_MAIL(mode) ? undefined : async (g: Group) => {
    if (!confirm(t("confirm.block", { label: g.label }))) return;
    const trashExisting = g.count > 0
      && confirm(t("confirm.block_trash_existing", { n: g.count }));
    try {
      await api.block(mode, g.key, g.label, trashExisting);
      notify(t("toast.blocked", { label: g.label }), "success");
      refresh();
    } catch (e: any) {
      fail(e);
    }
  };

  // Unblock = delete the standing rule the Block action created (same
  // reversible path as deleting any other rule in the Rules modal, just
  // reachable with one click from the group itself).
  const unblockGroup = KEYED_BY_MAIL(mode) ? undefined : async (g: Group) => {
    const ruleId = blockedRules.get(g.key);
    if (!ruleId) return;
    if (!confirm(t("confirm.unblock", { label: g.label }))) return;
    try {
      await api.deleteRule(ruleId);
      notify(t("toast.unblocked", { label: g.label }), "success");
      refresh();
    } catch (e: any) {
      fail(e);
    }
  };

  const ackUnsub = async (addr: string) => {
    try { await api.unsubscribeAck(addr); refresh(); }
    catch (e: any) { fail(e); }
  };

  const onAction = (v: string) => {
    if (!selected.size) return;
    if (v === "move") setMoveDest("?");
    else if (v === "unsubscribe") unsubscribeSelected();
    else if (v === "ai_review") startAi([...selected]);
    else act([...selected], v, "", ...retentionParams());
  };

  const dismissNotice = async () => {
    try { await api.clearNotice(); refresh(); } catch { /* cosmetic */ }
  };

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };

  /* Keyboard shortcuts: j/k move, x select, Enter open, # trash, / filter. */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      // isModalOpen(): also covers confirm/prompt dialogs, which App's own
      // panel flags don't know about.
      if (anyModal || isModalOpen()
          || ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName)) return;
      if (e.key === "/") {
        e.preventDefault();
        filterRef.current?.focus();
        return;
      }
      if (flat || !groups.length) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIdx((i) => Math.min(i + 1, groups.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "x" && focusIdx >= 0) {
        const key = groups[focusIdx].key;
        const next = new Set(selected);
        next.has(key) ? next.delete(key) : next.add(key);
        setSelected(next);
      } else if ((e.key === "Enter" || e.key === "o") && focusIdx >= 0) {
        setDetail(groups[focusIdx]);
      } else if (e.key === "#") {
        if (selected.size) act([...selected], "trash", "", ...retentionParams());
        else if (focusIdx >= 0)
          act([groups[focusIdx].key], "trash", "", ...retentionParams());
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  useEffect(() => {
    if (focusIdx < 0) return;
    document.querySelector(`[data-gidx="${focusIdx}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [focusIdx]);

  // The running job (if any): its label, raw progress text and icon. One
  // source for the status text, the cancel button and the progress strip.
  const job = !state ? null
    : scanning ? { label: t("Scanning…"), progress: state.progress }
    : deleting ? { label: t("Moving…"), progress: state.delete.progress }
    : aiRunning ? { label: `AI (${state.ai.grouping})…`,
        progress: state.ai.progress }
    : attsRunning ? { label: t("atts.running"), progress: state.atts.progress,
        icon: <Paperclip size={14} /> }
    : unsubRunning ? { label: t("unsub.running"),
        progress: state.unsub.progress, icon: <Mail size={14} /> }
    : null;

  // Persistent summary only: results and errors are toasts.
  const summary = (): string => {
    if (!state) return "";
    if (groups.length || state.scanned_ts) {
      if (!groups.length && filter && allGroups.length)
        return t("status.filter_none", { n: allGroups.length });
      const mails = groups.reduce((n, g) => n + g.count, 0);
      const size = groups.reduce((n, g) => n + g.size, 0);
      const ago = fmtAgo(state.scanned_ts);
      return `${groups.length} ${t("groups")} · ${mails} ${t("mails")}`
        + ` · ${fmtSize(size)}` + (filter ? ` ${t("(filtered)")}` : "")
        + (ago ? ` · ${t("scan.age", { ago })}` : "");
    }
    return t("No scan yet - hit “Scan”.");
  };

  const statusLine = () => {
    if (!state) return <Spinner />;
    const running = job ?? (pending ? { label: pending, progress: "" } : null);
    if (!running) return summary();
    return (
      <span className="inline-flex items-center gap-1.5">
        {job?.icon}
        {running.label} {running.progress} <Spinner />
        {job && (
          <Button variant="quiet" size="sm" onClick={cancel}>
            {t("cancel")}
          </Button>
        )}
      </span>
    );
  };
  const progress = job ? parseProgress(job.progress) : null;

  if (!auth) {
    return (
      <div className="flex justify-center pt-24"><Spinner size="lg" /></div>
    );
  }
  if (!authOk) {
    return <Login mode={auth.mode}
      onLogin={() => setAuth({ ...auth, authed: true })} />;
  }

  return (
    <div className={`mx-auto max-w-6xl p-3 sm:p-5
      ${selected.size > 0 ? "pb-28 sm:pb-20" : ""}`}>
      <header className="mb-4 flex items-center gap-3">
        <h1 className="type-title">
          Mailbroom
        </h1>
        <span className="ml-auto flex items-center gap-2">
          {state?.trash_count != null && state.trash_count > 0 && (
            <Button variant="quiet" size="sm"
              className="inline-flex items-center gap-1 whitespace-nowrap
                text-muted hover:text-body"
              title={t("trash.browse")}
              onClick={() => setTrashOpen(true)}>
              <Trash2 size={14} /> {state.trash_count}
            </Button>
          )}
          {/* Profile menu: account switcher (when >1 account), identity,
              theme, settings, trash, logout - keeps the header to three
              elements on one min-h-8 baseline on phones. */}
          <Menu label={t("menu.profile")}
            trigger={multiAccount
              ? <>
                  <AccountAvatar name={account} />
                  <span className="max-w-24 truncate" title={account}>
                    {account}
                  </span>
                  {auth.is_admin && auth.mode === "oidc"
                    ? <Star size={14} className="shrink-0" /> : null}
                  <ChevronDown size={14} className="shrink-0 text-faint" />
                </>
              : <span className="inline-flex items-center gap-0.5">
                  <User size={18} />
                  {auth.is_admin && auth.mode === "oidc"
                    && <Star size={14} />}
                </span>}>
            {multiAccount && (
              <>
                <MenuHeading>{t("menu.accounts")}</MenuHeading>
                {Object.entries(cfg!.accounts).map(([n, a]) => (
                  <MenuItem key={n} active={n === account} sub={a.user}
                    onClick={() => n !== account && switchAccount(n)}>
                    <span className="flex items-center gap-2">
                      <AccountAvatar name={n} />
                      {n}
                    </span>
                  </MenuItem>
                ))}
                <MenuItem onClick={() => setSettingsOpen(true)}>
                  <Plus size={16} className="mr-1 inline align-text-bottom" />
                  {t("account.add")}…
                </MenuItem>
                <div className="my-1 border-t border-line" />
              </>
            )}
            {auth.mode === "oidc" && !!auth.sub && (
              <MenuHeading>
                {auth.sub}
                {auth.is_admin && (
                  <span className="inline-flex items-center gap-1">
                    {" "}<Star size={14} /> {t("login.admin_tip")}
                  </span>
                )}
              </MenuHeading>
            )}
            <MenuItem onClick={toggleTheme}>
              {theme === "dark"
                ? <Sun size={16} className="mr-1 inline align-text-bottom" />
                : <Moon size={16} className="mr-1 inline align-text-bottom" />}
              {t("menu.theme", {
                next: theme === "dark" ? t("menu.light") : t("menu.dark") })}
            </MenuItem>
            <MenuItem onClick={() => setSettingsOpen(true)}>
              <SettingsIcon size={16} className="mr-1 inline align-text-bottom" />
              {t("Settings")}
            </MenuItem>
            {state?.trash_count != null && state.trash_count > 0 && (
              <MenuItem onClick={emptyTrash}>
                <Trash2 size={16} className="mr-1 inline align-text-bottom" />
                {t("Empty Trash")} ({state.trash_count})
              </MenuItem>
            )}
            {auth.mode !== "none" && (
              <MenuItem onClick={async () => {
                try { await api.logout(); } catch { /* session gone */ }
                window.location.reload();
              }}>
                <Power size={16} className="mr-1 inline align-text-bottom" />
                {t("login.logout")}
              </MenuItem>
            )}
            {buildId && (
              <MenuHeading>
                {t("menu.version", { version: __APP_VERSION__, id: buildId })}
              </MenuHeading>
            )}
          </Menu>
        </span>
      </header>

      {updateAvailable && (
        <div className="mb-3 flex items-center justify-between gap-2
          rounded-control border border-accent/40 bg-panel2 px-3 py-2 type-body">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles size={16} /> {t("update.available")}
          </span>
          <Button size="sm" onClick={() => window.location.reload()}>
            {t("update.reload")}
          </Button>
        </div>
      )}

      {/* Row 1: primary actions - identical in every grouping mode. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button onClick={startScan}
          disabled={scanning || aiRunning || deleting || attsRunning
            || unsubRunning}>
          {scanning ? <Spinner className="text-white" /> : t("Scan")}
        </Button>
        {/* order-2 + w-full: on phones the grouping toggle gets a full line
            of its own instead of being shrunk by the icon strip. */}
        <div className="order-2 flex w-full overflow-hidden rounded-control border
          border-line sm:order-none sm:w-auto">
          {(Object.keys(GROUPING_LABEL) as Grouping[]).map((g) => (
            <button key={g}
              onClick={() => {
                setFlat(false); setMode(g); setSelected(new Set());
                setFocusIdx(-1);
              }}
              className={`flex-1 whitespace-nowrap px-2 py-1.5 type-body sm:flex-none sm:px-3 ${
                !flat && mode === g
                  ? "bg-accent text-white"
                  : "bg-panel2 text-body hover:bg-chip"}`}>
              {t(GROUPING_LABEL[g])}
            </button>
          ))}
          <button
            onClick={() => {
              setFlat(true); setSelected(new Set()); setFocusIdx(-1);
            }}
            className={`flex-1 whitespace-nowrap px-2 py-1.5 type-body sm:flex-none sm:px-3 ${flat
              ? "bg-accent text-white"
              : "bg-panel2 text-body hover:bg-chip"}`}>
            {t("view.all_mails")}
          </button>
        </div>
        {/* Filter + builder share one flex-wrap unit: the builder toggle
            sits right next to the input on every width, and the builder
            panel (w-full) wraps to its own line directly underneath. */}
        {!flat && (
        <div className="relative order-last flex w-full flex-wrap
          items-center gap-2 sm:order-none sm:w-auto sm:min-w-24 sm:flex-1">
          <div className="relative min-w-0 flex-1">
            <Input
              ref={filterRef}
              className="w-full pr-9 coarse:pr-10"
              placeholder={t("filter groups…")}
              title="Combinable: tag:shipping ai:safe age:>1y unread:>80 is:unsub text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {!!filter && (
              <span className="absolute inset-y-0 right-0 flex items-center">
                {/* The wrapper centres the Button: a transform on the Button
                    itself is replaced by its pressed translate-y-px. */}
                <Button variant="quiet" size="icon" label={t("Clear filter")}
                  className="text-muted hover:text-body"
                  onClick={() => { setFilter(""); filterRef.current?.focus(); }}>
                  <X size={16} />
                </Button>
              </span>
            )}
          </div>
          <QueryBuilder value={filter} onChange={setFilter} />
          <Button variant="secondary" size="icon"
            label={t("saved_filter.save_tip")}
            disabled={!filter.trim()}
            onClick={saveFilterPreset}>
            <BookmarkPlus size={18} />
          </Button>
        </div>
        )}
        {/* One wrap unit; a tight gap on phones (deliberate: the 40 px touch
            icons would otherwise push the strip onto its own line, UX5
            reworks this toolbar). */}
        <div className={`ml-auto flex items-center gap-0.5 sm:gap-2 ${
          flat ? "" : "sm:ml-0"}`}>
          <Button variant="secondary" size="icon" label={t("Search all mails")}
            onClick={() => setSearchOpen(true)}><Search size={18} /></Button>
          <Button variant="secondary" size="icon" label={t("Rules")}
            onClick={() => setRulesOpen(true)}>
            <ClipboardList size={18} />
          </Button>
          <Button variant="secondary" size="icon" label={t("Attachments")}
            onClick={() => setAttsOpen(true)}><Paperclip size={18} /></Button>
          <Button variant="secondary" size="icon" label={t("Duplicates")}
            disabled={state?.status !== "done"}
            onClick={() => setDupsOpen(true)}><Copy size={18} /></Button>
          <Button variant="secondary" size="icon" label={t("Statistics")}
            onClick={() => setStatsOpen(true)}><BarChart3 size={18} /></Button>
          <Button variant="secondary" size="icon" label={t("Audit Log")}
            onClick={() => setAuditOpen(true)}><ScrollText size={18} /></Button>
          <Menu label={t("menu.more")} trigger={<MoreHorizontal size={18} />}>
            {aiEnabled && (
              <MenuItem onClick={() => startAi()}
                disabled={scanning || aiRunning || state?.status !== "done"}>
                <Wand2 size={16} className="mr-1 inline align-text-bottom" />
                {t("AI review")}
              </MenuItem>
            )}
            <MenuItem onClick={() => downloadFile(api.exportUrl(mode))}
              sub={t("export.csv_tip")}>
              <Download size={16} className="mr-1 inline align-text-bottom" />
              {t("export.csv")}
            </MenuItem>
          </Menu>
        </div>
      </div>
      {/* Row 2: quick-select preset chips + sort, as ONE wrapping flex
          layout - chips wrap onto their own line(s) instead of competing
          with Sort for a single line or hiding behind a horizontal
          scroll. No selection-dependent chrome here (that lives in the
          bottom bar below, which only renders once something is
          selected). */}
      {!flat && (
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {PRESET_CHIPS.map((p) => (
          <Chip key={p.key} className="shrink-0"
            on={filter === presetFilterQuery(p.key)}
            onClick={() => selectPreset(p.key)}>
            {t(p.label)}
          </Chip>
        ))}
        {/* New-sender review: only shown once there's something to review -
            an always-visible "New (0)" chip would just be clutter. Count
            and visibility come from the FULL mailbox (allGroups), not the
            currently-filtered groups - otherwise another active chip's
            filter could hide this one. */}
        {allGroups.some((g) => g.new) && (
          <Chip className="shrink-0" on={filter === "is:new"}
            onClick={() => selectPreset("new")}>
            {t("chip.new_count",
              { n: allGroups.filter((g) => g.new).length })}
          </Chip>
        )}
        {/* Saved filter presets: user-defined, visually distinct (outlined
            accent vs. the built-ins' filled muted look above) - tapping one
            REPLACES the filter query instead of adding to the selection.
            The pencil opens an inline editor (below, same Input +
            QueryBuilder pairing the filter box itself uses) on the
            preset's OWN stored query - not whatever's in the filter box;
            the x deletes it. */}
        {(state?.presets ?? []).map((p) => (
          <span key={p.id}
            className="inline-flex shrink-0 items-center gap-1 rounded-full
              border border-accent/50 bg-transparent px-3 py-1.5 type-meta
              whitespace-nowrap text-accent hover:bg-chip">
            <button onClick={() => setFilter(p.query)} title={p.query}>
              {p.name}
            </button>
            <button
              className="opacity-60 hover:opacity-100"
              title={t("saved_filter.edit_tip")}
              aria-label={t("Edit")}
              onClick={(e) => {
                e.stopPropagation();
                setEditingPreset(p);
                setEditQuery(p.query);
              }}>
              <Pencil size={14} />
            </button>
            <button
              className="opacity-60 hover:opacity-100"
              title={t("Delete")}
              aria-label={t("Delete")}
              onClick={(e) => {
                e.stopPropagation();
                deleteFilterPreset(p.id, p.name);
              }}>
              <X size={14} />
            </button>
          </span>
        ))}
        {/* Sort: field select + direction toggle as one segmented
            control; the arrow rotates instead of swapping glyphs. No
            ml-auto: that pushed it flush right whenever it wrapped onto
            its own line (chips don't reliably fill the row), stranding it
            with a big empty gap in front - it just flows after the last
            chip now, like any other item in this row. */}
        <div className="flex shrink-0 items-stretch overflow-hidden
          rounded-control border border-line">
          <Select className="min-w-0 flex-1 !rounded-none !border-0"
            value={sortK}
            onChange={(e) => {
              const k = e.target.value as SortKey;
              setSortK(k);
              setSortDir(k === "label" ? 1 : -1);
            }}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.k} value={o.k}>{t(o.label)}</option>
            ))}
          </Select>
          {/* !rounded-none: the segment's corners belong to the wrapper. */}
          <Button variant="secondary" size="icon"
            label={t(sortDir < 0 ? "sort.desc_tip" : "sort.asc_tip")}
            className="shrink-0 !rounded-none border-l border-line"
            onClick={() => setSortDir(-sortDir)}>
            <ArrowDown aria-hidden size={16}
              className={`text-accent transition-transform duration-200
                ${sortDir > 0 ? "rotate-180" : ""}`} />
          </Button>
        </div>
      </div>
      )}

      {/* Inline preset editor: appears only while editing one (Pencil
          above) - a Cancel is always reachable, per the rule of never
          leaving a swapped-in control with no way back. */}
      {!flat && editingPreset && (
        <div className="relative mb-3 flex flex-wrap items-center gap-2
          rounded-card border border-accent/50 bg-panel2 p-2">
          <span className="shrink-0 type-meta text-muted">
            {t("saved_filter.editing", { name: editingPreset.name })}
          </span>
          <Input className="min-w-0 flex-1" value={editQuery}
            onChange={(e) => setEditQuery(e.target.value)} />
          <QueryBuilder value={editQuery} onChange={setEditQuery} />
          <Button size="sm" onClick={saveEditedPreset}>
            {t("Save")}
          </Button>
          <Button variant="secondary" size="sm"
            onClick={() => setEditingPreset(null)}>
            {t("Cancel")}
          </Button>
        </div>
      )}

      {/* Contextual bulk-action bar: the ONLY bulk-action chrome in the
          app - it does not exist at all until something is selected.
          Three clearly separate rows: (1) what's selected, (2) the
          retention limit - a modifier that applies to WHICHEVER action
          runs below, labelled instead of relying on a hover-only title
          (useless on touch), (3) the actions themselves. */}
      {selected.size > 0 && (
        <div ref={bulkBar} className="fixed inset-x-0 bottom-0 z-(--z-bulkbar) border-t border-line
          bg-panel px-3 py-2 shadow-bar"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.5rem)" }}>
          <div className="mx-auto flex max-w-6xl flex-col gap-2">
            <div className="flex items-center gap-2 type-meta text-muted">
              <span>
                {selCountPending
                  ? <>{selected.size} {t("groups")} <Spinner /></>
                  : t("bar.selected", { n: selected.size, mails: selCount })}
                {selAllPinned && (
                  <span className="text-accent"> · {t("bar.all_pinned")}</span>
                )}
              </span>
              <button className={LINK}
                onClick={() => setSelected(new Set())}>
                {t("Clear selection")}
              </button>
              <button
                onClick={() => downloadFile(api.exportUrl(mode, [...selected]))}
                title={t("export.csv_tip")}
                className="ml-auto flex items-center gap-1 hover:text-body">
                <Download size={14} /> {t("export.csv")}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 type-meta
              text-muted">
              <span className="shrink-0">{t("bar.limit_to")}</span>
              <Select value={retention} title={t("retention.help")}
                className="min-w-0 flex-1"
                onChange={(e) =>
                  setRetention(e.target.value as typeof retention)}>
                <option value="none">{t("retention.none")}</option>
                <option value="keep_latest">{t("retention.keep_latest")}</option>
                <option value="older_than_days">
                  {t("retention.older_than_days")}
                </option>
              </Select>
              {retention !== "none" && (
                <Input type="number" min={1} className="w-16 shrink-0"
                  placeholder={t("retention.n_placeholder")}
                  value={retentionN}
                  onChange={(e) => setRetentionN(e.target.value)} />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select value="" className="min-w-0 flex-1"
                onChange={(e) => onAction(e.target.value)}>
                <option value="" disabled>{t("Action…")}</option>
                <option value="archive">{t("Archive")}</option>
                <option value="move">{t("Move to folder…")}</option>
                <option value="mark_read">{t("Mark read")}</option>
                <option value="unsubscribe">{t("Unsubscribe")}</option>
                {aiEnabled && (
                  <option value="ai_review">{t("AI review")}</option>
                )}
              </Select>
              {moveDest === "?" && (
                <>
                  <Select value="" className="min-w-0 flex-1"
                    onChange={(e) => {
                      if (e.target.value) act([...selected], "move",
                        e.target.value, ...retentionParams());
                      setMoveDest("");
                    }}>
                    <option value="" disabled>{t("Move to folder…")}</option>
                    {(state?.folders_raw ?? []).map((f, i) => (
                      <option key={f} value={f}>
                        {state?.folders[i] ?? f}
                      </option>
                    ))}
                  </Select>
                  <Button variant="secondary" size="icon" label={t("Cancel")}
                    className="shrink-0" onClick={() => setMoveDest("")}>
                    <X size={18} />
                  </Button>
                </>
              )}
              <Button variant="danger"
                disabled={selCountPending || selAllPinned}
                title={selAllPinned ? t("bar.all_pinned") : undefined}
                className="ml-auto shrink-0"
                onClick={() =>
                  act([...selected], "trash", "", ...retentionParams())}>
                {selCountPending
                  ? <>{t("Trash")} <Spinner /></>
                  : `${t("Trash")} ${selCount}`}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 2 px strip (space always reserved, no layout jump) under the
          toolbar while a job runs. */}
      <div className="mb-1 h-0.5">
        {(job || pending) && (
          <ProgressBar thin label={job?.label ?? pending}
            value={progress?.done ?? 0} max={progress?.total ?? 0}
            indeterminate={!progress} />
        )}
      </div>
      <div className="mb-1 flex min-h-5 items-center justify-between gap-2
        type-meta text-muted">
        <div>{statusLine()}</div>
        {(state?.undo.length ?? 0) > 0 && !deleting && (
          <span className="relative">
            <Button variant="quiet" size="sm"
              onClick={() => setUndoOpen(!undoOpen)}>
              {t("Undo")}
              <ChevronDown size={14}
                className="ml-0.5 inline align-text-bottom" />
            </Button>
            {undoOpen && (
              <span className="absolute right-0 top-8 z-(--z-dropdown) block
                w-72 rounded-card border border-line bg-panel p-1
                shadow-popover">
                {[...state!.undo].map((u, i) => ({ u, i })).reverse()
                  .map(({ u, i }) => (
                  <button key={i}
                    className="block w-full rounded px-2 py-1.5 text-left
                      hover:bg-panel2"
                    onClick={() => undo(i)}>
                    {actionVerb(u.action)}: {u.count}{" "}
                    {t("mails")} - <span className="text-muted">{u.label}</span>
                  </button>
                ))}
              </span>
            )}
          </span>
        )}
      </div>
      {state?.notice && (
        <Notice className="mb-2" icon={<Info size={14} />}
          onClose={dismissNotice}>
          {t(`notice.${state.notice.key}`, state.notice.params)}
        </Notice>
      )}

      {/* First-run onboarding: no credentials or no scan yet. */}
      {cfg && state?.status === "idle" && groups.length === 0
        && !scanning && (
        <div className="mx-auto my-10 max-w-md rounded-dialog border border-line
          bg-panel p-4 type-body sm:p-5">
          <div className="mb-3 type-heading">
            {t("onboard.title")}
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-muted">
            <li>{t("onboard.step_bridge")}</li>
            <li>
              {t("onboard.step_creds")}{" "}
              <button className={LINK_ACCENT}
                onClick={() => setSettingsOpen(true)}>
                {t("Settings")}
              </button>
            </li>
            <li>{t("onboard.step_scan")}</li>
          </ol>
          <div className="mt-4 flex items-center gap-3">
            {acct?.password_set && (
              <Button variant="secondary" onClick={async () => {
                setPending(t("onboard.testing"));
                try {
                  const r = await api.testConnection();
                  notify(t("onboard.test_ok", { n: r.folders }), "success");
                } catch (e: any) {
                  notify(`${t("onboard.test_fail")}: ${e.message ?? e}`,
                    "error");
                }
                setPending("");
              }}>{t("onboard.test")}</Button>
            )}
            <Button onClick={startScan} disabled={!acct?.password_set}>
              {t("Scan")}
            </Button>
          </div>
        </div>
      )}

      {flat ? (
        state && (
          <AllMailsView key={state.account} state={state}
            onChanged={refresh} />
        )
      ) : groups.length > 0 ? (
        <GroupTable
          groups={groups}
          selected={selected}
          focusedKey={focusIdx >= 0 ? groups[focusIdx]?.key ?? null : null}
          onToggle={(k) => {
            const next = new Set(selected);
            next.has(k) ? next.delete(k) : next.add(k);
            setSelected(next);
          }}
          onToggleAll={(checked, keys) => {
            const next = new Set(selected);
            keys.forEach((k) => checked ? next.add(k) : next.delete(k));
            setSelected(next);
          }}
          onOpen={setDetail}
          blockedKeys={blockedRules}
          onAckUnsub={ackUnsub}
          sortK={sortK}
          sortDir={sortDir}
          onSort={(k) => {
            if (k === sortK) setSortDir(-sortDir);
            else { setSortK(k); setSortDir(k === "label" ? 1 : -1); }
          }}
          groupLabel={t(GROUPING_LABEL[mode])}
          resetSignal={`${mode}\u0000${filter}`}
        />
      ) : (
        !scanning && state?.status === "done" && (
          filter && allGroups.length > 0 ? (
            <EmptyState icon={<Search size={18} />} title={t("no.matches")}
              action={
                <Button variant="secondary" onClick={() => {
                  setFilter(""); setActiveChip(null);
                  filterRef.current?.focus();
                }}>
                  {t("Clear filter")}
                </Button>
              } />
          ) : (
            <EmptyState>
              {state.scanned_ts ? t("status.no_mails")
                : t("No scan yet - hit “Scan”.")}
            </EmptyState>
          )
        )
      )}

      {detail && (
        <DetailPanel
          grouping={mode}
          group={detail}
          aiEnabled={aiEnabled}
          protectedNow={state?.groups[mode][detail.key]?.protected
            ?? detail.protected}
          unsubscribedNow={state?.groups[mode][detail.key]?.unsubscribed
            ?? detail.unsubscribed}
          onTrash={(g) => act([g.key], "trash")}
          onProtect={toggleProtect}
          onBlock={blockGroup}
          onUnblock={unblockGroup}
          blocked={blockedRules.has(detail.key)}
          folders={state?.folders_raw ?? []}
          sieve={(acct?.preset ?? "proton") === "proton"}
          onClose={() => { setDetail(null); refresh(); }}
          onDeleted={refresh}
        />
      )}
      {searchOpen && (
        <SearchPanel
          bodySearch={acct?.body_search !== "disabled"}
          bodyMode={acct?.body_search === "local" ? "local" : "server"}
          onClose={() => { setSearchOpen(false); refresh(); }}
          onDeleted={refresh}
        />
      )}
      {statsOpen && <StatsPanel onClose={() => setStatsOpen(false)} />}
      {auditOpen && (
        <AuditLogPanel rules={state?.rules ?? []}
          onClose={() => setAuditOpen(false)} />
      )}
      {trashOpen && state && (
        <TrashPanel
          state={state}
          onClose={() => { setTrashOpen(false); refresh(); }}
          onChanged={refresh}
        />
      )}
      {dupsOpen && (
        <DuplicatesPanel
          onClose={() => { setDupsOpen(false); refresh(); }}
          onDeleted={refresh}
        />
      )}
      {attsOpen && state && (
        <AttachmentsPanel
          state={state}
          onClose={() => { setAttsOpen(false); refresh(); }}
          onDeleted={refresh}
        />
      )}
      {rulesOpen && state && (
        <RulesModal
          state={state}
          onClose={() => setRulesOpen(false)}
          onChanged={refresh}
        />
      )}
      {settingsOpen && cfg && (
        <SettingsModal
          cfg={cfg}
          account={account}
          onClose={() => setSettingsOpen(false)}
          onSaved={setCfg}
          onAccountsChanged={(next, name) => {
            setCfg(next);
            if (name && next.accounts[name]) switchAccount(name);
            else if (!next.accounts[account])
              switchAccount(next.default_account);
          }}
        />
      )}
    </div>
  );
}
