"use client";

import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { centsToInput, fmtMoney, parseMoney } from "@/lib/format";
import { stepValue } from "@/lib/size";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------------------------------------------------------------- Button
type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "soft";
const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition active:scale-[.98] disabled:pointer-events-none disabled:opacity-40 select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";
const btnVariants: Record<BtnVariant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110 shadow-sm",
  secondary: "bg-surface text-ink border border-line hover:bg-surface2",
  soft: "bg-accent/10 text-accent hover:bg-accent/15",
  ghost: "text-ink hover:bg-surface2",
  danger: "bg-neg text-white hover:brightness-110",
};
const btnSizes = { sm: "h-9 px-3 text-sm", md: "h-11 px-4 text-[15px]", lg: "h-14 px-5 text-base" };

export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: keyof typeof btnSizes; block?: boolean }
>(function Button({ variant = "secondary", size = "md", block, className, ...p }, ref) {
  return (
    <button
      ref={ref}
      type={p.type ?? "button"}
      className={cx(btnBase, btnVariants[variant], btnSizes[size], block && "w-full", className)}
      {...p}
    />
  );
});

export function IconButton({
  label,
  className,
  ...p
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted transition hover:bg-surface2 hover:text-ink active:scale-95",
        className,
      )}
      {...p}
    />
  );
}

// ---------------------------------------------------------------- Layout bits
export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("rounded-2xl border border-line bg-surface", className)} {...p} />;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <div className="mt-0.5 text-sm text-muted">{sub}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2 mt-8 flex items-center justify-between">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{children}</h2>
      {right}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-shimmer rounded-xl bg-surface2", className)} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-40" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    </div>
  );
}

