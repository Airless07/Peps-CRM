// Store credit and referral rules. Pure tests (no database).
import { describe, expect, it } from "vitest";
import { availableCredit, balanceOf, clampCredit, creditSummary, creditTargets, makeReferralCode, percentOf, planCreditSync, referralBase, reservedCredit } from "./credit";
import { computeLedger, orderTotals } from "./money";
import { cleanReferrals, DEFAULT_STORE } from "./store/config";
import { defaultSellButtons } from "./sell-buttons";
import { ORDER_DEFAULTS, PRODUCT_DEFAULTS, emptyStoreData, type AppData, type OrderRec } from "./types";

const day = (n: number) => new Date(Date.UTC(2026, 0, n, 12)).toISOString();
const REF = { percent: 10, firstOrderOnly: false, newCustomerPercent: 0, inviteDays: 14 };

function order(id: string, over: Partial<OrderRec> = {}): OrderRec {
  return {
    ...ORDER_DEFAULTS,
    id,
    date: day(5),
    createdAt: day(5),
    customer: "Dana",
    customerId: "dana",
    paymentMethod: "Cash",
    note: "",
    soldBy: "A",
    discountType: "$",
    discountValue: 0,
    tipCents: 0,
    // 2 x $50, cost $10 each
    lines: [{ id: `${id}-l`, orderId: id, productId: "p", productName: "GHK-Cu", quantity: 2, unitPriceCents: 5000, unitCostCents: 1000, cutPercent: 10, sortOrder: 0 }],
    ...over,
  };
}

function data(orders: OrderRec[]): AppData {
  return {
    settings: { startingBalanceCents: 0, startDate: day(1), businessCutPercent: 10, partnerAName: "Ahmad", partnerBName: "Mo", partnerARatio: 50, tipHandling: "profit", defaultSoldBy: "A", lowStockThreshold: 3, paymentMethods: ["Cash"], sellButtons: defaultSellButtons() },
    products: [{ id: "p", name: "GHK-Cu", defaultPriceCents: 5000, costOverrideCents: null, lowStockThreshold: null, color: "slate", sortOrder: 0, archived: false, createdAt: day(1), ...PRODUCT_DEFAULTS }],
    customers: [],
    purchases: [{ id: "pu", date: day(2), productId: "p", quantity: 20, totalCostCents: 20000, note: "", fromInvestment: true, createdAt: day(2) }],
    adjustments: [],
    orders,
    splits: [],
    payouts: [],
    ...emptyStoreData(),
  };
}

describe("store credit works like a discount", () => {
  it("comes off after the discount; tip and shipping are added on top", () => {
    const t = orderTotals({ ...order("o"), discountType: "%", discountValue: 10, tipCents: 500, shippingCents: 695, storeCreditCents: 2000 });
    expect(t).toMatchObject({ subtotal: 10000, discount: 1000, credit: 2000, tip: 500, shipping: 695, total: 10000 - 1000 - 2000 + 500 + 695 });
    expect(t.lineRevenue).toEqual([7000]);
  });

  it("is never more than the total after other discounts", () => {
    const t = orderTotals({ ...order("o"), discountValue: 9000, storeCreditCents: 5000 });
    expect(t.credit).toBe(1000);
    expect(t.total).toBe(0);
    expect(clampCredit(5000, 3000, 8000)).toBe(3000); // capped by the balance
    expect(clampCredit(5000, 9000, 4000)).toBe(4000); // capped by the total
    expect(clampCredit(1234, 9000, 8000)).toBe(1234); // a custom part
    expect(clampCredit(-5, 9000, 8000)).toBe(0);
  });

  it("lowers revenue and profit by the credit; cost still counts", () => {
    const plain = computeLedger(data([order("o")]));
    const withCredit = computeLedger(data([order("o", { storeCreditCents: 2500 })]));
    const a = plain.orders.get("o")!;
    const b = withCredit.orders.get("o")!;
    expect(b.credit).toBe(2500);
    expect(b.revenue).toBe(a.revenue - 2500);
    expect(b.cost).toBe(a.cost);
    expect(b.profit).toBe(a.profit - 2500);
    expect(b.total).toBe(a.total - 2500);
    expect(withCredit.businessCents).toBe(plain.businessCents - 2500);
    // Same rule as a $25 discount.
    const asDiscount = computeLedger(data([order("o", { discountValue: 2500 })])).orders.get("o")!;
    expect({ revenue: b.revenue, profit: b.profit, a: b.a, b: b.b, business: b.business }).toEqual({ revenue: asDiscount.revenue, profit: asDiscount.profit, a: asDiscount.a, b: asDiscount.b, business: asDiscount.business });
  });

  it("existing orders (no credit field, or 0) give exactly the same money as before", () => {
    const old = [order("o1"), order("o2", { discountType: "%", discountValue: 15, tipCents: 700, date: day(6) }), order("o3", { owner: "B", date: day(7) })].map((o) => {
      const { storeCreditCents: _c, referredById: _r, ...rest } = o;
      return rest as OrderRec;
    });
    const zero = old.map((o) => ({ ...o, storeCreditCents: 0, referredById: null }));
    const a = computeLedger(data(old));
    const b = computeLedger(data(zero));
    expect(b.businessCents).toBe(a.businessCents);
    expect([b.pendingA, b.pendingB]).toEqual([a.pendingA, a.pendingB]);
    for (const id of ["o1", "o2", "o3"]) expect(b.orders.get(id)).toEqual(a.orders.get(id));
  });
});

