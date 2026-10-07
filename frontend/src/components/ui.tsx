import { Pin, Shield, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState,
  type ComponentProps, type ReactNode } from "react";
import { t } from "../i18n";
import { engagementTier } from "../lib";
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
      className={`flex min-h-7 items-center rounded px-1 transition-opacity
        ${on ? "" : "opacity-30 grayscale hover:opacity-70"} ${className}`}>
      <Shield size={16} />
    </button>
  );
}

/** Per-mail "Protect this mail" toggle (a pinned mail is skipped by every
 *  bulk action, rule and AI pick). Unrelated to any PIN code/privacy
 *  feature - the label says "protect", the icon is a drawing pin. */
export function PinButton({ on, onClick, className = "" }: {
  on: boolean; onClick: () => void; className?: string;
}) {
  const label = t(on ? "pin.unprotect_tip" : "pin.protect_tip");
  return (
    <button title={label} aria-label={label} aria-pressed={on}
      onClick={onClick}
      className={`flex min-h-7 shrink-0 items-center rounded px-1
        transition-opacity ${on ? "text-accent"
          : "opacity-40 hover:opacity-80"} ${className}`}>
      <Pin size={15} fill={on ? "currentColor" : "none"} />
    </button>
  );
}

/** Compact 3-step engagement meter: one lit bar per tier (low/medium/
 *  high). It is a button: a tap (or click) opens a small popover that names
 *  the score and spells out what it is made of - touch screens have no
 *  hover, and the bars alone don't say what they are. The title tooltip
 *  stays for desktop hover. Neutral accent tint on purpose - the emerald/
 *  amber/rose hues mean delete-safe/review/keep elsewhere. */
export function EngagementMeter({ g }: {
  g: { engagement: number; count: number; unread: number; replied: boolean;
       bulk: boolean; last: string };
}) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const tier = engagementTier(g.engagement);
  const lit = { low: 1, medium: 2, high: 3 }[tier];
  const readPct = g.count ? Math.round(100 * (1 - g.unread / g.count)) : 0;
  const parts = [
    t("eng.read", { n: readPct }),
    t(g.replied ? "eng.replied" : "eng.never_replied"),
    ...(g.bulk ? [t("eng.bulk")] : []),
    ...(g.last ? [t("eng.last", { year: g.last.slice(0, 4) })] : []),
  ];
  const tierName = t(`eng.${tier}`);
  const tip = t("eng.tip", { score: g.engagement, tier: tierName,
    parts: parts.join(", ") });
  // Opens left-aligned under the meter; flips if that runs off the right
  // edge of the screen.
  useLayoutEffect(() => {
    if (!open) { setAlignRight(false); return; }
    const r = pop.current?.getBoundingClientRect();
    if (r && r.width > 0 && r.right > window.innerWidth - 8) {
      setAlignRight(true);
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-block">
      <button type="button" title={tip} aria-label={tip} aria-expanded={open}
        data-eng={tier}
        // Rows are tap targets themselves (open the detail view) - this
        // one only explains the score.
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="inline-flex min-h-6 min-w-6 cursor-pointer items-end
          gap-0.5 rounded px-0.5 pb-1 hover:bg-chip">
        {[1, 2, 3].map((i) => (
          <span key={i} data-lit={i <= lit ? "true" : "false"}
            style={{ height: `${4 + i * 3}px` }}
            className={`w-1 rounded-sm ${i <= lit ? "bg-accent" : "bg-chip"}`} />
        ))}
      </button>
      {open && (
        <div ref={pop} role="dialog" onClick={(e) => e.stopPropagation()}
          className={`absolute top-full z-20 mt-1 w-max
            max-w-[min(18rem,calc(100vw-1rem))] rounded-lg border
            border-line bg-panel p-2.5 text-left text-xs font-normal
            shadow-lg ${alignRight ? "right-0" : "left-0"}`}>
          <div className="font-semibold text-body">
            {t("eng.popover_title", { score: g.engagement, tier: tierName })}
          </div>
          <div className="mt-0.5 text-muted">{parts.join(" · ")}</div>
        </div>
      )}
    </span>
  );
}

/** Group-row indicator: how many of a group's mails are pinned. */
export function PinBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <Tag className="!text-accent whitespace-nowrap">
      <span title={t("pin.badge_tip", { n })}
        className="inline-flex items-center gap-0.5">
        <Pin size={11} fill="currentColor" /> {n}
      </span>
    </Tag>
  );
}