export function Empty({
  icon,
  title,
  body,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      {icon && <div className="mb-3 text-muted">{icon}</div>}
      <div className="font-medium">{title}</div>
      {body && <p className="mt-1 max-w-xs text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Money({
  cents,
  colored,
  sign,
  className,
}: {
  cents: number;
  colored?: boolean | "neg";
  sign?: boolean;
  className?: string;
}) {
  const color =
    colored && cents < 0 ? "text-neg" : colored === true && cents > 0 ? "text-pos" : undefined;
  return <span className={cx("tabular-nums", color, className)}>{fmtMoney(cents, { sign })}</span>;
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warn" | "neg" | "pos" | "accent" }) {
  const tones = {
    neutral: "bg-surface2 text-muted",
    warn: "bg-warn/15 text-warn",
    neg: "bg-neg/12 text-neg",
    pos: "bg-pos/12 text-pos",
    accent: "bg-accent/12 text-accent",
  };
  return <span className={cx("inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

// ---------------------------------------------------------------- Form fields
export function Field({ label, hint, children, className, tag }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string; /** Small pill after the label, e.g. "Recommended". */ tag?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 flex items-center gap-2 text-sm font-medium text-muted">
        {label}
        {tag && <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent">{tag}</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "h-12 w-full rounded-xl border border-line bg-bg px-3.5 text-base text-ink placeholder:text-muted/70 transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...p },
  ref,
) {
  return <input ref={ref} className={cx(inputCls, className)} {...p} />;
});

export function Select({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(inputCls, "appearance-none pr-8", className)} {...p} />;
}

export function Textarea({ className, ...p }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(inputCls, "h-auto min-h-[76px] py-3", className)} {...p} />;
}

// ---------------------------------------------------------------- Number fields with - / + buttons
// Every number typed in the admin goes through NumberInput or MoneyInput, so they all look and behave
// the same: a bordered field with "-" on the left and "+" on the right (44px wide, 48px tall, easy to
// tap on a phone), and typing still works. The <input> comes FIRST in the DOM and the buttons are moved
// into place with CSS order: a <Field> is a <label>, and a label forwards clicks to its first labelable
// child, which must be the input, never the "-" button.
const stepShell =
  "flex h-12 w-full min-w-0 items-stretch overflow-hidden rounded-xl border border-line bg-bg transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20";
const stepBtn =
  "flex w-11 shrink-0 select-none items-center justify-center text-xl leading-none text-muted transition hover:bg-surface2 hover:text-ink active:bg-surface2 disabled:pointer-events-none disabled:opacity-30 focus-visible:bg-surface2 focus-visible:text-ink focus-visible:outline-none";
const stepInput =
  "h-full w-full min-w-0 bg-transparent text-center text-base tabular-nums text-ink placeholder:text-muted/70 focus:outline-none";

function StepShell({ onStep, canDec, canInc, label, children }: { onStep: (dir: -1 | 1) => void; canDec: boolean; canInc: boolean; label?: string; children: React.ReactNode }) {
  return (
    <div className={stepShell} data-stepper>
      {children}
      <button type="button" aria-label={label ? `Decrease ${label}` : "Decrease value"} className={cx(stepBtn, "order-first border-r border-line")} disabled={!canDec} onClick={() => onStep(-1)}>
        −
      </button>
      <button type="button" aria-label={label ? `Increase ${label}` : "Increase value"} className={cx(stepBtn, "border-l border-line")} disabled={!canInc} onClick={() => onStep(1)}>
        +
      </button>
    </div>
  );
}

/** Dollar input that reports cents. Keeps the typed text while focused. "-" / "+" move by `step` cents ($1 by default). */
export function MoneyInput({
  value,
  onChange,
  allowNegative,
  placeholder = "0.00",
  className,
  autoFocus,
  nullable,
  step = 100,
  min,
  max,
  label,
}: {
  value: number | null;
  onChange: (cents: number | null) => void;
  allowNegative?: boolean;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  nullable?: boolean;
  /** Cents per "-" / "+" press. */
  step?: number;
  min?: number;
  max?: number;
  /** Names the buttons for screen readers ("Increase Total cost"). */
  label?: string;
}) {
  const [text, setText] = useState(centsToInput(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(centsToInput(value));
  }, [value]);
  const lo = min ?? (allowNegative ? -Infinity : 0);
  const hi = max ?? Infinity;
  // An empty optional field steps from what its placeholder shows (e.g. the average cost).
  const base = value ?? parseMoney(placeholder) ?? 0;
  return (
    <div className={cx("min-w-0", className)}>
      <StepShell
        label={label}
        canDec={base > lo}
        canInc={base < hi}
        onStep={(d) => {
          const next = stepValue(base, d, step, lo, hi);
          setText(centsToInput(next));
          onChange(next);
        }}
      >
      <div className="relative min-w-0 flex-1">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted">$</span>
      <input
        inputMode="decimal"
        autoFocus={autoFocus}
        className={cx(stepInput, "pl-6 pr-2")}
        placeholder={placeholder}
        value={text}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onBlur={() => {
          focused.current = false;
          setText(centsToInput(value));
        }}
        onChange={(e) => {
          let t = e.target.value.replace(/[^0-9.\-]/g, "");
          if (!allowNegative) t = t.replace(/-/g, "");
          setText(t);
          const c = parseMoney(t);
          onChange(c === null ? (nullable ? null : 0) : c);
        }}
      />
      </div>
      </StepShell>
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  allowNegative,
  className,
  suffix,
  nullable,
  placeholder,
  label,
}: {
  value: number | null;
  onChange: (n: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  allowNegative?: boolean;
  className?: string;
  suffix?: string;
  nullable?: boolean;
  placeholder?: string;
  /** Names the buttons for screen readers ("Increase Quantity"). */
  label?: string;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value === null ? "" : String(value));
  }, [value]);
  const inc = step ?? 1;
  const lo = min ?? (allowNegative ? -Infinity : 0);
  const hi = max ?? Infinity;
  // An empty optional field steps from what its placeholder shows (e.g. the store-wide default).
  const fromPlaceholder = placeholder !== undefined && placeholder.trim() !== "" && Number.isFinite(Number(placeholder)) ? Number(placeholder) : null;
  const base = value ?? fromPlaceholder;
  return (
    <div className={cx("min-w-0", className)}>
      <StepShell
        label={label}
        canDec={base !== null && base > lo}
        canInc={base === null || base < hi}
        onStep={(d) => {
          // Empty with no number to start from: the first press fills in the minimum (or 0).
          const next = base === null ? Math.min(hi, Math.max(lo, 0)) : stepValue(base, d, inc, lo, hi);
          setText(String(next));
          onChange(next);
        }}
      >
      <div className="relative min-w-0 flex-1">
      <input
        inputMode={step && step < 1 ? "decimal" : allowNegative ? "text" : "numeric"}
        className={cx(stepInput, "px-2", suffix && "pr-9")}
        value={text}
        placeholder={placeholder}
        onFocus={(e) => {
          focused.current = true;
          e.currentTarget.select();
        }}
        onBlur={() => {
          focused.current = false;
          setText(value === null ? "" : String(value));
        }}
        onChange={(e) => {
          let t = e.target.value.replace(step && step < 1 ? /[^0-9.\-]/g : /[^0-9\-]/g, "");
          if (!allowNegative) t = t.replace(/-/g, "");
          setText(t);
          if (t === "" || t === "-") return onChange(nullable ? null : 0);
          let n = Number(t);
          if (!Number.isFinite(n)) return;
          if (min !== undefined) n = Math.max(min, n);
          if (max !== undefined) n = Math.min(max, n);
          onChange(n);
        }}
      />
      {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted">{suffix}</span>}
      </div>
      </StepShell>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    // Equal grid columns: every pill is the same width and height and always wraps its whole label.
    <div className={cx("grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-surface2 p-1", className)} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "flex min-w-0 items-center justify-center whitespace-nowrap rounded-lg px-4 font-medium transition",
            size === "sm" ? "h-8 text-sm" : "h-10 text-[15px]",
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 py-1">
      <span className="flex-1">
        <span className="block text-[15px]">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted">{hint}</span>}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input id={id} type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-7 w-12 rounded-full bg-line transition peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40" />
        <span className="absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

// ---------------------------------------------------------------- Sheet / modal
/**
 * Shared stack of open sheets. The page scroll is locked while at least one sheet is open and
 * released when the last one closes, whatever order they close in. (Each sheet saving and
 * restoring body.overflow on its own could leave the page stuck on "hidden" when two closed together.)
 */
const sheetStack: object[] = [];
function syncScrollLock() {
  document.body.style.overflow = sheetStack.length > 0 ? "hidden" : "";
}
function pushSheet(t: object) {
  sheetStack.push(t);
  syncScrollLock();
}
function popSheet(t: object) {
  const i = sheetStack.indexOf(t);
  if (i >= 0) sheetStack.splice(i, 1);
  syncScrollLock();
}
const isTopSheet = (t: object) => sheetStack[sheetStack.length - 1] === t;

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
    } else if (mounted) {
      setClosing(true);
      const t = setTimeout(() => {
        setMounted(false);
        setClosing(false);
      }, 180);
      return () => clearTimeout(t);
    }
  }, [open, mounted]);

  // Keep the latest onClose without re-running the lock effect on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const token = {};
    pushSheet(token);
    const onKey = (e: KeyboardEvent) => {
      // Only the top-most open sheet reacts, so one Escape closes one sheet.
      if (e.key === "Escape" && isTopSheet(token)) onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      popSheet(token);
    };
  }, [open]);

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
      <div
        className={cx("absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity duration-200", closing ? "opacity-0" : "animate-fade-in")}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          "relative flex max-h-[92dvh] w-full flex-col rounded-t-[22px] bg-surface shadow-2xl transition duration-200 md:rounded-2xl",
          wide ? "md:max-w-2xl" : "md:max-w-lg",
          closing ? "translate-y-full opacity-0 md:translate-y-2" : "animate-sheet-up md:animate-pop-in",
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line md:hidden" />
        {title && (
          <div className="flex shrink-0 items-center justify-between gap-2 px-5 pb-2 pt-3 md:pt-5">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            <IconButton label="Close" onClick={onClose} className="-mr-2">
              <X size={20} />
            </IconButton>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-line px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 md:pb-4">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- Confirm dialog
interface ConfirmOpts {
  title: string;
  body?: React.ReactNode;
  confirmText?: string;
  danger?: boolean;
  /** Require typing this word to enable the confirm button. */
  typeToConfirm?: string;
}
const ConfirmCtx = createContext<((o: ConfirmOpts) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const confirm = useCallback(
    (o: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        setTyped("");
        setState({ ...o, resolve });
        setOpen(true);
      }),
    [],
  );
  const close = (v: boolean) => {
    state?.resolve(v);
    setOpen(false);
  };
  const blocked = !!state?.typeToConfirm && typed !== state.typeToConfirm;
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Sheet open={open} onClose={() => close(false)} title={state?.title}>
        {state?.body && <div className="text-[15px] text-muted">{state.body}</div>}
        {state?.typeToConfirm && (
          <Field label={`Type ${state.typeToConfirm} to confirm`} className="mt-4">
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus autoCapitalize="characters" />
          </Field>
        )}
        <div className="mt-6 flex gap-2 pb-[env(safe-area-inset-bottom)]">
          <Button block onClick={() => close(false)}>
            Cancel
          </Button>
          <Button block variant={state?.danger ? "danger" : "primary"} disabled={blocked} onClick={() => close(true)}>
            {state?.confirmText ?? "Confirm"}
          </Button>
        </div>
      </Sheet>
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const c = useContext(ConfirmCtx);
  if (!c) throw new Error("useConfirm outside ConfirmProvider");
  return c;
}

export function Stepper({ value, onChange, min = 1 }: { value: number; onChange: (n: number) => void; min?: number }) {
  return (
    <div className="flex items-center rounded-xl border border-line">
      <button
        type="button"
        aria-label="Decrease"
        className="h-11 w-11 text-lg text-muted transition hover:text-ink active:scale-90 disabled:opacity-30"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span className="w-8 text-center font-medium tabular-nums">{value}</span>
      <button
        type="button"
        aria-label="Increase"
        className="h-11 w-11 text-lg text-muted transition hover:text-ink active:scale-90"
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

export function Row({ label, children, strong, className }: { label: React.ReactNode; children: React.ReactNode; strong?: boolean; className?: string }) {
  return (
    <div className={cx("flex items-center justify-between py-1", strong ? "text-base font-semibold" : "text-[15px]", className)}>
      <span className={strong ? undefined : "text-muted"}>{label}</span>
      <span className="tabular-nums">{children}</span>
    </div>
  );
}
