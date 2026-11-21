// Store credit and referral rules. Pure: used by the server (every write), the Sell cart, checkout and tests.
//
// A balance is the sum of a customer's credit entries; nothing stores a running balance.
// Store credit used on an order works like a discount: revenue goes down, cost still counts.
// It is only taken from the balance once the order counts (in person: completed, online: marked paid).
// Until then it is "reserved": saved Sell orders and unpaid website orders hold it so it can't be spent twice.
import { orderTotals } from "./money";
import type { ReferralSettings } from "./store/config";
import type { CreditEntryRec, CreditKind, OrderRec, SavedOrderRec } from "./types";

export const CREDIT_REASONS = ["Giveaway", "Apology", "Correction", "Referral bonus", "Loyalty"] as const;

/** Sum of a customer's entries. */
export function balanceOf(entries: Pick<CreditEntryRec, "customerId" | "amountCents">[], customerId: string | null | undefined): number {
  if (!customerId) return 0;
  return entries.reduce((x, e) => (e.customerId === customerId ? x + e.amountCents : x), 0);
}

/** Every customer's balance. */
export function balances(entries: Pick<CreditEntryRec, "customerId" | "amountCents">[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e.customerId, (m.get(e.customerId) ?? 0) + e.amountCents);
  return m;
}

type Holder = { id: string; customerId: string | null; storeCreditCents?: number };

/**
 * Credit held by orders that have picked it but not used it yet: saved Sell orders and website orders
 * waiting for payment. `exceptId` leaves out the order being edited or completed (its own hold is available to it).
 */
export function reservedCredit(
  holders: { savedOrders?: Holder[]; pendingOrders?: (Holder & Pick<OrderRec, "status">)[] },
  customerId: string | null | undefined,
  exceptId?: string | null,
): number {
  if (!customerId) return 0;
  let n = 0;
  for (const s of holders.savedOrders ?? []) if (s.customerId === customerId && s.id !== exceptId) n += Math.max(0, s.storeCreditCents ?? 0);
  for (const o of holders.pendingOrders ?? []) if (o.customerId === customerId && o.id !== exceptId && o.status === "awaiting_payment") n += Math.max(0, o.storeCreditCents ?? 0);
  return n;
}

/** What a customer can still spend: balance minus what other open orders hold. Never below 0. */
export function availableCredit(balance: number, reserved: number): number {
  return Math.max(0, balance - reserved);
}

/** The credit an order can use: what was asked for, capped by what is available and by the total after other discounts. */
export function clampCredit(requested: number, available: number, afterDiscount: number): number {
  return Math.max(0, Math.min(Math.round(requested || 0), available, afterDiscount));
}

/** Store credit for a percent of an amount, rounded to the cent. */
export const percentOf = (base: number, pct: number) => (base > 0 && pct > 0 ? Math.round((base * pct) / 100) : 0);

/** What referral credit is a percent of: the order after discounts and store credit, without tips or shipping. */
export function referralBase(order: Parameters<typeof orderTotals>[0]): number {
  const t = orderTotals(order);
  return t.subtotal - t.discount - t.credit;
}

/** One entry the order should have, net, for one customer. */
export interface CreditTarget {
  kind: Exclude<CreditKind, "manual">;
  customerId: string;
  amountCents: number;
}

export type CreditOrder = Parameters<typeof orderTotals>[0] & Pick<OrderRec, "customerId" | "owner"> & { referredById?: string | null; storeCreditCents?: number };

/**
 * What an order should have in the credit history, net:
 * - credit used: minus the credit, on the order's customer (only while it counts)
 * - referral: the referrer gets `percent` of the referral base (never on owner price, never for themselves)
 * - new customer reward: the referred customer gets `newCustomerPercent` of the same base
 * Not counting (canceled, unpaid, deleted) = nothing, so a sync gives everything back.
 */
export function creditTargets(
  order: CreditOrder | null,
  ctx: { counts: boolean; referrals: ReferralSettings; isFirstOrder: boolean; referrerExists: boolean },
): CreditTarget[] {
  if (!order || !ctx.counts) return [];
  const out: CreditTarget[] = [];
  const t = orderTotals(order);
  if (order.customerId && t.credit > 0) out.push({ kind: "order", customerId: order.customerId, amountCents: -t.credit });
  const ref = order.referredById;
  const earns = !!ref && ctx.referrerExists && !order.owner && ref !== order.customerId && (!ctx.referrals.firstOrderOnly || ctx.isFirstOrder);
  if (earns) {
    const base = t.subtotal - t.discount - t.credit;
    const reward = percentOf(base, ctx.referrals.percent);
    if (reward > 0) out.push({ kind: "referral", customerId: ref!, amountCents: reward });
    const welcome = order.customerId ? percentOf(base, ctx.referrals.newCustomerPercent) : 0;
    if (welcome > 0) out.push({ kind: "referral_new", customerId: order.customerId!, amountCents: welcome });
  }
  return out;
}

