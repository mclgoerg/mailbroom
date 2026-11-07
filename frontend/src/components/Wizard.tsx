import { Check, CheckCircle2, ChevronRight, Circle, Lock, Server } from
  "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api, errorText } from "../api";
import { demoHint, useDemo } from "../demoMode";
import { t } from "../i18n";
import { parseProgress } from "../lib";
import { PRESET_LABELS, PRESETS, presetLabel } from "../presets";
import type { AuthMethod, Config, FoldersResp, OauthProvider, Preset,
  Security, SmtpSecurity } from "../types";
import { FolderSettings } from "./FolderSettings";
import { Button, DemoHint, Field, Input, Modal, Notice, PanelHeader, Segmented,
  Select, Spinner, tabPanelProps } from "./ui";

/* First-run setup wizard (also "Add account"): provider -> sign in + test
 * (folders are an optional extra on that step) -> protect with a password ->
 * first scan. Everything goes through the endpoints Settings uses; the only
 * state kept here is the form. */

export type WizardStep = "provider" | "signin" | "protect" | "scan";

/** Set before the OAuth consent redirect so App can reopen the wizard on
 *  the way back (the redirect reloads the page). */
export const WIZARD_RESUME_KEY = "pmc_wizard";

const PROVIDERS = Object.keys(PRESET_LABELS) as Preset[];
const APP_PASSWORD: Preset[] = ["gmail", "icloud", "fastmail", "yahoo"];
const MIN_PASSWORD = 8;

export interface WizardScan {
  account: string; status: string; progress: string; error: string;
  scannedTs: number | null;
}

