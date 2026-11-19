// Owner price, BOGO deals, cash tracking, repeat order, today summary and receipts. Pure tests.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applySellDeals, mergeDealLines, sellDealHints } from "./bogo";
import { cashPosition, handoffError } from "./cash";
import { draftToOrder, type Draft, type DraftLine } from "./draft";
import { computeLedger, orderTotals } from "./money";
import { ownerSummary, setOwnerPrice, zeroCostLines } from "./owner";
import { finalizeSale, toSavedOrder, savedToDraft } from "./saved-orders";
import { receiptText, recentCustomers, repeatOrderDraft, todaySummary } from "./sell-tools";
import { defaultSellButtons } from "./sell-buttons";
import { unitsSoldByVariant } from "./store/catalog";
import { orderLinesOf, priceCart, type PricedVariant } from "./store/pricing";
import { ORDER_DEFAULTS, PRODUCT_DEFAULTS, emptyStoreData, type AppData, type BogoRule, type OrderRec, type ProductRec, type PromotionRec } from "./types";

const day = (n: number, h = 12) => new Date(Date.UTC(2026, 0, n, h)).toISOString();
const NOW = new Date(day(15));

// GHK-Cu 100mg: sells for $55, costs $6 (10 bought for $60). BPC-157 10mg: sells for $40, costs $10.
const product = (id: string, name: string, size: string, price: number, listingId: string, over: Partial<ProductRec> = {}): ProductRec => ({
  id,
  name,
  defaultPriceCents: price,
  costOverrideCents: null,
  lowStockThreshold: null,
  color: "slate",
  sortOrder: 0,
  archived: false,
  createdAt: day(1, 0),
  ...PRODUCT_DEFAULTS,
  listingId,
  variantLabel: size,
  ...over,
});
const PRODUCTS = [product("ghk", "GHK-Cu", "100mg", 5500, "l-ghk"), product("bpc", "BPC-157", "10mg", 4000, "l-bpc")];

function appData(over: Partial<AppData> = {}): AppData {
  return {
    settings: {
      startingBalanceCents: -130000,
      startDate: day(1, 0),
      businessCutPercent: 10,
      partnerAName: "Ahmad",
      partnerBName: "Mo",
      partnerARatio: 50,
      tipHandling: "profit",
      defaultSoldBy: "A",
      lowStockThreshold: 3,
      paymentMethods: ["Cash", "Zelle"],
      sellButtons: defaultSellButtons(),
    },
    products: PRODUCTS,
    customers: [],
    purchases: [
      { id: "pu1", date: day(2), productId: "ghk", quantity: 10, totalCostCents: 6000, note: "", fromInvestment: false, createdAt: day(2) },
      { id: "pu2", date: day(2), productId: "bpc", quantity: 10, totalCostCents: 10000, note: "", fromInvestment: false, createdAt: day(2) },
    ],
    adjustments: [],
    orders: [],
    splits: [],
    payouts: [],
    ...emptyStoreData(),
    ...over,
  };
}

const dline = (id: string, productId: string, qty: number, price: number, cost = 0): DraftLine => ({
  id,
  productId,
  productName: productId === "ghk" ? "GHK-Cu 100mg" : "BPC-157 10mg",
  quantity: qty,
  unitPriceCents: price,
  unitCostCents: cost,
  cutPercent: 10,
});
const draft = (lines: DraftLine[], over: Partial<Draft> = {}): Draft => ({
  id: "sale",
  date: day(10),
  customer: "",
  customerId: null,
  paymentMethod: "Cash",
  note: "",
  soldBy: "A",
  discountType: "$",
  discountValue: 0,
  tipCents: 0,
  lines,
  ...over,
});

