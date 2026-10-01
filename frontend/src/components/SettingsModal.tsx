import { useEffect, useState } from "react";
import { api, fmtUsd } from "../api";
import { getLang, setLang, t, type Lang } from "../i18n";
import { fmtAgo, fmtSize } from "../lib";
import type { AdminTenantStats, AuthMode, Config, FoldersResp, OauthProvider,
  Preset, Security, SmtpSecurity } from "../types";
import { Button, Field, Input, Loading, Modal, PanelHeader,
  SectionLabel, Select, TextArea } from "./ui";

/* Provider presets only PREFILL the connection fields - everything stays
 * editable. "custom" prefills nothing. Hosts per provider docs; all of
 * these use app passwords except Proton (Bridge password). */
const PRESETS: Record<Exclude<Preset, "custom">, {
  host: string; port: number; security: Security;
  smtpHost: string; smtpPort: number; smtpSecurity: SmtpSecurity;
  cafile: string; hint: string;
}> = {
  proton: { host: "127.0.0.1", port: 1143, security: "ssl",
    smtpHost: "", smtpPort: 1025, smtpSecurity: "auto",
    cafile: "/certs/bridge-cert.pem", hint: "preset.hint.proton" },
  gmail: { host: "imap.gmail.com", port: 993, security: "ssl",
    smtpHost: "smtp.gmail.com", smtpPort: 465, smtpSecurity: "ssl",
    cafile: "", hint: "preset.hint.oauth_gmail" },
  outlook: { host: "outlook.office365.com", port: 993, security: "ssl",
    smtpHost: "smtp.office365.com", smtpPort: 587, smtpSecurity: "starttls",
    // Unused: presetHint below computes this dynamically (depends on
    // whether the server has a shared Microsoft app configured).
    cafile: "", hint: "" },
  icloud: { host: "imap.mail.me.com", port: 993, security: "ssl",
    smtpHost: "smtp.mail.me.com", smtpPort: 587, smtpSecurity: "starttls",
    cafile: "", hint: "preset.hint.apppw" },
  fastmail: { host: "imap.fastmail.com", port: 993, security: "ssl",
    smtpHost: "smtp.fastmail.com", smtpPort: 465, smtpSecurity: "ssl",
    cafile: "", hint: "preset.hint.apppw" },
  gmx: { host: "imap.gmx.net", port: 993, security: "ssl",
    smtpHost: "mail.gmx.net", smtpPort: 465, smtpSecurity: "ssl",
    cafile: "", hint: "preset.hint.imap_toggle" },
  mailbox: { host: "imap.mailbox.org", port: 993, security: "ssl",
    smtpHost: "smtp.mailbox.org", smtpPort: 465, smtpSecurity: "ssl",
    cafile: "", hint: "" },
  yahoo: { host: "imap.mail.yahoo.com", port: 993, security: "ssl",
    smtpHost: "smtp.mail.yahoo.com", smtpPort: 465, smtpSecurity: "ssl",
    cafile: "", hint: "preset.hint.apppw" },
};

const PRESET_LABELS: Record<Preset, string> = {
  proton: "Proton Mail Bridge", gmail: "Gmail",
  outlook: "Outlook / Microsoft 365", icloud: "iCloud Mail",
  fastmail: "Fastmail", gmx: "GMX", mailbox: "mailbox.org",
  yahoo: "Yahoo Mail", custom: "Custom (any IMAP server)",
};