export function Wizard({ cfg, mode, initialStep, initialAccount, scan,
  previousAccount,
  onConfig, onClose }: {
  cfg: Config;
  /** `first`: edits the (empty) default account; `add`: a new account that
   *  only comes into being when its sign-in is tested. */
  mode: "first" | "add";
  initialStep?: WizardStep;
  /** An account of this wizard session that exists already (OAuth return). */
  initialAccount?: string;
  /** The scan state of the ACTIVE account, which is the wizard's account
   *  once it exists. */
  scan: WizardScan;
  /** Add mode: the account that was active when the wizard opened - where
   *  Cancel goes back to after removing a half-created account. */
  previousAccount?: string;
  /** The config changed; `switchTo` names an account to activate. */
  onConfig: (c: Config, switchTo: string | null) => void;
  onClose: () => void;
}) {
  const demo = useDemo();
  const existing = initialAccount && cfg.accounts[initialAccount]
    ? initialAccount : null;
  // The account the wizard works on: the default one on first run, else the
  // one created at the first test (null until then).
  const [acct, setAcct] = useState<string | null>(
    existing ?? (mode === "first" ? cfg.default_account : null));
  const created = useRef<string | null>(
    mode === "add" ? existing : null);
  const [tested, setTested] = useState(false);
  // The sign-in as it stands has passed its test (editing the form resets it);
  // `tested` only says that an account of this session was ever signed in.
  const [passed, setPassed] = useState(false);
  const [connected, setConnected] = useState(0);   // folders seen by the test
  // Decided once: setting the password flips `cfg.auth.mode` mid-wizard,
  // which must not change the step count.
  const [protectApplies] = useState(() => mode === "first"
    && cfg.auth.mode === "none" && !!cfg.auth.is_admin);
  const steps: WizardStep[] = ["provider", "signin",
    ...(protectApplies ? ["protect" as const] : []), "scan"];
  const [step, setStep] = useState<WizardStep>(initialStep
    ?? (existing ? "signin" : "provider"));
  const at = steps.indexOf(step);

  // ---- sign-in form
  const im = existing ? cfg.accounts[existing] : null;
  const [preset, setPreset] = useState<Preset>(
    (im?.preset ?? "proton") as Preset);
  const [f, setF] = useState(() => formFor(
    (im?.preset ?? "proton") as Preset, im));
  const set = (k: keyof typeof f) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setPassed(false);
      setF({ ...f, [k]: e.target.value });
    };
  const choosePreset = (p: Preset) => {
    setPreset(p);
    setPassed(false);
    setF(formFor(p, null));
    setStep("signin");
  };
  const saved = acct ? cfg.accounts[acct] : null;
  const oauthProvider: "" | OauthProvider = preset === "outlook"
    ? "microsoft" : f.auth === "oauth" && preset === "gmail" ? "google" : "";
  const method: AuthMethod = oauthProvider ? "oauth" : "password";
  const oauthConnected = !!saved?.oauth?.connected && saved.auth === "oauth";
  const hasPassword = !!f.password || !!saved?.password_set;
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const accountName = (): string => {
    if (acct) return acct;
    const base = f.user.trim() || t("wizard.new_name");
    let name = base, n = 2;
    while (Object.hasOwn(cfg.accounts, name)) name = `${base} ${n++}`;
    return name;
  };

  /** Save the sign-in (creating the account in add mode) and return its
   *  name; null on failure (error shown). */
  const saveSignIn = async (): Promise<string | null> => {
    const name = accountName();
    const create = !acct;
    const next = await api.saveConfig({
      ...(create ? { add_account: name } : {}),
      account: name,
      imap: { host: f.host.trim(), port: +f.port || 993,
        security: f.security, smtp_host: f.smtpHost.trim(),
        smtp_port: +f.smtpPort || 465, smtp_security: f.smtpSecurity,
        cafile: f.cafile.trim(), preset, user: f.user.trim(), auth: method,
        // Google shows an app password as 4 groups of 4 letters
        ...(f.password ? { password: preset === "gmail"
          ? f.password.replace(/\s+/g, "") : f.password } : {}),
        ...(oauthProvider ? { oauth: { provider: oauthProvider,
          client_id: f.clientId,
          ...(f.clientSecret ? { client_secret: f.clientSecret } : {}) } }
          : {}) },
    });
    if (create) {
      created.current = name;
      setAcct(name);
    }
    onConfig(next, create ? name : null);
    return name;
  };

  // the running connection test, which Cancel / X / Esc walk away from
  // (the server's attempt ends by itself; its answer is never used)
  const testCtl = useRef<AbortController | null>(null);
  const [testing, setTesting] = useState(false);
  const stopTest = () => testCtl.current?.abort();
  useEffect(() => () => testCtl.current?.abort(), []);

  const test = async () => {
    setErr("");
    setBusy(t("wizard.testing"));
    const ctl = new AbortController();
    try {
      const name = await saveSignIn();
      if (!name) return;
      testCtl.current = ctl;
      setTesting(true);
      const r = await api.testConnection(name, ctl.signal);
      if (ctl.signal.aborted) return;
      // the account now counts as set up: pick that up for the home card
      let fresh: Config | null = null;
      try { fresh = await api.getConfig(); } catch { /* next load */ }
      if (ctl.signal.aborted) return;      // closed while that was loading
      if (fresh) onConfig(fresh, null);
      setTested(true);
      setPassed(true);
      setConnected(r.folders);
      // a new test starts the optional folder choice afresh
      setFoldersOpen(false);
      setFolders(null);
    } catch (e: any) {
      if (!ctl.signal.aborted) setErr(String(e.message ?? e));
    } finally {
      testCtl.current = null;
      setTesting(false);
      setBusy("");
    }
  };

  // ---- OAuth (consent redirect, or Microsoft's device code)
  const [device, setDevice] = useState<{ userCode: string;
    verificationUri: string; deviceCode: string; interval: number } | null>(
    null);
  const connectOauth = async () => {
    setErr("");
    setBusy(t("wizard.working"));
    try {
      const name = await saveSignIn();
      if (!name) return;
      sessionStorage.setItem(WIZARD_RESUME_KEY,
        JSON.stringify({ mode, account: name }));
      window.location.href = `/api/oauth/imap/login?account=`
        + `${encodeURIComponent(name)}&provider=${oauthProvider}`;
    } catch (e: any) {
      setErr(String(e.message ?? e));
      setBusy("");
    }
  };
  const startDevice = async () => {
    setErr("");
    setBusy(t("wizard.working"));
    try {
      const name = await saveSignIn();
      if (!name) return;
      const r = await api.oauthDeviceStart(name);
      setDevice({ userCode: r.user_code,
        verificationUri: r.verification_uri, deviceCode: r.device_code,
        interval: r.interval || 5 });
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy("");
    }
  };
  useEffect(() => {
    if (!device || !acct) return;
    const id = setInterval(async () => {
      try {
        const r = await api.oauthDevicePoll(acct, device.deviceCode);
        if (r.status === "complete") {
          clearInterval(id);
          setDevice(null);
          onConfig(await api.getConfig(), null);
        } else if (r.status === "error") {
          clearInterval(id);
          setDevice(null);
          setErr(errorText(r.error ?? ""));
        }
      } catch { /* transient - keep polling until the code expires */ }
    }, device.interval * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.deviceCode]);

  // ---- folders
  const [folders, setFolders] = useState<FoldersResp | null>(null);
  const [foldersErr, setFoldersErr] = useState("");
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [wildcards, setWildcards] = useState<string[]>([]);
  const loadFolders = (merge = false) => {
    if (!acct) return;
    setFoldersErr("");
    if (!merge) setFolders(null);
    api.folders(acct).then((r) => {
      setFolders(r);
      if (!merge) setWildcards(r.wildcards);
      // a reload keeps the ticks of folders already listed
      const known = new Set(folders?.folders.map((x) => x.raw));
      setIncluded((prev) => new Set(r.folders
        .filter((x) => merge && known.has(x.raw)
          ? prev.has(x.raw) : !x.excluded)
        .map((x) => x.raw)));
    }).catch((e) => setFoldersErr(String(e.message ?? e)));
  };
  const [foldersOpen, setFoldersOpen] = useState(false);
  useEffect(() => {
    if (foldersOpen) loadFolders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foldersOpen, acct]);
  const saveFolders = async () => {
    if (!acct || !folders) return true;
    const explicit = folders.folders.filter((x) => !included.has(x.raw))
      .map((x) => x.raw);
    setBusy(t("wizard.working"));
    try {
      onConfig(await api.saveConfig({ account: acct,
        excluded_folders: [...wildcards, ...explicit] }), null);
      return true;
    } catch (e: any) {
      setErr(String(e.message ?? e));
      return false;
    } finally {
      setBusy("");
    }
  };

  // ---- protect with a password
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const pwError = pw1 && pw1.length < MIN_PASSWORD ? t("wizard.pw_short")
    : pw2 && pw1 !== pw2 ? t("wizard.pw_mismatch") : "";
  const savePassword = async () => {
    setErr("");
    setBusy(t("wizard.pw_set"));
    try {
      await api.saveConfig({ auth: { mode: "password", password: pw1 } });
      await api.login(pw1);              // so the session carries on
      onConfig(await api.getConfig(), null);
      setStep("scan");
    } catch (e: any) {
      setErr(String(e.message ?? e));
    } finally {
      setBusy("");
    }
  };

  // ---- first scan
  const started = useRef(false);
  const [scanErr, setScanErr] = useState("");
  const startScan = async () => {
    if (!acct) return;
    setScanErr("");
    try {
      await api.scan(acct);
    } catch (e: any) {
      if (e.code !== "busy_scan") setScanErr(String(e.message ?? e));
    }
  };
  useEffect(() => {
    if (step !== "scan" || started.current) return;
    started.current = true;
    startScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  const mine = scan.account === acct;
  const prog = mine && scan.status === "scanning"
    ? parseProgress(scan.progress) : null;
  const scanDone = mine && scan.status === "done";
  const scanFailed = scanErr || (mine && scan.status === "error"
    ? errorText(scan.error) : "");

  // ---- leaving
  const close = async () => {
    if (testCtl.current) testCtl.current.abort();   // leave the test behind
    else if (busy) return;          // a save is in flight: not now
    // add mode: an account this session created but never got to sign in
    // goes away again (only that one, never a pre-existing account)
    if (mode === "add" && created.current && !tested) {
      try {
        onConfig(await api.saveConfig(
          { delete_account: created.current }), previousAccount ?? null);
      } catch { /* leave it; Settings can delete it */ }
    }
    sessionStorage.removeItem(WIZARD_RESUME_KEY);
    onClose();
  };
  const go = (to: WizardStep) => { setErr(""); setStep(to); };
  const next = () => go(steps[at + 1]);
  const back = () => go(steps[at - 1]);

  const stepLabel: Record<WizardStep, string> = {
    provider: t("wizard.s_provider"), signin: t("wizard.s_signin"),
    protect: t("wizard.s_protect"), scan: t("wizard.s_scan") };
  // Continue on the sign-in step: the folder choice is optional; only when
  // it was opened is it saved (untouched, that equals the defaults).
  const cont = async () => {
    if (foldersOpen && folders && !(await saveFolders())) return;
    next();
  };
  const needOauth = method === "oauth" && !oauthConnected;
  const canTest = !busy && !!f.host.trim() && !!f.user.trim()
    && (method === "oauth" ? oauthConnected : hasPassword);

  const footer = (...buttons: React.ReactNode[]) => (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t
      border-line px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]
      sm:px-5">{buttons}</div>
  );
  const titleId = "wizard-title";

  return (
    <Modal full size="md" onClose={close} labelledBy={titleId}>
      <PanelHeader
        title={<span id={titleId}>{t("wizard.title")}</span>}
        closeLabel={mode === "first" ? t("wizard.later") : t("wizard.cancel")}
        onClose={close} />
      <div className="flex-1 overflow-y-auto p-4 sm:p-5">
        <ol aria-label={t("wizard.steps")}
          className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1
            type-meta text-muted">
          {steps.map((s, i) => (
            <li key={s} aria-current={s === step ? "step" : undefined}
              className={`flex items-center gap-2
                ${s === step ? "font-medium text-body" : ""}`}>
              <span aria-hidden="true" className={`grid size-5 shrink-0
                place-items-center rounded-full type-caption font-semibold
                ${s === step ? "bg-accent text-on-accent"
                : i < at ? "bg-accent-tint text-accent" : "bg-chip"}`}>
                {i < at ? <Check size={14} /> : i + 1}</span>
              {stepLabel[s]}
            </li>
          ))}
        </ol>
        {step === "provider" && (<>
          <h2 className="type-title2">{t("wizard.provider_title")}</h2>
          <p className="mb-4 mt-1 type-body text-muted">
            {t("wizard.provider_help")}</p>
          <div className="grid grid-cols-2 gap-2">
            {PROVIDERS.filter((p) => p !== "custom").map((p) => (
              <ProviderTile key={p} label={presetLabel(p)}
                hint={APP_PASSWORD.includes(p) ? t("wizard.pw_app") : ""}
                onClick={() => choosePreset(p)} />
            ))}
          </div>
          <button type="button" onClick={() => choosePreset("custom")}
            aria-label={t("wizard.imap_other")}
            aria-describedby="wizard-other-hint"
            className="mt-2 flex min-h-11 w-full items-center gap-3
              rounded-card border border-line bg-panel2 px-3 py-2 text-left
              hover:bg-chip focus-visible:outline-offset-2">
            <span aria-hidden="true" className="grid size-9 shrink-0
              place-items-center rounded-control bg-chip text-muted">
              <Server size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="block type-body font-medium">
                {t("wizard.imap_other")}</span>
              <span id="wizard-other-hint"
                className="block type-meta text-muted">
                {t("wizard.imap_other_hint")}</span>
            </span>
            <ChevronRight size={16} aria-hidden="true"
              className="shrink-0 text-faint" />
          </button>
        </>)}

        {step === "signin" && (
          <div className="grid gap-3">
            <div className="type-heading">{presetLabel(preset)}</div>
            <p className="type-meta text-muted">{hint(preset, cfg)}</p>
            {cfg.secret_key_set === false && <Notice tone="warn">
              {t("secrets.plaintext_warning")}
            </Notice>}
            {preset === "proton" && (
              <p className="type-meta text-muted">{t("wizard.proton_cert")}</p>
            )}
            {preset === "gmail" && (
              <Segmented fill idPrefix="wizard-signin"
                label={t("signin.label")} value={method}
                onChange={(v) => { setPassed(false); setF({ ...f, auth: v }); }}
                options={[
                  { value: "password", label: t("signin.password") },
                  { value: "oauth", label: t("signin.oauth") }]} />
            )}
            <div {...(preset === "gmail"
              ? tabPanelProps("wizard-signin", method) : {})}
              className="grid gap-3">
              <Field label={t("wizard.email")}>
                <Input className="w-full" type="email" autoComplete="off"
                  value={f.user} onChange={set("user")} />
              </Field>
              {method === "password" && (<>
                <Field label={preset === "proton" ? t("wizard.pw_bridge")
                  : APP_PASSWORD.includes(preset) ? t("wizard.pw_app")
                  : t("wizard.pw_plain")}>
                  <Input className="w-full" type="password"
                    autoComplete="new-password" value={f.password}
                    placeholder={saved?.password_set ? t("(unchanged)") : ""}
                    onChange={set("password")} />
                </Field>
                {preset === "gmail" && (
                  <p className="type-meta text-muted">
                    {t("signin.gmail_apppw_help")}</p>
                )}
              </>)}
              {method === "oauth" && oauthBlock()}
            </div>
            <details open={preset === "custom"}>
              <summary className="cursor-pointer type-meta text-muted">
                {t("wizard.advanced")}</summary>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <Field label={t("Host")}>
                  <Input className="w-full" value={f.host}
                    onChange={set("host")} />
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
                {(preset === "proton" || preset === "custom") && (
                  <div className="sm:col-span-2">
                    <Field label={t("cafile.label")}>
                      <Input className="w-full" value={f.cafile}
                        placeholder={preset === "proton" ? "/certs/bridge-cert.pem" : ""}
                        onChange={set("cafile")} />
                    </Field>
                  </div>
                )}
              </div>
            </details>
            {busy && <Busy label={busy} />}
            {testing && (
              <Button variant="secondary" onClick={stopTest}>
                {t("wizard.test_cancel")}</Button>
            )}
            {err && <Notice tone="danger">{err}</Notice>}
            {passed && (
              <div className="grid gap-2 border-t border-line pt-3">
                {connected > 0 && (
                  <p className="inline-flex items-center gap-1.5 type-body
                    text-safe-fg"><Check size={16} />
                    {t("wizard.test_ok", { n: connected })}</p>
                )}
                <Button variant="secondary" className="justify-self-start"
                  aria-expanded={foldersOpen} disabled={!!busy}
                  onClick={() => setFoldersOpen((o) => !o)}>
                  {t("wizard.folders_choose")}</Button>
                {foldersOpen && (<>
                  <p className="type-meta text-muted">
                    {t("wizard.folders_help")}</p>
                  {!folders && !foldersErr && <Busy label={t("loading…")} />}
                  {foldersErr && (
                    <Notice tone="danger">
                      {foldersErr}{" "}
                      <button className="underline"
                        onClick={() => loadFolders()}>
                        {t("folders.discover")}</button>
                    </Notice>
                  )}
                  {folders && (
                    <FolderSettings account={acct!} data={folders}
                      included={included} setIncluded={setIncluded} simple
                      wildcards={wildcards} setWildcards={setWildcards}
                      reload={() => loadFolders(true)} />
                  )}
                </>)}
              </div>
            )}
            {needOauth && !err && (
              <p className="type-meta text-muted">{t("wizard.oauth_needed")}</p>
            )}
            <DemoHint />
          </div>
        )}

        {step === "protect" && (
          <div className="grid gap-3">
            <div className="type-heading">{t("wizard.protect_title")}</div>
            <p className="type-body text-muted">{t("wizard.protect_help")}</p>
            <Field label={t("wizard.pw_new")}>
              <Input className="w-full" type="password"
                autoComplete="new-password" value={pw1}
                onChange={(e) => setPw1(e.target.value)} />
            </Field>
            <Field label={t("wizard.pw_repeat")}>
              <Input className="w-full" type="password"
                autoComplete="new-password" value={pw2}
                onChange={(e) => setPw2(e.target.value)} />
            </Field>
            {pwError && <p className="type-meta text-danger-fg">{pwError}</p>}
            {busy && <Busy label={busy} />}
            {err && <Notice tone="danger">{err}</Notice>}
          </div>
        )}

        {step === "scan" && (
          <div className="grid justify-items-center gap-4 text-center">
            {!scanFailed && <ScanRing
              frac={scanDone ? 1 : prog ? prog.done / prog.total : null}
              label={t("wizard.scan_title")}>
              {scanDone ? <Check size={18} aria-hidden="true"
                className="size-10 text-safe-fg" /> : prog && (<>
                <span className="type-largetitle">
                  {Math.round(prog.done / prog.total * 100)}%</span>
                <span className="type-meta text-muted">
                  {t("wizard.scan_of", { done: prog.done.toLocaleString(),
                    total: prog.total.toLocaleString() })}</span>
              </>)}
            </ScanRing>}
            <h2 className="type-title2">{scanDone ? t("wizard.scan_title_done")
              : t("wizard.scan_title")}</h2>
            {scanFailed ? (
              <Notice tone="danger" className="w-full text-left">
                <div className="font-medium">{t("wizard.scan_failed")}</div>
                {scanFailed}
              </Notice>
            ) : (<>
              <p className="type-body text-muted">
                {scanDone ? t("wizard.scan_done") : t("wizard.scan_headers")}
              </p>
              <ul className="w-full overflow-hidden rounded-card bg-panel2
                text-left">
                <ScanStep done label={t("wizard.ck_connected",
                  { name: preset === "custom" ? f.host : presetLabel(preset) })} />
                <ScanStep done label={connected > 0
                  ? t("wizard.ck_folders", { n: connected })
                  : t("wizard.ck_folders_ready")} />
                <ScanStep done={scanDone} label={scanDone
                  ? t("wizard.ck_grouped") : t("wizard.ck_grouping")} />
              </ul>
              {!scanDone && <p className="type-meta text-muted">
                {t("wizard.scan_close")}</p>}
              <p className="type-meta text-muted">{t("wizard.ai_note")}</p>
            </>)}
          </div>
        )}
      </div>

      {step === "provider" && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line
          px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          <p className="mr-auto inline-flex items-center gap-1.5 type-meta
            text-muted"><Lock size={14} aria-hidden="true" />
            {t("wizard.stays_here")}</p>
          <Button variant="secondary" onClick={close}>
            {mode === "first" ? t("wizard.later") : t("wizard.cancel")}
          </Button>
        </div>)}
      {step === "signin" && footer(
        <Button variant="secondary" onClick={back} disabled={!!busy}>
          {t("wizard.back")}</Button>,
        <Button variant={passed ? "secondary" : "primary"} onClick={test}
          disabled={demo || !canTest}
          title={demo ? demoHint() : undefined}>{t("wizard.test")}</Button>,
        passed && <Button key="cont" onClick={cont} disabled={!!busy}>
          {t("wizard.next")}</Button>)}
      {step === "protect" && footer(
        <Button variant="secondary" onClick={back} disabled={!!busy}>
          {t("wizard.back")}</Button>,
        <Button variant="secondary" onClick={next} disabled={!!busy}>
          {t("wizard.skip")}</Button>,
        <Button onClick={savePassword}
          disabled={!!busy || !pw1 || !!pwError || pw1 !== pw2}>
          {t("wizard.pw_set")}</Button>)}
      {step === "scan" && footer(
        scanFailed ? (<>
          <Button variant="secondary" onClick={() => go("signin")}>
            {t("wizard.back")}</Button>
          <Button onClick={startScan}>{t("wizard.scan_again")}</Button>
        </>) : scanDone ? (
          <Button onClick={close}>{t("wizard.finish")}</Button>
        ) : (
          <Button variant="secondary" onClick={close}>
            {t("wizard.scan_bg")}</Button>))}
    </Modal>
  );

  function oauthBlock() {
    const device_ok = oauthProvider === "microsoft"
      && cfg.oauth_ms_device_available;
    return (
      <div className="grid gap-2 rounded-card border border-line bg-panel2 p-3">
        <p className="type-meta text-muted">
          {oauthProvider === "google" ? t("oauth.google_help")
            : device_ok ? t("oauth.ms_device_help") : t("oauth.ms_byo_help")}
        </p>
        {!device_ok && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={t("oauth.client_id")}>
              <Input className="w-full" value={f.clientId}
                onChange={set("clientId")} />
            </Field>
            <Field label={t("oauth.client_secret")}>
              <Input className="w-full" type="password" value={f.clientSecret}
                placeholder={saved?.oauth?.client_secret_set
                  ? t("(unchanged)")
                  : t(oauthProvider === "microsoft" ? "optional" : "required")}
                onChange={set("clientSecret")} />
            </Field>
          </div>
        )}
        {oauthConnected ? (
          <span className="inline-flex items-center gap-1.5 type-body
            text-safe-fg"><Check size={16} /> {t("oauth.connected")}</span>
        ) : (
          <div>
            <Button onClick={device_ok ? startDevice : connectOauth}
              disabled={demo || !f.user.trim()
                || (!device_ok && !f.clientId)}>
              {device_ok ? t("oauth.connect_device") : t("oauth.connect")}
            </Button>
            <DemoHint className="mt-1" />
          </div>
        )}
        {device && (
          <div className="rounded-card border border-line bg-panel p-3
            type-body">
            <p>{t("oauth.device_instructions")}</p>
            <p className="mt-1">
              <a href={device.verificationUri} target="_blank"
                rel="noreferrer" className="underline">
                {device.verificationUri}</a>
              {" "}<code className="font-mono">{device.userCode}</code>
            </p>
          </div>
        )}
      </div>
    );
  }
}