/** Run a draft through the same last step as the Sell screen and add it to the data as a sale. */
function sell(data: AppData, d: Draft, opts: { fromSaved?: boolean; id?: string; date?: string } = {}): AppData {
  const ledger = computeLedger(data);
  const { final } = finalizeSale({ ...d, id: opts.id ?? d.id }, { customers: data.customers, unitCost: (pid) => ledger.stock.get(pid)?.unitCost, cutPercent: 10, now: opts.date ?? day(10), fromSaved: opts.fromSaved });
  return { ...data, orders: [...data.orders, draftToOrder(final, opts.date ?? day(10))] };
}

const costOf = (data: AppData) => {
  const l = computeLedger(data);
  return (pid: string) => l.stock.get(pid)?.unitCost;
};
const priceOf = (pid: string) => PRODUCTS.find((p) => p.id === pid)?.defaultPriceCents;

// ---------------------------------------------------------------- Owner price
describe("owner price", () => {
  const base = appData();
  const cart = draft([dline("l1", "ghk", 2, 5500), dline("l2", "bpc", 1, 4000)], { discountType: "%", discountValue: 10, tipCents: 500 });

  it("charges exactly each variant's cost per unit and clears discounts and tips", () => {
    const d = setOwnerPrice(cart, "A", { costOf: costOf(base), priceOf });
    expect(d.owner).toBe("A");
    expect(d.lines.map((l) => [l.unitPriceCents, l.unitCostCents, l.fullPriceCents])).toEqual([
      [600, 600, 5500],
      [1000, 1000, 4000],
    ]);
    expect(orderTotals(d)).toMatchObject({ subtotal: 2200, discount: 0, tip: 0, total: 2200 });
    // Turning it off brings the normal prices back.
    const off = setOwnerPrice(d, null, { costOf: costOf(base), priceOf });
    expect(off.owner).toBeNull();
    expect(off.lines.map((l) => l.unitPriceCents)).toEqual([5500, 4000]);
    expect(off.lines.every((l) => l.fullPriceCents === undefined)).toBe(true);
  });

  it("profit is $0, nothing goes to the split, business money goes up by the cost, stock drops", () => {
    const before = computeLedger(base);
    const after = computeLedger(sell(base, setOwnerPrice(cart, "B", { costOf: costOf(base), priceOf })));
    const r = after.orders.get("sale")!;
    expect(r).toMatchObject({ revenue: 2200, cost: 2200, profit: 0, a: 0, b: 0, business: 2200, tip: 0, discount: 0 });
    expect(after.businessCents - before.businessCents).toBe(2200);
    expect([after.pendingA, after.pendingB]).toEqual([before.pendingA, before.pendingB]);
    expect(after.stock.get("ghk")!.stock).toBe(before.stock.get("ghk")!.stock - 2);
    expect(after.stock.get("bpc")!.stock).toBe(before.stock.get("bpc")!.stock - 1);
  });

  it("works the same in payback mode and out of it", () => {
    for (const start of [-130000, 50000]) {
      const data = appData({ settings: { ...appData().settings, startingBalanceCents: start } });
      const before = computeLedger(data);
      expect(before.inPayback).toBe(start < 0);
      const after = computeLedger(sell(data, setOwnerPrice(cart, "A", { costOf: costOf(data), priceOf })));
      expect(after.businessCents - before.businessCents).toBe(2200);
      expect(after.pendingA + after.pendingB).toBe(before.pendingA + before.pendingB);
      expect(after.orders.get("sale")!.profit).toBe(0);
    }
  });

  it("the ledger never splits an owner purchase, even if a price differs from cost", () => {
    const odd = draft([{ ...dline("l1", "ghk", 1, 900, 600) }], { owner: "A" });
    const data: AppData = { ...base, orders: [draftToOrder(odd, day(10))] };
    const r = computeLedger({ ...data, settings: { ...data.settings, startingBalanceCents: 0 } }).orders.get("sale")!;
    expect([r.a, r.b, r.business]).toEqual([0, 0, 900]);
  });

  it("save for later keeps the saved cost prices when completed", () => {
    const d = setOwnerPrice(cart, "A", { costOf: costOf(base), priceOf });
    const savedRec = toSavedOrder(d, PRODUCTS);
    expect(savedRec.owner).toBe("A");
    // The cost goes up after saving: the saved owner order still charges what was saved, at $0 profit.
    const pricier = { ...base, purchases: [...base.purchases, { id: "pu3", date: day(3), productId: "ghk", quantity: 10, totalCostCents: 30000, note: "", fromInvestment: false, createdAt: day(3) }] };
    const after = computeLedger(sell(pricier, savedToDraft(savedRec, "Cash"), { fromSaved: true }));
    expect(after.orders.get("sale")).toMatchObject({ revenue: 2200, cost: 2200, profit: 0, a: 0, b: 0 });
  });

  it("warns about items with no cost set", () => {
    const data = appData({ purchases: [] });
    expect(zeroCostLines(cart.lines, costOf(data))).toEqual(["GHK-Cu 100mg", "BPC-157 10mg"]);
    expect(zeroCostLines(cart.lines, costOf(base))).toEqual([]);
  });

  it("is left out of sales stats and best sellers, and summed apart by owner", () => {
    let data = sell(base, setOwnerPrice(cart, "A", { costOf: costOf(base), priceOf }), { id: "own1" });
    data = sell(data, draft([dline("n1", "ghk", 1, 5500)]), { id: "sale1" });
    const ledger = computeLedger(data);
    const own = ownerSummary(data.orders, ledger);
    expect(own).toMatchObject({ count: 1, costCents: 2200, units: 3, byOwner: { A: { count: 1, costCents: 2200, units: 3 }, B: { count: 0, costCents: 0 } } });
    // Best sellers count real sales only.
    expect(unitsSoldByVariant(data, new Date(day(11))).get("ghk")).toBe(1);
    const today = todaySummary(data, ledger, new Date(day(10, 18)));
    expect(today).toMatchObject({ count: 1, revenue: 5500, owner: { count: 1, costCents: 2200 } });
  });
});

