// Store credit and referral rules. Pure: used by the server (every write), the Sell cart, checkout and tests.
//
// A balance is the sum of a customer's credit entries; nothing stores a running balance.
// Pending referral credit (order placed, not paid yet) is in the history but not in the spendable balance.
// Store credit used on an order works like a discount: revenue goes down, cost still counts.
// It is only taken from the balance once the order counts (in person: completed, online: marked paid).
// Until then it is "reserved": saved Sell orders and unpaid website orders hold it so it can't be spent twice.
import { orderTotals } from "./money";
import { codeProblem, normalizeCode } from "./referral-rules";
import { countsInMoney, type CreditEntryRec, type CreditKind, type OrderRec, type SavedOrderRec } from "./types";

export const CREDIT_REASONS = ["Giveaway", "Apology", "Correction", "Referral bonus", "Loyalty"] as const;

type BalEntry = Pick<CreditEntryRec, "customerId" | "amountCents"> & { pending?: boolean };

/** Spendable balance: sum of a customer's entries, pending referral credit left out. Can be negative after a reversal. */
export function balanceOf(entries: BalEntry[], customerId: string | null | undefined): number {
  if (!customerId) return 0;
  return entries.reduce((x, e) => (e.customerId === customerId && !e.pending ? x + e.amountCents : x), 0);
}

/** Pending referral credit (orders placed, not paid yet): visible, not spendable. */
export function pendingOf(entries: BalEntry[], customerId: string | null | undefined): number {
  if (!customerId) return 0;
  return entries.reduce((x, e) => (e.customerId === customerId && e.pending ? x + e.amountCents : x), 0);
}

/** Every customer's spendable balance (pending left out). */
export function balances(entries: BalEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) if (!e.pending) m.set(e.customerId, (m.get(e.customerId) ?? 0) + e.amountCents);
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

/** What a customer can still spend: balance minus what other open orders hold. Never below 0 (a negative balance can't spend). */
export function availableCredit(balance: number, reserved: number): number {
  return Math.max(0, balance - reserved);
}

/** The credit an order can use: what was asked for, capped by what is available and by the total after other discounts. */
export function clampCredit(requested: number, available: number, afterDiscount: number): number {
  return Math.max(0, Math.min(Math.round(requested || 0), available, afterDiscount));
}

/** A percent of an amount in integer cents, rounded DOWN (never pays a fraction of a cent too much). */
export const percentOf = (base: number, pct: number) => (base > 0 && pct > 0 ? Math.floor((base * pct) / 100 + 1e-9) : 0);

type TotalsIn = Parameters<typeof orderTotals>[0];

/**
 * What referral credit is a percent of: the order subtotal after ALL discounts (discount code, automatic
 * deal and the buyer's referral discount), without shipping or tips. Store credit the buyer spends is a
 * way of paying, so it does NOT lower this.
 */
export function referralBase(order: TotalsIn): number {
  const t = orderTotals({ ...order, refundedCents: 0 });
  return Math.max(0, t.subtotal - t.discount);
}

/** The money an order took in that a refund can give back: what the customer paid, without tips (store credit left out). */
export function refundableOf(order: TotalsIn): number {
  const t = orderTotals({ ...order, refundedCents: 0 });
  return Math.max(0, t.subtotal - t.discount - t.credit + t.shipping);
}

export type CreditOrder = TotalsIn &
  Pick<OrderRec, "customerId" | "owner"> & {
    status: OrderRec["status"];
    referredById?: string | null;
    /** Reward percent saved on the order when it was placed. Null = no referral. */
    referralRatePct?: number | null;
    storeCreditCents?: number;
    refundedCents?: number;
  };

/**
 * The referral credit an order earns its code owner, in cents: rate x referral base, rounded down.
 * Owner price orders and self-referrals earn nothing. A refund lowers it in proportion to the money refunded.
 */
export function referralCredit(order: CreditOrder): number {
  if (!order.referredById || order.owner || !(order.referralRatePct && order.referralRatePct > 0)) return 0;
  if (order.referredById === order.customerId) return 0;
  const full = percentOf(referralBase(order), order.referralRatePct);
  const refunded = Math.max(0, order.refundedCents ?? 0);
  if (refunded <= 0 || full <= 0) return full;
  const cap = refundableOf(order);
  if (cap <= 0) return 0;
  const left = Math.max(0, cap - Math.min(refunded, cap));
  return Math.floor((full * left) / cap);
}

/** One entry the order should have, net, for one customer. */
export interface CreditTarget {
  kind: Exclude<CreditKind, "manual">;
  customerId: string;
  amountCents: number;
  /** Pending referral credit (order not paid yet). */
  pending: boolean;
}

/**
 * What an order should have in the credit history, net:
 * - placed, not paid yet: the code owner has PENDING referral credit (visible, not spendable)
 * - counts (paid / completed / shipped...): credit used comes off the buyer; the owner's referral credit is AVAILABLE
 * - canceled or deleted: nothing, so a sync reverses everything
 * `legacyNew`: rewards for the referred customer from the old rules (kept while the order counts, never created anew).
 */
export function creditTargets(order: CreditOrder | null, ctx: { referrerExists: boolean; legacyNew?: Map<string, number> }): CreditTarget[] {
  if (!order) return [];
  const pending = order.status === "awaiting_payment";
  const counts = countsInMoney(order.status);
  if (!pending && !counts) return [];
  const out: CreditTarget[] = [];
  const t = orderTotals(order);
  if (counts && order.customerId && t.credit > 0) out.push({ kind: "order", customerId: order.customerId, amountCents: -t.credit, pending: false });
  const reward = ctx.referrerExists ? referralCredit(order) : 0;
  if (reward > 0) out.push({ kind: "referral", customerId: order.referredById!, amountCents: reward, pending });
  if (counts) for (const [customerId, cents] of ctx.legacyNew ?? []) if (cents > 0) out.push({ kind: "referral_new", customerId, amountCents: cents, pending: false });
  return out;
}

