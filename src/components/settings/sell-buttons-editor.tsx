"use client";

// Settings, Business and account: the quick discount and tip buttons of the Sell cart.
// Add, edit, remove, drag to reorder (or focus the handle and use the arrow keys), with a live preview.
import { useRef, useState } from "react";
import { GripVertical, Plus, X } from "lucide-react";
import { Button, MoneyInput, NumberInput, Segmented, cx } from "@/components/ui";
import { MAX_SELL_BUTTONS, MIN_SELL_BUTTONS, discountButtonLabel, moveItem, sellButtonsError, tipButtonLabel, type DiscountButton, type SellButtons } from "@/lib/sell-buttons";
import type { DiscountType } from "@/lib/types";

const iconBtn = "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";
const previewChip = "flex h-12 items-center rounded-xl border border-line bg-surface px-3.5 text-sm font-medium tabular-nums";

/** Pointer drag (mouse and touch) on a row's handle. The list reorders live while dragging. */
function useDragReorder<T>(list: T[], onChange: (next: T[]) => void) {
  const rows = useRef<(HTMLElement | null)[]>([]);
  const latest = useRef(list);
  latest.current = list;
  const from = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const moveTo = (to: number) => {
    if (from.current === null || to === from.current || to < 0 || to >= latest.current.length) return;
    onChange(moveItem(latest.current, from.current, to));
    from.current = to;
    setDragging(to);
  };
  const stop = () => {
    from.current = null;
    setDragging(null);
  };

  const row = (i: number) => (el: HTMLElement | null) => {
    rows.current[i] = el;
  };
  const handle = (i: number, label: string) => ({
    type: "button" as const,
    "aria-label": `Reorder ${label}. Drag, or use the arrow keys.`,
    title: "Drag to reorder",
    style: { touchAction: "none" as const },
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      from.current = i;
      setDragging(i);
    },
    onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (from.current === null) return;
      const over = rows.current.findIndex((el, j) => {
        if (!el || j >= latest.current.length) return false;
        const r = el.getBoundingClientRect();
        return e.clientY >= r.top && e.clientY <= r.bottom;
      });
      if (over >= 0) moveTo(over);
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const to = i + (e.key === "ArrowUp" ? -1 : 1);
      if (to < 0 || to >= latest.current.length) return;
      // Keep the keyboard focus on the item that moved. Rows are reused by position, so the handle
      // at the new position already exists: focus it right away, so a fast second key press follows the item.
      rows.current[to]?.querySelector<HTMLButtonElement>("[data-drag-handle]")?.focus();
      onChange(moveItem(latest.current, i, to));
    },
  });
  return { row, handle, dragging };
}

/** First amount from `steps` (then beyond) that is not already used, so "Add" never makes a duplicate. */
function freeValue(used: number[], start: number, step: number, max: number): number {
  for (let v = start; v <= max; v += step) if (!used.includes(v)) return v;
  return start;
}