/** A provider on the first step: neutral monogram square, name, and a hint
 *  only where we know one (the hint describes the button, it is not its name). */
function ProviderTile({ label, hint, onClick }: {
  label: string; hint: string; onClick: () => void;
}) {
  const id = useId();
  return (
    <button type="button" onClick={onClick}
      aria-label={label} aria-describedby={hint ? id : undefined}
      className="flex min-h-11 items-center gap-3 rounded-card border
        border-line bg-panel2 px-3 py-2 text-left hover:bg-chip
        focus-visible:outline-offset-2">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center
        rounded-control bg-chip type-body font-semibold text-muted">
        {label.charAt(0).toUpperCase()}</span>
      <span className="min-w-0">
        <span className="block type-body font-medium">{label}</span>
        {hint && <span id={id} className="block type-meta text-muted">
          {hint}</span>}
      </span>
    </button>
  );
}

/** The first-scan progress ring: determinate for a fraction, else a short
 *  arc turning (static under reduced motion). `children` sit in its centre. */
function ScanRing({ frac, label, children }: {
  frac: number | null; label: string; children?: React.ReactNode;
}) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const arc = (f: number) => `${C * f} ${C}`;
  const props = { viewBox: "0 0 120 120", fill: "none", strokeWidth: 8,
    className: "absolute inset-0 size-full" } as const;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={frac == null ? undefined : Math.round(frac * 100)}
      className="relative grid size-40 place-items-center">
      <svg {...props} aria-hidden="true">
        <circle cx="60" cy="60" r={R} className="stroke-chip" />
      </svg>
      <svg {...props} aria-hidden="true" className={`absolute inset-0 size-full
        -rotate-90 ${frac == null ? "animate-spin motion-reduce:animate-none"
        : ""}`}>
        <circle cx="60" cy="60" r={R} strokeLinecap="round"
          className="stroke-accent"
          strokeDasharray={arc(frac ?? 0.25)} />
      </svg>
      <div className="relative grid justify-items-center">{children}</div>
    </div>
  );
}

