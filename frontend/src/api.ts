import type {
  AdminTenantStats, AiGroupResult, AppState, AttMail, AuditResp, AuthProbe,
  Config, DupSet, FilterPreset, FoldersResp, Grouping, Mail, MessageDetail,
  Rule, RuleRun, StatsResp, TrashResp, UnsubBulkResult, UnsubResult,
} from "./types";

/* Active account: every API call is scoped to exactly one account (strict
 * separation - the backend never mixes them). Set once by App on startup
 * and whenever the user switches. */
let ACCOUNT = "";

export function setAccount(name: string) {
  ACCOUNT = name;
}

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
  const name = /filename="?([^"]+)"?/.exec(cd)?.[1] ?? "download";
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

async function req<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(withAccount(path), {
    method: body === undefined ? "GET" : "POST",
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
    throw new Error(detail || `HTTP ${res.status}`);
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
  deleteGroups: (grouping: Grouping, keys: string[],
                 action = "trash", dest = "", force = false,
                 keepLatest: number | null = null,
                 olderThanDays: number | null = null) =>
    req<{ ok: boolean; queued: number; skipped: number }>("/api/delete",
      { grouping, keys, action, dest, force, keep_latest: keepLatest,
        older_than_days: olderThanDays }),
  protect: (entry: string, on: boolean) =>
    req<{ protected: string[] }>("/api/protect", { entry, on }),
  deleteMessages: (items: [string, number][], action = "trash", dest = "") =>
    req<{ ok: boolean; queued: number }>("/api/delete_messages",
      { items, action, dest }),
  aiReview: (grouping: Grouping, keys?: string[]) =>
    req<{ ok: boolean }>("/api/ai", { grouping, keys: keys ?? null }),
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
  undo: (index = -1) =>
    req<{ restored: number; of: number }>("/api/undo", { index }),
  emptyTrash: () => req<{ deleted: number }>("/api/empty_trash", {}),
  cancel: (target: "scan" | "ai" | "delete" | "atts" | "unsub") =>
    req<{ ok: boolean }>("/api/cancel", { target }),
  clearNotice: () => req<{ ok: boolean }>("/api/notice/clear", {}),
  search: (q: string) =>
    req<Mail[]>(`/api/search?q=${encodeURIComponent(q)}`),
  folders: (account?: string) =>
    req<FoldersResp>(account
      ? `/api/folders?account=${encodeURIComponent(account)}`
      : "/api/folders"),
  exportUrl: (grouping: Grouping, keys?: string[]) =>
    withAccount(`/api/export?grouping=${grouping}`
      + (keys?.length
        ? keys.map((k) => `&keys=${encodeURIComponent(k)}`).join("")
        : "")),
  rules: () => req<{ rules: Rule[] }>("/api/rules"),
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
  trashRestore: (uids: number[], dest: string, uv: number) =>
    req<{ restored: number }>("/api/trash/restore", { uids, dest, uv }),
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
  testDigest: (account: string) =>
    req<{ sent: boolean; demo: boolean }>(
      `/api/digest/test?account=${encodeURIComponent(account)}`, {}),
};

export { fmtSize, fmtUsd, mailKey } from "./lib";
