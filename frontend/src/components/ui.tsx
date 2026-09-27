import { useEffect, type ReactNode } from "react";
import { t } from "../i18n";
import type { GroupAi } from "../types";

/** One-time consent: what metadata the AI features transmit. */
export function ensureAiAck(): boolean {
  if (localStorage.getItem("pmc_ai_ack") === "1") return true;
  if (confirm(t("ai.disclaimer"))) {
    localStorage.setItem("pmc_ai_ack", "1");
    return true;
  }
  return false;
}

export function Tag({ children, className = "" }: {
  children: ReactNode; className?: string;
}) {
  return (
    <span className={`inline-block rounded bg-chip px-1.5 py-0.5
      text-[0.68rem] leading-4 text-chiptext ${className}`}>
      {children}
    </span>
  );
}

const VERDICT_STYLE: Record<string, string> = {
  delete_safe: "!bg-emerald-950 !text-emerald-300",
  review: "!bg-amber-950 !text-amber-300",
  keep: "!bg-rose-950 !text-rose-300",
};

export function AiTag({ ai }: { ai: GroupAi }) {
  return (
    <Tag className={VERDICT_STYLE[ai.verdict] ?? ""}>
      <span title={ai.reason}>{ai.verdict.replace("_", " ")}</span>
    </Tag>
  );
}

/** Compact per-mail rating summary for a group: 🟢n 🟡n 🔴n. */
export function RatingChips({ ratings }: {
  ratings: { delete_safe: number; review: number; keep: number };
}) {
  const parts: [string, number][] = [
    ["🟢", ratings.delete_safe], ["🟡", ratings.review], ["🔴", ratings.keep]];
  return (
    <span className="inline-flex gap-1 whitespace-nowrap align-middle
      text-[0.68rem] text-muted"
      title={t("ratings.title")}>
      {parts.filter(([, n]) => n > 0).map(([icon, n]) => (
        <span key={icon}>{icon}{n}</span>
      ))}
    </span>
  );
}


/** Shield toggle: protected senders are skipped by bulk deletes and the AI
 *  never rates them delete_safe. Grayscale = not protected. */
export function ProtectButton({ on, onClick, className = "" }: {
  on: boolean; onClick: () => void; className?: string;
}) {
  return (
    <button
      title={t(on ? "unprotect.tip" : "protect.tip")}
      onClick={onClick}
      className={`min-h-7 rounded px-1 text-sm transition-opacity
        ${on ? "" : "opacity-30 grayscale hover:opacity-70"} ${className}`}>
      🛡️
    </button>
  );
}


export function Spinner() {
  return (
    <span className="inline-block size-3.5 animate-spin rounded-full
      border-2 border-line border-t-accent align-middle" />
  );
}

export function Button({ children, onClick, disabled, variant = "primary",
  className = "", title }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: "primary" | "ghost" | "danger"; className?: string; title?: string;
}) {
  const styles = {
    primary: "bg-accent hover:bg-indigo-500 text-white",
    ghost: "bg-chip hover:bg-chiph text-body",
    danger: "bg-red-700 hover:bg-red-600 text-white",
  }[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`min-h-9 rounded-md px-3 py-1.5 text-sm font-medium
        transition-colors disabled:cursor-default disabled:opacity-40
        ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Modal({ children, onClose, full = false }: {
  children: ReactNode; onClose: () => void; full?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center
        bg-black/60 p-0 sm:p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`flex flex-col overflow-hidden border-line bg-panel
        sm:rounded-xl sm:border
        ${full
          ? "h-dvh w-full sm:h-[88vh] sm:max-w-3xl"
          : "max-h-dvh w-full overflow-y-auto sm:max-h-[88vh] sm:max-w-2xl"}`}>
        {children}
      </div>
    </div>
  );
}

export const applyTheme = (theme: "dark" | "light"): void => {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("pmc_theme", theme);
};

export const currentTheme = (): "dark" | "light" =>
  (document.documentElement.dataset.theme as "dark" | "light") || "dark";