/** The app-wide loading animation (see .pmc-spinner in index.css).
 *  Colored via currentColor - defaults to the accent; pass e.g.
 *  className="text-white" inside primary buttons. */
export function Spinner({ size = "sm", className = "" }: {
  size?: "sm" | "md" | "lg"; className?: string;
}) {
  const s = {
    sm: "size-3.5 [--pmc-thickness:2px]",
    md: "size-6 [--pmc-thickness:2.5px]",
    lg: "size-9 [--pmc-thickness:3px]",
  }[size];
  return (
    <span aria-label="loading" role="status"
      className={`pmc-spinner inline-block align-middle text-accent
        ${s} ${className}`} />
  );
}

/** Determinate progress bar (theme tokens only). `max` 0 = not known yet:
 *  the bar stays empty. */
export function ProgressBar({ value, max, label, className = "" }: {
  value: number; max: number; label?: string; className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((100 * value) / max)) : 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0}
      aria-valuemax={max > 0 ? max : undefined}
      aria-valuenow={max > 0 ? value : undefined}
      className={`h-2 w-full overflow-hidden rounded-full bg-chip
        ${className}`}>
      <div className="h-full rounded-full bg-accent transition-[width]
        duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Standard block-level loading state: big spinner + muted label,
 *  centered, with a short fade-in delay. Use this in every panel. */
export function Loading({ label, className = "" }: {
  label?: string; className?: string;
}) {
  return (
    <div className={`pmc-loading flex flex-col items-center justify-center
      gap-3 p-8 text-sm text-muted ${className}`}>
      <Spinner size="lg" />
      <span>{label ?? t("loading…")}</span>
    </div>
  );
}

