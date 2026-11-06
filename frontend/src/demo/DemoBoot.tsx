/* The first-load screen of the in-browser demo: honest progress while the
 * backend downloads and starts, and a plain failure state (never a spinner
 * that spins forever). */

import { Check } from "lucide-react";
import { t } from "../i18n";
import { Button, Notice, ProgressBar, Spinner } from "../components/ui";
import { STEPS, type StepId } from "./protocol";
import type { BootState } from "./runtime";

const LABEL: Record<StepId, string> = {
  download: "demo.boot.download",
  python: "demo.boot.python",
  libraries: "demo.boot.libraries",
  seed: "demo.boot.seed",
};

const fmtMb = (n: number) => (Math.round(n * 10) / 10).toFixed(1);

export function DemoBoot({ state, onRetry }: {
  state: Exclude<BootState, { phase: "ready" }>; onRetry: () => void;
}) {
  const failed = state.phase === "failed";
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center
      gap-4 p-5">
      <h1 className="type-title">{t("demo.boot.title")}</h1>
      {failed ? (
        <>
          <Notice tone="danger">
            <p className="font-medium">{t("demo.fail.title")}</p>
            <p>{t(`demo.fail.${state.reason}`)}</p>
          </Notice>
          <div>
            <Button onClick={onRetry}>{t("demo.retry")}</Button>
          </div>
        </>
      ) : (
        <ol className="flex flex-col gap-2 type-body">
          {STEPS.map((s) => {
            const done = state.done.includes(s);
            const active = state.step === s;
            return (
              <li key={s} className={`flex items-center gap-2 ${
                done || active ? "" : "text-faint"}`}>
                <span className="flex size-5 shrink-0 items-center
                  justify-center">
                  {done ? <Check size={16} aria-label={t("demo.boot.done")} />
                    : active ? <Spinner /> : null}
                </span>
                <span>{t(LABEL[s])}</span>
                {s === "download" && active && state.totalMb > 0 && (
                  <span className="ml-auto type-meta text-muted tabular-nums">
                    {t("demo.boot.mb", { done: fmtMb(state.mb),
                      total: fmtMb(state.totalMb) })}
                  </span>
                )}
              </li>
            );
          })}
          <li className={`flex items-center gap-2 ${
            state.done.length === STEPS.length ? "" : "text-faint"}`}>
            <span className="size-5 shrink-0" />
            <span>{t("demo.boot.ready")}</span>
          </li>
        </ol>
      )}
      {!failed && state.step === "download" && state.totalMb > 0 && (
        <ProgressBar value={state.mb} max={state.totalMb}
          label={t("demo.boot.download")} />
      )}
      <p className="type-body text-muted">{t("demo.boot.privacy")}</p>
      <p className="type-meta text-muted">{t("demo.boot.hint")}</p>
    </main>
  );
}