export interface CreditWrite {
  customerId: string;
  kind: CreditTarget["kind"];
  amountCents: number;
  pending: boolean;
}

const keyOf = (kind: string, customerId: string, pending: boolean) => `${kind}|${customerId}|${pending ? 1 : 0}`;

/**
 * Entries to write so the order's history matches its targets: the difference between what the order
 * should have and what it already has. Running it again writes nothing, so marking paid twice, refunding
 * twice or canceling twice never double-credits or double-removes.
 * Old entries count at their effective value (amount minus any shortfall noted under the old $0 floor).
 *
 * Order of work: credit used first (it must be covered by the spendable balance BEFORE this order's own
 * rewards), then additions, then take-backs. Take-backs may take a balance below $0: future credit pays
 * it off first, and nothing can be spent until it is positive again.
 * Returns `short` instead of writes when a customer doesn't have the credit an order uses.
 */
export function planCreditSync(
  targets: CreditTarget[],
  existing: (Pick<CreditEntryRec, "customerId" | "amountCents" | "shortfallCents"> & { kind: string; pending?: boolean })[],
  balance: (customerId: string) => number,
): { writes: CreditWrite[]; short: null } | { writes: null; short: { customerId: string; needCents: number; haveCents: number } } {
  type Net = { kind: CreditTarget["kind"]; customerId: string; pending: boolean; net: number };
  const have = new Map<string, Net>();
  for (const e of existing) {
    if (e.kind === "manual") continue;
    const pending = !!e.pending;
    const k = keyOf(e.kind, e.customerId, pending);
    const cur = have.get(k) ?? { kind: e.kind as CreditTarget["kind"], customerId: e.customerId, pending, net: 0 };
    cur.net += e.amountCents - (e.shortfallCents || 0);
    have.set(k, cur);
  }
  const want = new Map(targets.map((t) => [keyOf(t.kind, t.customerId, t.pending), t]));
  const deltas: { kind: CreditTarget["kind"]; customerId: string; pending: boolean; delta: number }[] = [];
  for (const k of new Set([...have.keys(), ...want.keys()])) {
    const h = have.get(k);
    const w = want.get(k);
    const delta = (w?.amountCents ?? 0) - (h?.net ?? 0);
    const src = (w ?? h)!;
    if (delta !== 0) deltas.push({ kind: src.kind, customerId: src.customerId, pending: src.pending, delta });
  }
  const bal = new Map<string, number>();
  const cur = (id: string) => (bal.has(id) ? bal.get(id)! : balance(id));
  const writes: CreditWrite[] = [];
  const move = (d: (typeof deltas)[number]) => {
    if (!d.pending) bal.set(d.customerId, cur(d.customerId) + d.delta);
    writes.push({ customerId: d.customerId, kind: d.kind, amountCents: d.delta, pending: d.pending });
  };
  // 1. Credit used on the order: must be fully covered by the spendable balance.
  for (const d of deltas.filter((x) => x.kind === "order" && x.delta < 0)) {
    const b = cur(d.customerId);
    if (b < -d.delta) return { writes: null, short: { customerId: d.customerId, needCents: -d.delta, haveCents: Math.max(0, b) } };
    move(d);
  }
  // 2. Additions: refunds of credit used, referral credit (pending or available).
  for (const d of deltas.filter((x) => x.delta > 0)) move(d);
  // 3. Take-backs: referral credit reversed. May take the balance below $0.
  for (const d of deltas.filter((x) => x.kind !== "order" && x.delta < 0)) move(d);
  return { writes, short: null };
}

/** Money page numbers. `inRange` decides which entry dates count for issued / used. Pending credit is left out. */
export function creditSummary(entries: (Pick<CreditEntryRec, "date" | "kind" | "amountCents"> & { pending?: boolean })[], inRange: (iso: string) => boolean) {
  let outstanding = 0;
  let issued = 0;
  let used = 0;
  for (const e of entries) {
    if (e.pending) continue;
    outstanding += e.amountCents;
    if (!inRange(e.date)) continue;
    if (e.kind === "order") used -= e.amountCents;
    else issued += e.amountCents;
  }
  return { outstanding, issued, used };
}

/** A saved order's credit is the same kind of hold as an order's. */
export const savedCredit = (s: Pick<SavedOrderRec, "storeCreditCents">) => Math.max(0, s.storeCreditCents ?? 0);

/** A new referral code: up to 4 letters of the name and 4 random characters, e.g. "DANA7K2P". No 0/O/1/I. Always passes codeProblem(). */
export function makeReferralCode(name: string, rand: () => number = Math.random): string {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "").replace(/[OI]/g, "").slice(0, 4) || "FRND";
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let tries = 0; tries < 50; tries++) {
    let tail = "";
    for (let i = 0; i < 4; i++) tail += abc[Math.floor(rand() * abc.length)];
    const code = (tries < 25 ? letters : "FRND") + tail;
    if (!codeProblem(code)) return code;
  }
  return "FRND" + Date.now().toString(36).toUpperCase().slice(-4);
}

/** The stored form of a typed code (referral or discount): trimmed and uppercase. */
export const cleanCode = (code: string) => normalizeCode(code);