// ---------------------------------------------------------------- BOGO
const rule = (over: Partial<BogoRule> = {}, get: Partial<BogoRule["get"]> = {}, buy: Partial<BogoRule["buy"]> = {}): BogoRule => ({
  buy: { listingIds: ["l-ghk"], variantIds: [], qty: 1, ...buy },
  get: { same: true, listingIds: [], variantIds: [], qty: 1, percentOff: 100, ...get },
  online: true,
  inPerson: true,
  noCodes: false,
  ...over,
});
const deal = (r: BogoRule, over: Partial<PromotionRec> = {}): PromotionRec => ({
  id: "bogo1",
  kind: "bogo",
  name: "Buy 1 GHK-Cu, get 1 free",
  code: "",
  discountType: "%",
  discountValue: r.get.percentOff,
  minSubtotalCents: 0,
  startsAt: null,
  endsAt: null,
  maxUses: null,
  oncePerEmail: false,
  listingIds: [],
  groupIds: [],
  shippingTiers: [],
  bogo: r,
  active: true,
  createdAt: day(1),
  uses: [],
  ...over,
});
const code10: PromotionRec = { ...deal(rule()), id: "c10", kind: "code", name: "", code: "SAVE10", discountValue: 10, bogo: null };
const VARIANTS = (tiers: { minQty: number; percentOff: number }[] = []): PricedVariant[] => [
  { variantId: "ghk", listingId: "l-ghk", groupIds: [], name: "GHK-Cu 100mg", priceCents: 5500, qtyDeals: tiers, listingName: "GHK-Cu" },
  { variantId: "bpc", listingId: "l-bpc", groupIds: [], name: "BPC-157 10mg", priceCents: 4000, qtyDeals: tiers, listingName: "BPC-157" },
];
const price = (promotions: PromotionRec[], items: [string, number][], opts: { code?: string; tiers?: { minQty: number; percentOff: number }[] } = {}) =>
  priceCart({ items: items.map(([variantId, quantity]) => ({ variantId, quantity })), variants: VARIANTS(opts.tiers), promotions, code: opts.code, now: NOW });

