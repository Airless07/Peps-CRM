/**
 * Policy pages are written once, but some facts change in Settings (shipping prices, free shipping,
 * payment methods, unpaid time, referral rules, minimum age). Those are written as {tokens} in the
 * policy text and filled in here from the live settings, so a policy never disagrees with checkout.
 */
import type { PromotionRec } from "../types";
import { SUPPORT_EMAIL, type SiteContent, type StoreSettings } from "./config";
import { payMethodsText } from "./copy";
import { freeShippingText, isLive, money, usesLeft } from "./pricing";

export const POLICY_TOKENS = ["min_age", "payment_methods", "pay_hours", "shipping_options", "free_shipping", "referral_rules", "support_email"] as const;

const hours = (h: number) => (h % 24 === 0 ? `${h / 24} ${h === 24 ? "day" : "days"} (${h} hours)` : `${h} hours`);

export function policyFacts(store: StoreSettings, content: Pick<SiteContent, "contact">, promotions: PromotionRec[], now = new Date()): Record<(typeof POLICY_TOKENS)[number], string> {
  const tiers = store.shippingTiers.filter((t) => t.enabled);
  const free = promotions
    .filter((p) => p.kind === "free_shipping" && p.shippingTiers.length > 0 && isLive(p, now) && usesLeft(p) !== 0)
    .map((p) => `${freeShippingText(p.shippingTiers, store.shippingTiers)}${p.minSubtotalCents > 0 ? ` on orders of ${money(p.minSubtotalCents)} or more (after discounts)` : ""}`);
  const r = store.referrals;
  const referral = [
    `With an account you get a referral code. When someone places an order with your code, you earn ${r.percent}% of their order (after discounts, without shipping) as store credit.`,
    r.buyerDiscountPercent > 0 ? `The person using your code gets ${r.buyerDiscountPercent}% off.` : "",
    "The credit shows as pending as soon as the order is placed and can be used once that order is paid. It is taken back if the order is refunded (in part for a partial refund) or canceled.",
    `One referral code per order, and you can't use your own code.${r.allowStacking ? "" : " A referral code can't be combined with a discount code."}`,
    "Store credit has no cash value and can only be used at checkout on this website. We can remove codes or credit used against these rules.",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    min_age: String(store.entryGate.minAge),
    payment_methods: payMethodsText(store.payments),
    pay_hours: hours(store.autoCancelHours),
    shipping_options: tiers.length ? tiers.map((t) => `- ${t.name}: ${money(t.flatCents)}`).join("\n") : "- Shown at checkout.",
    free_shipping: free.length ? `${free.map((f) => `${f}.`).join(" ")} Applied automatically at checkout while the offer runs.` : "There is no free shipping offer right now.",
    referral_rules: referral,
    support_email: content.contact.email.trim() || SUPPORT_EMAIL,
  };
}

/** Replace every {token} with its live value. Unknown {words} are left as they are. */
export function fillPolicy(body: string, facts: Record<string, string>): string {
  return body.replace(/\{([a-z_]+)\}/g, (all, k: string) => (k in facts ? facts[k] : all));
}