/** One line of the first-scan checklist. */
const ScanStep = ({ done, label }: { done?: boolean; label: string }) => (
  <li className="flex items-center gap-3 px-3 py-2.5 type-body
    not-first:border-t not-first:border-line">
    {done ? <CheckCircle2 size={18} aria-hidden="true"
        className="shrink-0 text-safe-fg" />
      : <Circle size={18} aria-hidden="true"
        className="shrink-0 text-faint" />}
    {label}
  </li>
);

const Busy = ({ label }: { label: string }) => (
  <p className="inline-flex items-center gap-2 type-meta text-muted">
    <Spinner /> {label}</p>
);

/** The first-run form for a provider (prefilled from its preset, or from an
 *  account that exists already). */
function formFor(p: Preset, im: Config["accounts"][string] | null) {
  const pre = p === "custom" ? null : PRESETS[p];
  return {
    host: im?.host ?? pre?.host ?? "",
    port: String(im?.port ?? pre?.port ?? 993),
    security: (im?.security ?? pre?.security ?? "ssl") as Security,
    smtpHost: im?.smtp_host ?? pre?.smtpHost ?? "",
    smtpPort: String(im?.smtp_port ?? pre?.smtpPort ?? 465),
    smtpSecurity: (im?.smtp_security ?? pre?.smtpSecurity ?? "auto") as
      SmtpSecurity,
    // Proton's certificate path belongs to Proton only
    cafile: im?.cafile ?? pre?.cafile ?? "",
    user: im?.user ?? "",
    password: "",
    auth: (im?.auth ?? (p === "outlook" ? "oauth" : "password")) as
      AuthMethod,
    clientId: im?.oauth?.client_id ?? "",
    clientSecret: "",
  };
}

const hint = (p: Preset, cfg: Config): string => {
  if (p === "custom") return t("wizard.custom_help");
  if (p === "outlook") return t(cfg.oauth_ms_device_available
    ? "preset.hint.oauth_outlook_device" : "preset.hint.oauth_outlook_byo");
  const k = PRESETS[p].hint;
  return k ? t(k) : "";
};
