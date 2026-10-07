import { Check, Pin, Shield, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect,
  useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
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
  delete_safe: "!bg-safe-bg !text-safe-fg",
  review: "!bg-review-bg !text-review-fg",
  keep: "!bg-keep-bg !text-keep-fg",
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
          className={`absolute top-full z-(--z-dropdown) mt-1 w-max
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

/** Shared disabled look for Button / controls / MenuItem: flat chip fill,
 *  faint text, no opacity (a disabled red button must not read as an alarm). */
const DISABLED = "disabled:cursor-not-allowed disabled:bg-chip disabled:text-faint";

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger"
  | "danger-quiet" | "ghost";   // "ghost" = deprecated alias of secondary

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent enabled:hover:bg-accenth text-white",
  secondary: "bg-chip enabled:hover:bg-chiph text-body",
  ghost: "bg-chip enabled:hover:bg-chiph text-body",
  quiet: "bg-transparent enabled:hover:bg-chip text-body",
  danger: "bg-danger enabled:hover:bg-danger-h text-white",
  "danger-quiet":
    "bg-transparent enabled:hover:bg-keep-bg text-danger-fg",
};

// sm: 32 / 36 px visual on touch, the ::after extends the hit area to 44.
const BUTTON_SIZE = {
  md: "min-h-9 coarse:min-h-10 px-3 py-1.5 type-body font-medium",
  sm: `relative min-h-8 coarse:min-h-9 px-2.5 py-1 type-meta font-medium
    after:absolute after:inset-x-0 after:inset-y-0 after:content-['']
    coarse:after:-inset-y-1`,
  icon: `inline-flex size-9 coarse:size-10 items-center justify-center p-0
    type-body`,
};

export type ButtonProps = Omit<ComponentProps<"button">, "title"> & {
  variant?: ButtonVariant;
} & (
  | { size?: "md" | "sm"; title?: string; label?: never }
  // Icon-only buttons must say what they do: rendered as aria-label + title.
  | { size: "icon"; label: string; title?: never }
);

export function Button({ variant = "primary", size = "md", label, title,
  className = "", children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      aria-label={size === "icon" ? label : rest["aria-label"]}
      title={size === "icon" ? label : title}
      className={`rounded-control transition-colors enabled:active:translate-y-px
        ${DISABLED} ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[variant]}
        ${className}`}>
      {children}
    </button>
  );
}

/* ----------------------- form controls (ONE look) -----------------------
 * Every input/select/textarea in the app uses these - never restyle them
 * locally. They accept all native props incl. ref (React 19). */

const CONTROL = `min-h-9 coarse:min-h-10 rounded-control border border-line
  bg-panel2 px-3 py-1.5 text-left type-body focus:border-accent ${DISABLED}`;

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
      <span className="mb-1 block type-meta text-muted">{label}</span>
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
      <Button variant="secondary" size="icon" label={t("Close")}
        onClick={onClose}>
        <X size={18} />
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
    <div className={`type-section text-muted ${className}`}>
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
 * their onClick). Sits BELOW modals (z-modal). */
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
          className={`absolute top-full z-(--z-dropdown) mt-1 min-w-52
            max-w-[calc(100vw-1rem)] rounded-lg border border-line bg-panel
            p-1 shadow-lg ${alignLeft ? "left-0" : "right-0"}`}
          onClick={() => setOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, onClick, disabled, active, sub,
  danger }: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;    // renders a trailing check, role=menuitemradio
  sub?: ReactNode;     // muted second line (e.g. an account's address)
  danger?: boolean;    // destructive entry (quiet red text)
}) {
  return (
    <button
      role={active === undefined ? undefined : "menuitemradio"}
      aria-checked={active}
      className={`flex w-full items-center gap-2 rounded-control px-3 py-2
        text-left type-body enabled:hover:bg-chip
        disabled:cursor-not-allowed disabled:text-faint
        ${danger ? "text-danger-fg" : "text-body"}`}
      onClick={onClick} disabled={disabled}>
      <span className="min-w-0 flex-1 truncate">
        {children}
        {sub != null && sub !== "" && (
          <span className="block truncate type-meta text-muted">{sub}</span>
        )}
      </span>
      {active && <span className="text-accent">✓</span>}
    </button>
  );
}

/** Hairline between groups of MenuItems. */
export function MenuDivider() {
  return <div role="separator" className="my-1 border-t border-line" />;
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

/** "Nothing here" message. Plain children still work; `icon`/`title`/
 *  `hint`/`action` give it the fuller illustrated shape. */
export function EmptyState({ children, icon, title, hint, action }: {
  children?: ReactNode; icon?: ReactNode; title?: ReactNode;
  hint?: ReactNode; action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 p-6 text-center
      type-body text-muted">
      {icon != null && <span className="text-faint">{icon}</span>}
      {title != null && (
        <div className="type-heading text-body">{title}</div>
      )}
      {children}
      {hint != null && <div className="type-meta">{hint}</div>}
      {action != null && <div className="pt-1">{action}</div>}
    </div>
  );
}

const MODAL_WIDTH = { sm: "sm:max-w-md", md: "sm:max-w-2xl",
  lg: "sm:max-w-3xl" };   // 448 / 672 / 768 px

/** Dialog shell. `sm` (448) is a bottom sheet on phones, `md` (672) /
 *  `lg` (768) are full-screen there. `full` = `lg` at a fixed 88vh; other
 *  modals shrink to their content. `label` names the dialog for AT. */
export function Modal({ children, onClose, full = false, size, label }: {
  children: ReactNode; onClose: () => void; full?: boolean;
  size?: "sm" | "md" | "lg"; label?: string;
}) {
  const sz = size ?? (full ? "lg" : "md");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const shape = sz === "sm"
    ? `max-h-[88dvh] rounded-t-dialog border-t max-sm:pb-[env(safe-area-inset-bottom)]
       sm:rounded-dialog`
    : full
      ? "h-dvh sm:h-[88vh]"
      : "h-dvh overflow-y-auto sm:h-auto sm:max-h-[88vh]";
  return (
    <div
      className={`fixed inset-0 z-(--z-modal) flex justify-center bg-overlay
        p-0 sm:p-6 ${sz === "sm" ? "items-end sm:items-center"
          : "items-center"}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div role={label ? "dialog" : undefined}
        aria-modal={label ? true : undefined} aria-label={label}
        data-size={sz}
        className={`flex w-full flex-col overflow-hidden border-line bg-panel
        sm:rounded-dialog sm:border ${MODAL_WIDTH[sz]} ${shape}`}>
        {children}
      </div>
    </div>
  );
}