describe("BOGO deals on the website", () => {
  it("same item, buy 1 get 1 free: the free unit is its own line at $0", () => {
    const p = price([deal(rule())], [["ghk", 2]]);
    expect(p.bogo).toEqual([expect.objectContaining({ label: "BOGO: GHK-Cu 100mg", quantity: 1, cents: 5500, unitPriceCents: 0 })]);
    expect(p).toMatchObject({ listSubtotalCents: 11000, qtySavingsCents: 0, bogoCents: 5500, subtotalCents: 5500, discountCents: 0 });
    expect(orderLinesOf(p)).toEqual([
      { variantId: "ghk", name: "GHK-Cu 100mg", quantity: 1, unitPriceCents: 5500, dealId: "", dealName: "", fullPriceCents: null },
      { variantId: "ghk", name: "GHK-Cu 100mg", quantity: 1, unitPriceCents: 0, dealId: "bogo1", dealName: "Buy 1 GHK-Cu, get 1 free", fullPriceCents: 5500 },
    ]);
    // The use is recorded with the order (counts toward the limit).
    expect(p.applied).toEqual([expect.objectContaining({ id: "bogo1", kind: "bogo" })]);
  });

  it("counts groups: 3 units give 1 free, 4 give 2", () => {
    expect(price([deal(rule())], [["ghk", 3]]).bogoCents).toBe(5500);
    expect(price([deal(rule())], [["ghk", 4]]).bogoCents).toBe(11000);
  });

  it("nudges when the free item isn't in the cart yet", () => {
    expect(price([deal(rule())], [["ghk", 1]]).dealHints).toEqual([{ dealId: "bogo1", text: "Add 1 more GHK-Cu to get it free" }]);
    expect(price([deal(rule())], [["ghk", 2]]).dealHints).toEqual([]);
    // Buy 2 get 1: with 2 in the cart, 1 more makes it.
    expect(price([deal(rule({}, {}, { qty: 2 }))], [["ghk", 2]]).dealHints[0].text).toBe("Add 1 more GHK-Cu to get it free");
    expect(price([deal(rule({}, {}, { qty: 2 }))], [["ghk", 3]]).bogoCents).toBe(5500);
  });

  it("different item at a % off: buy 1 BPC-157, get 1 GHK-Cu 50% off", () => {
    const r = rule({}, { same: false, variantIds: ["ghk"], percentOff: 50 }, { listingIds: ["l-bpc"] });
    const p = price([deal(r, { name: "BPC + half-price GHK" })], [["bpc", 1], ["ghk", 1]]);
    expect(p.bogo).toEqual([expect.objectContaining({ variantId: "ghk", quantity: 1, cents: 2750, unitPriceCents: 2750 })]);
    expect(p.subtotalCents).toBe(4000 + 2750);
    expect(price([deal(r)], [["bpc", 1]]).dealHints).toEqual([{ dealId: "bogo1", text: "Add 1 GHK-Cu 100mg to get it 50% off" }]);
    // The buy item alone or the get item alone gets nothing.
    expect(price([deal(r)], [["ghk", 2]]).bogoCents).toBe(0);
  });

  it("respects the use limit, dates, on/off and where it applies", () => {
    expect(price([deal(rule(), { maxUses: 2, uses: [1, 2].map((i) => ({ id: `u${i}`, promotionId: "bogo1", orderId: `o${i}`, email: "", createdAt: day(2) })) })], [["ghk", 2]]).bogoCents).toBe(0);
    expect(price([deal(rule(), { maxUses: 2, uses: [{ id: "u1", promotionId: "bogo1", orderId: "o1", email: "", createdAt: day(2) }] })], [["ghk", 2]]).bogoCents).toBe(5500);
    expect(price([deal(rule(), { startsAt: day(20) })], [["ghk", 2]]).bogoCents).toBe(0);
    expect(price([deal(rule(), { endsAt: day(14) })], [["ghk", 2]]).bogoCents).toBe(0);
    expect(price([deal(rule(), { active: false })], [["ghk", 2]]).bogoCents).toBe(0);
    expect(price([deal(rule({ online: false }))], [["ghk", 2]]).bogoCents).toBe(0);
  });

  it("never stacks with buy-more tiers on the same product: the better price wins", () => {
    // 2 vials: tiers give 10% off ($99), the deal gives one free ($55): the deal wins, with no tier on top.
    const a = price([deal(rule())], [["ghk", 2]], { tiers: [{ minQty: 2, percentOff: 10 }] });
    expect(a).toMatchObject({ bogoCents: 5500, qtySavingsCents: 0, subtotalCents: 5500 });
    expect(a.lines[0]).toMatchObject({ percentOff: 0, unitPriceCents: 5500 });
    // 3 vials at 40% off ($99) beat the deal (2 x $55 = $110): tiers win, no BOGO.
    const b = price([deal(rule())], [["ghk", 3]], { tiers: [{ minQty: 3, percentOff: 40 }] });
    expect(b).toMatchObject({ bogoCents: 0, subtotalCents: 9900 });
    // Another product in the same cart keeps its tiers.
    const c = price([deal(rule())], [["ghk", 2], ["bpc", 2]], { tiers: [{ minQty: 2, percentOff: 10 }] });
    expect(c.lines.find((l) => l.variantId === "bpc")).toMatchObject({ percentOff: 10 });
    expect(c.bogoCents).toBe(5500);
  });

  it("codes stack on top, unless the deal says no codes", () => {
    const on = price([deal(rule()), code10], [["ghk", 2], ["bpc", 1]], { code: "SAVE10" });
    // 10% of what is left after the deal ($55 + $40).
    expect(on).toMatchObject({ bogoCents: 5500, discountCents: 950, codeError: "", code: "SAVE10" });
    const off = price([deal(rule({ noCodes: true })), code10], [["ghk", 2], ["bpc", 1]], { code: "SAVE10" });
    expect(off.discountCents).toBe(0);
    expect(off.codeError).toMatch(/can.t be used with the “Buy 1 GHK-Cu, get 1 free” deal/);
  });

  it("the free unit still costs money and leaves stock", () => {
    const p = price([deal(rule())], [["ghk", 2]]);
    const data = appData();
    const order: OrderRec = {
      ...ORDER_DEFAULTS,
      id: "web",
      date: day(10),
      customer: "",
      customerId: null,
      paymentMethod: "Zelle",
      note: "",
      soldBy: "W",
      discountType: "$",
      discountValue: 0,
      tipCents: 0,
      createdAt: day(10),
      source: "online",
      status: "paid",
      lines: orderLinesOf(p).map((l, i) => ({ id: `wl${i}`, orderId: "web", productId: l.variantId, productName: l.name, quantity: l.quantity, unitPriceCents: l.unitPriceCents, unitCostCents: 600, cutPercent: 10, sortOrder: i, dealId: l.dealId, dealName: l.dealName, fullPriceCents: l.fullPriceCents })),
    };
    const before = computeLedger(data);
    const after = computeLedger({ ...data, orders: [order] });
    expect(after.orders.get("web")).toMatchObject({ revenue: 5500, cost: 1200, profit: 4300, units: 2 });
    expect(after.stock.get("ghk")!.stock).toBe(before.stock.get("ghk")!.stock - 2);
  });
});

