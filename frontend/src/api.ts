import type {
  AiGroupResult, AppState, AttMail, Config, DupSet, FoldersResp, Grouping,
  Mail, MessageDetail, Rule, RuleRun, StatsResp, TrashResp, UnsubResult,
} from "./types";

async function req<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
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
                 action = "trash", dest = "", force = false) =>
    req<{ ok: boolean; queued: number; skipped: number }>("/api/delete",
      { grouping, keys, action, dest, force }),
  protect: (entry: string, on: boolean) =>
    req<{ protected: string[] }>("/api/protect", { entry, on }),
  deleteMessages: (items: [string, number][], action = "trash", dest = "") =>
    req<{ ok: boolean; queued: number }>("/api/delete_messages",
      { items, action, dest }),
  aiReview: (grouping: Grouping) => req<{ ok: boolean }>("/api/ai", { grouping }),
  aiGroup: (grouping: Grouping, key: string, offset = 0, limit = 200) =>
    req<AiGroupResult>("/api/ai_group", { grouping, key, offset, limit }),
  getConfig: () => req<Config>("/api/config"),
  saveConfig: (body: unknown) => req<Config>("/api/config", body),
  unsubscribe: (grouping: Grouping, key: string) =>
    req<UnsubResult>("/api/unsubscribe", { grouping, key }),
  undo: (index = -1) =>
    req<{ restored: number; of: number }>("/api/undo", { index }),
  emptyTrash: () => req<{ deleted: number }>("/api/empty_trash", {}),
  cancel: (target: "scan" | "ai" | "delete" | "atts") =>
    req<{ ok: boolean }>("/api/cancel", { target }),
  clearNotice: () => req<{ ok: boolean }>("/api/notice/clear", {}),
  search: (q: string) =>
    req<Mail[]>(`/api/search?q=${encodeURIComponent(q)}`),
  folders: () => req<FoldersResp>("/api/folders"),
  exportUrl: (grouping: Grouping) => `/api/export?grouping=${grouping}`,
  rules: () => req<{ rules: Rule[] }>("/api/rules"),
  createRule: (body: Partial<Rule>) => req<Rule>("/api/rules", body),
  updateRule: (id: string, body: Partial<Rule>) =>
    req<Rule>(`/api/rules/${id}`, body),
  deleteRule: async (id: string): Promise<void> => {
    const res = await fetch(`/api/rules/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await res.text());
  },
  runRule: (id: string) => req<RuleRun>(`/api/rules/${id}/run`, {}),
  startAttachments: () => req<{ ok: boolean }>("/api/attachments", {}),
  attachments: () => req<AttMail[]>("/api/attachments"),
  duplicates: () => req<DupSet[]>("/api/duplicates"),
  stats: () => req<StatsResp>("/api/stats"),
  trash: () => req<TrashResp>("/api/trash"),
  trashRestore: (uids: number[], dest: string, uv: number) =>
    req<{ restored: number }>("/api/trash/restore", { uids, dest, uv }),
  testConnection: () =>
    req<{ ok: boolean; folders: number }>("/api/test_connection", {}),
};

export { fmtSize, fmtUsd, mailKey } from "./lib";
