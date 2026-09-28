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

export interface DupSet {
  wasted: number;
  mails: Mail[];    // newest first
}

export interface TrashResp {
  folder: string;
  uv: number;
  total: number;
  mails: Mail[];
}

export interface StatsResp {
  mails: number;
  size: number;
  unread: number;
  bulk: number;
  oldest: string;
  senders: number;
  replied_senders: number;
  ai_groups: { delete_safe: number; review: number; keep: number;
    unrated: number };
  rated_mails: { delete_safe: number; review: number; keep: number };
  years: { year: string; count: number; size: number }[];
  months: { month: string; count: number; size: number }[];
  categories: { tag: string; count: number; size: number }[];
  top_domains: { domain: string; count: number; size: number }[];
  top_senders: { key: string; label: string; count: number;
    size: number }[];
  scans: { ts: number; mails: number; size: number; senders: number }[];
  actions: Record<string, { trash: number; archive: number; move: number;
    mark_read: number; freed: number }>;
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

/** Slim live-update payload (SSE): AppState without `groups`. */
export type StatusMsg = Omit<AppState, "groups">;

export interface AppState {
  account: string;
  status: "idle" | "scanning" | "done" | "error";
  scanned_ts: number | null;
  groups_rev: number;
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
  role: string | null;    // trash | sent | junk | drafts | archive | all
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

export type Security = "ssl" | "starttls";
export type SmtpSecurity = "auto" | "ssl" | "starttls";
export type Preset = "proton" | "gmail" | "icloud" | "fastmail" | "gmx"
  | "mailbox" | "yahoo" | "custom";

export interface ImapAccount {
  excluded_folders: string[];
  host: string;
  port: number;
  security: Security;
  smtp_host: string;
  smtp_port: number;
  smtp_security: SmtpSecurity;
  user: string;
  password: string;
  password_set: boolean;
  cafile: string;
  preset: Preset;
  oauth: ImapOauth | null;
}

export type OauthProvider = "google" | "microsoft";

// Never carries a token - just enough to render connect status and let
// the user re-enter their own client credentials.
export interface ImapOauth {
  provider: OauthProvider;
  client_id: string;
  client_secret_set: boolean;
  connected: boolean;
}

export type AuthMode = "none" | "password" | "oidc";

export interface AuthProbe {
  mode: AuthMode;
  authed: boolean;
  sub?: string;        // OIDC identity of the session (empty otherwise)
  is_admin?: boolean;  // may edit server-level settings (auth, shared AI)
}

// Non-admins only ever receive {mode, is_admin} - the server-side login
// details (incl. the allow-list) are admin-only.
export interface AuthCfg {
  mode: AuthMode;
  is_admin: boolean;
  password_set?: boolean;
  admin?: string;
  oidc?: {
    issuer: string;
    client_id: string;
    client_secret_set: boolean;
    redirect_base: string;
    allowed: string[];
  };
}

// Admin-only usage overview: one row per tenant workspace. Counts,
// spend and disk only - the backend never includes account names,
// addresses or any mail-derived data here.
export interface AdminTenantStats {
  id: string;
  label: string;              // display name (admin identity); "" = use id
  is_admin_workspace: boolean;
  accounts: number;
  mails: number;
  size: number;
  scans: number;
  last_scan_ts: number | null;
  rules: number;
  verdicts: number;
  actions_month: { trash: number; archive: number; move: number;
    mark_read: number; freed: number };
  ai: { source: "own" | "shared" | null; runs: number;
    input_tokens: number; output_tokens: number; cost: number;
    month_cost: number; budget_usd: number };
  disk_bytes: number;
}

// Admin-only: the server-side AI key shared with all tenants.
export interface SharedAiCfg {
  enabled: boolean;
  provider: "anthropic" | "foundry" | "openai" | "ollama";
  model: string;
  foundry_endpoint: string;
  price_in: number;
  price_out: number;
  default_tenant_budget_usd: number;
  api_key: string;
  api_key_set: boolean;
}

export interface Config {
  accounts: Record<string, ImapAccount>;
  default_account: string;
  oauth_providers: OauthProvider[];
  oauth_ms_device_available: boolean;
  auth: AuthCfg;
  protected: string[];
  categories: Record<string, string[]>;
  ai: {
    provider: "anthropic" | "foundry" | "openai" | "ollama";
    model: string;
    foundry_endpoint: string;
    price_in: number;
    price_out: number;
    budget_usd: number;
    month_cost: number;
    prices_effective: [number, number];
    api_key: string;
    api_key_set: boolean;
    available: boolean;
    source: "own" | "shared" | null;   // which key AI runs would use
    shared_budget_usd: number;         // effective cap when on the shared key
  };
  shared_ai?: SharedAiCfg;             // present for the admin only
  ai_stats: {
    input_tokens: number;
    output_tokens: number;
    cost: number;
    runs: number;
  };
}
