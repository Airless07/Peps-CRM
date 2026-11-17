// Quick discount and tip buttons in the Sell cart. Edited in Settings, Business and account.
// Pure. The buttons only fill in the order's discount / tip: an order stores the amount itself,
// so changing the buttons later never changes a past order.
import type { DiscountType } from "./types";

export interface DiscountButton {
  type: DiscountType;
  /** Cents when type is "$", percent when "%". */
  value: number;
}

export interface SellButtons {
  discounts: DiscountButton[];
  /** Tip amounts in cents. */
  tips: number[];
}

export const MIN_SELL_BUTTONS = 1;
export const MAX_SELL_BUTTONS = 8;
const MAX_CENTS = 1_000_000_00;

export const DEFAULT_SELL_BUTTONS: SellButtons = {
  discounts: [
    { type: "$", value: 500 },
    { type: "$", value: 1000 },
    { type: "$", value: 2000 },
    { type: "%", value: 10 },
  ],
  tips: [500, 1000, 2000],
};

export const defaultSellButtons = (): SellButtons => structuredClone(DEFAULT_SELL_BUTTONS);

const dollars = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

/** "-$5", "-$2.50", "-10%" */
export const discountButtonLabel = (b: DiscountButton) => (b.type === "%" ? `-${b.value}%` : `-$${dollars(b.value)}`);
/** "$5", "$2.50" */
export const tipButtonLabel = (cents: number) => `$${dollars(cents)}`;

const validDiscount = (b: DiscountButton) =>
  b.type === "%" ? Number.isFinite(b.value) && b.value > 0 && b.value <= 100 : Number.isInteger(b.value) && b.value > 0 && b.value <= MAX_CENTS;
const validTip = (c: number) => Number.isInteger(c) && c > 0 && c <= MAX_CENTS;
const discountKey = (b: DiscountButton) => `${b.type}${b.value}`;

/** Why these buttons can't be saved, or null when they are fine. */
export function sellButtonsError(b: SellButtons): string | null {
  for (const [name, list] of [["discount", b.discounts], ["tip", b.tips]] as const) {
    if (list.length < MIN_SELL_BUTTONS) return `Keep at least ${MIN_SELL_BUTTONS} ${name} button`;
    if (list.length > MAX_SELL_BUTTONS) return `No more than ${MAX_SELL_BUTTONS} ${name} buttons`;
  }
  if (b.discounts.some((d) => !validDiscount(d))) return "Each discount button needs an amount above 0 (a percent can't be over 100)";
  if (b.tips.some((t) => !validTip(t))) return "Each tip button needs an amount above $0";
  if (new Set(b.discounts.map(discountKey)).size !== b.discounts.length) return "Two discount buttons are the same";
  if (new Set(b.tips).size !== b.tips.length) return "Two tip buttons are the same";
  return null;
}

/**
 * Read stored buttons (JSON text or an object). Anything invalid or repeated is dropped, the saved
 * order is kept, and a list that ends up empty falls back to its default.
 */
export function cleanSellButtons(v: unknown): SellButtons {
  let raw: unknown = v;
  if (typeof v === "string") {
    try {
      raw = v ? JSON.parse(v) : null;
    } catch {
      raw = null;
    }
  }
  const o = (raw && typeof raw === "object" ? raw : {}) as { discounts?: unknown; tips?: unknown };
  const discounts: DiscountButton[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(o.discounts) ? o.discounts : []) {
    const b = x as Partial<DiscountButton> | null;
    if (!b || (b.type !== "$" && b.type !== "%") || typeof b.value !== "number") continue;
    const clean: DiscountButton = { type: b.type, value: b.value };
    if (!validDiscount(clean) || seen.has(discountKey(clean))) continue;
    seen.add(discountKey(clean));
    discounts.push(clean);
  }
  const tips: number[] = [];
  for (const x of Array.isArray(o.tips) ? o.tips : []) {
    if (typeof x !== "number" || !validTip(x) || tips.includes(x)) continue;
    tips.push(x);
  }
  return {
    discounts: discounts.length ? discounts.slice(0, MAX_SELL_BUTTONS) : defaultSellButtons().discounts,
    tips: tips.length ? tips.slice(0, MAX_SELL_BUTTONS) : defaultSellButtons().tips,
  };
}

type HasDiscount = { discountType: DiscountType; discountValue: number };

export const isDiscountButtonOn = (order: HasDiscount, b: DiscountButton) => order.discountType === b.type && order.discountValue === b.value;

/** Tap a discount button: sets that discount, or clears it when it is already on. */
export function tapDiscountButton<T extends HasDiscount>(order: T, b: DiscountButton): T {
  return isDiscountButtonOn(order, b) ? { ...order, discountType: b.type, discountValue: 0 } : { ...order, discountType: b.type, discountValue: b.value };
}

/** Tap a tip button: sets the tip to that amount. */
export const tapTipButton = <T extends { tipCents: number }>(order: T, cents: number): T => ({ ...order, tipCents: cents });

/** Move one item of a list to another position (drag to reorder). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}
