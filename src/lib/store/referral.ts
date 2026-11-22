// Referral codes at checkout. Pure: AppData in, what the code does out. Used by the quote API,
// placeOrder (same function, so the cart and the saved order can never disagree) and tests.
import { normalizeCode, isSelfReferral, SELF_REFERRAL_TEXT } from "../referral-rules";
import type { Address, AppData } from "../types";

export type CodeKind = "discount" | "referral" | "none";

/** What a typed code is: a discount code, a referral code, or nothing known. Not case sensitive. */
export function codeKindOf(data: Pick<AppData, "promotions" | "customers">, code: string): CodeKind {
  const c = normalizeCode(code);
  if (!c) return "none";
  if (data.promotions.some((p) => p.kind === "code" && p.code.toUpperCase() === c)) return "discount";
  if (data.customers.some((x) => (x.referralCode ?? "").toUpperCase() === c)) return "referral";
  return "none";
}

export interface ReferralBuyer {
  customerId?: string | null;
  email?: string | null;
  shipTo?: Partial<Address> | null;
}

export type ReferralResult =
  | { ok: true; ownerId: string; code: string; display: string; buyerDiscountPercent: number; ratePercent: number }
  | { ok: false; error: string };

/** Every shipping address tied to a customer: saved on their account, or used on their own orders. */
function addressesOf(data: Pick<AppData, "customers" | "orders" | "pendingOrders">, customerId: string) {
  const c = data.customers.find((x) => x.id === customerId);
  const fromOrders = [...data.orders, ...(data.pendingOrders ?? [])].filter((o) => o.customerId === customerId && o.web?.shipTo).map((o) => o.web!.shipTo!);
  return [...(c?.addresses ?? []), ...fromOrders];
}

/** Check a referral code for this buyer. Guests can use codes; only the owner needs to be a customer. */
export function resolveReferral(data: Pick<AppData, "customers" | "orders" | "pendingOrders" | "promotions" | "store">, code: string, buyer: ReferralBuyer): ReferralResult {
  const c = normalizeCode(code);
  if (!c) return { ok: false, error: "Enter a code." };
  const owner = data.customers.find((x) => (x.referralCode ?? "").toUpperCase() === c);
  if (!owner) return { ok: false, error: "That referral code wasn't found. Check the spelling and try again." };
  if (isSelfReferral({ id: owner.id, email: owner.email, addresses: addressesOf(data, owner.id) }, { customerId: buyer.customerId, email: buyer.email, shipTo: buyer.shipTo ?? null })) {
    return { ok: false, error: SELF_REFERRAL_TEXT };
  }
  const r = data.store.referrals;
  return { ok: true, ownerId: owner.id, code: c, display: owner.referralCodeDisplay || owner.referralCode || c, buyerDiscountPercent: r.buyerDiscountPercent, ratePercent: r.percent };
}

export const STACKING_TEXT = "A referral code and a discount code can't be used on the same order. Pick the one you want to keep.";

/**
 * "You used CODE last time": the referral code on the buyer's most recent order that had one, only when
 * that code still belongs to someone (and not to the buyer). Never ties the buyer to a referrer: it is
 * only a suggestion they apply with one click.
 */
export function lastReferralCode(data: Pick<AppData, "customers" | "orders" | "pendingOrders" | "promotions" | "store">, buyer: ReferralBuyer): string | null {
  if (!buyer.customerId) return null;
  const mine = [...data.orders, ...(data.pendingOrders ?? [])]
    .filter((o) => o.customerId === buyer.customerId && (o.referralCode ?? "").trim())
    .sort((a, b) => (b.createdAt < a.createdAt ? -1 : b.createdAt > a.createdAt ? 1 : 0));
  const last = mine[0]?.referralCode?.trim();
  if (!last) return null;
  const r = resolveReferral(data, last, buyer);
  return r.ok ? r.display : null;
}
