import { ClipboardList, Pin, Shield, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "../api";
import { t } from "../i18n";
import { matchGroup, parseFilter } from "../lib";
import type { AppState, Grouping, Rule } from "../types";
import { QueryBuilder } from "./QueryBuilder";
import { Button, confirmDialog, EmptyState, Field, Input, Modal, PanelHeader, SectionLabel,
  Select, Spinner, Tag } from "./ui";

const EMPTY = {
  name: "", grouping: "sender" as Grouping, query: "", action: "trash",
  dest: "", schedule: "manual" as Rule["schedule"],
  retention: "none" as "none" | "keep_latest" | "older_than_days",
  retentionN: "",
};

function RunSummary({ rule }: { rule: Rule }) {
  const r = rule.last_run;
  if (!r) return <span className="text-muted">{t("rule.never_ran")}</span>;
  if (r.error) return <span className="text-danger-fg">{r.error}</span>;
  return (
    <>
      {new Date(r.ts * 1000).toLocaleString()} -{" "}
      {t(r.mode === "execute" ? "rule.run_executed" : "rule.run_report", {
        groups: r.groups, mails: r.mails, acted: r.acted })}
      {r.capped > 0 && <> · {t("rule.capped", { n: r.capped })}</>}
      {r.skipped_protected > 0 &&
        <span className="inline-flex items-center gap-1">
          {" "}· <Shield size={14} />
          {t("rule.protected_skipped", { n: r.skipped_protected })}
        </span>}
      {r.skipped_pinned > 0 &&
        <span className="inline-flex items-center gap-1">
          {" "}· <Pin size={14} />
          {t("rule.pinned_skipped", { n: r.skipped_pinned })}
        </span>}
      {r.preview.length > 0 && (
        <span className="block text-muted">
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
    // Pinned mails never move (mark_read is non-destructive: exempt).
    const pinned = (g: { pinned: number }) =>
      form.action === "mark_read" ? 0 : g.pinned ?? 0;
    return { groups: hits.length,
             mails: hits.reduce((n, g) => n + g.count - pinned(g), 0) };
  }, [state, form.grouping, form.query, form.action]);

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
      setMsg(t("err.generic", { msg: e.message ?? e }));
    }
  };

  const run = async (rule: Rule) => {
    if (rule.mode === "execute" && !await confirmDialog({
      title: t("rule.confirm_execute", { name: rule.name }), tone: "danger",
      confirmLabel: t("rule.run_now") })) return;
    setBusyId(rule.id);
    setMsg("");
    try {
      await api.runRule(rule.id);
      onChanged();
    } catch (e: any) {
      setMsg(t("err.generic", { msg: e.message ?? e }));
    }
    setBusyId("");
  };

  const toggleMode = async (rule: Rule) => {
    const mode = rule.mode === "report" ? "execute" : "report";
    if (mode === "execute" && !await confirmDialog({
      title: t("rule.enable_title", { name: rule.name }),
      body: t("rule.enable_body"), tone: "danger",
      confirmLabel: t("rule.enable_execute") })) return;
    setMsg("");
    try {
      await api.updateRule(rule.id, { mode });
      onChanged();
    } catch (e: any) {
      setMsg(t("err.generic", { msg: e.message ?? e }));
    }
  };

  const del = async (rule: Rule) => {
    if (!await confirmDialog({
      title: t("rule.confirm_delete", { name: rule.name }), tone: "danger",
      confirmLabel: t("Delete") })) return;
    try {
      await api.deleteRule(rule.id);
      if (editId === rule.id) { setEditId(null); setForm({ ...EMPTY }); }
      onChanged();
    } catch (e: any) {
      setMsg(t("err.generic", { msg: e.message ?? e }));
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
      <PanelHeader title={<span className="inline-flex items-center gap-2">
        <ClipboardList size={18} /> {t("Rules")}
      </span>} onClose={onClose} />
      <div className="space-y-4 p-4 sm:p-5">
        <p className="type-meta text-muted">{t("rules.help")}</p>

        {rules.map((rule) => (
          <div key={rule.id}
            className="rounded-card border border-line bg-panel2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="type-body font-medium">{rule.name}</span>
              <Tag>{t(rule.grouping === "sender" ? "Sender"
                : rule.grouping === "domain" ? "Domain"
                : rule.grouping === "thread" ? "Thread" : "Subject")}</Tag>
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
              <Tag tone={rule.mode === "execute" ? "keep" : "safe"}>
                {t(`mode.${rule.mode}`)}
              </Tag>
            </div>
            {rule.query && (
              <code className="mt-1 block type-meta text-chiptext">
                {rule.query}
              </code>
            )}
            <div className="mt-1 type-meta text-muted">
              <RunSummary rule={rule} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm"
                onClick={() => run(rule)} disabled={busyId === rule.id}>
                {busyId === rule.id ? <Spinner /> : t("rule.run_now")}
              </Button>
              <Button variant="quiet" size="sm"
                onClick={() => edit(rule)}>{t("Edit")}</Button>
              <Button variant="secondary" size="sm"
                disabled={rule.mode === "report" && rule.report_runs < 1}
                title={rule.mode === "report" && rule.report_runs < 1
                  ? t("rule.need_report") : ""}
                onClick={() => toggleMode(rule)}>
                {rule.mode === "report" && (
                  <TriangleAlert size={14}
                    className="mr-1 inline align-text-bottom" />
                )}
                {rule.mode === "report"
                  ? t("rule.enable_execute") : t("rule.back_to_report")}
              </Button>
              <Button variant="danger-quiet" size="sm" className="ml-auto"
                onClick={() => del(rule)}>{t("Delete")}</Button>
            </div>
          </div>
        ))}
        {!rules.length && <EmptyState>{t("rules.empty")}</EmptyState>}

        <div className="rounded-card border border-line p-3">
          <SectionLabel className="mb-2">
            {editId ? t("rule.edit_title") : t("rule.new_title")}
          </SectionLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("rule.f_name")}>
              <Input className="w-full" placeholder={t("rule.name")}
                value={form.name} onChange={set("name")} />
            </Field>
            <Field label={t("rule.f_grouping")}>
              <Select className="w-full" value={form.grouping}
                onChange={set("grouping")}>
                <option value="sender">{t("Sender")}</option>
                <option value="domain">{t("Domain")}</option>
                <option value="subject">{t("Subject")}</option>
                <option value="thread">{t("Thread")}</option>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              {/* The builder stays outside the <label>: its popover holds
                  controls of its own. */}
              <div className="relative flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field label={t("rule.f_filter")}>
                    <Input className="w-full"
                      placeholder="tag:shipping age:>1y is:noreply-ever …"
                      value={form.query} onChange={set("query")} />
                  </Field>
                </div>
                <QueryBuilder value={form.query}
                  onChange={(q) => setForm({ ...form, query: q })} />
              </div>
              <div className="mt-1 type-meta text-muted">
                {matchCount
                  ? t("rule.match_count", matchCount)
                  : t("rule.match_unknown")}
              </div>
            </div>
            <Field label={t("rule.f_action")}>
              <Select className="w-full" value={form.action}
                onChange={set("action")}>
                <option value="trash">{t("action.trash")}</option>
                <option value="archive">{t("action.archive")}</option>
                <option value="move">{t("action.move")}</option>
                <option value="mark_read">{t("action.mark_read")}</option>
              </Select>
            </Field>
            <Field label={t("rule.f_schedule")}>
              <Select className="w-full" value={form.schedule}
                onChange={set("schedule")}>
                <option value="manual">{t("sched.manual")}</option>
                <option value="daily">{t("sched.daily")}</option>
                <option value="weekly">{t("sched.weekly")}</option>
              </Select>
            </Field>
            <Field label={t("rule.f_apply")}>
              <Select className="w-full" value={form.retention}
                onChange={set("retention")}>
                <option value="none">{t("retention.none")}</option>
                <option value="keep_latest">{t("retention.keep_latest")}</option>
                <option value="older_than_days">
                  {t("retention.older_than_days")}
                </option>
              </Select>
            </Field>
            {form.retention !== "none" && (
              <Field label={t("rule.f_retention_n")}>
                <Input className="w-full" type="number" min={1}
                  placeholder={t("retention.n_placeholder")}
                  value={form.retentionN} onChange={set("retentionN")} />
              </Field>
            )}
            {form.action === "move" && (
              <div className="sm:col-span-2">
                <Field label={t("rule.f_dest")}>
                  <Select className="w-full" value={form.dest}
                    onChange={set("dest")}>
                    <option value="">{t("Move to folder…")}</option>
                    {(state.folders_raw ?? []).map((f, i) => (
                      <option key={f} value={f}>{state.folders[i] ?? f}</option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button onClick={save}>
              {editId ? t("Save") : t("rule.create")}
            </Button>
            {editId && (
              <Button variant="secondary" onClick={() => {
                setEditId(null); setForm({ ...EMPTY });
              }}>{t("cancel")}</Button>
            )}
            <span className="type-meta text-muted">{msg}</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