describe("available credit", () => {
  const entries = [
    { customerId: "dana", amountCents: 3000 },
    { customerId: "dana", amountCents: -500 },
    { customerId: "sam", amountCents: 900 },
  ];
  it("balance is the sum of the history", () => {
    expect(balanceOf(entries, "dana")).toBe(2500);
    expect(balanceOf(entries, null)).toBe(0);
  });
  it("saved orders and unpaid website orders hold their credit, except the order being edited", () => {
    const holders = {
      savedOrders: [{ id: "s1", customerId: "dana", storeCreditCents: 1000 }],
      pendingOrders: [
        { id: "w1", customerId: "dana", storeCreditCents: 700, status: "awaiting_payment" as const },
        { id: "w2", customerId: "dana", storeCreditCents: 999, status: "canceled" as const },
      ],
    };
    expect(reservedCredit(holders, "dana")).toBe(1700);
    expect(reservedCredit(holders, "dana", "s1")).toBe(700);
    expect(availableCredit(2500, 1700)).toBe(800);
    expect(availableCredit(500, 1700)).toBe(0);
  });
});

describe("referral credit", () => {
  const ctx = { counts: true, referrals: REF, isFirstOrder: true, referrerExists: true };

  it("is the referral % of the order after discounts and store credit, excluding tips and shipping, rounded to cents", () => {
    const o = order("o", { referredById: "sam", discountValue: 1555, storeCreditCents: 1000, tipCents: 2000, shippingCents: 695 });
    // 10000 - 1555 - 1000 = 7445; 10% = 744.5 -> 745
    expect(referralBase(o)).toBe(7445);
    expect(creditTargets(o, ctx)).toEqual([
      { kind: "order", customerId: "dana", amountCents: -1000 },
      { kind: "referral", customerId: "sam", amountCents: 745 },
    ]);
    expect(percentOf(7445, 10)).toBe(745);
  });

  it("no self-referral, none on owner price, none while the order doesn't count", () => {
    expect(creditTargets(order("o", { referredById: "dana" }), ctx)).toEqual([]);
    expect(creditTargets(order("o", { referredById: "sam", owner: "A" }), ctx)).toEqual([]);
    expect(creditTargets(order("o", { referredById: "sam" }), { ...ctx, counts: false })).toEqual([]);
    expect(creditTargets(order("o", { referredById: "sam" }), { ...ctx, referrerExists: false })).toEqual([]);
  });

  it("first order only, and the optional reward for the new customer", () => {
    const o = order("o", { referredById: "sam" });
    expect(creditTargets(o, { ...ctx, referrals: { ...REF, firstOrderOnly: true }, isFirstOrder: false })).toEqual([]);
    expect(creditTargets(o, { ...ctx, referrals: { ...REF, firstOrderOnly: true }, isFirstOrder: true })).toEqual([{ kind: "referral", customerId: "sam", amountCents: 1000 }]);
    expect(creditTargets(o, { ...ctx, referrals: { ...REF, newCustomerPercent: 5 } })).toEqual([
      { kind: "referral", customerId: "sam", amountCents: 1000 },
      { kind: "referral_new", customerId: "dana", amountCents: 500 },
    ]);
  });

  it("settings default to 10%, off, 0% and 14 days, and are kept in range", () => {
    expect(DEFAULT_STORE.referrals).toEqual(REF);
    expect(cleanReferrals({ percent: 250, newCustomerPercent: -3, inviteDays: 0, firstOrderOnly: true })).toEqual({ percent: 100, newCustomerPercent: 0, inviteDays: 1, firstOrderOnly: true });
    expect(cleanReferrals(undefined)).toEqual(REF);
  });
});

