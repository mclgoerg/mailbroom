import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, setAccount as apiSetAccount, withAccount } from "./api";
import { DetailPanel } from "./components/DetailPanel";
import { Login } from "./components/Login";
import { AttachmentsPanel } from "./components/AttachmentsPanel";
import { DuplicatesPanel } from "./components/DuplicatesPanel";
import { GroupTable, type SortKey } from "./components/GroupTable";
import { RulesModal } from "./components/RulesModal";
import { SearchPanel } from "./components/SearchPanel";
import { SettingsModal } from "./components/SettingsModal";
import { StatsPanel } from "./components/StatsPanel";
import { TrashPanel } from "./components/TrashPanel";
import { applyTheme, Button, currentTheme, ensureAiAck, Input, Select,
  Spinner } from "./components/ui";
import { t } from "./i18n";
import { applyStatus, fmtAgo, fmtSize, fmtUsd, matchGroup, parseFilter }
  from "./lib";
import type { AppState, AuthProbe, Config, Group, Grouping, StatusMsg }
  from "./types";

const GROUPING_LABEL: Record<Grouping, string> = {
  sender: "Sender", domain: "Domain", subject: "Subject",
};

const SORT_OPTIONS: { k: SortKey; label: string }[] = [
  { k: "count", label: "Sort: mails" },
  { k: "size", label: "Sort: size" },
  { k: "last", label: "Sort: last activity" },
  { k: "unreadPct", label: "Sort: unread %" },
  { k: "label", label: "Sort: name" },
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
  const [filter, setFilter] = useState("");
  const [sortK, setSortK] = useState<SortKey>("count");
  const [sortDir, setSortDir] = useState(-1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Group | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [attsOpen, setAttsOpen] = useState(false);
  const [dupsOpen, setDupsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);
  const [moveDest, setMoveDest] = useState("");
  const [focusIdx, setFocusIdx] = useState(-1);
  const [toast, setToast] = useState("");
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
      // Polling fallback only drives itself when SSE isn't connected.
      if (!sse.current && (st.status === "scanning"
          || st.ai.status === "running" || st.delete.status === "running"
          || st.atts?.status === "running")) {
        timer.current = setTimeout(refresh, 1200);
      }
    } catch (e: any) {
      setToast(`Connection error: ${e.message ?? e}`);
      if (!sse.current) timer.current = setTimeout(refresh, 4000);
    } finally {
      fetching.current = false;
    }
  }, []);

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
  const prevJobs = useRef<{ d?: string; a?: string; t?: string }>({});
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
    prevJobs.current = { d: state.delete.status, a: state.ai.status,
      t: state.atts?.status };
  }, [state]);

  const groups = useMemo(() => {
    const all = Object.values(state?.groups?.[mode] ?? {});
    const f = parseFilter(filter);
    const filtered = all.filter((g) => matchGroup(g, f));
    return filtered.sort((a, b) => {
      const va = sortValue(a, sortK), vb = sortValue(b, sortK);
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return cmp * sortDir || b.count - a.count;
    });
  }, [state, mode, filter, sortK, sortDir]);

  // Count over ALL groups of the mode, not the filtered view — actions apply
  // to every selected key, including ones a filter is hiding.
  const selCount = useMemo(() => {
    const all = state?.groups?.[mode] ?? {};
    return [...selected].reduce((n, k) => n + (all[k]?.count ?? 0), 0);
  }, [state, mode, selected]);

  const scanning = state?.status === "scanning";
  const aiRunning = state?.ai.status === "running";
  const deleting = state?.delete.status === "running";
  const attsRunning = state?.atts?.status === "running";
  const aiEnabled = !!cfg?.ai.available;
  const acct = cfg?.accounts[account] ?? null;
  const anyModal = !!detail || searchOpen || settingsOpen || rulesOpen
    || attsOpen || dupsOpen || statsOpen || trashOpen;

  const startScan = async () => {
    setSelected(new Set());
    // Instant feedback: the real progress replaces this on the next tick.
    setToast(t("Starting…"));
    try { await api.scan(); setToast(""); refresh(); }
    catch (e: any) { setToast(`Error: ${e.message ?? e}`); }
  };

  const startAi = async () => {
    if (!ensureAiAck()) return;
    setToast(t("Starting…"));
    try { await api.aiReview(mode); setToast(""); refresh(); }
    catch (e: any) { setToast(`AI error: ${e.message ?? e}`); }
  };

  const cancel = async () => {
    const target = scanning ? "scan" : aiRunning ? "ai"
      : attsRunning ? "atts" : "delete";
    try { await api.cancel(target); refresh(); } catch { /* too late */ }
  };

  const undo = async (index: number) => {
    const entry = state?.undo[index];
    if (!entry) return;
    setUndoOpen(false);
    if (!confirm(t("confirm.restore",
      { count: entry.count, label: entry.label }))) return;
    setToast(t("Restoring…"));
    try { await api.undo(index); setToast(""); refresh(); }
    catch (e: any) { setToast(`Undo error: ${e.message ?? e}`); }
  };

  const emptyTrash = async () => {
    const n = state?.trash_count ?? 0;
    if (!confirm(t("confirm.empty_trash", { n }))) return;
    setToast(t("Emptying Trash…"));
    try { await api.emptyTrash(); setToast(""); refresh(); }
    catch (e: any) { setToast(`Error: ${e.message ?? e}`); }
  };

  // Selection presets never pick up protected groups — protecting a sender
  // means "keep it out of every bulk sweep".
  const selectPreset = (preset: string) => {
    const next = new Set(selected);
    if (preset === "none") next.clear();
    else if (preset === "aisafe") {
      groups.filter((g) => g.ai?.verdict === "delete_safe" && !g.protected)
        .forEach((g) => next.add(g.key));
    } else if (preset.startsWith("older")) {
      const months = Number(preset.slice(5));
      const cutoff = new Date(Date.now() - months * 30.44 * 86400e3)
        .toISOString().slice(0, 10);
      groups.filter((g) => g.last && g.last < cutoff && !g.protected)
        .forEach((g) => next.add(g.key));
    }
    setSelected(next);
  };

  const act = async (keys: string[], action: string, dest = "") => {
    const all = state?.groups[mode] ?? {};
    let force = false;
    let effective = keys;
    if (action === "trash") {
      const prot = keys.filter((k) => all[k]?.protected);
      if (prot.length === 1 && keys.length === 1) {
        // Explicitly trashing one protected group: allow, after its own
        // warning (the backend requires force for this).
        if (!confirm(t("confirm.trash_protected",
          { label: all[keys[0]]?.label ?? keys[0] }))) return;
        force = true;
      } else if (prot.length) {
        effective = keys.filter((k) => !all[k]?.protected);
        if (!effective.length) {
          setToast(t("toast.all_protected"));
          return;
        }
      }
    }
    const n = effective.reduce((acc, k) => acc + (all[k]?.count ?? 0), 0);
    const verb = actionVerb(action) + (dest ? ` → ${dest}` : "");
    const skipNote = effective.length !== keys.length
      ? " " + t("confirm.protected_skipped",
          { n: keys.length - effective.length }) : "";
    if (!force && !confirm(
      t("confirm.act", { verb, n, k: effective.length }) + skipNote)) return;
    try {
      await api.deleteGroups(mode, effective, action, dest, force);
      setToast("");
      setSelected(new Set());
      refresh();   // runs in the background; SSE/polling follows it
    } catch (e: any) {
      setToast(`Error: ${e.message ?? e}`);
    }
  };

  // Sender mode protects the exact address, domain mode the whole domain.
  // Subject groups have no stable sender, so they get no protect toggle.
  const toggleProtect = mode === "subject" ? undefined : async (g: Group) => {
    const entry = mode === "domain" ? `@${g.key}` : g.key;
    try {
      const r = await api.protect(entry, !g.protected);
      setCfg((c) => (c ? { ...c, protected: r.protected } : c));
      refresh();
    } catch (e: any) {
      setToast(`Error: ${e.message ?? e}`);
    }
  };

  const onAction = (v: string) => {
    if (!selected.size) return;
    if (v === "move") setMoveDest("?");
    else act([...selected], v);
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
      if (anyModal || ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName))
        return;
      if (e.key === "/") {
        e.preventDefault();
        filterRef.current?.focus();
        return;
      }
      if (!groups.length) return;
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
        if (selected.size) act([...selected], "trash");
        else if (focusIdx >= 0) act([groups[focusIdx].key], "trash");
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

  const statusLine = () => {
    if (!state) return <Spinner />;
    if (scanning)
      return <>{t("Scanning…")} {state.progress} <Spinner />{" "}
        <button className="underline" onClick={cancel}>{t("cancel")}</button></>;
    if (state.status === "error") return `Error: ${state.error}`;
    if (deleting)
      return <>{t("Moving…")} {state.delete.progress} <Spinner />{" "}
        <button className="underline" onClick={cancel}>{t("cancel")}</button></>;
    if (aiRunning)
      return <>AI ({state.ai.grouping})… {state.ai.progress}{" "}
        <Spinner /> <button className="underline" onClick={cancel}>
        {t("cancel")}</button></>;
    if (attsRunning)
      return <>📎 {t("atts.running")} {state.atts.progress} <Spinner />{" "}
        <button className="underline" onClick={cancel}>{t("cancel")}</button></>;
    const parts: string[] = [];
    if (groups.length) {
      const mails = groups.reduce((n, g) => n + g.count, 0);
      const size = groups.reduce((n, g) => n + g.size, 0);
      const ago = fmtAgo(state.scanned_ts);
      parts.push(`${groups.length} ${t("groups")} · ${mails} ${t("mails")}`
        + ` · ${fmtSize(size)}` + (filter ? ` ${t("(filtered)")}` : "")
        + (ago ? ` · ${t("scan.age", { ago })}` : ""));
    }
    if (state.delete.status === "error")
      parts.push(`Error: ${state.delete.error}`);
    else if (state.delete.status === "done" && state.delete.moved > 0)
      parts.push(t("done_moved", { n: state.delete.moved }));
    if (state.ai.status === "error") parts.push(`AI error: ${state.ai.error}`);
    else if (state.ai.status === "done" && state.ai.usage) {
      const u = state.ai.usage;
      parts.push(t("ai_done", {
        in: u.input_tokens, out: u.output_tokens,
        cost: u.cost ? ` ≈ ${fmtUsd(u.cost)}` : "",
        total: fmtUsd(u.total_cost ?? 0) }));
    }
    if (toast) parts.push(toast);
    return parts.join(" — ") || t("No scan yet — hit “Scan”.");
  };

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
    <div className="mx-auto max-w-6xl p-3 sm:p-5">
      <header className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-bold tracking-tight">
          Mailbroom
        </h1>
        <button className="text-sm text-muted hover:text-body"
          title={t("Theme")} onClick={toggleTheme}>
          {theme === "dark" ? "☀" : "🌙"}
        </button>
        {auth.mode === "oidc" && !!auth.sub && (
          <span className="max-w-40 truncate text-xs text-muted"
            title={auth.is_admin
              ? `${auth.sub} — ${t("login.admin_tip")}` : auth.sub}>
            {auth.sub}{auth.is_admin ? " ★" : ""}
          </span>
        )}
        {auth.mode !== "none" && (
          <button className="text-xs text-muted underline-offset-2
            hover:underline"
            onClick={async () => {
              try { await api.logout(); } catch { /* session gone anyway */ }
              window.location.reload();
            }}>
            {t("login.logout")}
          </button>
        )}
        {/* Account switcher — only when more than one account exists.
            Switching swaps the entire view; nothing mixes across accounts. */}
        {cfg && Object.keys(cfg.accounts).length > 1 && (
          <div className="flex overflow-hidden rounded-md border border-line"
            title={t("account.switch_tip")}>
            {Object.keys(cfg.accounts).map((n) => (
              <button key={n}
                onClick={() => n !== account && switchAccount(n)}
                className={`max-w-32 truncate px-2.5 py-1 text-xs ${
                  n === account
                    ? "bg-accent text-white"
                    : "bg-panel2 text-body hover:bg-chip"}`}>
                {n}
              </button>
            ))}
          </div>
        )}
        {state?.trash_count != null && state.trash_count > 0 && (
          <span className="ml-auto flex items-center gap-2 text-xs text-muted">
            <button className="underline-offset-2 hover:underline"
              title={t("trash.browse")}
              onClick={() => setTrashOpen(true)}>
              {t("Trash")}: {state.trash_count}
            </button>
            <Button variant="ghost" className="!min-h-7 !px-2 !py-0.5 !text-xs"
              onClick={emptyTrash}>{t("Empty Trash")}</Button>
          </span>
        )}
      </header>

      {/* Row 1: primary actions — identical in every grouping mode. */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button onClick={startScan}
          disabled={scanning || aiRunning || deleting || attsRunning}>
          {scanning ? <Spinner className="!text-white" /> : t("Scan")}
        </Button>
        {/* order-2 + w-full: on phones the grouping toggle gets a full line
            of its own instead of being shrunk by the icon strip. */}
        <div className="order-2 flex w-full overflow-hidden rounded-md border
          border-line sm:order-none sm:w-auto">
          {(Object.keys(GROUPING_LABEL) as Grouping[]).map((g) => (
            <button key={g}
              onClick={() => {
                setMode(g); setSelected(new Set()); setFocusIdx(-1);
              }}
              className={`flex-1 px-3 py-1.5 text-sm sm:flex-none ${mode === g
                ? "bg-accent text-white"
                : "bg-panel2 text-body hover:bg-chip"}`}>
              {t(GROUPING_LABEL[g])}
            </button>
          ))}
        </div>
        <Input
          ref={filterRef}
          className="order-last w-full sm:order-none sm:w-auto sm:min-w-24
            sm:flex-1"
          placeholder={t("filter groups…")}
          title="Combinable: tag:shipping ai:safe age:>1y unread:>80 is:unsub text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {/* One wrap unit; tighter padding on phones so the strip fits next
            to Scan on one line. */}
        <div className="ml-auto flex items-center gap-1.5 sm:ml-0 sm:gap-2">
          <Button variant="ghost" className="!px-2 sm:!px-3"
            title={t("Search all mails")}
            onClick={() => setSearchOpen(true)}>🔍</Button>
          <Button variant="ghost" className="!px-2 sm:!px-3"
            title={t("Rules")}
            onClick={() => setRulesOpen(true)}>📋</Button>
          <Button variant="ghost" className="!px-2 sm:!px-3"
            title={t("Attachments")}
            onClick={() => setAttsOpen(true)}>📎</Button>
          <Button variant="ghost" className="!px-2 sm:!px-3"
            title={t("Duplicates")}
            disabled={state?.status !== "done"}
            onClick={() => setDupsOpen(true)}>📑</Button>
          <Button variant="ghost" className="!px-2 sm:!px-3"
            title={t("Statistics")}
            onClick={() => setStatsOpen(true)}>📊</Button>
          <Button variant="ghost" className="!px-2 sm:!px-3"
            title={t("Settings")}
            onClick={() => setSettingsOpen(true)}>⚙</Button>
        </div>
      </div>
      {/* Row 2: selection / sorting / bulk tools. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select className="flex-1 sm:flex-none" value=""
          onChange={(e) => selectPreset(e.target.value)}>
          <option value="" disabled>{t("Select…")}</option>
          <option value="aisafe">{t("AI-safe groups")}</option>
          <option value="older6">{t("Inactive > 6 months")}</option>
          <option value="older12">{t("Inactive > 1 year")}</option>
          <option value="older24">{t("Inactive > 2 years")}</option>
          <option value="none">{t("Clear selection")}</option>
        </Select>
        <Select className="flex-1 sm:flex-none" value={sortK}
          onChange={(e) => {
            const k = e.target.value as SortKey;
            setSortK(k);
            setSortDir(k === "label" ? 1 : -1);
          }}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.k} value={o.k}>{t(o.label)}</option>
          ))}
        </Select>
        {aiEnabled && (
          <Button variant="ghost" onClick={startAi}
            disabled={scanning || aiRunning || state?.status !== "done"}>
            {t("AI review")}
          </Button>
        )}
        <a href={api.exportUrl(mode)} download
          className="min-h-9 rounded-md bg-chip px-3 py-1.5 text-sm
            font-medium text-body hover:bg-chiph"
          title="Export current grouping as CSV">CSV</a>
        {moveDest === "?" ? (
          <Select value=""
            onChange={(e) => {
              setMoveDest("");
              if (e.target.value) act([...selected], "move", e.target.value);
            }}>
            <option value="" disabled>{t("Move to folder…")}</option>
            {(state?.folders_raw ?? []).map((f, i) => (
              <option key={f} value={f}>{state?.folders[i] ?? f}</option>
            ))}
          </Select>
        ) : (
          <Select value="" disabled={!selected.size}
            onChange={(e) => onAction(e.target.value)}>
            <option value="" disabled>{t("Action…")}</option>
            <option value="archive">{t("Archive")}</option>
            <option value="move">{t("Move to folder…")}</option>
            <option value="mark_read">{t("Mark read")}</option>
          </Select>
        )}
        <Button variant="danger" disabled={selected.size === 0}
          className="ml-auto"
          onClick={() => act([...selected], "trash")}>
          {selected.size ? `${t("Trash")} ${selCount}` : t("Trash")}
        </Button>
      </div>

      <div className="mb-1 min-h-5 text-xs text-muted">{statusLine()}</div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        {state?.notice && (
          <span className="rounded bg-panel2 px-2 py-1 text-chiptext">
            {t(`notice.${state.notice.key}`, state.notice.params)}{" "}
            <button className="text-muted underline"
              onClick={dismissNotice}>{t("dismiss")}</button>
          </span>
        )}
        {(state?.undo.length ?? 0) > 0 && !deleting && (
          <span className="relative">
            <Button variant="ghost" className="!min-h-7 !px-2 !py-0.5 !text-xs"
              onClick={() => setUndoOpen(!undoOpen)}>
              {t("Undo")} ▾
            </Button>
            {undoOpen && (
              <span className="absolute left-0 top-8 z-10 block w-72
                rounded-md border border-line bg-panel p-1 shadow-lg">
                {[...state!.undo].map((u, i) => ({ u, i })).reverse()
                  .map(({ u, i }) => (
                  <button key={i}
                    className="block w-full rounded px-2 py-1.5 text-left
                      hover:bg-panel2"
                    onClick={() => undo(i)}>
                    {actionVerb(u.action)}: {u.count}{" "}
                    {t("mails")} — <span className="text-muted">{u.label}</span>
                  </button>
                ))}
              </span>
            )}
          </span>
        )}
      </div>

      {/* First-run onboarding: no credentials or no scan yet. */}
      {cfg && state?.status === "idle" && groups.length === 0
        && !scanning && (
        <div className="mx-auto my-10 max-w-md rounded-xl border border-line
          bg-panel p-6 text-sm">
          <div className="mb-3 text-base font-semibold">
            {t("onboard.title")}
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-muted">
            <li>{t("onboard.step_bridge")}</li>
            <li>
              {t("onboard.step_creds")}{" "}
              <button className="text-accent underline"
                onClick={() => setSettingsOpen(true)}>
                {t("Settings")}
              </button>
            </li>
            <li>{t("onboard.step_scan")}</li>
          </ol>
          <div className="mt-4 flex items-center gap-3">
            {acct?.password_set && (
              <Button variant="ghost" onClick={async () => {
                setToast(t("onboard.testing"));
                try {
                  const r = await api.testConnection();
                  setToast(t("onboard.test_ok", { n: r.folders }));
                } catch (e: any) {
                  setToast(`${t("onboard.test_fail")}: ${e.message ?? e}`);
                }
              }}>{t("onboard.test")}</Button>
            )}
            <Button onClick={startScan} disabled={!acct?.password_set}>
              {t("Scan")}
            </Button>
          </div>
        </div>
      )}

      {groups.length > 0 ? (
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
          onTrash={(g) => act([g.key], "trash")}
          onProtect={toggleProtect}
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
          <div className="py-16 text-center text-sm text-muted">
            {filter ? t("no.matches") : t("No scan yet — hit “Scan”.")}
          </div>
        )
      )}

      {detail && (
        <DetailPanel
          grouping={mode}
          group={detail}
          aiEnabled={aiEnabled}
          protectedNow={state?.groups[mode][detail.key]?.protected
            ?? detail.protected}
          onProtect={toggleProtect}
          folders={state?.folders_raw ?? []}
          sieve={(acct?.preset ?? "proton") === "proton"}
          onClose={() => { setDetail(null); refresh(); }}
          onDeleted={refresh}
        />
      )}
      {searchOpen && (
        <SearchPanel
          onClose={() => { setSearchOpen(false); refresh(); }}
          onDeleted={refresh}
        />
      )}
      {statsOpen && <StatsPanel onClose={() => setStatsOpen(false)} />}
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
