// Server-side carts. A signed-in customer's cart lives in the CustomerCart table, tied to the account,
// so it follows them to any device and nobody else ever sees it. Guests keep their cart in the browser.
// Only variant ids and quantities are stored: prices, discounts and credit are always worked out again
// by the quote for whoever is signed in at that moment.
import { prisma } from "../db";
import { json } from "../serialize";

export interface CartLine {
  variantId: string;
  quantity: number;
}

export interface ServerCart {
  items: CartLine[];
  code: string;
  referral: string;
}

export const MAX_QTY = 99;
const MAX_LINES = 50;

/** What can be bought on the website right now: variant id -> units in stock. */
export type StockOf = (variantId: string) => number | undefined;

/** One line per variant, whole quantities 1..99, unknown junk dropped. Order kept (first time seen). */
export function cleanItems(items: unknown): CartLine[] {
  if (!Array.isArray(items)) return [];
  const out = new Map<string, number>();
  for (const raw of items) {
    const i = raw as Partial<CartLine> | null;
    if (!i || typeof i.variantId !== "string" || !i.variantId || i.variantId.length > 64) continue;
    const q = Math.floor(Number(i.quantity));
    if (!Number.isFinite(q) || q <= 0) continue;
    out.set(i.variantId, Math.min(MAX_QTY, (out.get(i.variantId) ?? 0) + q));
  }
  return [...out].slice(0, MAX_LINES).map(([variantId, quantity]) => ({ variantId, quantity }));
}

/**
 * Cap every line at what is in stock (and 99). Variants the website doesn't sell are dropped. A sold-out
 * line is kept at its quantity so the cart can say "Sold out, remove it" instead of silently losing it.
 */
export function capToStock(items: CartLine[], stockOf: StockOf): CartLine[] {
  const out: CartLine[] = [];
  for (const i of items) {
    const stock = stockOf(i.variantId);
    if (stock === undefined) continue;
    out.push({ variantId: i.variantId, quantity: stock > 0 ? Math.min(i.quantity, stock, MAX_QTY) : Math.min(i.quantity, MAX_QTY) });
  }
  return out;
}

/** Guest cart + account cart: quantities added together, capped at stock. The account's lines come first. */
export function mergeCarts(account: CartLine[], guest: CartLine[], stockOf: StockOf): CartLine[] {
  return capToStock(cleanItems([...account, ...guest]), stockOf);
}

export type AddResult = { items: CartLine[]; added: number; capped: boolean; available: number | null; message: string };

/** Add units of one variant, never past what is in stock. */
export function addLine(items: CartLine[], variantId: string, quantity: number, stockOf: StockOf): AddResult {
  const stock = stockOf(variantId);
  const list = cleanItems(items);
  if (stock === undefined) return { items: list, added: 0, capped: false, available: null, message: "This product is no longer available." };
  if (stock <= 0) return { items: list, added: 0, capped: true, available: 0, message: "Sold out." };
  const want = Math.max(1, Math.floor(quantity) || 1);
  const have = list.find((l) => l.variantId === variantId)?.quantity ?? 0;
  const limit = Math.min(stock, MAX_QTY);
  const next = Math.min(limit, have + want);
  const added = Math.max(0, next - have);
  const capped = have + want > limit;
  const items2 = have ? list.map((l) => (l.variantId === variantId ? { ...l, quantity: next } : l)) : [...list, { variantId, quantity: next }];
  const message = !capped ? "" : added === 0 ? `You already have all ${limit} available in your cart.` : `Only ${limit} available. ${added} added.`;
  return { items: added || have ? items2 : list, added, capped, available: capped ? limit : null, message };
}

const clean = (c: unknown) => (typeof c === "string" ? c.trim().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 30) : "");

export async function readCart(customerId: string): Promise<ServerCart> {
  const row = await prisma.customerCart.findUnique({ where: { customerId } });
  return row ? { items: cleanItems(json<CartLine[]>(row.itemsJson, [])), code: row.code, referral: row.referral } : { items: [], code: "", referral: "" };
}

export async function writeCart(customerId: string, cart: ServerCart): Promise<ServerCart> {
  const next = { items: cleanItems(cart.items), code: clean(cart.code).toUpperCase(), referral: clean(cart.referral) };
  await prisma.customerCart.upsert({
    where: { customerId },
    create: { customerId, itemsJson: JSON.stringify(next.items), code: next.code, referral: next.referral },
    update: { itemsJson: JSON.stringify(next.items), code: next.code, referral: next.referral },
  });
  return next;
}

/**
 * Signing in with a guest cart: guest items go into the account's cart (quantities added, capped at stock).
 * Codes are never carried over, neither the guest's nor ones saved on the account: they are re-applied
 * (and re-checked) for this account.
 */
export async function mergeGuestCart(customerId: string, guest: unknown, stockOf: StockOf): Promise<ServerCart> {
  const mine = await readCart(customerId);
  return writeCart(customerId, { items: mergeCarts(mine.items, cleanItems(guest), stockOf), code: "", referral: "" });
}

export async function clearCart(customerId: string) {
  await prisma.customerCart.deleteMany({ where: { customerId } });
}