describe("BOGO deals in the Sell cart", () => {
  const ctx = (promotions: PromotionRec[]) => ({ promotions, products: PRODUCTS, now: NOW });

  it("moves the free unit to its own line right under the item, and is stable when run again", () => {
    const d = applySellDeals(draft([dline("l1", "ghk", 2, 5500)]), ctx([deal(rule())]));
    expect(d.lines.map((l) => [l.id, l.quantity, l.unitPriceCents, l.fullPriceCents ?? null, l.dealId ?? ""])).toEqual([
      ["l1", 1, 5500, null, ""],
      ["l1~bogo1", 1, 0, 5500, "bogo1"],
    ]);
    expect(applySellDeals(d, ctx([deal(rule())]))).toEqual(d);
    expect(orderTotals(d)).toMatchObject({ subtotal: 5500, total: 5500 });
  });

  it("adding one more, removing the free line, or ending the deal puts units back", () => {
    const d = applySellDeals(draft([dline("l1", "ghk", 2, 5500)]), ctx([deal(rule())]));
    const plus = applySellDeals({ ...d, lines: d.lines.map((l) => (l.id === "l1" ? { ...l, quantity: 2 } : l)) }, ctx([deal(rule())]));
    expect(plus.lines.map((l) => l.quantity)).toEqual([2, 1]);
    const removed = applySellDeals({ ...d, lines: d.lines.filter((l) => !l.dealId) }, ctx([deal(rule())]));
    expect(removed.lines).toEqual([expect.objectContaining({ id: "l1", quantity: 1, unitPriceCents: 5500 })]);
    const ended = applySellDeals(d, ctx([]));
    expect(ended.lines).toEqual([expect.objectContaining({ id: "l1", quantity: 2, unitPriceCents: 5500 })]);
    expect(mergeDealLines(d.lines)).toEqual([expect.objectContaining({ id: "l1", quantity: 2 })]);
  });

  it("only in-person deals apply, and owner price turns deals off", () => {
    expect(applySellDeals(draft([dline("l1", "ghk", 2, 5500)]), ctx([deal(rule({ inPerson: false }))])).lines).toHaveLength(1);
    expect(applySellDeals(draft([dline("l1", "ghk", 2, 5500)], { owner: "A" }), ctx([deal(rule())])).lines).toHaveLength(1);
  });

  it("nudges in the Sell cart too", () => {
    const names = { listing: (id: string) => (id === "l-ghk" ? "GHK-Cu" : "BPC-157"), variant: (id: string) => (id === "ghk" ? "GHK-Cu 100mg" : "BPC-157 10mg") };
    expect(sellDealHints(draft([dline("l1", "ghk", 1, 5500)]), { ...ctx([deal(rule())]), names })).toEqual([{ dealId: "bogo1", text: "Add 1 more GHK-Cu to get it free" }]);
  });

  it("a completed sale counts the free unit's cost and stock", () => {
    const data = appData();
    const d = applySellDeals(draft([dline("l1", "ghk", 2, 5500)]), ctx([deal(rule())]));
    const after = computeLedger(sell(data, d));
    expect(after.orders.get("sale")).toMatchObject({ revenue: 5500, cost: 1200, profit: 4300, units: 2 });
    expect(after.stock.get("ghk")!.stock).toBe(8);
  });
});

