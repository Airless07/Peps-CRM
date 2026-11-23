import { describe, expect, it } from "vitest";
import type { PromotionRec } from "../types";
import { DEFAULT_CONTENT, parseStore, POLICY_IDS } from "./config";
import { fillPolicy, policyFacts, POLICY_TOKENS } from "./policy-text";

const store = parseStore(
  JSON.stringify({
    open: true,
    autoCancelHours: 24,
    payments: { zelle: { enabled: true, details: "x" } },
    shippingTiers: [
      { id: "standard", name: "Standard (2–5 business days)", enabled: true, flatCents: 895 },
      { id: "priority", name: "Priority (1–3 business days)", enabled: true, flatCents: 1395 },
      { id: "express", name: "Express (1–2 days)", enabled: true, flatCents: 3995 },
    ],
    referrals: { percent: 10, buyerDiscountPercent: 5, allowStacking: true, inviteDays: 14 },
  }),
);
const freeOver100 = { id: "f", kind: "free_shipping", active: true, startsAt: null, endsAt: null, maxUses: null, uses: [], minSubtotalCents: 10000, shippingTiers: ["standard"] } as unknown as PromotionRec;

describe("policies match how the store works", () => {
  it("fills shipping prices, free shipping over $100, Zelle, 24 hours, referral rules, age and the support email", () => {
    const f = policyFacts(store, { contact: { email: "", phone: "", hours: "", note: "" } }, [freeOver100]);
    const shipping = fillPolicy(DEFAULT_CONTENT.policies.shipping.body, f);
    expect(shipping).toContain("- Standard (2–5 business days): $8.95");
    expect(shipping).toContain("- Priority (1–3 business days): $13.95");
    expect(shipping).toContain("- Express (1–2 days): $39.95");
    expect(shipping).toMatch(/Free standard \(2–5 business days\) shipping on orders of \$100 or more/);
    expect(shipping).toContain("support@buckshotlabs.com");
    const terms = fillPolicy(DEFAULT_CONTENT.policies.terms.body, f);
    expect(terms).toContain("We accept Zelle.");
    expect(terms).toContain("after 1 day (24 hours)");
    expect(terms).toContain("you earn 10% of their order");
    expect(terms).toContain("gets 5% off");
    expect(terms).toContain("at least 21 years old");
  });

  it("no free shipping offer = says so; every token in every policy gets a value", () => {
    const f = policyFacts(store, DEFAULT_CONTENT, []);
    expect(f.free_shipping).toBe("There is no free shipping offer right now.");
    for (const id of POLICY_IDS) {
      const out = fillPolicy(DEFAULT_CONTENT.policies[id].body, f);
      expect(out, id).not.toMatch(new RegExp(`\{(${POLICY_TOKENS.join("|")})\}`));
    }
  });

  it("every policy is there with its full name; unclear promises are marked [FILL IN]", () => {
    expect(POLICY_IDS.map((id) => DEFAULT_CONTENT.policies[id].title)).toEqual(["Terms of Service", "Privacy Policy", "Shipping Policy", "Refund & Return Policy", "Research Use Policy"]);
    expect(DEFAULT_CONTENT.policies.refunds.body).toMatch(/\[FILL IN: how many business days a refund usually takes\.\]/);
    expect(DEFAULT_CONTENT.contact.email).toBe("support@buckshotlabs.com");
  });
});
