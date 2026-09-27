export type Grouping = "sender" | "domain" | "subject";
export type Verdict = "delete_safe" | "review" | "keep";

export interface GroupAi {
  verdict: Verdict;
  reason: string;
}

export interface Group {
  key: string;
  label: string;
  sub: string;
  count: number;
  size: number;
  unread: number;
  first: string;
  last: string;
  tags: string[];
  samples: string[];
  bulk: boolean;
  unsub: boolean;
  ai: GroupAi | null;
  ratings: { delete_safe: number; review: number; keep: number } | null;
  protected: boolean;
  replied: boolean;
  att_size: number;
}

export interface AiUsage {
  input_tokens: number;
  output_tokens: number;
  cost?: number;
  total_cost?: number;
}

export interface AiState {
  status: "idle" | "running" | "done" | "error";
  grouping: string;
  progress: string;
  error: string;
  usage: AiUsage | null;
}

export interface DeleteState {
  status: "idle" | "running" | "done" | "error";
  progress: string;
  error: string;
  moved: number;
}

export interface AttsState {
  status: "idle" | "running" | "done" | "error";
  progress: string;
  error: string;
  mails: number;
  size: number;
}

export interface AttMail extends Mail {
  att_size: number;
  atts: { name: string; size: number }[];
}

export interface RuleRun {
  ts: number;
  mode: "report" | "execute";
  groups: number;
  mails: number;
  acted: number;
  capped: number;
  skipped_protected: number;
  preview: { key: string; label: string; count: number }[];
  error: string;
}

export interface Rule {
  id: string;
  name: string;
  grouping: Grouping;
  query: string;
  action: string;
  dest: string;
  schedule: "manual" | "daily" | "weekly";
  mode: "report" | "execute";
  report_runs: number;
  created: number;
  last_run: RuleRun | null;
}

export interface AppState {
  status: "idle" | "scanning" | "done" | "error";
  progress: string;
  error: string;
  folders: string[];
  groups: Record<Grouping, Record<string, Group>>;
  ai: AiState;
  delete: DeleteState;
  atts: AttsState;
  trash_count: number | null;
  notice: { key: string; params: Record<string, string | number> } | null;
  undo: { ts: number; label: string; count: number; action: string }[];
  folders_raw: string[];
  rules: Rule[];
}

export interface FolderInfo {
  raw: string;
  name: string;
  excluded: boolean;
}

export interface FoldersResp {
  folders: FolderInfo[];
  wildcards: string[];
}

export interface Mail {
  uid: number;
  folder: string;
  date: string;
  ts: number;
  subject: string;
  addr: string;
  size: number;
  seen: boolean;
  ai: Verdict | null;
}

export interface MessageDetail {
  from: string;
  to: string;
  date: string;
  subject: string;
  text: string;
}

export interface AiGroupResult {
  verdicts: [string, number, Verdict][];
  note: string;
  reviewed: number;
  remaining: number;
  total: number;
  usage: AiUsage;
}

export interface UnsubResult {
  action: "done" | "link";
  method: string;
  detail: string;
}

export interface Config {
  imap: {
    host: string;
    port: number;
    smtp_port: number;
    user: string;
    password: string;
    password_set: boolean;
    cafile: string;
  };
  profiles: string[];
  active_profile: string;
  excluded_folders: string[];
  protected: string[];
  ai: {
    provider: "anthropic" | "foundry" | "openai" | "ollama";
    model: string;
    foundry_endpoint: string;
    price_in: number;
    price_out: number;
    prices_effective: [number, number];
    api_key: string;
    api_key_set: boolean;
    available: boolean;
  };
  ai_stats: {
    input_tokens: number;
    output_tokens: number;
    cost: number;
    runs: number;
  };
}