describe("syncing an order's credit history", () => {
  const bal = (m: Record<string, number>) => (id: string) => m[id] ?? 0;
  const t = (kind: "order" | "referral" | "referral_new", customerId: string, amountCents: number) => ({ kind, customerId, amountCents });
  const e = (kind: string, customerId: string, amountCents: number, shortfallCents = 0) => ({ kind, customerId, amountCents, shortfallCents });

  it("completing takes the credit and pays the referrer; running it again writes nothing", () => {
    const first = planCreditSync([t("order", "dana", -2000), t("referral", "sam", 800)], [], bal({ dana: 2000 }));
    expect(first.writes).toEqual([
      { customerId: "dana", kind: "order", amountCents: -2000, shortfallCents: 0 },
      { customerId: "sam", kind: "referral", amountCents: 800, shortfallCents: 0 },
    ]);
    const again = planCreditSync([t("order", "dana", -2000), t("referral", "sam", 800)], [e("order", "dana", -2000), e("referral", "sam", 800)], bal({ dana: 0, sam: 800 }));
    expect(again.writes).toEqual([]);
  });

  it("refuses credit the customer doesn't have", () => {
    const r = planCreditSync([t("order", "dana", -2000)], [], bal({ dana: 1500 }));
    expect(r.writes).toBeNull();
    expect(r.short).toEqual({ customerId: "dana", needCents: 2000, haveCents: 1500 });
  });

  it("canceling refunds the credit used and reverses the referral", () => {
    const r = planCreditSync([], [e("order", "dana", -2000), e("referral", "sam", 800)], bal({ dana: 0, sam: 800 }));
    expect(r.writes).toEqual([
      { customerId: "dana", kind: "order", amountCents: 2000, shortfallCents: 0 },
      { customerId: "sam", kind: "referral", amountCents: -800, shortfallCents: 0 },
    ]);
  });

  it("a reversal stops at $0 and notes the shortfall, and is never retried", () => {
    // Sam already spent $5 of the $8 reward.
    const r = planCreditSync([], [e("referral", "sam", 800)], bal({ sam: 300 }));
    expect(r.writes).toEqual([{ customerId: "sam", kind: "referral", amountCents: -300, shortfallCents: 500 }]);
    const again = planCreditSync([], [e("referral", "sam", 800), e("referral", "sam", -300, 500)], bal({ sam: 1000 }));
    expect(again.writes).toEqual([]);
  });

  it("an edit writes only the difference", () => {
    const r = planCreditSync([t("order", "dana", -1500), t("referral", "sam", 600)], [e("order", "dana", -2000), e("referral", "sam", 800)], bal({ dana: 0, sam: 800 }));
    expect(r.writes).toEqual([
      { customerId: "dana", kind: "order", amountCents: 500, shortfallCents: 0 },
      { customerId: "sam", kind: "referral", amountCents: -200, shortfallCents: 0 },
    ]);
  });
});

describe("Money page numbers and codes", () => {
  it("outstanding is every balance; issued and used are for the period", () => {
    const entries = [
      { date: day(1), kind: "manual" as const, amountCents: 5000 },
      { date: day(10), kind: "referral" as const, amountCents: 800 },
      { date: day(10), kind: "order" as const, amountCents: -2000 },
      { date: day(11), kind: "order" as const, amountCents: 500 }, // refund
      { date: day(11), kind: "manual" as const, amountCents: -300 },
    ];
    const inJan10to11 = (iso: string) => iso >= day(10) && iso <= day(11);
    expect(creditSummary(entries, inJan10to11)).toEqual({ outstanding: 4000, issued: 500, used: 1500 });
    expect(creditSummary(entries, () => true).outstanding).toBe(4000);
  });

  it("referral codes are short, readable and start with the name", () => {
    let i = 0;
    const code = makeReferralCode("Dana Reed", () => (i++ % 10) / 10);
    expect(code).toMatch(/^DANA[A-Z2-9]{4}$/);
    expect(makeReferralCode("José O'Neil")).toMatch(/^JSNE[A-Z2-9]{4}$/);
    expect(makeReferralCode("12")).toMatch(/^FRND/);
  });
});
