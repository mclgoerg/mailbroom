import { Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { api, fmtSize, fmtUsd } from "../api";
import { getLang, t } from "../i18n";
import { matchGroup, parseFilter, type SmartMembers } from "../lib";
import type { AiFilterResult, Group } from "../types";
import { QueryBuilder } from "./QueryBuilder";
import { Button, ensureAiAck, Field, Input, Modal, Notice, PanelHeader, Spinner,
  TextArea } from "./ui";

/** The most the backend takes (aifilter.TEXT_MAX). */
export const AI_FILTER_MAX = 300;

/** Describe a filter in plain words: the AI writes the query, the user checks
 *  and edits it (Input + QueryBuilder) against a live preview, then applies
 *  it, saves it as a preset or as a rule. Nothing is selected or acted on
 *  here; only the sentence and the filter syntax go to the AI provider. */
export function AiFilterPanel({ groups, members, onClose, onApply,
  onSavePreset, onSaveRule }: {
  /** The loaded groups of the current grouping (the preview runs on them). */
  groups: Group[];
  members?: SmartMembers;
  onClose: () => void;
  onApply: (query: string) => void;
  onSavePreset: (query: string) => void;
  onSaveRule: (query: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AiFilterResult | null>(null);
  const [query, setQuery] = useState("");

  const send = async () => {
    const sentence = text.trim();
    if (!sentence || busy) return;
    if (!await ensureAiAck()) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.aiFilter(sentence, getLang());
      setResult(r);
      setQuery(r.query);
    } catch (e: any) {
      setError(String(e.message ?? e));
    }
    setBusy(false);
  };

  // The SAME filter code the list uses, on the groups that are loaded.
  const preview = useMemo(() => {
    if (!groups.length) return null;
    const f = parseFilter(query);
    const hits = groups.filter((g) => matchGroup(g, f, Date.now(), members));
    return {
      groups: hits.length,
      mails: hits.reduce((n, g) => n + g.count, 0),
      size: hits.reduce((n, g) => n + g.size, 0),
      protectedGroups: hits.filter((g) => g.protected).length,
    };
  }, [groups, members, query]);

  const ready = !!query.trim();
  return (
    <Modal size="sm" onClose={onClose} label={t("aif.title")}>
      <PanelHeader onClose={onClose} sub={t("aif.sub")}
        title={<span className="inline-flex items-center gap-2">
          <Sparkles size={18} /> {t("aif.title")}
        </span>} />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {!result ? (
          <>
            <Field label={t("aif.label")}>
              <TextArea className="font-sans" rows={3} autoFocus
                maxLength={AI_FILTER_MAX} value={text}
                placeholder={t("aif.placeholder")}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
                }} />
            </Field>
            <div className="flex items-start gap-2 type-meta text-muted">
              <span className="min-w-0 flex-1">{t("aif.disclosure")}</span>
              <span className="shrink-0 tabular-nums">
                {t("aif.chars", { n: text.length, max: AI_FILTER_MAX })}
              </span>
            </div>
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="flex items-center justify-end gap-2">
              {busy && <span className="inline-flex items-center gap-2
                type-meta text-muted"><Spinner /> {t("aif.thinking")}</span>}
              <Button onClick={send} disabled={busy || !text.trim()}>
                {t("aif.send")}
              </Button>
            </div>
          </>
        ) : (
          <>
            {result.explanation && (
              <div className="type-body">{result.explanation}</div>
            )}
            <Field label={t("aif.query_label")}>
              <div className="relative flex items-center gap-2">
                <Input className="min-w-0 flex-1 font-mono" value={query}
                  autoCapitalize="off" autoCorrect="off" spellCheck={false}
                  onChange={(e) => setQuery(e.target.value)} />
                <QueryBuilder value={query} onChange={setQuery} />
              </div>
            </Field>
            <div className="rounded-card bg-panel2 px-3 py-2">
              <div className="type-meta text-muted">{t("aif.preview_label")}</div>
              {preview === null ? (
                <div className="type-meta">{t("aif.no_scan")}</div>
              ) : preview.groups === 0 ? (
                <div className="type-body">{t("aif.no_match")}</div>
              ) : (
                <div className="type-body tabular-nums">
                  {t("aif.groups", { n: preview.groups })}
                  {" · "}{t("aif.mails", { n: preview.mails })}
                  {" · "}{fmtSize(preview.size)}
                  {preview.protectedGroups > 0 && (
                    <span className="type-meta text-muted">
                      {" "}({t("aif.incl_protected", { n: preview.protectedGroups })})
                    </span>
                  )}
                </div>
              )}
            </div>
            {result.unsupported.length > 0 && (
              <Notice>
                {t("aif.unsupported", { items: result.unsupported.join(", ") })}
              </Notice>
            )}
            <div className="type-meta text-muted">
              {t("aif.nothing_selected")}
              {result.cost > 0 && <> {t("aif.cost", { cost: fmtUsd(result.cost) })}</>}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => onApply(query.trim())} disabled={!ready}>
                {t("aif.apply")}
              </Button>
              <Button variant="secondary" disabled={!ready}
                onClick={() => onSavePreset(query.trim())}>
                {t("aif.save_preset")}
              </Button>
              <Button variant="secondary" disabled={!ready}
                onClick={() => onSaveRule(query.trim())}>
                {t("aif.save_rule")}
              </Button>
              <Button variant="quiet" className="ml-auto"
                onClick={() => { setResult(null); setError(""); }}>
                {t("aif.back")}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