// ---------------------------------------------------------------- Cash
describe("cash tracking", () => {
  it("each cash sale counts with who received it; hand-offs move cash, business money stays the same", () => {
    let data = appData();
    data = sell(data, draft([dline("a", "ghk", 1, 5500)], { soldBy: "A", tipCents: 500 }), { id: "s1" }); // cash to Ahmad (the seller): $60
    data = sell(data, draft([dline("b", "bpc", 1, 4000)], { soldBy: "A", cashTo: "B" }), { id: "s2" }); // Ahmad sold, Mo took the cash: $40
    data = sell(data, draft([dline("c", "bpc", 1, 4000)], { soldBy: "B", paymentMethod: "Zelle", cashTo: "B" }), { id: "s3" }); // not cash
    expect(data.orders.map((o) => o.cashTo)).toEqual(["A", "B", null]);
    const ledger = computeLedger(data);
    const pos = cashPosition(data, ledger);
    expect(pos).toMatchObject({ A: 6000, B: 4000, received: { A: 6000, B: 4000 } });
    expect(pos.A + pos.B + pos.bank).toBe(ledger.businessCents);

    const moved = { ...data, cashHandoffs: [{ id: "h1", date: day(11), from: "B" as const, to: "bank" as const, amountCents: 3000, note: "Deposit", createdAt: day(11) }, { id: "h2", date: day(11), from: "A" as const, to: "B" as const, amountCents: 1000, note: "", createdAt: day(11) }] };
    const after = cashPosition(moved, computeLedger(moved));
    expect(after).toMatchObject({ A: 5000, B: 2000, bank: pos.bank + 3000 });
    expect(computeLedger(moved).businessCents).toBe(ledger.businessCents);
    expect(after.A + after.B + after.bank).toBe(ledger.businessCents);
  });

  it("older sales without a holder stay in the bank", () => {
    const data = appData({ orders: [{ ...draftToOrder(draft([dline("a", "ghk", 1, 5500)]), day(5)), id: "old", cashTo: null }] });
    expect(cashPosition(data, computeLedger(data))).toMatchObject({ A: 0, B: 0 });
  });

  it("refuses a hand-off that makes no sense", () => {
    const pos = { A: 5000, B: 0, bank: 100, received: { A: 5000, B: 0 }, total: 5100 };
    expect(handoffError({ from: "A", to: "A", amountCents: 100 }, pos)).toMatch(/different/);
    expect(handoffError({ from: "A", to: "bank", amountCents: 0 }, pos)).toMatch(/how much/);
    expect(handoffError({ from: "B", to: "bank", amountCents: 100 }, pos)).toMatch(/more than/);
    expect(handoffError({ from: "A", to: "bank", amountCents: 5000 }, pos)).toBe("");
  });

  it("today's summary shows cash received per person", () => {
    let data = appData();
    data = sell(data, draft([dline("a", "ghk", 1, 5500)], { soldBy: "A" }), { id: "s1" });
    data = sell(data, draft([dline("b", "bpc", 2, 4000)], { soldBy: "B", paymentMethod: "Zelle" }), { id: "s2" });
    const t = todaySummary(data, computeLedger(data), new Date(day(10, 20)));
    expect(t).toMatchObject({ count: 2, revenue: 13500, cash: { A: 5500, B: 0 } });
    expect(t.bySeller.A).toMatchObject({ count: 1, revenue: 5500, profit: 4900 });
    expect(t.bySeller.B).toMatchObject({ count: 1, revenue: 8000, profit: 6000 });
    expect(t.byMethod.map((m) => [m.method, m.count, m.revenue])).toEqual([
      ["Cash", 1, 5500],
      ["Zelle", 1, 8000],
    ]);
    expect(todaySummary(data, computeLedger(data), new Date(day(11, 20))).count).toBe(0);
  });
});