export function SellButtonsEditor({ value, onChange }: { value: SellButtons; onChange: (v: SellButtons) => void }) {
  const setDiscounts = (discounts: DiscountButton[]) => onChange({ ...value, discounts });
  const setTips = (tips: number[]) => onChange({ ...value, tips });
  const dDrag = useDragReorder(value.discounts, setDiscounts);
  const tDrag = useDragReorder(value.tips, setTips);
  const error = sellButtonsError(value);

  const patchDiscount = (i: number, patch: Partial<DiscountButton>) => setDiscounts(value.discounts.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const usedOf = (type: DiscountType) => value.discounts.filter((b) => b.type === type).map((b) => b.value);
  const setType = (i: number, type: DiscountType) => {
    if (value.discounts[i].type === type) return;
    patchDiscount(i, { type, value: type === "%" ? freeValue(usedOf("%"), 10, 5, 100) : freeValue(usedOf("$"), 500, 500, 100000) });
  };

  return (
    <div className="space-y-7">
      {/* Discounts */}
      <div data-sell-buttons="discounts">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="font-medium">Discount buttons</h3>
          <span className="text-xs text-muted">
            {value.discounts.length} of {MAX_SELL_BUTTONS}
          </span>
        </div>
        <ul className="space-y-2">
          {value.discounts.map((b, i) => (
            // On phones the amount gets its own full-width line (it has - / + buttons and needs the room).
            <li key={i} ref={dDrag.row(i)} className={cx("flex flex-wrap items-center gap-1 rounded-xl transition sm:flex-nowrap", dDrag.dragging === i && "bg-accent/10 ring-1 ring-accent/40")}>
              <button {...dDrag.handle(i, `discount button ${discountButtonLabel(b)}`)} data-drag-handle className={cx(iconBtn, "cursor-grab active:cursor-grabbing")}>
                <GripVertical size={18} />
              </button>
              <Segmented<DiscountType>
                size="sm"
                className="w-28 shrink-0"
                value={b.type}
                onChange={(t) => setType(i, t)}
                options={[
                  { value: "$", label: "$" },
                  { value: "%", label: "%" },
                ]}
              />
              {b.type === "$" ? (
                <MoneyInput className="order-last w-full sm:order-none sm:w-auto sm:flex-1" label="discount amount" value={b.value} onChange={(c) => patchDiscount(i, { value: c ?? 0 })} />
              ) : (
                <NumberInput className="order-last w-full sm:order-none sm:w-auto sm:flex-1" label="discount percent" value={b.value} min={0} max={100} step={0.5} suffix="%" onChange={(n) => patchDiscount(i, { value: n ?? 0 })} />
              )}
              <button
                type="button"
                className={cx(iconBtn, "ml-auto sm:ml-0")}
                disabled={value.discounts.length <= MIN_SELL_BUTTONS}
                onClick={() => setDiscounts(value.discounts.filter((_, j) => j !== i))}
                aria-label={`Remove discount button ${discountButtonLabel(b)}`}
              >
                <X size={17} />
              </button>
            </li>
          ))}
        </ul>
        <Button
          className="mt-2"
          disabled={value.discounts.length >= MAX_SELL_BUTTONS}
          onClick={() => setDiscounts([...value.discounts, { type: "$", value: freeValue(usedOf("$"), 500, 500, 100000) }])}
        >
          <Plus size={17} /> Add discount button
        </Button>
      </div>

      {/* Tips */}
      <div data-sell-buttons="tips">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="font-medium">Tip buttons</h3>
          <span className="text-xs text-muted">
            {value.tips.length} of {MAX_SELL_BUTTONS}
          </span>
        </div>
        <ul className="space-y-2">
          {value.tips.map((c, i) => (
            <li key={i} ref={tDrag.row(i)} className={cx("flex items-center gap-1 rounded-xl transition", tDrag.dragging === i && "bg-accent/10 ring-1 ring-accent/40")}>
              <button {...tDrag.handle(i, `tip button ${tipButtonLabel(c)}`)} data-drag-handle className={cx(iconBtn, "cursor-grab active:cursor-grabbing")}>
                <GripVertical size={18} />
              </button>
              <MoneyInput className="min-w-0 flex-1" value={c} onChange={(v) => setTips(value.tips.map((x, j) => (j === i ? v ?? 0 : x)))} />
              <button
                type="button"
                className={iconBtn}
                disabled={value.tips.length <= MIN_SELL_BUTTONS}
                onClick={() => setTips(value.tips.filter((_, j) => j !== i))}
                aria-label={`Remove tip button ${tipButtonLabel(c)}`}
              >
                <X size={17} />
              </button>
            </li>
          ))}
        </ul>
        <Button className="mt-2" disabled={value.tips.length >= MAX_SELL_BUTTONS} onClick={() => setTips([...value.tips, freeValue(value.tips, 500, 500, 100000)])}>
          <Plus size={17} /> Add tip button
        </Button>
      </div>

      {/* Live preview: what the Sell cart will show */}
      <div data-sell-buttons-preview className="rounded-2xl bg-surface2/70 p-4">
        <div className="mb-3 text-sm font-medium">Preview: the Sell cart</div>
        <div className="mb-1.5 text-xs font-medium text-muted">Discount</div>
        <div className="flex flex-wrap gap-2">
          <span className={cx(previewChip, "border-dashed text-muted")}>Custom amount</span>
          {value.discounts.map((b, i) => (
            <span key={i} data-preview-discount className={previewChip}>
              {discountButtonLabel(b)}
            </span>
          ))}
        </div>
        <div className="mb-1.5 mt-4 text-xs font-medium text-muted">Tip</div>
        <div className="flex flex-wrap gap-2">
          <span className={previewChip}>None</span>
          {value.tips.map((c, i) => (
            <span key={i} data-preview-tip className={previewChip}>
              {tipButtonLabel(c)}
            </span>
          ))}
          <span className={cx(previewChip, "border-dashed text-muted")}>Custom</span>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-neg">
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted">
          Between {MIN_SELL_BUTTONS} and {MAX_SELL_BUTTONS} buttons per list. A % button takes that percent off the order subtotal; a discount is never more than the subtotal. Changing these never changes past orders.
        </p>
      )}
    </div>
  );
}