export function Button({ children, onClick, disabled, variant = "primary",
  className = "", title }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: "primary" | "ghost" | "danger"; className?: string; title?: string;
}) {
  const styles = {
    primary: "bg-accent hover:bg-accenth text-white",
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

/* ----------------------- form controls (ONE look) -----------------------
 * Every input/select/textarea in the app uses these - never restyle them
 * locally. They accept all native props incl. ref (React 19). */

const CONTROL = `min-h-9 rounded-md border border-line bg-panel2 px-3 py-1.5
  text-sm outline-none focus:border-accent
  disabled:cursor-default disabled:opacity-40`;

export function Input({ className = "", ...rest }:
  ComponentProps<"input">) {
  return <input className={`${CONTROL} ${className}`} {...rest} />;
}

export function Select({ className = "", ...rest }:
  ComponentProps<"select">) {
  return <select className={`${CONTROL} ${className}`} {...rest} />;
}

export function TextArea({ className = "", ...rest }:
  ComponentProps<"textarea">) {
  return (
    <textarea
      className={`${CONTROL} min-h-20 w-full font-mono ${className}`}
      {...rest} />
  );
}

/** Labelled form control (label above, muted). */
export function Field({ label, children }: {
  label: ReactNode; children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

/* --------------------------- layout primitives --------------------------- */

/** Standard panel/modal header: title (+optional subtitle) left, optional
 *  action elements, close button right. Used by every modal. */
export function PanelHeader({ title, sub, actions, onClose }: {
  title: ReactNode; sub?: ReactNode; actions?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{title}</div>
        {sub != null && sub !== "" && (
          <div className="truncate text-xs text-muted">{sub}</div>
        )}
      </div>
      {actions}
      <Button variant="ghost" onClick={onClose} title={t("Close")}>
        <X size={17} />
      </Button>
    </div>
  );
}

/** Standard action row under a panel header. */
export function Toolbar({ children, className = "" }: {
  children: ReactNode; className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 border-b border-line
      px-4 py-2 ${className}`}>
      {children}
    </div>
  );
}

/** Uppercase section label used to group form/panel content. */
export function SectionLabel({ children, className = "" }: {
  children: ReactNode; className?: string;
}) {
  return (
    <div className={`text-xs font-semibold uppercase tracking-wide
      text-muted ${className}`}>
      {children}
    </div>
  );
}

/** Standard "nothing here" message for empty lists/results. */
/** Dropdown menu: a trigger button plus a popover - right-aligned by
 * default, flipped to left-aligned when that would run off the left edge
 * of the screen (a trigger that wrapped to the start of a row on a
 * phone). Closes
 * on outside click, Escape, or after any click inside (items just run
 * their onClick). Sits BELOW modals (they are z-20). */
export function Menu({ trigger, label, children }: {
  trigger: ReactNode;
  label?: string;                 // accessible name / tooltip
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [alignLeft, setAlignLeft] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // Measure right-aligned first, then flip if it overflows the viewport.
  useLayoutEffect(() => {
    if (!open) { setAlignLeft(false); return; }
    const r = pop.current?.getBoundingClientRect();
    if (r && r.width > 0 && r.left < 8) setAlignLeft(true);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button className="flex min-h-8 items-center rounded-md border
        border-line bg-panel2 px-2 text-sm hover:bg-chip"
        title={label} aria-label={label} aria-expanded={open}
        onClick={() => setOpen(!open)}>
        {trigger}
      </button>
      {open && (
        <div ref={pop}
          className={`absolute top-full z-10 mt-1 min-w-52
            max-w-[calc(100vw-1rem)] rounded-lg border border-line bg-panel
            p-1 shadow-lg ${alignLeft ? "left-0" : "right-0"}`}
          onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, disabled, active, sub }: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;    // renders a trailing check, role=menuitemradio
  sub?: ReactNode;     // muted second line (e.g. an account's address)
}) {
  return (
    <button
      role={active === undefined ? undefined : "menuitemradio"}
      aria-checked={active}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2
        text-left text-sm text-body hover:bg-chip disabled:opacity-50"
      onClick={onClick} disabled={disabled}>
      <span className="min-w-0 flex-1 truncate">
        {children}
        {sub != null && sub !== "" && (
          <span className="block truncate text-xs text-muted">{sub}</span>
        )}
      </span>
      {active && <span className="text-accent">✓</span>}
    </button>
  );
}

/* Non-semantic identity hues (never emerald/amber/rose/sky/orange - those
 * are reserved: delete-safe/review/keep/replied/attachments). */
const ACCOUNT_HUES = [
  "bg-violet-900 text-violet-300",
  "bg-teal-900 text-teal-300",
  "bg-cyan-900 text-cyan-300",
  "bg-lime-900 text-lime-300",
  "bg-indigo-900 text-indigo-300",
  "bg-fuchsia-900 text-fuchsia-300",
];

const hueOf = (name: string): string => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return ACCOUNT_HUES[Math.abs(h) % ACCOUNT_HUES.length];
};

/** Letter avatar identifying one account/sender/domain, tinted by a
 *  stable hash of its name so entries stay visually distinct. `size`
 *  controls the diameter: "sm" (account switcher) or "md" (group rows). */
export function Avatar({ name, size = "sm", className = "" }: {
  name: string; size?: "sm" | "md"; className?: string;
}) {
  const dims = size === "md" ? "size-8 text-xs" : "size-5 text-[0.65rem]";
  return (
    <span className={`inline-flex ${dims} shrink-0 items-center
      justify-center rounded-full font-semibold uppercase
      ${hueOf(name)} ${className}`}>
      {name.charAt(0)}
    </span>
  );
}

/** Account-switcher-sized avatar - thin wrapper around `Avatar`. */
export function AccountAvatar({ name, className = "" }: {
  name: string; className?: string;
}) {
  return <Avatar name={name} className={className} />;
}

/** Non-interactive heading line inside a Menu (e.g. the identity). */
export function MenuHeading({ children }: { children: ReactNode }) {
  return (
    <div className="max-w-64 truncate border-b border-line px-3 pb-2 pt-1
      text-xs text-muted">
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="p-6 text-center text-sm text-muted">{children}</div>
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
  // Keep the iOS status bar style in sync with a live theme switch too
  // (index.html sets the initial value before first paint).
  const bar = document.querySelector(
    'meta[name="apple-mobile-web-app-status-bar-style"]');
  if (bar) bar.setAttribute("content", theme === "dark" ? "black" : "default");
};

export const currentTheme = (): "dark" | "light" =>
  (document.documentElement.dataset.theme as "dark" | "light") || "dark";