// ---------------------------------------------------------------- Repeat, recent customers, receipt
describe("repeat last order", () => {
  it("rebuilds the cart at today's prices and costs, merges BOGO units back, and skips items no longer sold", () => {
    const old: OrderRec = {
      ...draftToOrder(
        draft(
          [
            { ...dline("a", "ghk", 1, 4000, 500) },
            { ...dline("a~d", "ghk", 1, 0, 500), dealId: "bogo1", dealName: "BOGO", fullPriceCents: 4000 },
            dline("b", "bpc", 2, 3000, 800),
            { ...dline("c", "gone", 1, 2000), productName: "Old thing" },
          ],
          { customer: "Dana", customerId: "cust", discountValue: 500, tipCents: 300 },
        ),
        day(5),
      ),
      id: "old",
    };
    const data = appData({ products: [...PRODUCTS, product("arch", "Archived", "", 100, "l-x", { archived: true })] });
    const base = draft([], { id: "cart", paymentMethod: "Zelle", soldBy: "B" });
    const { draft: d, skipped } = repeatOrderDraft(old, { products: data.products, costOf: costOf(data), cutPercent: 10, base });
    expect(d.id).not.toBe("cart");
    expect(d).toMatchObject({ customer: "Dana", customerId: "cust", discountValue: 0, tipCents: 0, owner: null, paymentMethod: "Zelle", soldBy: "B" });
    expect(d.lines.map((l) => [l.productId, l.productName, l.quantity, l.unitPriceCents, l.unitCostCents])).toEqual([
      ["ghk", "GHK-Cu 100mg", 2, 5500, 600],
      ["bpc", "BPC-157 10mg", 2, 4000, 1000],
    ]);
    expect(skipped).toEqual(["Old thing"]);
    // A live deal applies again when the cart shows it.
    expect(applySellDeals(d, { promotions: [deal(rule())], products: PRODUCTS, now: NOW }).lines.filter((l) => l.dealId)).toHaveLength(1);
  });

  it("recent customers: newest order first, each once, at most 5", () => {
    const customers = ["c1", "c2", "c3", "c4", "c5", "c6"].map((id) => ({ id, name: id.toUpperCase(), phone: "", email: "", notes: "", createdAt: day(1), hasAccount: false, addresses: [] }));
    const orders = ["c1", "c2", "c1", "c3", "c4", "c5", "c6"].map((cid, i) => ({ ...draftToOrder(draft([dline("x", "ghk", 1, 5500)], { customerId: cid, date: day(2 + i) }), day(2 + i)), id: `o${i}` }));
    expect(recentCustomers({ orders, customers }).map((c) => c.id)).toEqual(["c6", "c5", "c4", "c3", "c1"]);
  });
});