/* ------------------------- checkbox, chips, notice ------------------------ */

/** The one checkbox. The <label> is the hit area (32 px, 44 px on touch);
 *  the box itself is 18 px in the accent colour. Without `label` text give
 *  it an `aria-label`. All native input props are forwarded. */
export function Checkbox({ label, className = "", ...rest }:
  Omit<ComponentProps<"input">, "type"> & { label?: ReactNode }) {
  return (
    <label className={`inline-flex min-h-8 min-w-8 coarse:min-h-11
      coarse:min-w-11 shrink-0 cursor-pointer items-center justify-center
      gap-2 type-body ${rest.disabled ? "cursor-not-allowed text-faint" : ""}
      ${className}`}>
      <input type="checkbox"
        className="size-4.5 shrink-0 cursor-[inherit] accent-accent"
        {...rest} />
      {label != null && <span>{label}</span>}
    </label>
  );
}

/** Toggle chip (quick filters / presets). On = accent border + check. */
export function Chip({ on = false, children, className = "", ...rest }:
  Omit<ComponentProps<"button">, "type"> & { on?: boolean }) {
  return (
    <button type="button" aria-pressed={on} {...rest}
      className={`inline-flex min-h-8 coarse:min-h-9 items-center gap-1.5
        rounded-full border px-3 type-meta transition-colors
        enabled:active:translate-y-px disabled:cursor-not-allowed
        disabled:border-line disabled:bg-chip disabled:text-faint
        ${on ? "border-accent bg-chiph text-body"
          : "border-line bg-panel2 text-muted enabled:hover:bg-chip"}
        ${className}`}>
      {on && <Check size={14} aria-hidden />}
      {children}
    </button>
  );
}

