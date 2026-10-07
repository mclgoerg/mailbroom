import { AlertCircle, Check, CheckCircle2, Info, Pin, Shield, X }
  from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId,
  useLayoutEffect, useMemo, useRef, useState, type ComponentProps,
  type ReactNode, type RefObject } from "react";
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

/** Shared look of every text link (an underlined button or anchor). The
 *  colour is inherited; add `text-accent` / `text-muted` where needed. */
export const LINK = "cursor-pointer underline hover:text-body";

/** Link in the accent colour; stays accent on hover. */
export const LINK_ACCENT = "cursor-pointer text-accent underline hover:text-accenth";

export type TagTone = "neutral" | "safe" | "review" | "keep" | "info"
  | "attach" | "new" | "accent";

const TAG_TONE: Record<TagTone, string> = {
  neutral: "bg-chip text-chiptext",
  safe: "bg-safe-bg text-safe-fg",
  review: "bg-review-bg text-review-fg",
  keep: "bg-keep-bg text-keep-fg",
  info: "bg-info-bg text-info-fg",
  attach: "bg-attach-bg text-attach-fg",
  new: "bg-new-bg text-new-fg",
  accent: "bg-chip text-accent",
};

/** Small badge (caption layer). `tone` picks a semantic bg/fg pair. */
export function Tag({ children, tone = "neutral", className = "" }: {
  children: ReactNode; tone?: TagTone; className?: string;
}) {
  return (
    <span className={`inline-block rounded-badge px-1.5 py-0.5 type-caption
      ${TAG_TONE[tone]} ${className}`}>
      {children}
    </span>
  );
}

const VERDICT_TONE: Record<string, TagTone> = {
  delete_safe: "safe",
  review: "review",
  keep: "keep",
};

export function AiTag({ ai }: { ai: GroupAi }) {
  return (
    <Tag tone={VERDICT_TONE[ai.verdict]}>
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
      type-caption text-muted"
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
      aria-label={t(on ? "unprotect.tip" : "protect.tip")}
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
      <Pin size={16} fill={on ? "currentColor" : "none"} />
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
            max-w-[min(18rem,calc(100vw-1rem))] rounded-card border
            border-line bg-panel p-3 text-left type-meta
            shadow-popover ${alignRight ? "right-0" : "left-0"}`}>
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
    <Tag tone="accent" className="whitespace-nowrap">
      <span title={t("pin.badge_tip", { n })}
        className="inline-flex items-center gap-0.5">
        <Pin size={14} fill="currentColor" /> {n}
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

/** Progress bar (theme tokens only). `max` 0 = not known yet: the bar stays
 *  empty. `indeterminate` = running with no done/total to show (sliding
 *  segment; static under reduced motion). `thin` = the 2 px strip used under
 *  the toolbar. */
export function ProgressBar({ value, max, label, className = "", thin = false,
  indeterminate = false }: {
  value: number; max: number; label?: string; className?: string;
  thin?: boolean; indeterminate?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((100 * value) / max)) : 0;
  const known = !indeterminate;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0}
      aria-valuemax={known && max > 0 ? max : undefined}
      aria-valuenow={known && max > 0 ? value : undefined}
      className={`${thin ? "h-0.5" : "h-2"} w-full overflow-hidden
        rounded-full bg-chip ${className}`}>
      {indeterminate
        ? <div className="pmc-indeterminate h-full w-1/3 rounded-full
            bg-accent" />
        : <div className="h-full rounded-full bg-accent transition-[width]
            duration-300" style={{ width: `${pct}%` }} />}
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
      gap-3 p-8 type-body text-muted ${className}`}>
      <Spinner size="lg" />
      <span>{label ?? t("loading…")}</span>
    </div>
  );
}

/** Shared disabled look for Button / controls / MenuItem: flat chip fill,
 *  faint text, no opacity (a disabled red button must not read as an alarm). */
