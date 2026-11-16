"use client";

// Actions dropdown for a row. Pattern from the VALO admin's RowMenu: opens on click (works on a phone),
// Escape closes and returns focus, arrow keys move through items, a disabled item keeps its reason.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { cx } from "./ui";

export interface RowMenuItem {
  label: string;
  onSelect?: () => void | Promise<void>;
  /** An external link instead of an action (opens in a new tab). */
  href?: string;
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
}

export function RowMenu({ items, label = "Actions", describedRow }: { items: RowMenuItem[]; label?: string; describedRow?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const width = 232;
    const estHeight = items.length * 46 + 12;
    const up = r.bottom + estHeight > window.innerHeight - 12 && r.top > estHeight;
    setPos({ top: up ? r.top - 6 : r.bottom + 6, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)), up });
  }, [open, items.length]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (listRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener("pointerdown", close);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  useEffect(() => {
    if (open && pos) listRef.current?.querySelector<HTMLElement>("[data-menuitem]:not([aria-disabled='true'])")?.focus();
  }, [open, pos]);

  function close(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const nodes = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-menuitem]") ?? [])].filter((n) => n.getAttribute("aria-disabled") !== "true");
    const at = nodes.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") (e.preventDefault(), close());
    else if (e.key === "ArrowDown") (e.preventDefault(), nodes[(at + 1) % nodes.length]?.focus());
    else if (e.key === "ArrowUp") (e.preventDefault(), nodes[at <= 0 ? nodes.length - 1 : at - 1]?.focus());
    else if (e.key === "Tab") setOpen(false);
  }

  const itemCls = "flex w-full flex-col items-start rounded-lg px-3 py-2.5 text-left text-[15px] transition hover:bg-surface2 focus:bg-surface2 focus:outline-none";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition hover:bg-surface2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        {label}
        {describedRow && <span className="sr-only"> for {describedRow}</span>}
        <ChevronDown size={15} className={cx("text-muted transition", open && "rotate-180")} />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={listRef}
            id={`${id}-menu`}
            role="menu"
            aria-label={describedRow ? `${label} for ${describedRow}` : label}
            onKeyDown={onKeyDown}
            onClick={(e) => e.stopPropagation()}
            style={{ top: pos.top, left: pos.left, width: 232, transform: pos.up ? "translateY(-100%)" : undefined }}
            className="fixed z-[60] animate-fade-in rounded-xl border border-line bg-surface p-1.5 shadow-xl"
          >
            {items.map((item, i) =>
              item.href && !item.disabled ? (
                <a key={i} data-menuitem role="menuitem" className={itemCls} href={item.href} target="_blank" rel="noreferrer" onClick={() => (close(false), item.onSelect?.())}>
                  {item.label}
                </a>
              ) : (
                <button
                  key={i}
                  data-menuitem
                  role="menuitem"
                  type="button"
                  aria-disabled={item.disabled ? "true" : undefined}
                  title={item.disabled ? item.disabledReason : undefined}
                  className={cx(itemCls, item.danger && "text-neg", item.disabled && "cursor-not-allowed opacity-55 hover:bg-transparent")}
                  onClick={async () => {
                    if (item.disabled) return;
                    close(false);
                    await item.onSelect?.();
                  }}
                >
                  <span>{item.label}</span>
                  {item.disabled && item.disabledReason && <span className="mt-0.5 text-xs text-muted">{item.disabledReason}</span>}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