describe("copy receipt", () => {
  it("is plain text with the order number, items with sizes, BOGO, discount, total and date", () => {
    const d = applySellDeals(draft([dline("l1", "ghk", 2, 5500), dline("l2", "bpc", 1, 4000)], { discountType: "%", discountValue: 10, tipCents: 500 }), { promotions: [deal(rule())], products: PRODUCTS, now: NOW });
    const o = { ...draftToOrder(d, day(10)), number: 1042 };
    const text = receiptText(o, { storeName: "Buckshot Labs" });
    expect(text).toContain("Buckshot Labs");
    expect(text).toContain("Order #1042");
    expect(text).toContain("1× GHK-Cu 100mg  $55.00");
    expect(text).toContain("BOGO (Buy 1 GHK-Cu, get 1 free)  -$55.00");
    expect(text).toContain("1× BPC-157 10mg  $40.00");
    expect(text).toContain("Discount (10%)  -$9.50");
    expect(text).toContain("Tip  $5.00");
    expect(text).toContain(`Total  $${(orderTotals(o).total / 100).toFixed(2)}`);
    expect(text).toContain("Paid with Cash");
    expect(text).not.toMatch(/<|>/);
  });
});

// ---------------------------------------------------------------- Migration
describe("migration 20261119120000_owner_bogo_cash", () => {
  it("is additive only: new nullable or defaulted columns and one new table", () => {
    const sql = readFileSync(path.join(import.meta.dirname, "../../prisma/migrations/20261119120000_owner_bogo_cash/migration.sql"), "utf8").replace(/^\s*--.*$/gm, "");
    expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bUPDATE\b|RENAME|PRAGMA|INSERT INTO/i);
    expect(sql.match(/CREATE TABLE/g)).toHaveLength(1);
    for (const stmt of sql.split(";").filter((x) => /ADD COLUMN/.test(x))) expect(stmt).toMatch(/TEXT;?\s*$|DEFAULT|INTEGER\s*$/);
  });

  it("existing money is unchanged: orders without the new fields compute exactly as before", () => {
    const sale = (over: Partial<OrderRec> = {}): OrderRec => ({ ...draftToOrder(draft([dline("a", "ghk", 2, 5500, 600)], { discountValue: 500, tipCents: 300 }), day(5)), id: "x", ...over });
    const plain = sale();
    const { owner: _o, cashTo: _c, ...legacy } = plain;
    const a = computeLedger(appData({ orders: [plain] }));
    const b = computeLedger(appData({ orders: [legacy as OrderRec] }));
    expect(a.businessCents).toBe(b.businessCents);
    expect([a.pendingA, a.pendingB]).toEqual([b.pendingA, b.pendingB]);
    expect(a.orders.get("x")).toEqual(b.orders.get("x"));
  });
});