const DISABLED = "disabled:cursor-not-allowed disabled:bg-chip disabled:text-faint";

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger"
  | "danger-quiet";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent enabled:hover:bg-accenth text-white",
  secondary: "bg-chip enabled:hover:bg-chiph text-body",
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
        <div className="truncate type-heading">{title}</div>
        {sub != null && sub !== "" && (
          <div className="truncate type-meta text-muted">{sub}</div>
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

/** The filter-input row of the main toolbar (row B): the group filter and the
 *  All-mails filter both use it, so switching views never moves anything.
 *  `relative` anchors the QueryBuilder popover. */
export const FILTER_ROW = "relative mb-2 flex flex-wrap items-center gap-2";

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

/** Dropdown menu: a trigger button plus a popover - right-aligned by
 * default, flipped to left-aligned when that would run off the left edge
 * of the screen (a trigger that wrapped to the start of a row on a
 * phone). Closes
 * on outside click, Escape, or after any click inside (items just run
 * their onClick). Sits BELOW modals (z-modal). */
export function Menu({ trigger, label, variant, icon, children }: {
  trigger: ReactNode;
  label?: string;                 // accessible name / tooltip
  /** Render the trigger as a design-system `Button` of this variant (a
   *  labelled "Tools ▾" button, or with `icon` a square icon button whose
   *  `label` is then required). Without it: the compact header trigger. */
  variant?: ButtonVariant;
  icon?: boolean;
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
      {variant && icon ? (
        <Button variant={variant} size="icon" label={label ?? ""}
          aria-haspopup="menu" aria-expanded={open}
          onClick={() => setOpen(!open)}>
          {trigger}
        </Button>
      ) : variant ? (
        <Button variant={variant} aria-haspopup="menu" aria-expanded={open}
          className="inline-flex items-center gap-1.5"
          onClick={() => setOpen(!open)}>
          {trigger}
        </Button>
      ) : (
        <button className="flex min-h-8 items-center rounded-control border
          border-line bg-panel2 px-2 type-body hover:bg-chip"
          title={label} aria-label={label} aria-expanded={open}
          onClick={() => setOpen(!open)}>
          {trigger}
        </button>
      )}
      {open && (
        <div ref={pop}
          className={`absolute top-full z-(--z-dropdown) mt-1 min-w-52
            max-w-[calc(100vw-1rem)] rounded-card border border-line bg-panel
            p-1 shadow-popover ${alignLeft ? "left-0" : "right-0"}`}
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
  const dims = size === "md" ? "size-8 type-meta" : "size-5 type-caption";
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
      type-meta text-muted">
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

// Open modals, oldest first (module-level: dialogs opened from anywhere).
const openModals: symbol[] = [];

/** True while any Modal (panel or confirm/prompt dialog) is mounted. Global
 *  keyboard shortcuts must stay quiet then. */
export const isModalOpen = (): boolean => openModals.length > 0;

const MODAL_WIDTH = { sm: "sm:max-w-md", md: "sm:max-w-2xl",
  lg: "sm:max-w-3xl" };   // 448 / 672 / 768 px

/** Dialog shell. `sm` (448) is a bottom sheet on phones, `md` (672) /
 *  `lg` (768) are full-screen there. `full` = `lg` at a fixed 88vh; other
 *  modals shrink to their content. `label` / `labelledBy` / `describedBy` name it for AT. */
export function Modal({ children, onClose, full = false, size, label,
  labelledBy, describedBy }: {
  children: ReactNode; onClose: () => void; full?: boolean;
  size?: "sm" | "md" | "lg"; label?: string;
  labelledBy?: string; describedBy?: string;
}) {
  const sz = size ?? (full ? "lg" : "md");
  const id = useRef(Symbol("modal")).current;
  // The listener calls the latest onClose; the effect itself depends on
  // [id] only, so a parent re-render (inline onClose) never re-registers
  // the modal and reshuffles the stack.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Layout effect: the stack is current as soon as the modal is in the DOM,
  // before any key event can arrive.
  useLayoutEffect(() => {
    openModals.push(id);
    const onKey = (e: KeyboardEvent) => {
      // Only the topmost modal reacts, so Esc on a confirm that sits over
      // a panel closes the confirm and leaves the panel open.
      if (e.key === "Escape" && openModals[openModals.length - 1] === id) {
        closeRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      openModals.splice(openModals.indexOf(id), 1);
    };
  }, [id]);
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
      <div role="dialog" aria-modal="true" aria-label={label}
        aria-labelledby={labelledBy} aria-describedby={describedBy}
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
      coarse:min-w-11 cursor-pointer items-center gap-2 type-body
      ${label != null ? "justify-start" : "shrink-0 justify-center"}
      ${rest.disabled ? "cursor-not-allowed text-faint" : ""}
      ${className}`}>
      <input type="checkbox"
        className="size-4.5 shrink-0 cursor-[inherit] accent-accent"
        {...rest} />
      {label != null && <span className="min-w-0">{label}</span>}
    </label>
  );
}

/** Toggle chip (quick filters / presets). On = accent border + check. */
export function Chip({ on = false, children, className = "", ...rest }:
  Omit<ComponentProps<"button">, "type"> & { on?: boolean }) {
  return (
    <button type="button" aria-pressed={on} {...rest}
      className={`inline-flex min-h-8 coarse:min-h-9 items-center gap-1.5
        whitespace-nowrap rounded-full border px-3 type-meta transition-colors
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
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={label != null ? labelId : undefined}
      className={`inline-flex min-h-8 coarse:min-h-9
      items-stretch overflow-hidden rounded-full border border-line
      bg-panel2 type-meta ${className}`}>
      {label != null && (
        <span id={labelId}
          className="flex items-center pl-3 pr-1.5 text-muted">
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
      className={`flex items-center whitespace-nowrap border-l border-line
        px-3 transition-colors focus-visible:-outline-offset-2 enabled:active:translate-y-px
        disabled:cursor-not-allowed disabled:bg-chip disabled:text-faint
        ${on ? "bg-chiph text-body ring-1 ring-inset ring-accent"
          : "text-muted enabled:hover:bg-chip"} ${className}`}>
      {children}
    </button>
  );
}

/** Segmented control for mutually exclusive views (tablist). The selected
 *  segment is the quiet "current" style (chiph + accent inset ring), never
 *  the solid accent that belongs to the one primary Button. `fill` makes
 *  the segments equal-width across the full row. */
export function Segmented<T extends string>({ value, onChange, options,
  label, fill = false, className = "" }: {
  value: T | null;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
  fill?: boolean;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label}
      className={`inline-flex items-stretch overflow-hidden rounded-control
        border border-line bg-panel2 ${fill ? "w-full" : ""} ${className}`}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="tab" aria-selected={on}
            onClick={() => onChange(o.value)}
            className={`min-h-9 coarse:min-h-10 min-w-0 whitespace-nowrap
              px-1.5 transition-colors type-meta md:type-body md:px-3
              focus-visible:-outline-offset-2 enabled:active:translate-y-px
              ${fill ? "flex-1" : ""} ${i > 0 ? "border-l border-line" : ""}
              ${on ? "bg-chiph font-medium text-body ring-1 ring-inset ring-accent"
                : "text-muted hover:bg-chip"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Live `matchMedia` flag (false where matchMedia doesn't exist, e.g.
 *  jsdom: components then render their wide layout). */
export function useMediaQuery(query: string): boolean {
  const get = () => typeof window.matchMedia === "function"
    && window.matchMedia(query).matches;
  const [match, setMatch] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
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

const TOAST_ICON = { info: Info, success: CheckCircle2, error: AlertCircle };

// `dismiss` is stable and the timer depends only on [ms, id, dismiss], so a
// re-render (another toast arriving, parent updates) never restarts it.
function ToastView({ toast, dismiss }: {
  toast: ToastItem; dismiss: (id: number) => void;
}) {
  const { variant = "info", action, duration, id } = toast;
  const ms = duration ?? (variant === "error" ? 0 : TOAST_MS);
  const onDismiss = () => dismiss(id);
  useEffect(() => {
    if (ms <= 0) return;
    const timer = setTimeout(() => dismiss(id), ms);
    return () => clearTimeout(timer);
  }, [ms, id, dismiss]);
  const Icon = TOAST_ICON[variant];
  return (
    <div data-variant={variant}
      role={variant === "error" ? "alert" : undefined}
      className={`pointer-events-auto flex
      w-full max-w-120 items-center gap-2 rounded-card border py-1.5 pl-3
      pr-1.5 shadow-bar type-body ${TOAST_STYLE[variant]}`}>
      <Icon size={16} aria-hidden className={`shrink-0 ${variant === "error"
        ? "text-danger-fg" : ""}`} />
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

/** Publishes the height of a fixed bottom bar as `--bulkbar-h` while
 *  `active`, so the toast stack (`.pmc-toasts`) sits above it. */
export function useBulkBarHeight(ref: RefObject<HTMLElement | null>,
    active: boolean) {
  useEffect(() => {
    const root = document.documentElement.style;
    const el = ref.current;
    if (!active || !el) return;
    const sync = () => root.setProperty("--bulkbar-h", `${el.offsetHeight}px`);
    sync();
    const ro = typeof ResizeObserver === "undefined"
      ? null : new ResizeObserver(sync);
    ro?.observe(el);
    return () => { ro?.disconnect(); root.removeProperty("--bulkbar-h"); };
  }, [ref, active]);
}

/** Mount once at the app root; `useToast()` anywhere below. Toasts stack
 *  bottom-centre above the bulk bar (`--bulkbar-h`) and the safe area, and
 *  above modals; they never take focus. */
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
      <div aria-live="polite" className="pmc-toasts pointer-events-none fixed
        inset-x-0 z-(--z-toast) flex flex-col items-center gap-2 px-3">
        {items.map((x) => (
          <ToastView key={x.id} toast={x} dismiss={dismiss} />
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
  const titleId = useId();
  const bodyId = useId();
  const hasBody = body != null || (bullets?.length ?? 0) > 0;
  useEffect(() => {
    (tone === "danger" ? safe : ok).current?.focus();
  }, [tone]);
  return (
    <Modal size="sm" labelledBy={titleId}
      describedBy={hasBody ? bodyId : undefined}
      onClose={() => onResult(false)}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        <div id={titleId} className="type-heading">{title}</div>
        {hasBody && (
          <div id={bodyId} className="space-y-3 type-body text-muted">
            {body != null && <div>{body}</div>}
            {bullets && bullets.length > 0 && (
              <ul className="list-disc space-y-1 pl-5">
                {bullets.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            )}
          </div>
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

/** Single-field prompt. Submit stays enabled: with an invalid value it shows
 *  the `validate` message instead of closing (also for the initial value,
 *  and when Enter is pressed). */
export function PromptDialog({ title, label, initial = "", confirmLabel,
  validate, onResult }: PromptOptions & {
  onResult: (value: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  const error = validate?.(value) ?? null;
  return (
    <Modal size="sm" labelledBy={titleId} onClose={() => onResult(null)}>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(e) => {
        e.preventDefault();
        if (error) setTouched(true); else onResult(value);
      }}>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
          <div id={titleId} className="type-heading">{title}</div>
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
          <Button type="submit">{confirmLabel ?? t("OK")}</Button>
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

const cancelRequest = (r: DialogRequest) =>
  r.kind === "confirm" ? r.resolve(false) : r.resolve(null);

/** Mount once at the app root (main.tsx). Dialogs queue if several are
 *  requested; pending ones settle as cancelled on unmount, and focus goes
 *  back to where it was when a dialog closes. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const live = useRef<DialogRequest[]>([]);
  live.current = queue;
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const push = (r: DialogRequest) => {
      // Remember the opener now, before the dialog's autofocus moves focus.
      if (!live.current.length) {
        opener.current = document.activeElement as HTMLElement | null;
      }
      setQueue((q) => [...q, { ...r, id: nextDialogId++ }]);
    };
    pushDialog = push;
    return () => {
      if (pushDialog === push) pushDialog = null;
      live.current.forEach(cancelRequest);
    };
  }, []);
  const cur = queue[0];
  const hadCur = useRef(false);
  useEffect(() => {
    if (!cur && hadCur.current) {
      opener.current?.focus?.();
      opener.current = null;
    }
    hadCur.current = !!cur;
  }, [cur]);
  const done = (r: DialogRequest, fn: () => void) => {
    fn();
    setQueue((q) => q.filter((x) => x.id !== r.id));
  };
  return (
    <>
      {children}
      {cur?.kind === "confirm" && (
        <ConfirmDialog key={cur.id} {...cur.opts}
          onResult={(ok) => done(cur, () => cur.resolve(ok))} />
      )}
      {cur?.kind === "prompt" && (
        <PromptDialog key={cur.id} {...cur.opts}
          onResult={(v) => done(cur, () => cur.resolve(v))} />
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
        <span className={`truncate type-body-mobile md:type-body
          group-hover:underline ${unread
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
      className={`flex items-start gap-1 border-b border-l-2 border-b-line/60
        px-3 py-3 md:px-2 md:py-2.5 ${selected
          ? "border-l-accent bg-panel2"
          : pinned ? "border-l-accent bg-panel" : "border-l-transparent"}`}>
      {onToggle && (
        <Checkbox checked={checked} onChange={onToggle}
          className="-my-1.5 coarse:-mt-2.5 coarse:-mb-0.5"
          aria-label={selectLabel ?? t("Select mail")} />
      )}
      {onOpen ? (
        <button type="button" onClick={onOpen}
          className="group min-w-0 flex-1 cursor-pointer text-left">
          {text}
        </button>
      ) : <div className="min-w-0 flex-1">{text}</div>}
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
