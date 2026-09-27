import { useEffect, useState } from "react";
import { api, fmtUsd } from "../api";
import { getLang, setLang, t, type Lang } from "../i18n";
import type { Config, FoldersResp } from "../types";
import { Button, Field, Input, Loading, Modal, PanelHeader,
  SectionLabel, Select, TextArea } from "./ui";

export function SettingsModal({ cfg, onClose, onSaved }: {
  cfg: Config;
  onClose: () => void;
  onSaved: (c: Config) => void;
}) {
  const [f, setF] = useState({
    host: cfg.imap.host,
    port: String(cfg.imap.port),
    smtpPort: String(cfg.imap.smtp_port ?? 1025),
    user: cfg.imap.user,
    password: "",
    provider: cfg.ai.provider,
    endpoint: cfg.ai.foundry_endpoint,
    model: cfg.ai.model,
    apiKey: "",
    priceIn: cfg.ai.price_in ? String(cfg.ai.price_in) : "",
    priceOut: cfg.ai.price_out ? String(cfg.ai.price_out) : "",
    budget: cfg.ai.budget_usd ? String(cfg.ai.budget_usd) : "",
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
  // Folder picker: checked = scanned. Wildcard rules (e.g. Labels/*) are
  // shown as removable chips and win over checkboxes.
  const [folders, setFolders] = useState<FoldersResp | null>(null);
  const [foldersErr, setFoldersErr] = useState("");
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [wildcards, setWildcards] = useState<string[]>([]);

  useEffect(() => {
    api.folders()
      .then((r) => {
        setFolders(r);
        setWildcards(r.wildcards);
        setIncluded(new Set(
          r.folders.filter((x) => !x.excluded).map((x) => x.raw)));
      })
      .catch((e) => setFoldersErr(String(e.message ?? e)));
  }, []);

  const set = (k: keyof typeof f) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setF({ ...f, [k]: e.target.value });

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
        imap: { host: f.host, port: +f.port || 1143,
          smtp_port: +f.smtpPort || 1025, user: f.user,
          ...(f.password ? { password: f.password } : {}) },
        ...(excluded ? { excluded_folders: excluded } : {}),
        protected: protectedText.split("\n")
          .map((s) => s.trim()).filter(Boolean),
        categories: parseCategories(),
        ai: { provider: f.provider, model: f.model,
          foundry_endpoint: f.endpoint,
          price_in: +f.priceIn || 0, price_out: +f.priceOut || 0,
          budget_usd: +f.budget || 0,
          ...(f.apiKey ? { api_key: f.apiKey } : {}) },
        ...extra,
      };
      const next = await api.saveConfig(body);
      onSaved(next);
      setF({ ...f, password: "", apiKey: "",
        host: next.imap.host, port: String(next.imap.port),
        smtpPort: String(next.imap.smtp_port), user: next.imap.user });
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

  const switchProfile = async (name: string) => {
    if (name === cfg.active_profile) return;
    if (!confirm(t("confirm.switch_profile", { name }))) return;
    // Persist current fields into the old profile, then switch.
    await save({ switch_profile: name });
  };

  const newProfile = async () => {
    const name = prompt(t("Name for the new account profile:"))?.trim();
    if (!name) return;
    await save({ save_profile_as: name });
  };

  const deleteProfile = async () => {
    const name = prompt(
      `${t("Delete…")} (≠ "${cfg.active_profile}"):`)?.trim();
    if (!name || name === cfg.active_profile) return;
    onSaved(await api.saveConfig({ delete_profile: name }));
  };

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

  return (
    <Modal onClose={onClose}>
      <PanelHeader title={<>⚙ {t("Settings")}</>} onClose={onClose} />
      <div className="grid gap-4 p-5 sm:grid-cols-2">
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
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t("Account profile")}>
            <Select className="w-full" value={cfg.active_profile}
              onChange={(e) => switchProfile(e.target.value)}>
              {cfg.profiles.map((p) => <option key={p}>{p}</option>)}
            </Select>
          </Field>
          <Button variant="ghost" onClick={newProfile}>{t("New")}</Button>
          {cfg.profiles.length > 1 && (
            <Button variant="ghost" onClick={deleteProfile}>
              {t("Delete…")}
            </Button>
          )}
        </div>

        <SectionLabel className="sm:col-span-2">
          {t("IMAP (Proton Mail Bridge)")}
        </SectionLabel>
        <Field label={t("Host")}>
          <Input className="w-full" value={f.host} onChange={set("host")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("IMAP port")}>
            <Input className="w-full" type="number" value={f.port}
              onChange={set("port")} />
          </Field>
          <Field label={t("SMTP port (unsubscribe mails)")}>
            <Input className="w-full" type="number" value={f.smtpPort}
              onChange={set("smtpPort")} />
          </Field>
        </div>
        <Field label={t("User")}>
          <Input className="w-full" value={f.user} onChange={set("user")} />
        </Field>
        <Field label={t("Password")}>
          <Input className="w-full" type="password" value={f.password}
            placeholder={cfg.imap.password_set
              ? t("(unchanged)") : t("required")}
            onChange={set("password")} />
        </Field>

        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs text-muted">
            {t("Folders to scan")}
          </span>
          {!folders && !foldersErr && <Loading className="!p-3" />}
          {foldersErr && (
            <div className="text-xs text-rose-400">{foldersErr}</div>
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
                  .map((x) => (
                  <label key={x.raw}
                    className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={included.has(x.raw)}
                      onChange={() => {
                        const next = new Set(included);
                        next.has(x.raw) ? next.delete(x.raw)
                          : next.add(x.raw);
                        setIncluded(next);
                      }} />
                    <span className="truncate">{x.name}</span>
                  </label>
                ))}
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

        <SectionLabel className="sm:col-span-2 mt-2">
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
                  : t("(no key — AI features hidden)")}
              onChange={set("apiKey")} />
          </Field>
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
            {" "}— {s.runs} {t("runs")}, {s.input_tokens.toLocaleString()} /{" "}
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
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line
        px-5 py-3">
        <Button onClick={() => save()}>{t("Save")}</Button>
        <a href="/api/export_config" download
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
