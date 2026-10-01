import { useMemo, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { matchGroup, parseFilter } from "../lib";
import type { AppState, Grouping, Rule } from "../types";
import { QueryBuilder } from "./QueryBuilder";
import { Button, EmptyState, Input, Modal, PanelHeader, SectionLabel,
  Select, Spinner, Tag } from "./ui";

const EMPTY = {
  name: "", grouping: "sender" as Grouping, query: "", action: "trash",
  dest: "", schedule: "manual" as Rule["schedule"],
  retention: "none" as "none" | "keep_latest" | "older_than_days",
  retentionN: "",
};

function RunSummary({ rule }: { rule: Rule }) {
  const r = rule.last_run;
  if (!r) return <span className="text-faint">{t("rule.never_ran")}</span>;
  if (r.error) return <span className="text-rose-400">{r.error}</span>;
  return (
    <>
      {new Date(r.ts * 1000).toLocaleString()} -{" "}
      {t(r.mode === "execute" ? "rule.run_executed" : "rule.run_report", {
        groups: r.groups, mails: r.mails, acted: r.acted })}
      {r.capped > 0 && <> · {t("rule.capped", { n: r.capped })}</>}
      {r.skipped_protected > 0 &&
        <> · 🛡️ {t("rule.protected_skipped", { n: r.skipped_protected })}</>}
      {r.preview.length > 0 && (
        <span className="block text-faint">
          {r.preview.map((p) => `${p.label} (${p.count})`).join(" · ")}
        </span>
      )}
    </>
  );
}

export function RulesModal({ state, onClose, onChanged }: {
  state: AppState;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [form, setForm] = useState({ ...EMPTY });
  const [editId, setEditId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState("");
  const [msg, setMsg] = useState("");

  const rules = state.rules ?? [];

  // Live match count against the current scan, using the SAME filter code
  // the group list uses (the backend port mirrors it).
  const matchCount = useMemo(() => {
    const groups = Object.values(state.groups?.[form.grouping] ?? {});
    if (!groups.length) return null;
    const f = parseFilter(form.query);
    const hits = groups.filter((g) => matchGroup(g, f) && !g.protected);
    return { groups: hits.length,
             mails: hits.reduce((n, g) => n + g.count, 0) };
  }, [state, form.grouping, form.query]);

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    setMsg("");
    const { retention, retentionN, ...rest } = form;
    const n = Number(retentionN);
    const body = {
      ...rest,
      keep_latest: retention === "keep_latest" && n > 0 ? n : null,
      older_than_days: retention === "older_than_days" && n > 0 ? n : null,
    };
    try {
      if (editId) await api.updateRule(editId, body);
      else await api.createRule(body);
      setForm({ ...EMPTY });
      setEditId(null);
      onChanged();
    } catch (e: any) {
      setMsg(`Error: ${e.message ?? e}`);
    }
  };

  const run = async (rule: Rule) => {
    if (rule.mode === "execute"
        && !confirm(t("rule.confirm_execute", { name: rule.name }))) return;
    setBusyId(rule.id);
    setMsg("");
    try {
      await api.runRule(rule.id);
      onChanged();
    } catch (e: any) {
      setMsg(`Error: ${e.message ?? e}`);
    }
    setBusyId("");
  };

  const toggleMode = async (rule: Rule) => {
    const mode = rule.mode === "report" ? "execute" : "report";
    if (mode === "execute"
        && !confirm(t("rule.confirm_enable", { name: rule.name }))) return;
    setMsg("");
    try {
      await api.updateRule(rule.id, { mode });
      onChanged();
    } catch (e: any) {
      setMsg(`Error: ${e.message ?? e}`);
    }
  };

  const del = async (rule: Rule) => {
    if (!confirm(t("rule.confirm_delete", { name: rule.name }))) return;
    try {
      await api.deleteRule(rule.id);
      if (editId === rule.id) { setEditId(null); setForm({ ...EMPTY }); }
      onChanged();
    } catch (e: any) {
      setMsg(`Error: ${e.message ?? e}`);
    }
  };

  const edit = (rule: Rule) => {
    setEditId(rule.id);
    setForm({ name: rule.name, grouping: rule.grouping, query: rule.query,
      action: rule.action, dest: rule.dest, schedule: rule.schedule,
      retention: rule.keep_latest != null ? "keep_latest"
        : rule.older_than_days != null ? "older_than_days" : "none",
      retentionN: String(rule.keep_latest ?? rule.older_than_days ?? "") });
  };

  return (
    <Modal onClose={onClose}>
      <PanelHeader title={<>📋 {t("Rules")}</>} onClose={onClose} />
      <div className="space-y-4 p-5">
        <p className="text-xs text-muted">{t("rules.help")}</p>

        {rules.map((rule) => (
          <div key={rule.id}
            className="rounded-lg border border-line bg-panel2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{rule.name}</span>
              <Tag>{t(rule.grouping === "sender" ? "Sender"
                : rule.grouping === "domain" ? "Domain" : "Subject")}</Tag>
              <Tag>{t(`action.${rule.action}`)}
                {rule.dest ? ` → ${rule.dest}` : ""}</Tag>
              <Tag>{t(`sched.${rule.schedule}`)}</Tag>
              {rule.keep_latest != null && (
                <Tag>{t("retention.tag_keep_latest", { n: rule.keep_latest })}</Tag>
              )}
              {rule.older_than_days != null && (
                <Tag>{t("retention.tag_older_than_days",
                  { n: rule.older_than_days })}</Tag>
              )}
              <Tag className={rule.mode === "execute"
                ? "!bg-rose-950 !text-rose-300"
                : "!bg-emerald-950 !text-emerald-300"}>
                {t(`mode.${rule.mode}`)}
              </Tag>
            </div>
            {rule.query && (
              <code className="mt-1 block text-xs text-chiptext">
                {rule.query}
              </code>
            )}
            <div className="mt-1 text-xs text-muted">
              <RunSummary rule={rule} />
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="ghost" className="!min-h-7 !px-2 !text-xs"
                onClick={() => run(rule)} disabled={busyId === rule.id}>
                {busyId === rule.id ? <Spinner /> : t("rule.run_now")}
              </Button>
              <Button variant={rule.mode === "report" ? "danger" : "ghost"}
                className="!min-h-7 !px-2 !text-xs"
                disabled={rule.mode === "report" && rule.report_runs < 1}
                title={rule.mode === "report" && rule.report_runs < 1
                  ? t("rule.need_report") : ""}
                onClick={() => toggleMode(rule)}>
                {rule.mode === "report"
                  ? t("rule.enable_execute") : t("rule.back_to_report")}
              </Button>
              <Button variant="ghost" className="!min-h-7 !px-2 !text-xs"
                onClick={() => edit(rule)}>{t("Edit")}</Button>
              <Button variant="ghost" className="!min-h-7 !px-2 !text-xs"
                onClick={() => del(rule)}>{t("Delete")}</Button>
            </div>
          </div>
        ))}
        {!rules.length && <EmptyState>{t("rules.empty")}</EmptyState>}

        <div className="rounded-lg border border-line p-3">
          <SectionLabel className="mb-2">
            {editId ? t("rule.edit_title") : t("rule.new_title")}
          </SectionLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input className="w-full" placeholder={t("rule.name")}
              value={form.name} onChange={set("name")} />
            <Select className="w-full" value={form.grouping}
              onChange={set("grouping")}>
              <option value="sender">{t("Sender")}</option>
              <option value="domain">{t("Domain")}</option>
              <option value="subject">{t("Subject")}</option>
            </Select>
            <div className="sm:col-span-2">
              <div className="relative flex flex-wrap items-center gap-2">
                <Input className="min-w-0 flex-1"
                  placeholder="tag:shipping age:>1y is:noreply-ever …"
                  value={form.query} onChange={set("query")} />
                <QueryBuilder value={form.query}
                  onChange={(q) => setForm({ ...form, query: q })} />
              </div>
              <div className="mt-1 text-xs text-muted">
                {matchCount
                  ? t("rule.match_count", matchCount)
                  : t("rule.match_unknown")}
              </div>
            </div>
            <Select className="w-full" value={form.action}
              onChange={set("action")}>
              <option value="trash">{t("action.trash")}</option>
              <option value="archive">{t("action.archive")}</option>
              <option value="move">{t("action.move")}</option>
              <option value="mark_read">{t("action.mark_read")}</option>
            </Select>
            <Select className="w-full" value={form.schedule}
              onChange={set("schedule")}>
              <option value="manual">{t("sched.manual")}</option>
              <option value="daily">{t("sched.daily")}</option>
              <option value="weekly">{t("sched.weekly")}</option>
            </Select>
            <Select className="w-full" value={form.retention}
              onChange={set("retention")}>
              <option value="none">{t("retention.none")}</option>
              <option value="keep_latest">{t("retention.keep_latest")}</option>
              <option value="older_than_days">
                {t("retention.older_than_days")}
              </option>
            </Select>
            {form.retention !== "none" && (
              <Input className="w-full" type="number" min={1}
                placeholder={t("retention.n_placeholder")}
                value={form.retentionN} onChange={set("retentionN")} />
            )}
            {form.action === "move" && (
              <Select className="w-full sm:col-span-2" value={form.dest}
                onChange={set("dest")}>
                <option value="">{t("Move to folder…")}</option>
                {(state.folders_raw ?? []).map((f, i) => (
                  <option key={f} value={f}>{state.folders[i] ?? f}</option>
                ))}
              </Select>
            )}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={save}>
              {editId ? t("Save") : t("rule.create")}
            </Button>
            {editId && (
              <Button variant="ghost" onClick={() => {
                setEditId(null); setForm({ ...EMPTY });
              }}>{t("cancel")}</Button>
            )}
            <span className="text-xs text-muted">{msg}</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