/** Segmented chip: one pill holding several one-tap `ChipSegment`s, with an
 *  optional leading `label` (e.g. "Inactive:"). */
export function ChipGroup({ label, children, className = "" }: {
  label?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <div role="group" className={`inline-flex min-h-8 coarse:min-h-9
      items-stretch overflow-hidden rounded-full border border-line
      bg-panel2 type-meta ${className}`}>
      {label != null && (
        <span className="flex items-center pl-3 pr-1.5 text-muted">
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

export function ChipSegment({ on = false, children, className = "", ...rest }:
  Omit<ComponentProps<"button">, "type"> & { on?: boolean }) {
  return (
    <button type="button" aria-pressed={on} {...rest}
      className={`flex items-center border-l border-line px-3
        transition-colors enabled:active:translate-y-px
        disabled:cursor-not-allowed disabled:bg-chip disabled:text-faint
        ${on ? "bg-chiph text-body ring-1 ring-inset ring-accent"
          : "text-muted enabled:hover:bg-chip"} ${className}`}>
      {children}
    </button>
  );
}

/** Dismissible inline notice (replaces the one-off banners). */
export function Notice({ children, icon, onClose, className = "" }: {
  children: ReactNode; icon?: ReactNode; onClose?: () => void;
  className?: string;
}) {
  return (
    <div role="status" className={`flex items-start gap-2 rounded-card
      bg-panel2 px-3 py-2 type-meta text-body ${className}`}>
      {icon != null && <span className="mt-0.5 shrink-0 text-muted">{icon}</span>}
      <div className="min-w-0 flex-1 py-0.5">{children}</div>
      {onClose && (
        <Button variant="quiet" size="icon" label={t("Dismiss")}
          className="-my-1.5 -mr-2" onClick={onClose}>
          <X size={18} />
        </Button>
      )}
    </div>
  );
}

/* --------------------------------- toasts --------------------------------- */

export type ToastVariant = "info" | "success" | "error";
export type ToastOptions = {
  variant?: ToastVariant;
  action?: { label: string; onClick: () => void };
  /** ms before auto-dismiss; 0 = stay until closed. Default 8000, and
   *  errors stay by default. */
  duration?: number;
};
type ToastItem = ToastOptions & { id: number; message: ReactNode };

const TOAST_MS = 8000;
const TOAST_STYLE: Record<ToastVariant, string> = {
  info: "border-line bg-panel2 text-body",
  success: "border-transparent bg-safe-bg text-safe-fg",
  error: "border-transparent bg-keep-bg text-keep-fg",
};

type ToastApi = {
  show: (message: ReactNode, opts?: ToastOptions) => number;
  dismiss: (id: number) => void;
};
const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast needs a <ToastProvider>");
  return api;
}

function ToastView({ toast, onDismiss }: {
  toast: ToastItem; onDismiss: () => void;
}) {
  const { variant = "info", action, duration } = toast;
  const ms = duration ?? (variant === "error" ? 0 : TOAST_MS);
  useEffect(() => {
    if (ms <= 0) return;
    const timer = setTimeout(onDismiss, ms);
    return () => clearTimeout(timer);
  }, [ms, onDismiss]);
  return (
    <div data-variant={variant} className={`pointer-events-auto flex
      w-full max-w-120 items-center gap-2 rounded-card border py-1.5 pl-3
      pr-1.5 shadow-bar type-body ${TOAST_STYLE[variant]}`}>
      <div className="min-w-0 flex-1 py-1">{toast.message}</div>
      {action && (
        <Button variant="quiet" size="sm" className="shrink-0 !text-inherit"
          onClick={() => { action.onClick(); onDismiss(); }}>
          {action.label}
        </Button>
      )}
      <Button variant="quiet" size="icon" label={t("Dismiss")}
        className="shrink-0 !text-inherit" onClick={onDismiss}>
        <X size={18} />
      </Button>
    </div>
  );
}

/** Mount once at the app root; `useToast()` anywhere below. Toasts stack
 *  bottom-centre above the bulk bar (`--bulkbar-h`) and the safe area. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) =>
    setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback((message: ReactNode, opts: ToastOptions = {}) => {
    const id = nextId.current++;
    setItems((xs) => [...xs, { ...opts, id, message }]);
    return id;
  }, []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0
        z-(--z-toast) flex flex-col items-center gap-2 px-3"
        style={{ bottom: "calc(var(--bulkbar-h, 0px) + env(safe-area-inset-bottom) + 1rem)" }}>
        {items.map((x) => (
          <ToastView key={x.id} toast={x} onDismiss={() => dismiss(x.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* -------------------------- confirm / prompt dialogs ----------------------- */

export type ConfirmOptions = {
  title: string; body?: ReactNode; bullets?: ReactNode[];
  confirmLabel: string; tone?: "danger" | "primary";
};
export type PromptOptions = {
  title: string; label: string; initial?: string; confirmLabel?: string;
  /** Return an error message, or null when the value is acceptable. */
  validate?: (value: string) => string | null;
};

/** Confirm sheet. Danger dialogs focus Cancel, the safe choice. */
export function ConfirmDialog({ title, body, bullets, confirmLabel,
  tone = "primary", onResult }: ConfirmOptions & {
  onResult: (ok: boolean) => void;
}) {
  const safe = useRef<HTMLButtonElement>(null);
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    (tone === "danger" ? safe : ok).current?.focus();
  }, [tone]);
  return (
    <Modal size="sm" label={title} onClose={() => onResult(false)}>
      <div className="space-y-3 p-4 sm:p-5">
        <div className="type-heading">{title}</div>
        {body != null && <div className="type-body text-muted">{body}</div>}
        {bullets && bullets.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 type-body text-muted">
            {bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-4 py-3
        sm:px-5">
        <Button ref={safe} variant="secondary"
          onClick={() => onResult(false)}>{t("Cancel")}</Button>
        <Button ref={ok} variant={tone === "danger" ? "danger" : "primary"}
          onClick={() => onResult(true)}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

/** Single-field prompt. The confirm button stays disabled while `validate`
 *  returns a message; the message shows once the user has typed. */
export function PromptDialog({ title, label, initial = "", confirmLabel,
  validate, onResult }: PromptOptions & {
  onResult: (value: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const error = validate?.(value) ?? null;
  return (
    <Modal size="sm" label={title} onClose={() => onResult(null)}>
      <form onSubmit={(e) => {
        e.preventDefault();
        if (error) setTouched(true); else onResult(value);
      }}>
        <div className="space-y-3 p-4 sm:p-5">
          <div className="type-heading">{title}</div>
          <Field label={label}>
            <Input ref={input} value={value} className="w-full"
              aria-invalid={touched && !!error}
              onChange={(e) => { setValue(e.target.value); setTouched(true); }} />
          </Field>
          {touched && error && (
            <div role="alert" className="type-meta text-danger-fg">{error}</div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3
          sm:px-5">
          <Button type="button" variant="secondary"
            onClick={() => onResult(null)}>{t("Cancel")}</Button>
          <Button type="submit" disabled={!!error}>
            {confirmLabel ?? t("OK")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type DialogRequest = { id?: number } & (
  | { kind: "confirm"; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: "prompt"; opts: PromptOptions;
      resolve: (v: string | null) => void });

// The mounted DialogProvider's queue push; the functions below are plain
// module exports so non-component code (mailActions, handlers) can await them.
let pushDialog: ((r: DialogRequest) => void) | null = null;
let nextDialogId = 1;

const needProvider = () =>
  Promise.reject(new Error("confirmDialog/promptDialog need a <DialogProvider>"));

/** Resolves true on confirm; false on Cancel, Esc or backdrop. */
export const confirmDialog = (opts: ConfirmOptions): Promise<boolean> =>
  pushDialog
    ? new Promise((resolve) => pushDialog!({ kind: "confirm", opts, resolve }))
    : needProvider();

/** Resolves the entered text, or null when cancelled. */
export const promptDialog = (opts: PromptOptions): Promise<string | null> =>
  pushDialog
    ? new Promise((resolve) => pushDialog!({ kind: "prompt", opts, resolve }))
    : needProvider();

/** Mount once at the app root. Dialogs queue if several are requested. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  useEffect(() => {
    const push = (r: DialogRequest) =>
      setQueue((q) => [...q, { ...r, id: nextDialogId++ }]);
    pushDialog = push;
    return () => { if (pushDialog === push) pushDialog = null; };
  }, []);
  const cur = queue[0];
  const done = (fn: () => void) => { fn(); setQueue((q) => q.slice(1)); };
  return (
    <>
      {children}
      {cur?.kind === "confirm" && (
        <ConfirmDialog key={cur.id} {...cur.opts}
          onResult={(ok) => done(() => cur.resolve(ok))} />
      )}
      {cur?.kind === "prompt" && (
        <PromptDialog key={cur.id} {...cur.opts}
          onResult={(v) => done(() => cur.resolve(v))} />
      )}
    </>
  );
}

/* --------------------------------- mail row -------------------------------- */

/** The two-line per-mail row: `[checkbox] [unread dot] subject … trailing`,
 *  then `meta` (date · folder · sender · size). Clicking the text area
 *  calls `onOpen`; the checkbox and `trailing` (pin, badge) are their own
 *  targets, so `meta` must not contain interactive elements. Omit `onToggle`
 *  for rows without selection. */
export function MailRow({ checked = false, onToggle, unread = false, subject,
  meta, trailing, onOpen, selected = false, pinned = false,
  selectLabel }: {
  checked?: boolean; onToggle?: () => void; unread?: boolean;
  subject: ReactNode; meta?: ReactNode; trailing?: ReactNode;
  onOpen?: () => void; selected?: boolean; pinned?: boolean;
  selectLabel?: string;
}) {
  const text = (
    <>
      <span className="flex min-w-0 items-center gap-1.5">
        {unread && (
          <>
            <span aria-hidden className="inline-block size-2 shrink-0
              rounded-full bg-accent" />
            <span className="sr-only">{t("unread")}</span>
          </>
        )}
        <span className={`truncate type-body-mobile md:type-body ${unread
          ? "font-semibold md:font-semibold"
          : "font-medium md:font-medium"}`}>{subject}</span>
      </span>
      {meta != null && meta !== "" && (
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 type-meta
          text-muted">
          {typeof meta === "string"
            ? <span className="min-w-0 truncate">{meta}</span> : meta}
        </span>
      )}
    </>
  );
  return (
    <div data-pinned={pinned ? "true" : undefined}
      data-selected={selected ? "true" : undefined}
      className={`flex items-start gap-1 border-b border-line/60 px-3 py-3
        md:px-2 md:py-2.5 ${selected ? "border-l-2 border-l-accent bg-panel2"
          : pinned ? "border-l-2 border-l-accent bg-panel" : ""}`}>
      {onToggle && (
        <Checkbox checked={checked} onChange={onToggle}
          aria-label={selectLabel ?? t("Select mail")} />
      )}
      {onOpen ? (
        <button type="button" onClick={onOpen}
          className="min-w-0 flex-1 cursor-pointer py-1 text-left
            hover:underline">
          {text}
        </button>
      ) : <div className="min-w-0 flex-1 py-1">{text}</div>}
      {trailing != null && (
        <div className="flex shrink-0 items-center gap-1 self-start pt-0.5">
          {trailing}
        </div>
      )}
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
