import { t } from "./i18n";
import type {
  AdminTenantStats, AiFilterResult, AiGroupResult, AppState, AttMail, AuditResp, AuthProbe,
  KnowledgeList, KnowledgeSaved, KnowledgeSrc,
  Config, ConversationResp, DupSet, FilterPreset, FoldersResp, Grouping, IndexInfo, TrackerReport,
  Mail, MessageDetail,
  LookalikeCount, MailsResp, Rule, RuleRun, SearchResp, SortEstimate, StatsResp, TrashResp,
  FolderMoveResp, FolderRole, PurgePreview, PurgeResult, PurgeSelect,
  UndoEntry, UndoIdent, UnsubBulkResult, UnsubResult,
} from "./types";

/* Active account: every API call is scoped to exactly one account (strict
 * separation - the backend never mixes them). Set once by App on startup
 * and whenever the user switches. */
let ACCOUNT = "";

export function setAccount(name: string) {
  ACCOUNT = name;
}

/** Pin a call to one account (the one being edited in Settings, which is
 *  not necessarily the active one). */
const forAccount = (path: string, account?: string): string =>
  account ? `${path}${path.includes("?") ? "&" : "?"}account=`
    + encodeURIComponent(account) : path;

export function withAccount(path: string): string {
  if (!ACCOUNT || path.includes("account=")) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}account=${encodeURIComponent(ACCOUNT)}`;
}

/* iOS Safari, when installed as a standalone PWA, does not reliably
 * handle a plain `<a href=url>` navigation to a Content-Disposition:
 * attachment response: `download` opens its Quick Look preview with no
 * way to dismiss it short of a swipe, and target="_blank" opens a blank
 * in-app browser tab that neither renders nor saves anything. Fetching
 * the file ourselves and handing the browser a blob: URL instead is the
 * one approach that reliably triggers an actual save/share sheet on
 * every platform. */
export async function downloadFile(url: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  saveBlob(/filename="?([^"]+)"?/.exec(cd)?.[1] ?? "download", blob);
}

/** Hand a blob to the browser as a download (blob: link, so it also works in
 *  iOS standalone mode). */
export function saveBlob(name: string, blob: Blob): void {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

/* Stable error codes the backend answers with (the HTTP `detail`; see
 * mailops.py / knowledgestore.py) -> the `t()` key of the translated text. */
const ERROR_CODES: Record<string, string> = {
  no_message_id: "pin.no_message_id",
  pinned_mails: "pin.refused",
  protected_mails: "fp.protected_refused",
  all_pinned: "toast.all_pinned",
  // private sender knowledge (backend/knowledgestore.py)
  knowledge_bad_request: "know.err.bad_request",
  knowledge_bad_key: "know.err.bad_key",
  knowledge_bad_kind: "know.err.bad_kind",
  knowledge_bad_note: "know.err.bad_note",
  knowledge_full: "know.err.full",
  knowledge_ai_running: "know.err.ai_running",
  knowledge_unscanned: "know.err.unscanned",
  // special-folder choices (backend/mailops.py)
  role_not_candidate: "folder.err.not_candidate",
  role_ambiguous: "folder.err.ambiguous",
  move_unsafe: "folder.err.move_unsafe",
  not_lookalike: "folder.err.not_lookalike",
  // Empty Trash, permanent deletion, Folders panel moves, undo (mailops.py)
  busy_action: "ferr.busy_action",
  busy_purge: "ferr.busy_purge",
  busy_scan: "ferr.busy_scan",
  busy_rule: "ferr.busy_rule",
  count_required: "ferr.count_required",
  role_missing: "ferr.role_missing",
  inbox_missing: "ferr.inbox_missing",
  junk_needs_trash: "ferr.junk_needs_trash",
  role_unconfirmed: "ferr.role_unconfirmed",
  junk_is_trash: "ferr.junk_is_trash",
  folder_changed: "ferr.folder_changed",
  folder_changed_rescan: "ferr.folder_changed_rescan",
  partial_unsafe: "ferr.partial_unsafe",
  partial_unsafe_changed: "ferr.partial_unsafe_changed",
  cannot_open: "ferr.cannot_open",
  cannot_list: "ferr.cannot_list",
  cannot_flag: "ferr.cannot_flag",
  cannot_expunge: "ferr.cannot_expunge",
  cannot_move: "ferr.cannot_move",
  cannot_remove_copies: "ferr.cannot_remove_copies",
  cannot_read_moved: "ferr.cannot_read_moved",
  uv_unreadable: "ferr.uv_unreadable",
  no_known_selected: "ferr.no_known_selected",
  unknown_target: "ferr.unknown_target",
  target_is_trash: "ferr.target_is_trash",
  nothing_to_undo: "ferr.nothing_to_undo",
  deleted_then_failed: "ferr.deleted_then_failed",
  stranded_then_failed: "ferr.stranded_then_failed",
  moved_then_failed: "ferr.moved_then_failed",
  // purge rules (backend/rules.py)
  rule_report_first: "ferr.rule_report_first",
  rule_folder_changed: "ferr.rule_folder_changed",
  rule_purge_grouping: "ferr.rule_purge_grouping",
  rule_purge_keep_latest: "ferr.rule_purge_keep_latest",
  rule_purge_needs_age: "ferr.rule_purge_needs_age",
  rule_purge_filter: "ferr.rule_purge_filter",
  rule_purge_filter_domain: "ferr.rule_purge_filter_domain",
  // plain words -> filter (backend/aifilter.py)
  aifilter_not_configured: "aif.err.not_configured",
  aifilter_text_empty: "aif.err.text_empty",
  aifilter_text_too_long: "aif.err.text_too_long",
  aifilter_budget: "aif.err.budget",
};

/** The role names a `role=` param stands for (translated). */
const ROLE_NAMES: Record<string, string> = {
  trash: "Trash", junk: "Junk", archive: "ferr.role_archive",
};

/** A coded error detail: `code` or `code:key=value,...` (mailops.coded; the
 *  values are percent-encoded, so a folder name or a nested `cause=` can hold
 *  any character). Counts are `n`. `null` unless it is one of our codes with
 *  well-formed params - the caller then shows the raw text. */
export function parseErrorDetail(detail: string):
    { code: string; params: Record<string, string | number> } | null {
  if (typeof detail !== "string") return null;   // e.g. a 422's error list
  const i = detail.indexOf(":");
  const code = i < 0 ? detail : detail.slice(0, i);
  if (!Object.hasOwn(ERROR_CODES, code)) return null;
  const params: Record<string, string | number> = {};
  if (i >= 0) {
    try {
      for (const pair of detail.slice(i + 1).split(",")) {
        const eq = pair.indexOf("=");
        if (eq < 1) return null;
        const key = pair.slice(0, eq);
        const value = decodeURIComponent(pair.slice(eq + 1));
        params[key] = key === "n" && /^\d+$/.test(value) ? Number(value) : value;
      }
    } catch {
      return null;                     // a broken % escape: show it raw
    }
  }
  return { code, params };
}

/** The user-language text of a backend error `detail`: a known code with
 *  its params, a nested `cause` translated the same way; anything else (an
 *  unknown code, plain English from an older server, a raw IMAP error) as it
 *  is. */
export function errorText(detail: string): string {
  const parsed = parseErrorDetail(detail);
  if (!parsed) return detail;
  const { code, params } = parsed;
  const text: Record<string, string | number> = { ...params };
  if (typeof params.cause === "string") text.cause = errorText(params.cause);
  if (typeof params.role === "string")
    text.folder = t(ROLE_NAMES[params.role] ?? params.role);
  return t(ERROR_CODES[code], text);
}

/** The label of an Undo entry in the user's language: the structured label
 *  (key + params) the backend recorded for it, else the label as sent - a
 *  sender, a folder name, or an entry from before labels were structured. */
export const undoLabel = (u: UndoLabelled): string =>
  u.label_key ? t(u.label_key, u.label_params) : u.label;

type UndoLabelled = Pick<UndoEntry, "label" | "label_key" | "label_params">;

/** Notice params with a structured `label` (`label_key` + `label_<param>`,
 *  see mailops.undo_last) worded in the user's language. */
export function noticeParams(
    params: Record<string, string | number>): Record<string, string | number> {
  const key = params.label_key;
  if (typeof key !== "string") return params;
  const sub: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params))
    if (k.startsWith("label_") && k !== "label_key") sub[k.slice(6)] = v;
  return { ...params, label: t(key, sub) };
}

async function req<T>(path: string, body?: unknown,
                      method?: "PUT" | "DELETE"): Promise<T> {
  const res = await fetch(withAccount(path), {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = await res.text();
    try {
      detail = JSON.parse(detail).detail ?? detail;
    } catch {
      /* plain text */
    }
    const parsed = parseErrorDetail(detail);
    const err: Error & { code?: string } =
      new Error(detail ? errorText(detail) : `HTTP ${res.status}`);
    if (parsed) err.code = parsed.code;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const api = {
  state: () => req<AppState>("/api/state"),
  scan: () => req<{ ok: boolean }>("/api/scan", {}),
  group: (grouping: Grouping, key: string) =>
    req<Mail[]>(`/api/group?grouping=${grouping}&key=${encodeURIComponent(key)}`),
  message: (folder: string, uid: number) =>
    req<MessageDetail>(
      `/api/message?folder=${encodeURIComponent(folder)}&uid=${uid}`),
  // Several mails' text over ONE IMAP connection (conversation reader).
  messages: (items: [string, number][]) =>
    req<{ messages: (Partial<MessageDetail> & { folder: string; uid: number;
      error?: string })[] }>("/api/messages", { items }),
  thread: (folder: string, uid: number) =>
    req<ConversationResp>(
      `/api/thread?folder=${encodeURIComponent(folder)}&uid=${uid}`),
  deleteGroups: (grouping: Grouping, keys: string[],
                 action = "trash", dest = "", force = false,
                 keepLatest: number | null = null,
                 olderThanDays: number | null = null) =>
    req<{ ok: boolean; queued: number; skipped: number }>("/api/delete",
      { grouping, keys, action, dest, force, keep_latest: keepLatest,
        older_than_days: olderThanDays }),
  protect: (entry: string, on: boolean) =>
    req<{ protected: string[] }>("/api/protect", { entry, on }),
  // The AI writes a filter query from a sentence (nothing else is sent).
  aiFilter: (text: string, lang: string) =>
    req<AiFilterResult>("/api/ai/filter", { text, lang }),
  aiSortEstimate: () => req<SortEstimate>("/api/ai_sort/estimate"),
  aiSort: () => req<{ units: number; senders: number }>("/api/ai_sort", {}),
  aiSortClear: () => req<{ cleared: number }>("/api/ai_sort/clear", {}),
  // Private sender knowledge (per user, shared by all accounts).
  knowledge: () => req<KnowledgeList>("/api/knowledge"),
  // File entries ({key, kind, note?, src?, ts?}) and / or remove keys in one
  // request; `previous` is what an Undo puts back.
  knowledgePut: (body: { entries?: { key: string; kind: string;
      note?: string; src?: KnowledgeSrc; ts?: number }[]; remove?: string[] }) =>
    req<KnowledgeSaved>("/api/knowledge", body, "PUT"),
  // Keep the AI's cached answers of the current account as your own rules.
  knowledgeKeepAi: () =>
    req<{ ok: boolean; kept: number; senders: number; skipped: number }>(
      "/api/knowledge/keep_ai", { all: true }),
  knowledgeForgetAi: () =>
    req<{ ok: boolean; forgotten: number }>("/api/knowledge/forget_ai", {}),
  // Refused (code knowledge_unscanned) unless every account has a finished scan.
  knowledgeRemoveUnused: () =>
    req<{ ok: boolean; removed: number }>("/api/knowledge/remove_unused", {}),
  // Merge a knowledge section ({version, entries}) - just this, no settings.
  knowledgeImport: (section: unknown) =>
    req<{ ok: boolean; knowledge: number }>("/api/import_config",
      { knowledge: section }),
  protectMany: (entries: string[], on: boolean) =>
    req<{ protected: string[] }>("/api/protect", { entries, on }),
  deleteMessages: (items: [string, number][], action = "trash", dest = "",
                   force = false) =>
    req<{ ok: boolean; queued: number }>("/api/delete_messages",
      { items, action, dest, force }),
  pin: (folder: string, uid: number, pinned: boolean) =>
    req<{ ok: boolean; pinned: boolean }>("/api/pin",
      { folder, uid, pinned }),
  pinGroup: (grouping: Grouping, key: string, pinned: boolean) =>
    req<{ ok: boolean; pinned: boolean; changed: number; skipped: number }>(
      "/api/pin_group", { grouping, key, pinned }),
  // `rerate` (with keys): also send groups that already have a verdict and
  // replace it - an explicit second opinion, billed again.
  aiReview: (grouping: Grouping, keys?: string[], rerate = false) =>
    req<{ ok: boolean }>("/api/ai",
      { grouping, keys: keys ?? null, rerate }),
  aiGroup: (grouping: Grouping, key: string, offset = 0, limit = 200,
      uids?: [string, number][]) =>
    req<AiGroupResult>("/api/ai_group",
      { grouping, key, offset, limit, uids: uids ?? null }),
  getConfig: () => req<Config>("/api/config"),
  saveConfig: (body: unknown) => req<Config>("/api/config", body),
  unsubscribe: (grouping: Grouping, key: string) =>
    req<UnsubResult>("/api/unsubscribe", { grouping, key }),
  unsubscribeBulk: (grouping: Grouping, keys: string[]) =>
    req<UnsubBulkResult>("/api/unsubscribe_bulk", { grouping, keys }),
  unsubscribeAck: (addr: string, done = true) =>
    req<{ status?: string; ok?: boolean }>("/api/unsubscribe/ack",
      { addr, done }),
  undo: (index = -1, ident?: UndoIdent, account?: string) =>
    req<{ restored: number; of: number; rescan: boolean }>(
      forAccount("/api/undo", account), ident ? { index, ident } : { index }),
  emptyTrash: (counted: { uv: number; max_uid: number }) =>
    req<{ deleted: number }>("/api/empty_trash", counted),
  cancel: (target: "scan" | "ai" | "delete" | "atts" | "unsub" | "index") =>
    req<{ ok: boolean }>("/api/cancel", { target }),
  clearNotice: () => req<{ ok: boolean }>("/api/notice/clear", {}),
  mails: (p: { offset: number; limit: number; sort: string; dir: string;
            q: string }) =>
    req<MailsResp>(`/api/mails?offset=${p.offset}&limit=${p.limit}`
      + `&sort=${p.sort}&dir=${p.dir}&q=${encodeURIComponent(p.q)}`),
  search: (q: string, body = false) =>
    req<SearchResp>(`/api/search?q=${encodeURIComponent(q)}`
      + (body ? "&scope=body" : "")),
  folders: (account?: string) =>
    req<FoldersResp>(account
      ? `/api/folders?account=${encodeURIComponent(account)}`
      : "/api/folders"),
  setFolderRole: (role: string, folder: string, account?: string) =>
    req<{ role: string; folder: string | null; source: string | null }>(
      forAccount("/api/folders/role", account), { role, folder }),
  lookalike: (folder: string, account?: string) =>
    req<LookalikeCount>(forAccount(
      `/api/folders/lookalike?folder=${encodeURIComponent(folder)}`, account)),
  moveLookalike: (folder: string, uv: number, max_uid: number,
                  account?: string) =>
    req<{ moved: number; target?: string; role?: string;
          undo: UndoIdent | null }>(
      forAccount("/api/folders/move_contents", account),
      { folder, uv, max_uid }),
  exportUrl: (grouping: Grouping, keys?: string[]) =>
    withAccount(`/api/export?grouping=${grouping}`
      + (keys?.length
        ? keys.map((k) => `&keys=${encodeURIComponent(k)}`).join("")
        : "")),
  // `cap`: the effective per-run cap every rule run obeys
  rules: () => req<{ rules: Rule[]; cap: number }>("/api/rules"),
  createRule: (body: Partial<Rule>) => req<Rule>("/api/rules", body),
  updateRule: (id: string, body: Partial<Rule>) =>
    req<Rule>(`/api/rules/${id}`, body),
  deleteRule: async (id: string): Promise<void> => {
    const res = await fetch(`/api/rules/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await res.text());
  },
  runRule: (id: string) => req<RuleRun>(`/api/rules/${id}/run`, {}),
  createPreset: (name: string, query: string) =>
    req<FilterPreset>("/api/presets", { name, query }),
  updatePreset: (id: string, name: string, query: string) =>
    req<FilterPreset>(`/api/presets/${id}`, { name, query }),
  deletePreset: async (id: string): Promise<void> => {
    const res = await fetch(`/api/presets/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await res.text());
  },
  block: (grouping: Grouping, key: string, label = "",
          trashExisting = false) =>
    req<{ rule: Rule; trashed?: { queued: number; skipped: number };
          trash_error?: string }>("/api/block",
      { grouping, key, label, trash_existing: trashExisting }),
  startAttachments: () => req<{ ok: boolean }>("/api/attachments", {}),
  attachments: () => req<AttMail[]>("/api/attachments"),
  duplicates: () => req<DupSet[]>("/api/duplicates"),
  stats: () => req<StatsResp>("/api/stats"),
  audit: (offset = 0, limit = 50) =>
    req<AuditResp>(`/api/audit?offset=${offset}&limit=${limit}`),
  auditExportUrl: () => withAccount("/api/audit/export"),
  trash: () => req<TrashResp>("/api/trash"),
  foldersPanel: (role: FolderRole) =>
    req<TrashResp>(`/api/folders_panel?role=${role}`),
  folderMove: (role: FolderRole, action: "not_junk" | "trash",
               uids: number[], uv: number, force = false) =>
    req<FolderMoveResp>("/api/folders_panel/move",
      { role, action, uids, uv, force }),
  // Permanent delete (Trash / Junk): count first (a fresh server listing),
  // then send back exactly the counted uv + UIDs.
  purgePreview: (role: FolderRole, select: PurgeSelect) =>
    req<PurgePreview>("/api/folders_panel/purge_preview", { role, ...select }),
  // role / folder / trash_folder / uv / uids all come from the preview.
  purge: (role: FolderRole, uids: number[], uv: number, folder: string,
          trash_folder: string | null) =>
    req<PurgeResult>("/api/folders_panel/purge",
      { role, uids, uv, folder, trash_folder }),
  trashRestore: (uids: number[], dest: string, uv: number) =>
    req<{ restored: number; rescan: boolean }>("/api/trash/restore", { uids, dest, uv }),
  testConnection: () =>
    req<{ ok: boolean; folders: number }>("/api/test_connection", {}),
  authProbe: () => req<AuthProbe>("/api/auth"),
  // cache: "no-store" - this specifically must never answer from a cached
  // response, or an update-available check can never detect anything.
  version: () => fetch(withAccount("/api/version"), { cache: "no-store" })
    .then((r) => r.json() as Promise<{ build: string }>),
  login: (password: string) =>
    req<{ ok: boolean }>("/api/login", { password }),
  logout: () => req<{ ok: boolean }>("/api/logout", {}),
  adminStats: () =>
    req<{ tenants: AdminTenantStats[] }>("/api/admin/stats"),
  oauthDeviceStart: (account: string) =>
    req<{ device_code: string; user_code: string; verification_uri: string;
      expires_in: number; interval: number }>(
      `/api/oauth/imap/device/start?account=${encodeURIComponent(account)}`,
      {}),
  oauthDevicePoll: (account: string, deviceCode: string) =>
    req<{ status: "pending" | "complete" | "error"; error?: string }>(
      `/api/oauth/imap/device/poll?account=${encodeURIComponent(account)}` +
      `&device_code=${encodeURIComponent(deviceCode)}`, {}),
  oauthDisconnect: (account: string) =>
    req<{ ok: boolean }>(
      `/api/oauth/imap/disconnect?account=${encodeURIComponent(account)}`, {}),
  trackers: () => req<TrackerReport>("/api/trackers"),
  indexInfo: (account: string) =>
    req<IndexInfo>(`/api/index?account=${encodeURIComponent(account)}`),
  indexBuild: (account: string, rebuild = false) =>
    req<{ ok: boolean }>(
      `/api/index/build?account=${encodeURIComponent(account)}`, { rebuild }),
  indexDelete: (account: string) =>
    req<{ ok: boolean }>(
      `/api/index/delete?account=${encodeURIComponent(account)}`, {}),
  indexCancel: (account: string) =>
    req<{ ok: boolean }>(
      `/api/cancel?account=${encodeURIComponent(account)}`,
      { target: "index" }),
  testDigest: (account: string) =>
    req<{ sent: boolean; demo: boolean }>(
      `/api/digest/test?account=${encodeURIComponent(account)}`, {}),
};

export { fmtSize, fmtUsd, mailKey } from "./lib";