export interface CreditWrite {
  customerId: string;
  kind: CreditTarget["kind"];
  amountCents: number;
  shortfallCents: number;
}

const keyOf = (kind: string, customerId: string) => `${kind}\u0000${customerId}`;

/**
 * Entries to write so the order's history matches its targets. Existing entries count at their effective
 * value (amount minus any shortfall), so a reversal that could only be partly taken back is never retried.
 *
 * Order of work for each customer: credit used first (it must be covered by the balance BEFORE this order's
 * own rewards), then additions, then other take-backs, which stop at $0 and note the shortfall.
 * Returns `short` instead of writes when a customer doesn't have the credit an order uses.
 */
export function planCreditSync(
  targets: CreditTarget[],
  existing: (Pick<CreditEntryRec, "customerId" | "amountCents" | "shortfallCents"> & { kind: string })[],
  balance: (customerId: string) => number,
): { writes: CreditWrite[]; short: null } | { writes: null; short: { customerId: string; needCents: number; haveCents: number } } {
  const have = new Map<string, { kind: CreditTarget["kind"]; customerId: string; net: number }>();
  for (const e of existing) {
    if (e.kind === "manual") continue;
    const k = keyOf(e.kind, e.customerId);
    const cur = have.get(k) ?? { kind: e.kind as CreditTarget["kind"], customerId: e.customerId, net: 0 };
    cur.net += e.amountCents - (e.shortfallCents || 0);
    have.set(k, cur);
  }
  const want = new Map(targets.map((t) => [keyOf(t.kind, t.customerId), t]));
  const deltas: { kind: CreditTarget["kind"]; customerId: string; delta: number }[] = [];
  for (const k of new Set([...have.keys(), ...want.keys()])) {
    const h = have.get(k);
    const w = want.get(k);
    const delta = (w?.amountCents ?? 0) - (h?.net ?? 0);
    if (delta !== 0) deltas.push({ kind: (w ?? h)!.kind, customerId: (w ?? h)!.customerId, delta });
  }
  const bal = new Map<string, number>();
  const cur = (id: string) => (bal.has(id) ? bal.get(id)! : balance(id));
  const writes: CreditWrite[] = [];
  // 1. Credit used on the order: must be fully covered.
  for (const d of deltas.filter((x) => x.kind === "order" && x.delta < 0)) {
    const b = cur(d.customerId);
    if (b < -d.delta) return { writes: null, short: { customerId: d.customerId, needCents: -d.delta, haveCents: Math.max(0, b) } };
    bal.set(d.customerId, b + d.delta);
    writes.push({ customerId: d.customerId, kind: d.kind, amountCents: d.delta, shortfallCents: 0 });
  }
  // 2. Additions: refunds of credit used, referral rewards.
  for (const d of deltas.filter((x) => x.delta > 0)) {
    bal.set(d.customerId, cur(d.customerId) + d.delta);
    writes.push({ customerId: d.customerId, kind: d.kind, amountCents: d.delta, shortfallCents: 0 });
  }
  // 3. Rewards taken back: down to $0 at most, the rest is noted as a shortfall.
  for (const d of deltas.filter((x) => x.kind !== "order" && x.delta < 0)) {
    const b = Math.max(0, cur(d.customerId));
    const take = Math.min(b, -d.delta);
    bal.set(d.customerId, cur(d.customerId) - take);
    writes.push({ customerId: d.customerId, kind: d.kind, amountCents: -take, shortfallCents: -d.delta - take });
  }
  return { writes, short: null };
}

/** Money page numbers. `inRange` decides which entry dates count for issued / used. */
export function creditSummary(entries: Pick<CreditEntryRec, "date" | "kind" | "amountCents">[], inRange: (iso: string) => boolean) {
  let outstanding = 0;
  let issued = 0;
  let used = 0;
  for (const e of entries) {
    outstanding += e.amountCents;
    if (!inRange(e.date)) continue;
    if (e.kind === "order") used -= e.amountCents;
    else issued += e.amountCents;
  }
  return { outstanding, issued, used };
}

/** A saved order's credit is the same kind of hold as an order's. */
export const savedCredit = (s: Pick<SavedOrderRec, "storeCreditCents">) => Math.max(0, s.storeCreditCents ?? 0);

/** A new referral code: up to 4 letters of the name and 4 random characters, e.g. "DANA7K2P". No 0/O/1/I. */
export function makeReferralCode(name: string, rand: () => number = Math.random): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "").replace(/[OI]/g, "").slice(0, 4) || "FRND";
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let tail = "";
  for (let i = 0; i < 4; i++) tail += abc[Math.floor(rand() * abc.length)];
  return letters + tail;
}

export const cleanCode = (code: string) => code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