export function SettingsModal({ cfg, account, onClose, onSaved,
  onAccountsChanged }: {
  cfg: Config;
  account: string;                       // the ACTIVE account
  onClose: () => void;
  onSaved: (c: Config) => void;
  /** Accounts were added/removed. `switchTo` names a new account to
   *  activate (or null to let App re-validate the current one). */
  onAccountsChanged: (c: Config, switchTo: string | null) => void;
}) {
  // Which account the connection fields below edit (defaults to the
  // active one; independent of the header switcher).
  const [editAcct, setEditAcct] = useState(
    cfg.accounts[account] ? account : cfg.default_account);
  const imapOf = (c: Config, name: string) =>
    c.accounts[name] ?? c.accounts[c.default_account];
  const imapFields = (c: Config, name: string) => {
    const im = imapOf(c, name);
    return {
      preset: (im.preset ?? "proton") as Preset,
      host: im.host,
      port: String(im.port),
      security: (im.security ?? "ssl") as Security,
      smtpHost: im.smtp_host ?? "",
      smtpPort: String(im.smtp_port ?? 1025),
      smtpSecurity: (im.smtp_security ?? "auto") as SmtpSecurity,
      cafile: im.cafile ?? "",
      user: im.user,
      password: "",
      oauthProvider: (im.oauth?.provider ?? "") as "" | OauthProvider,
      oauthClientId: im.oauth?.client_id ?? "",
      oauthClientSecret: "",
      oauthClientSecretSet: im.oauth?.client_secret_set ?? false,
      oauthConnected: im.oauth?.connected ?? false,
    };
  };
  const [f, setF] = useState({
    ...imapFields(cfg, cfg.accounts[account] ? account : cfg.default_account),
    provider: cfg.ai.provider,
    endpoint: cfg.ai.foundry_endpoint,
    model: cfg.ai.model,
    apiKey: "",
    priceIn: cfg.ai.price_in ? String(cfg.ai.price_in) : "",
    priceOut: cfg.ai.price_out ? String(cfg.ai.price_out) : "",
    budget: cfg.ai.budget_usd ? String(cfg.ai.budget_usd) : "",
    authMode: cfg.auth.mode as AuthMode,
    authPassword: "",
    // Server-level fields: only the admin receives them (cfg.auth.oidc /
    // cfg.shared_ai are absent for other users, whose UI hides the
    // sections anyway).
    oidcIssuer: cfg.auth.oidc?.issuer ?? "",
    oidcClientId: cfg.auth.oidc?.client_id ?? "",
    oidcSecret: "",
    oidcRedirect: cfg.auth.oidc?.redirect_base ?? "",
    oidcAllowed: (cfg.auth.oidc?.allowed ?? []).join("\n"),
    oidcAdmin: cfg.auth.admin ?? "",
    sharedEnabled: cfg.shared_ai?.enabled ?? false,
    sharedProvider: cfg.shared_ai?.provider ?? "anthropic",
    sharedModel: cfg.shared_ai?.model ?? "claude-sonnet-5",
    sharedEndpoint: cfg.shared_ai?.foundry_endpoint ?? "",
    sharedKey: "",
    sharedBudget: cfg.shared_ai?.default_tenant_budget_usd
      ? String(cfg.shared_ai.default_tenant_budget_usd) : "",
  });
  const [protectedText, setProtectedText] =
    useState((cfg.protected ?? []).join("\n"));
  const catText = (cats: Record<string, string[]>) =>
    Object.entries(cats ?? {})
      .map(([k, v]) => `${k}: ${v.join(", ")}`).join("\n");
  const [categoriesText, setCategoriesText] =
    useState(catText(cfg.categories));
  const parseCategories = (): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const line of categoriesText.split("\n")) {
      const i = line.indexOf(":");
      if (i < 1) continue;
      const name = line.slice(0, i).trim().toLowerCase();
      if (!name) continue;
      out[name] = line.slice(i + 1).split(",")
        .map((s) => s.trim().toLowerCase()).filter(Boolean);
    }
    return out;
  };
  const [msg, setMsg] = useState("");
  // Admin usage overview (Server tab): fetched once when the tab opens.
  const [tenantStats, setTenantStats] =
    useState<AdminTenantStats[] | null>(null);
  const [tenantStatsErr, setTenantStatsErr] = useState("");
  // Folder picker: checked = scanned. Wildcard rules (e.g. Labels/*) are
  // shown as removable chips and win over checkboxes.
  const [folders, setFolders] = useState<FoldersResp | null>(null);
  const [foldersErr, setFoldersErr] = useState("");
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [wildcards, setWildcards] = useState<string[]>([]);

  // Folder discovery is PER ACCOUNT (each provider names folders
  // differently) and needs that account's SAVED credentials.
  const discoverFolders = (name: string) => {
    setFolders(null);
    setFoldersErr("");
    api.folders(name)
      .then((r) => {
        setFolders(r);
        setWildcards(r.wildcards);
        setIncluded(new Set(
          r.folders.filter((x) => !x.excluded).map((x) => x.raw)));
      })
      .catch((e) => setFoldersErr(String(e.message ?? e)));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { discoverFolders(editAcct); }, [editAcct]);

  const set = (k: keyof typeof f) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setF({ ...f, [k]: e.target.value });

  const PRESET_OAUTH: Partial<Record<Preset, OauthProvider>> =
    { gmail: "google", outlook: "microsoft" };
  const applyPreset = (p: Preset) => {
    if (p === "custom") {
      setF({ ...f, preset: p, oauthProvider: "" });
      return;
    }
    const pre = PRESETS[p];
    setF({ ...f, preset: p, host: pre.host, port: String(pre.port),
      security: pre.security, smtpHost: pre.smtpHost,
      smtpPort: String(pre.smtpPort), smtpSecurity: pre.smtpSecurity,
      cafile: pre.cafile, oauthProvider: PRESET_OAUTH[p] ?? "" });
  };
  const presetHint = f.preset === "custom" ? ""
    // Outlook's hint depends on whether this server has a shared
    // Microsoft app (device code, no setup) or not (bring your own).
    : f.preset === "outlook"
      ? (cfg.oauth_ms_device_available ? "preset.hint.oauth_outlook_device"
        : "preset.hint.oauth_outlook_byo")
      : PRESETS[f.preset].hint;
  // The provider preset already says which mail service this is, so it
  // also decides the OAuth provider - no need to ask again. Only a
  // preset outside gmail/outlook falls back to whatever the account's
  // saved oauth block already has (a leftover from a custom setup).
  const oauthProvider: "" | OauthProvider =
    f.preset === "gmail" ? "google"
    : f.preset === "outlook" ? "microsoft"
    : f.oauthProvider;

  const excludedList = (): string[] | undefined => {
    if (!folders) return undefined;   // picker never loaded: keep old config
    const explicit = folders.folders
      .filter((x) => !included.has(x.raw))
      .map((x) => x.raw);
    return [...wildcards, ...explicit];
  };

  const save = async (extra: Record<string, unknown> = {}) => {
    try {
      const excluded = excludedList();
      const body: Record<string, unknown> = {
        account: editAcct,
        imap: { host: f.host, port: +f.port || 1143,
          security: f.security, smtp_host: f.smtpHost,
          smtp_port: +f.smtpPort || 1025, smtp_security: f.smtpSecurity,
          cafile: f.cafile, preset: f.preset, user: f.user,
          ...(f.password ? { password: f.password } : {}),
          ...(oauthProvider ? { oauth: { provider: oauthProvider,
            client_id: f.oauthClientId,
            ...(f.oauthClientSecret
              ? { client_secret: f.oauthClientSecret } : {}) } } : {}) },
        ...(excluded ? { excluded_folders: excluded } : {}),
        protected: protectedText.split("\n")
          .map((s) => s.trim()).filter(Boolean),
        categories: parseCategories(),
        ai: { provider: f.provider, model: f.model,
          foundry_endpoint: f.endpoint,
          price_in: +f.priceIn || 0, price_out: +f.priceOut || 0,
          budget_usd: +f.budget || 0,
          ...(f.apiKey ? { api_key: f.apiKey } : {}) },
        // Server-level settings ride along for the admin only - the
        // backend rejects them (403) from anyone else.
        ...(cfg.auth.is_admin ? {
          auth: { mode: f.authMode, admin: f.oidcAdmin.trim(),
            ...(f.authPassword ? { password: f.authPassword } : {}),
            oidc: { issuer: f.oidcIssuer, client_id: f.oidcClientId,
              redirect_base: f.oidcRedirect,
              allowed: f.oidcAllowed.split("\n")
                .map((a) => a.trim()).filter(Boolean),
              ...(f.oidcSecret ? { client_secret: f.oidcSecret } : {}) } },
          shared_ai: { enabled: f.sharedEnabled,
            provider: f.sharedProvider, model: f.sharedModel,
            foundry_endpoint: f.sharedEndpoint,
            default_tenant_budget_usd: +f.sharedBudget || 0,
            ...(f.sharedKey ? { api_key: f.sharedKey } : {}) },
        } : {}),
        ...extra,
      };
      const next = await api.saveConfig(body);
      onSaved(next);
      setF({ ...f, apiKey: "", authPassword: "", oidcSecret: "",
        sharedKey: "", authMode: next.auth.mode,
        ...imapFields(next, editAcct) });
      setProtectedText((next.protected ?? []).join("\n"));
      setCategoriesText(catText(next.categories));
      setMsg(t("Saved."));
      setTimeout(() => setMsg(""), 2500);
      return next;
    } catch (e: any) {
      setMsg(`Error: ${e.message ?? e}`);
      return null;
    }
  };

  const switchEditAccount = (name: string) => {
    setEditAcct(name);                 // effect above re-discovers folders
    setF({ ...f, ...imapFields(cfg, name) });
  };

  const renameAccount = async () => {
    const name = prompt(t("account.rename_prompt", { name: editAcct }),
      editAcct)?.trim();
    if (!name || name === editAcct) return;
    try {
      const next = await api.saveConfig(
        { rename_account: { from: editAcct, to: name } });
      onAccountsChanged(next, account === editAcct ? name : null);
      setEditAcct(name);
      setMsg(t("account.renamed", { name }));
    } catch (e: any) {
      setMsg(`Error: ${e.message ?? e}`);
    }
  };

  const newAccount = async () => {
    const name = prompt(t("account.new_prompt"))?.trim();
    if (!name) return;
    try {
      const next = await api.saveConfig({ add_account: name });
      onAccountsChanged(next, name);
      setEditAcct(name);
      setF({ ...f, ...imapFields(next, name) });
    } catch (e: any) {
      setMsg(`Error: ${e.message ?? e}`);
    }
  };

  const deleteAccount = async () => {
    if (!confirm(t("account.confirm_delete", { name: editAcct }))) return;
    try {
      const next = await api.saveConfig({ delete_account: editAcct });
      onAccountsChanged(next, null);
      setEditAcct(next.default_account);
      setF({ ...f, ...imapFields(next, next.default_account) });
    } catch (e: any) {
      setMsg(`Error: ${e.message ?? e}`);
    }
  };

  // OAuth connect: the auth-code+PKCE flow is a full-page redirect (the
  // provider's consent screen), so client_id/secret must be saved first.
  // The device-code flow needs neither - it polls this modal instead.
  const [deviceInfo, setDeviceInfo] = useState<{
    userCode: string; verificationUri: string; deviceCode: string;
    interval: number;
  } | null>(null);
  const [oauthMsg, setOauthMsg] = useState("");

  const connectOauth = async () => {
    const next = await save();
    if (!next) return;
    window.location.href = `/api/oauth/imap/login?account=` +
      `${encodeURIComponent(editAcct)}&provider=${oauthProvider}`;
  };

  const disconnectOauth = async () => {
    if (!confirm(t("oauth.confirm_disconnect"))) return;
    await api.oauthDisconnect(editAcct);
    const next = await api.getConfig();
    onSaved(next);
    setF({ ...f, ...imapFields(next, editAcct) });
  };

  const startDeviceConnect = async () => {
    setOauthMsg("");
    try {
      const r = await api.oauthDeviceStart(editAcct);
      setDeviceInfo({ userCode: r.user_code,
        verificationUri: r.verification_uri, deviceCode: r.device_code,
        interval: r.interval || 5 });
    } catch (e: any) {
      setOauthMsg(`Error: ${e.message ?? e}`);
    }
  };

  useEffect(() => {
    if (!deviceInfo) return;
    const id = setInterval(async () => {
      try {
        const r = await api.oauthDevicePoll(editAcct, deviceInfo.deviceCode);
        if (r.status === "complete") {
          clearInterval(id);
          setDeviceInfo(null);
          const next = await api.getConfig();
          onSaved(next);
          setF((old) => ({ ...old, ...imapFields(next, editAcct) }));
          setOauthMsg(t("oauth.connected"));
        } else if (r.status === "error") {
          clearInterval(id);
          setDeviceInfo(null);
          setOauthMsg(`Error: ${r.error}`);
        }
      } catch {
        /* transient network error - keep polling until it expires */
      }
    }, deviceInfo.interval * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceInfo?.deviceCode]);

  const resetStats = async () => {
    if (!confirm(t("confirm.reset_spend"))) return;
    onSaved(await api.saveConfig({ reset_ai_stats: true }));
  };

  const clearVerdicts = async () => {
    if (!confirm(t("confirm.clear_verdicts"))) return;
    onSaved(await api.saveConfig({ clear_ai_verdicts: true }));
    setMsg(t("AI verdict cache cleared."));
  };

  const [pi, po] = cfg.ai.prices_effective;
  const s = cfg.ai_stats;

  // Settings are split into tabs; the SERVER tab (login + shared AI)
  // exists for the admin only. All form state lives in this component,
  // so Save always persists every tab, not just the visible one.
  type Tab = "account" | "general" | "ai" | "server";
  const [tab, setTab] = useState<Tab>("account");
  useEffect(() => {
    if (tab !== "server" || !cfg.auth.is_admin || tenantStats) return;
    api.adminStats()
      .then((r) => setTenantStats(r.tenants))
      .catch((e) => setTenantStatsErr(String(e.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const tabs: [Tab, string][] = [
    ["account", t("tab.account")],
    ["general", t("tab.general")],
    ["ai", t("tab.ai")],
    ...(cfg.auth.is_admin ? [["server", t("tab.server")] as [Tab, string]]
      : []),
  ];

  return (
    // full = fixed-height sheet: switching tabs must not resize or
    // re-center the modal (only the content area scrolls; header, tab
    // bar and the Save footer stay put).
    <Modal full onClose={onClose}>
      <PanelHeader title={<>⚙ {t("Settings")}</>} onClose={onClose} />
      <div role="tablist" className="flex flex-wrap gap-1 border-b
        border-line px-5 pt-3">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k}
            className={`rounded-t-md px-3 py-1.5 text-sm ${tab === k
              ? "bg-accent text-white"
              : "bg-panel2 text-body hover:bg-chip"}`}
            onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="grid flex-1 content-start gap-4 overflow-y-auto p-5
        sm:grid-cols-2">
        {tab === "general" && (<>
        <Field label={t("Language")}>
          <Select className="w-full" value={getLang()}
            onChange={(e) => {
              setLang(e.target.value as Lang);
              window.location.reload();
            }}>
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox"
            defaultChecked={localStorage.getItem("pmc_notify") === "1"}
            onChange={async (e) => {
              if (!e.target.checked) {
                localStorage.setItem("pmc_notify", "0");
                return;
              }
              const perm = typeof Notification !== "undefined"
                ? await Notification.requestPermission() : "denied";
              if (perm === "granted") {
                localStorage.setItem("pmc_notify", "1");
              } else {
                e.target.checked = false;
                setMsg(t("notify.denied"));
              }
            }} />
          {t("notify.toggle")}
        </label>
        </>)}
        {tab === "account" && (<>
        <div className="sm:col-span-2 flex flex-wrap items-end gap-2">
          <Field label={t("account.label")}>
            <Select className="w-full" value={editAcct}
              onChange={(e) => switchEditAccount(e.target.value)}>
              {Object.keys(cfg.accounts).map((n) =>
                <option key={n}>{n}</option>)}
            </Select>
          </Field>
          <Button variant="ghost" onClick={newAccount}>
            {t("account.add")}
          </Button>
          <Button variant="ghost" onClick={renameAccount}>
            {t("account.rename")}
          </Button>
          {Object.keys(cfg.accounts).length > 1 && (
            <Button variant="ghost" onClick={deleteAccount}>
              {t("Delete…")}
            </Button>
          )}
          <span className="pb-2 text-xs text-muted">
            {t("account.hint")}
          </span>
        </div>
        <div className="sm:col-span-2">
          <Field label={t("preset.label")}>
            <Select className="w-full" value={f.preset}
              onChange={(e) => applyPreset(e.target.value as Preset)}>
              {(Object.keys(PRESET_LABELS) as Preset[]).map((p) => (
                <option key={p} value={p}>{PRESET_LABELS[p]}</option>
              ))}
            </Select>
          </Field>
          {presetHint && (
            <p className="mt-1 text-xs text-muted">{t(presetHint)}</p>
          )}
        </div>
        <Field label={t("Host")}>
          <Input className="w-full" value={f.host} onChange={set("host")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("IMAP port")}>
            <Input className="w-full" type="number" value={f.port}
              onChange={set("port")} />
          </Field>
          <Field label={t("imap.security")}>
            <Select className="w-full" value={f.security}
              onChange={set("security")}>
              <option value="ssl">SSL/TLS</option>
              <option value="starttls">STARTTLS</option>
            </Select>
          </Field>
        </div>
        <Field label={t("User")}>
          <Input className="w-full" value={f.user} onChange={set("user")} />
        </Field>
        {!oauthProvider && (
        <Field label={t("Password")}>
          <Input className="w-full" type="password" value={f.password}
            placeholder={imapOf(cfg, editAcct).password_set
              ? t("(unchanged)") : t("required")}
            onChange={set("password")} />
        </Field>
        )}
        <Field label={t("smtp.host")}>
          <Input className="w-full" value={f.smtpHost}
            placeholder={t("smtp.host_placeholder")}
            onChange={set("smtpHost")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("SMTP port (unsubscribe mails)")}>
            <Input className="w-full" type="number" value={f.smtpPort}
              onChange={set("smtpPort")} />
          </Field>
          <Field label={t("smtp.security")}>
            <Select className="w-full" value={f.smtpSecurity}
              onChange={set("smtpSecurity")}>
              <option value="auto">{t("sec.auto")}</option>
              <option value="ssl">SSL/TLS</option>
              <option value="starttls">STARTTLS</option>
            </Select>
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label={t("cafile.label")}>
            <Input className="w-full" value={f.cafile}
              placeholder="/certs/bridge-cert.pem"
              onChange={set("cafile")} />
          </Field>
        </div>

        {oauthProvider && (
        <div className="sm:col-span-2 rounded-md border border-line
          bg-panel2 p-3">
          <SectionLabel>
            {t("oauth.title", { provider: oauthProvider === "google"
              ? "Gmail" : "Outlook" })}
          </SectionLabel>

          {oauthProvider === "google" && (
            <p className="my-2 text-xs text-muted">{t("oauth.google_help")}</p>
          )}
          {oauthProvider === "microsoft" && cfg.oauth_ms_device_available && (
            <p className="my-2 text-xs text-muted">{t("oauth.ms_device_help")}</p>
          )}
          {oauthProvider === "microsoft" && !cfg.oauth_ms_device_available && (
            <p className="my-2 text-xs text-muted">{t("oauth.ms_byo_help")}</p>
          )}

          {!(oauthProvider === "microsoft"
            && cfg.oauth_ms_device_available) && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label={t("oauth.client_id")}>
                <Input className="w-full" value={f.oauthClientId}
                  onChange={set("oauthClientId")} />
              </Field>
              <Field label={t("oauth.client_secret")}>
                <Input className="w-full" type="password"
                  value={f.oauthClientSecret}
                  placeholder={f.oauthClientSecretSet
                    ? t("(unchanged)") : t("required")}
                  onChange={set("oauthClientSecret")} />
              </Field>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {f.oauthConnected ? (<>
              <span className="text-sm text-emerald-400">
                ✓ {t("oauth.connected")}
              </span>
              <Button variant="ghost" onClick={disconnectOauth}>
                {t("oauth.disconnect")}
              </Button>
            </>) : oauthProvider === "microsoft"
              && cfg.oauth_ms_device_available ? (
              <Button onClick={startDeviceConnect}>
                {t("oauth.connect_device")}
              </Button>
            ) : (
              <Button onClick={connectOauth} disabled={!f.oauthClientId}>
                {t("oauth.connect")}
              </Button>
            )}
          </div>

          {deviceInfo && (
            <div className="mt-2 rounded-md border border-line bg-panel p-3
              text-sm">
              <p>{t("oauth.device_instructions")}</p>
              <p className="mt-1">
                <a href={deviceInfo.verificationUri} target="_blank"
                  rel="noreferrer" className="text-accent underline">
                  {deviceInfo.verificationUri}
                </a>
              </p>
              <p className="mt-1 font-mono text-lg tracking-widest">
                {deviceInfo.userCode}
              </p>
            </div>
          )}
          {oauthMsg && (
            <p className="mt-2 text-xs text-muted">{oauthMsg}</p>
          )}
        </div>
        )}

        <div className="sm:col-span-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs text-muted">
              {t("folders.title", { name: editAcct })}
            </span>
            <Button variant="ghost" className="!min-h-7 !px-2 !py-0.5 !text-xs"
              title={t("folders.discover_tip")}
              onClick={() => discoverFolders(editAcct)}>
              🔄 {t("folders.discover")}
            </Button>
          </div>
          {!folders && !foldersErr && <Loading className="!p-3" />}
          {foldersErr && (
            <div className="text-xs text-rose-400">
              {foldersErr}
              <span className="ml-1 text-muted">{t("folders.err_hint")}</span>
            </div>
          )}
          {folders && (
            <div className="rounded-md border border-line bg-panel2 p-3">
              <div className="grid gap-1 sm:grid-cols-2">
                {folders.folders
                  .filter((x) => !wildcards.some((w) =>
                    x.raw.toLowerCase().startsWith(
                      w.trim().toLowerCase().slice(0, -1))
                    || x.name.toLowerCase().startsWith(
                      w.trim().toLowerCase().slice(0, -1))))
                  .map((x) => {
                  // trash/junk/sent/drafts/all are excluded by ROLE on the
                  // backend - their checkboxes are informational only.
                  const locked = !!x.role && x.role !== "archive";
                  return (
                  <label key={x.raw}
                    className={`flex items-center gap-2 text-sm${
                      locked ? " opacity-60" : ""}`}
                    title={locked ? t("folder.role_excluded") : undefined}>
                    <input type="checkbox" checked={included.has(x.raw)}
                      disabled={locked}
                      onChange={() => {
                        const next = new Set(included);
                        next.has(x.raw) ? next.delete(x.raw)
                          : next.add(x.raw);
                        setIncluded(next);
                      }} />
                    <span className="truncate">{x.name}</span>
                    {x.role && (
                      <span className="rounded bg-chip px-1 text-[10px]
                        text-chiptext">{x.role}</span>
                    )}
                  </label>
                  );
                })}
              </div>
              {wildcards.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5
                  border-t border-line pt-2 text-xs text-muted">
                  {t("Excluded by rule:")}
                  {wildcards.map((w) => (
                    <span key={w} className="rounded bg-chip px-1.5 py-0.5
                      text-chiptext">
                      {w}{" "}
                      <button className="text-muted hover:text-body"
                        title="✕"
                        onClick={() => setWildcards(
                          wildcards.filter((x) => x !== w))}>
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        </>)}

        {tab === "general" && (<>
        <div className="sm:col-span-2">
          <Field label={`🛡️ ${t("Protected senders")}`}>
            <TextArea
              value={protectedText}
              placeholder={"boss@work.example\n@mybank.example"}
              onChange={(e) => setProtectedText(e.target.value)}
            />
          </Field>
          <p className="mt-1 text-xs text-muted">{t("protected.help")}</p>
        </div>

        <div className="sm:col-span-2">
          <Field label={t("Custom categories")}>
            <TextArea className="!min-h-16"
              value={categoriesText}
              placeholder={"insurance: allianz, huk, versicherung\nshipping: dhl, dpd"}
              onChange={(e) => setCategoriesText(e.target.value)}
            />
          </Field>
          <p className="mt-1 text-xs text-muted">{t("categories.help")}</p>
        </div>
        </>)}

        {tab === "server" && cfg.auth.is_admin && (<>
          <SectionLabel className="sm:col-span-2 mt-2">
            {t("login.section")}
          </SectionLabel>
          <p className="sm:col-span-2 -mt-2 text-xs text-muted">
            {t("login.help")}
          </p>
          <Field label={t("login.mode")}>
            <Select className="w-full" value={f.authMode}
              onChange={set("authMode")}>
              <option value="none">{t("login.mode_none")}</option>
              <option value="password">{t("login.mode_password")}</option>
              <option value="oidc">{t("login.mode_oidc")}</option>
            </Select>
          </Field>
          {f.authMode === "password" && (
            <Field label={t("login.password_label")}>
              <Input className="w-full" type="password" value={f.authPassword}
                placeholder={cfg.auth.password_set
                  ? t("(unchanged)") : t("required")}
                onChange={set("authPassword")} />
            </Field>
          )}
          {f.authMode === "oidc" && (
            <>
              <Field label={t("login.oidc_issuer")}>
                <Input className="w-full" value={f.oidcIssuer}
                  placeholder="https://id.example.com"
                  onChange={set("oidcIssuer")} />
              </Field>
              <Field label={t("login.oidc_client")}>
                <Input className="w-full" value={f.oidcClientId}
                  onChange={set("oidcClientId")} />
              </Field>
              <Field label={t("login.oidc_secret")}>
                <Input className="w-full" type="password" value={f.oidcSecret}
                  placeholder={cfg.auth.oidc?.client_secret_set
                    ? t("(unchanged)") : t("required")}
                  onChange={set("oidcSecret")} />
              </Field>
              <Field label={t("login.oidc_redirect")}>
                <Input className="w-full" value={f.oidcRedirect}
                  placeholder={t("login.oidc_redirect_ph")}
                  onChange={set("oidcRedirect")} />
              </Field>
              <Field label={t("login.oidc_admin")}>
                <Input className="w-full" value={f.oidcAdmin}
                  placeholder={t("login.oidc_admin_ph")}
                  onChange={set("oidcAdmin")} />
              </Field>
              <div className="self-end pb-2 text-xs text-muted">
                {t("login.tenancy_note")}
              </div>
              <div className="sm:col-span-2">
                <Field label={t("login.oidc_allowed")}>
                  <TextArea className="!min-h-16" value={f.oidcAllowed}
                    placeholder={"me@corp.example"}
                    onChange={(e) =>
                      setF({ ...f, oidcAllowed: e.target.value })} />
                </Field>
                <p className="mt-1 text-xs text-muted">
                  {t("login.oidc_allowed_help")}
                </p>
              </div>
            </>
          )}

          <SectionLabel className="sm:col-span-2 mt-2">
            {t("shared.section")}
          </SectionLabel>
          <p className="sm:col-span-2 -mt-2 text-xs text-muted">
            {t("shared.help")}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.sharedEnabled}
              onChange={(e) =>
                setF({ ...f, sharedEnabled: e.target.checked })} />
            {t("shared.enabled")}
          </label>
          <Field label={t("shared.budget")}>
            <Input className="w-full" type="number" step="0.5" min="0"
              value={f.sharedBudget} placeholder={t("budget.none")}
              onChange={set("sharedBudget")} />
          </Field>
          {f.sharedEnabled && (<>
            <Field label={t("Provider")}>
              <Select className="w-full" value={f.sharedProvider}
                onChange={set("sharedProvider")}>
                <option value="anthropic">Anthropic API</option>
                <option value="openai">OpenAI</option>
                <option value="foundry">Microsoft Foundry</option>
                <option value="ollama">
                  Ollama / local (OpenAI-compatible)
                </option>
              </Select>
            </Field>
            <Field label={t("Model")}>
              <Input className="w-full" value={f.sharedModel}
                onChange={set("sharedModel")} />
            </Field>
            {(f.sharedProvider === "foundry"
              || f.sharedProvider === "ollama") && (
              <div className="sm:col-span-2">
                <Field label={t("endpoint.label")}>
                  <Input className="w-full" value={f.sharedEndpoint}
                    onChange={set("sharedEndpoint")} />
                </Field>
              </div>
            )}
            <div className="sm:col-span-2">
              <Field label={t("API key")}>
                <Input className="w-full" type="password" value={f.sharedKey}
                  placeholder={cfg.shared_ai?.api_key_set
                    ? t("(unchanged)") : t("required")}
                  onChange={set("sharedKey")} />
              </Field>
            </div>
          </>)}

          <SectionLabel className="sm:col-span-2 mt-2">
            {t("usage.section")}
          </SectionLabel>
          <p className="sm:col-span-2 -mt-2 text-xs text-muted">
            {t("usage.help")}
          </p>
          <div className="min-w-0 sm:col-span-2">
            {!tenantStats && !tenantStatsErr && <Loading className="!p-3" />}
            {tenantStatsErr && (
              <div className="text-xs text-rose-400">{tenantStatsErr}</div>
            )}
            {tenantStats && (
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="w-full min-w-[560px] table-fixed text-xs">
                  <thead>
                    <tr className="border-b border-line text-left text-muted">
                      <th className="w-[26%] px-2 py-1.5 font-medium">
                        {t("usage.user")}</th>
                      <th className="w-[16%] px-2 py-1.5 font-medium">
                        {t("usage.mails")}</th>
                      <th className="w-[14%] px-2 py-1.5 font-medium">
                        {t("usage.cleaned")}</th>
                      <th className="w-[18%] px-2 py-1.5 font-medium">
                        {t("usage.ai_month")}</th>
                      <th className="w-[13%] px-2 py-1.5 font-medium">
                        {t("usage.last_scan")}</th>
                      <th className="w-[13%] px-2 py-1.5 font-medium">
                        {t("usage.disk")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenantStats.map((u) => (
                      <tr key={u.id} className="border-b border-line
                        last:border-0 align-top">
                        <td className="truncate px-2 py-1.5"
                          title={`${u.id} - ${u.accounts} account(s), ${
                            u.scans} scan(s), ${u.rules} rule(s), ${
                            u.verdicts} AI verdict(s)`}>
                          {u.is_admin_workspace ? "★ " : ""}
                          {u.label || u.id}
                        </td>
                        <td className="px-2 py-1.5">
                          {u.mails.toLocaleString()}
                          <span className="text-muted">
                            {" "}· {fmtSize(u.size)}</span>
                        </td>
                        <td className="px-2 py-1.5">
                          {u.actions_month.trash.toLocaleString()}
                          <span className="text-muted">
                            {" "}· {fmtSize(u.actions_month.freed)}</span>
                        </td>
                        <td className="px-2 py-1.5">
                          {fmtUsd(u.ai.month_cost)}
                          <span className="text-muted">
                            {u.ai.budget_usd
                              ? ` / ${fmtUsd(u.ai.budget_usd)}` : ""}
                            {u.ai.source === "shared"
                              ? ` (${t("usage.shared")})` : ""}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          {fmtAgo(u.last_scan_ts) || "-"}
                        </td>
                        <td className="px-2 py-1.5">
                          {fmtSize(u.disk_bytes)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>)}

        {tab === "ai" && (<>
        <SectionLabel className="sm:col-span-2">
          {t("AI review (optional)")}
        </SectionLabel>
        <p className="sm:col-span-2 -mt-2 text-xs text-muted">
          {t("ai.data_note")}
        </p>
        <Field label={t("Provider")}>
          <Select className="w-full" value={f.provider}
            onChange={set("provider")}>
            <option value="anthropic">Anthropic API</option>
            <option value="openai">OpenAI</option>
            <option value="foundry">Microsoft Foundry</option>
            <option value="ollama">Ollama / local (OpenAI-compatible)</option>
          </Select>
        </Field>
        <Field label={t("Model")}>
          <Input className="w-full" value={f.model} onChange={set("model")} />
        </Field>
        {(f.provider === "foundry" || f.provider === "ollama") && (
          <div className="sm:col-span-2">
            <Field label={f.provider === "foundry"
              ? "Foundry endpoint (https://…services.ai.azure.com/anthropic)"
              : `${t("endpoint.label")} (http://…:11434)`}>
              <Input className="w-full" value={f.endpoint}
                onChange={set("endpoint")} />
            </Field>
          </div>
        )}
        <div className="sm:col-span-2">
          <Field label={t("API key")}>
            <Input className="w-full" type="password" value={f.apiKey}
              placeholder={cfg.ai.api_key_set
                ? t("(unchanged)")
                : f.provider === "ollama"
                  ? t("key.optional")
                  : cfg.ai.source === "shared"
                    ? t("ai.shared_key_ph")
                    : t("(no key - AI features hidden)")}
              onChange={set("apiKey")} />
          </Field>
          {cfg.ai.source === "shared" && (
            <p className="mt-1 text-xs text-muted">
              {t("ai.shared_note", {
                cap: cfg.ai.shared_budget_usd
                  ? fmtUsd(cfg.ai.shared_budget_usd) : t("budget.none"),
              })}
            </p>
          )}
        </div>
        <Field label={`$ / 1M in (auto: ${pi})`}>
          <Input className="w-full" type="number" step="0.01" min="0"
            value={f.priceIn} placeholder={`auto: ${pi}`}
            onChange={set("priceIn")} />
        </Field>
        <Field label={`$ / 1M out (auto: ${po})`}>
          <Input className="w-full" type="number" step="0.01" min="0"
            value={f.priceOut} placeholder={`auto: ${po}`}
            onChange={set("priceOut")} />
        </Field>
        <Field label={t("budget.label")}>
          <Input className="w-full" type="number" step="0.5" min="0"
            value={f.budget} placeholder={t("budget.none")}
            onChange={set("budget")} />
        </Field>
        <div className="self-end pb-2 text-xs text-muted">
          {t("budget.month", { spent: fmtUsd(cfg.ai.month_cost ?? 0) })}
        </div>

        <div className="sm:col-span-2 flex flex-wrap items-center gap-3
          rounded-lg bg-panel2 px-4 py-3 text-xs text-muted">
          <span>
            {t("AI spend")}: <b className="text-body">{fmtUsd(s.cost)}</b>
            {" "}- {s.runs} {t("runs")}, {s.input_tokens.toLocaleString()} /{" "}
            {s.output_tokens.toLocaleString()}
          </span>
          <Button variant="ghost" className="!min-h-7 !px-2 !py-0.5 !text-xs"
            onClick={resetStats}>
            {t("Reset")}
          </Button>
          <Button variant="ghost" className="!min-h-7 !px-2 !py-0.5 !text-xs"
            onClick={clearVerdicts}>
            {t("Clear AI verdict cache")}
          </Button>
        </div>
        </>)}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line
        px-5 py-3">
        <Button onClick={() => save()}>{t("Save")}</Button>
        <a href="/api/export_config" target="_blank" rel="noopener"
          className="min-h-9 rounded-md bg-chip px-3 py-1.5 text-sm
            font-medium text-body hover:bg-chiph"
          title={t("export.tip")}>{t("Export")}</a>
        <label className="min-h-9 cursor-pointer rounded-md bg-chip px-3
          py-1.5 text-sm font-medium text-body hover:bg-chiph">
          {t("Import…")}
          <input type="file" accept="application/json" className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (!confirm(t("import.confirm"))) return;
              try {
                const body = JSON.parse(await file.text());
                const res = await fetch("/api/import_config", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                });
                if (!res.ok) throw new Error(await res.text());
                const r = await res.json();
                onSaved(await api.getConfig());
                setMsg(t("import.done", { rules: r.rules,
                  verdicts: r.verdicts }));
              } catch (err: any) {
                setMsg(`Error: ${err.message ?? err}`);
              }
            }} />
        </label>
        <span className="text-xs text-muted">{msg}</span>
      </div>
    </Modal>
  );
}
