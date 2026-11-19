// Pure tests for the store: pricing, promotions, the public catalog and the new money inputs.
import { describe, expect, it } from "vitest";
import { normalizeBackup } from "../backup";
import { computeLedger, planSplit } from "../money";
import type { AppData, LabelRec, ListingRec, OrderRec, ProductRec, PromotionRec } from "../types";
import { DEFAULT_SETTINGS, ORDER_DEFAULTS, PRODUCT_DEFAULTS, emptyStoreData } from "../types";
import { buildCatalog, pricedVariants } from "./catalog";
import { DEFAULT_STORE, parseStore } from "./config";
import { checkoutMethods, paymentWarnings } from "./payments";
import { priceCart, promoHeadlines, qtyPercentOff, shippingOptions, usesLeft, type PricedVariant } from "./pricing";

const day = (n: number, h = 12) => new Date(Date.UTC(2026, 0, n, h)).toISOString();
const NOW = new Date(day(15));

const listing = (id: string, over: Partial<ListingRec> = {}): ListingRec => ({
  id,
  name: id.toUpperCase(),
  slug: id,
  summary: "",
  description: "",
  casNumber: "",
  formula: "",
  molecularWeight: "",
  purity: "",
  form: "",
  storage: "",
  showOnWebsite: true,
  photos: [],
  hoverGif: "",
  groupIds: [],
  badges: [],
  bestSeller: false,
  qtyDeals: null,
  sortOrder: 0,
  seoTitle: "",
  seoDescription: "",
  createdAt: day(1),
  ...over,
});

const product = (id: string, listingId: string, price: number, over: Partial<ProductRec> = {}): ProductRec => ({
  id,
  name: id,
  defaultPriceCents: price,
  costOverrideCents: 1234,
  lowStockThreshold: null,
  color: "slate",
  sortOrder: 0,
  archived: false,
  createdAt: day(1),
  ...PRODUCT_DEFAULTS,
  listingId,
  ...over,
});

function appData(over: Partial<AppData> = {}): AppData {
  return {
    settings: { ...DEFAULT_SETTINGS, startingBalanceCents: 0 },
    products: [product("v5", "bpc", 4000, { variantLabel: "5mg" }), product("v10", "bpc", 7000, { variantLabel: "10mg" }), product("tb", "tb", 5000)],
    customers: [],
    purchases: [
      { id: "pu1", date: day(1), productId: "v5", quantity: 10, totalCostCents: 10000, note: "", fromInvestment: true, createdAt: day(1) },
      { id: "pu2", date: day(1), productId: "v10", quantity: 2, totalCostCents: 4000, note: "", fromInvestment: true, createdAt: day(1) },
    ],
    adjustments: [],
    orders: [],
    splits: [],
    payouts: [],
    ...emptyStoreData(),
    listings: [listing("bpc", { groupIds: ["g1"] }), listing("tb"), listing("hidden", { showOnWebsite: false })],
    groups: [{ id: "g1", name: "Recovery", slug: "recovery", sortOrder: 0, createdAt: day(1) }],
    ...over,
  };
}

const promo = (over: Partial<PromotionRec>): PromotionRec => ({
  id: over.id ?? "p1",
  kind: "code",
  name: "",
  code: "SAVE10",
  discountType: "%",
  discountValue: 10,
  minSubtotalCents: 0,
  startsAt: null,
  endsAt: null,
  maxUses: null,
  oncePerEmail: false,
  listingIds: [],
  groupIds: [],
  shippingTiers: over.kind === "free_shipping" ? ["standard"] : [],
  active: true,
  createdAt: day(1),
  uses: [],
  ...over,
});

const use = (email = "a@b.co", n = 1) => Array.from({ length: n }, (_, i) => ({ id: `u${i}`, promotionId: "p1", orderId: `o${i}`, email, createdAt: day(2) }));

const NO_DEALS: PricedVariant[] = [
  { variantId: "v5", listingId: "bpc", groupIds: ["g1"], name: "BPC 5mg", priceCents: 4000, qtyDeals: [] },
  { variantId: "v10", listingId: "bpc", groupIds: ["g1"], name: "BPC 10mg", priceCents: 7000, qtyDeals: [] },
  { variantId: "tb", listingId: "tb", groupIds: [], name: "TB", priceCents: 5000, qtyDeals: [] },
];
const cart = (promotions: PromotionRec[], code = "", items = [{ variantId: "v5", quantity: 1 }], email = "") =>
  priceCart({ items, variants: NO_DEALS, promotions, code, email, now: NOW });

// ---------------------------------------------------------------- Public catalog
describe("public catalog never exposes admin data", () => {
  const data = appData();
  const catalog = buildCatalog(data, computeLedger(data), NOW);
  const text = JSON.stringify(catalog);

  it("has no cost, profit, margin or purchase fields anywhere", () => {
    const keys = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (keys.add(k), walk(x));
    };
    walk(catalog);
    const banned = [...keys].filter((k) => /cost|profit|margin|purchase|cut|partner|payout|unitsSold|soldQty|threshold/i.test(k));
    expect(banned).toEqual([]);
    // The override cost value used in the fixture must not appear as a value either.
    expect(text).not.toContain("1234");
    expect(text).not.toMatch(/"stock":\s*\d/);
  });

  it("the public variant has exactly the public fields", () => {
    expect(Object.keys(catalog.products[0].variants[0]).sort()).toEqual(["coa", "id", "label", "olderCoas", "priceCents", "purity", "stock", "testing", "testingLabel", "volume"]);
  });

  it("only lists products switched on for the website, with stock as a label", () => {
    expect(catalog.products.map((p) => p.id)).toEqual(["bpc", "tb"]);
    const bpc = catalog.products[0];
    expect(bpc.variants.map((v) => [v.label, v.stock])).toEqual([
      ["5mg", "in"],
      ["10mg", "low"],
    ]);
    expect(catalog.products[1].variants[0].stock).toBe("out");
    expect([bpc.priceFromCents, bpc.priceToCents]).toEqual([4000, 7000]);
  });

  it("pricedVariants carries prices only", () => {
    expect(Object.keys(pricedVariants(data)[0]).sort()).toEqual(["groupIds", "listingId", "listingName", "name", "priceCents", "qtyDeals", "variantId"]);
  });

  it("best sellers: automatic from the last 30 days, or manual picks", () => {
    const sale = (id: string, productId: string, date: string, qty: number): OrderRec => ({
      id,
      date,
      customer: "",
      customerId: null,
      paymentMethod: "Cash",
      note: "",
      soldBy: "A",
      discountType: "$",
      discountValue: 0,
      tipCents: 0,
      createdAt: date,
      ...ORDER_DEFAULTS,
      lines: [{ id: `${id}l`, orderId: id, productId, productName: "", quantity: qty, unitPriceCents: 5000, unitCostCents: 0, cutPercent: 10, sortOrder: 0 }],
    });
    const d = appData({ orders: [sale("o1", "tb", day(10), 3), sale("old", "v5", new Date(Date.UTC(2025, 9, 1)).toISOString(), 50)] });
    const auto = buildCatalog(d, computeLedger(d), NOW);
    expect(auto.products.filter((p) => p.bestSeller).map((p) => p.id)).toEqual(["tb"]);
    const m = appData({ store: { ...DEFAULT_STORE, bestSellerMode: "manual" }, listings: [listing("bpc", { bestSeller: true }), listing("tb")] });
    expect(buildCatalog(m, computeLedger(m), NOW).products.filter((p) => p.bestSeller).map((p) => p.id)).toEqual(["bpc"]);
  });
});

// ---------------------------------------------------------------- Buy more, save more
describe("buy more, save more", () => {
  const deals = DEFAULT_STORE.qtyDeals;
  it("default tiers: 2 = 5%, 3+ = 10%", () => {
    expect([1, 2, 3, 7].map((q) => qtyPercentOff(deals, q))).toEqual([0, 5, 10, 10]);
  });
  it("lowers the unit price on the line and counts all sizes of a product together", () => {
    const variants = NO_DEALS.map((v) => ({ ...v, qtyDeals: deals }));
    const p = priceCart({ items: [{ variantId: "v5", quantity: 1 }, { variantId: "v10", quantity: 2 }, { variantId: "tb", quantity: 1 }], variants, promotions: [], now: NOW });
    expect(p.lines.map((l) => [l.variantId, l.percentOff, l.unitPriceCents])).toEqual([
      ["v5", 10, 3600],
      ["v10", 10, 6300],
      ["tb", 0, 5000],
    ]);
    expect(p.listSubtotalCents).toBe(23000);
    expect(p.subtotalCents).toBe(3600 + 12600 + 5000);
    expect(p.qtySavingsCents).toBe(1800);
  });
  it("a discount code stacks on top of the lower unit price", () => {
    const variants = NO_DEALS.map((v) => ({ ...v, qtyDeals: deals }));
    const p = priceCart({ items: [{ variantId: "v5", quantity: 2 }], variants, promotions: [promo({})], code: "save10", now: NOW });
    expect(p.subtotalCents).toBe(7600);
    expect(p.discountCents).toBe(760);
  });
  it("a product can override or switch off the store default", () => {
    const d = appData({ listings: [listing("bpc", { qtyDeals: [{ minQty: 2, percentOff: 20 }] }), listing("tb", { qtyDeals: [] })] });
    const v = pricedVariants(d);
    expect(v.find((x) => x.variantId === "v5")!.qtyDeals).toEqual([{ minQty: 2, percentOff: 20 }]);
    expect(v.find((x) => x.variantId === "tb")!.qtyDeals).toEqual([]);
  });
});

// ---------------------------------------------------------------- Discount codes
describe("discount codes", () => {
  it("percent and dollar codes, case-insensitive", () => {
    expect(cart([promo({})], "save10").discountCents).toBe(400);
    expect(cart([promo({ discountType: "$", discountValue: 1500 })], "SAVE10").discountCents).toBe(1500);
    expect(cart([promo({ discountType: "$", discountValue: 99999 })], "SAVE10").discountCents).toBe(4000);
  });
  it("unknown code gives a clear error and no discount", () => {
    const p = cart([promo({})], "NOPE");
    expect(p.discountCents).toBe(0);
    expect(p.codeError).toMatch(/not found/);
  });
  it("dates: not started, expired, inactive", () => {
    expect(cart([promo({ startsAt: day(20) })], "SAVE10").codeError).toMatch(/not active yet/);
    expect(cart([promo({ endsAt: day(10) })], "SAVE10").codeError).toMatch(/expired/);
    expect(cart([promo({ active: false })], "SAVE10").codeError).toMatch(/not active/);
    expect(cart([promo({ startsAt: day(10), endsAt: day(20) })], "SAVE10").discountCents).toBe(400);
  });
  it("total use limit", () => {
    expect(cart([promo({ maxUses: 3, uses: use("x@y.co", 2) })], "SAVE10").discountCents).toBe(400);
    const full = promo({ maxUses: 3, uses: use("x@y.co", 3) });
    expect(usesLeft(full)).toBe(0);
    expect(cart([full], "SAVE10").codeError).toMatch(/fully used/);
  });
  it("one use per email", () => {
    const p = promo({ oncePerEmail: true, uses: use("a@b.co") });
    expect(cart([p], "SAVE10", undefined, "A@B.co").codeError).toMatch(/already used/);
    expect(cart([p], "SAVE10", undefined, "new@b.co").discountCents).toBe(400);
  });
  it("minimum subtotal", () => {
    const p = promo({ minSubtotalCents: 5000 });
    expect(cart([p], "SAVE10").codeError).toMatch(/at least \$50/);
    expect(cart([p], "SAVE10", [{ variantId: "v5", quantity: 2 }]).discountCents).toBe(800);
  });
  it("limited to products or groups: only those lines are discounted", () => {
    const items = [{ variantId: "v5", quantity: 1 }, { variantId: "tb", quantity: 1 }];
    expect(cart([promo({ listingIds: ["tb"] })], "SAVE10", items).discountCents).toBe(500);
    expect(cart([promo({ groupIds: ["g1"] })], "SAVE10", items).discountCents).toBe(400);
    expect(cart([promo({ listingIds: ["tb"] })], "SAVE10").codeError).toMatch(/does not apply/);
  });
});

// ---------------------------------------------------------------- Automatic deals
describe("automatic deals", () => {
  const deal = (uses: number) => promo({ id: "auto", kind: "auto", code: "", name: "Launch", discountType: "$", discountValue: 2000, maxUses: 10, uses: use("x@y.co", uses) });
  it("applies with no code and counts down", () => {
    expect(cart([deal(0)]).discountCents).toBe(2000);
    expect(usesLeft(deal(3))).toBe(7);
    expect(promoHeadlines([deal(3)], NOW)[0].text).toBe("$20 off: 7 left");
  });
  it("stops on its own when the uses run out", () => {
    expect(cart([deal(10)]).discountCents).toBe(0);
    expect(promoHeadlines([deal(10)], NOW)).toEqual([]);
  });
  it("stacks with a code but never below zero", () => {
    const p = cart([deal(0), promo({ discountType: "$", discountValue: 3000 })], "SAVE10");
    expect(p.discountCents).toBe(4000);
    expect(p.applied.map((a) => a.kind)).toEqual(["code", "auto"]);
  });
});

// ---------------------------------------------------------------- Free shipping + tiers
describe("free shipping rules and shipping tiers", () => {
  const rule = promo({ id: "fs", kind: "free_shipping", code: "", name: "Free shipping weekend", minSubtotalCents: 10000, startsAt: day(14), endsAt: day(16) });
  it("needs the date range and the minimum subtotal", () => {
    expect(cart([rule]).freeShipping).toBe(false);
    expect(cart([rule], "", [{ variantId: "v5", quantity: 3 }]).freeShipping).toBe(true);
    expect(priceCart({ items: [{ variantId: "v5", quantity: 3 }], variants: NO_DEALS, promotions: [rule], now: new Date(day(20)) }).freeShipping).toBe(false);
    expect(promoHeadlines([rule], NOW)[0].text).toBe("Free standard shipping on orders $100+");
  });
  it("names exactly what is free in the announcement bar", () => {
    expect(promoHeadlines([rule], NOW, DEFAULT_STORE.shippingTiers)[0].text).toBe("Free standard shipping on orders $100+");
    expect(promoHeadlines([{ ...rule, shippingTiers: ["standard", "priority"] }], NOW, DEFAULT_STORE.shippingTiers)[0].text).toBe("Free standard and priority shipping on orders $100+");
    expect(promoHeadlines([{ ...rule, shippingTiers: ["standard", "priority", "express"] }], NOW, DEFAULT_STORE.shippingTiers)[0].text).toBe("Free shipping on orders $100+");
    // Uses the option names from Settings.
    const renamed = DEFAULT_STORE.shippingTiers.map((t) => (t.id === "standard" ? { ...t, name: "Economy shipping" } : t));
    expect(promoHeadlines([rule], NOW, renamed)[0].text).toBe("Free economy shipping on orders $100+");
    // A rule with no option picked is never advertised and never applies.
    expect(promoHeadlines([{ ...rule, shippingTiers: [] }], NOW, DEFAULT_STORE.shippingTiers)).toEqual([]);
    expect(cart([{ ...rule, shippingTiers: [] }], "", [{ variantId: "v5", quantity: 3 }]).freeShipping).toBe(false);
  });

  // The owner's rule: "Free shipping on orders $100+", Standard only.
  const owner = promo({ id: "fs100", kind: "free_shipping", code: "", name: "Free shipping on orders $100+", minSubtotalCents: 10000, shippingTiers: ["standard"] });
  const quote = (items: { variantId: string; quantity: number }[]) => {
    const p = priceCart({ items, variants: NO_DEALS, promotions: [owner], now: NOW, shippingTiers: DEFAULT_STORE.shippingTiers });
    return { p, opts: shippingOptions(DEFAULT_STORE, p.freeTiers) };
  };
  it("Standard is free on orders of $100 or more", () => {
    const { p, opts } = quote([{ variantId: "v5", quantity: 3 }]); // $120
    expect(p.freeTiers).toEqual(["standard"]);
    expect(p.freeShippingLabel).toBe("Free standard shipping");
    expect(opts.find((o) => o.tier === "standard")).toMatchObject({ cents: 0, baseCents: 695, free: true });
    // Exactly $100 counts.
    expect(priceCart({ items: [{ variantId: "tb", quantity: 2 }], variants: NO_DEALS, promotions: [owner], now: NOW }).freeTiers).toEqual(["standard"]);
  });
  it("Priority and Express are still charged over $100", () => {
    const { opts } = quote([{ variantId: "v5", quantity: 3 }]);
    expect(opts.map((o) => [o.tier, o.cents, o.free])).toEqual([
      ["standard", 0, true],
      ["priority", 1195, false],
      ["express", 3495, false],
    ]);
    // Live carrier prices too: only the covered option drops to $0.
    const live = shippingOptions(DEFAULT_STORE, ["standard"], { standard: { cents: 431, service: "", estimate: "" }, priority: { cents: 980, service: "", estimate: "" } });
    expect(live.map((o) => [o.tier, o.cents, o.baseCents])).toEqual([
      ["standard", 0, 431],
      ["priority", 980, 980],
      ["express", 3495, 3495],
    ]);
  });
  it("everything is charged under $100", () => {
    const { p, opts } = quote([{ variantId: "v5", quantity: 2 }]); // $80
    expect(p.freeShipping).toBe(false);
    expect(p.freeTiers).toEqual([]);
    expect(p.freeShippingLabel).toBe("");
    expect(opts.map((o) => [o.tier, o.cents, o.free])).toEqual([
      ["standard", 695, false],
      ["priority", 1195, false],
      ["express", 3495, false],
    ]);
  });
  it("two rules add up, each covering only its own options", () => {
    const express = promo({ id: "fsx", kind: "free_shipping", code: "", minSubtotalCents: 30000, shippingTiers: ["express"] });
    const mid = priceCart({ items: [{ variantId: "v5", quantity: 3 }], variants: NO_DEALS, promotions: [owner, express], now: NOW });
    expect(mid.freeTiers).toEqual(["standard"]);
    const big = priceCart({ items: [{ variantId: "v10", quantity: 5 }], variants: NO_DEALS, promotions: [owner, express], now: NOW, shippingTiers: DEFAULT_STORE.shippingTiers });
    expect(big.freeTiers).toEqual(["standard", "express"]);
    expect(big.freeShippingLabel).toBe("Free standard and express shipping");
    expect(shippingOptions(DEFAULT_STORE, big.freeTiers).map((o) => o.cents)).toEqual([0, 1195, 0]);
  });
  it("tiers can be renamed or turned off, and live rates replace flat prices", () => {
    const store = parseStore(JSON.stringify({ shippingTiers: [{ id: "express", enabled: false }, { id: "standard", name: "Economy", flatCents: 500 }] }));
    expect(shippingOptions(store, []).map((o) => [o.tier, o.name, o.cents])).toEqual([
      ["standard", "Economy", 500],
      ["priority", "Priority", 1195],
    ]);
    const live = shippingOptions(store, [], { standard: { cents: 431, service: "USPS Ground Advantage", estimate: "" } });
    expect(live[0]).toMatchObject({ cents: 431, service: "USPS Ground Advantage" });
    expect(live[1].cents).toBe(1195);
  });
});

// ---------------------------------------------------------------- Payment methods
describe("payment methods at checkout", () => {
  it("defaults: Zelle on but hidden until its details are filled in", () => {
    expect(checkoutMethods(DEFAULT_STORE.payments)).toEqual([]);
    expect(paymentWarnings(DEFAULT_STORE.payments).join(" ")).toMatch(/Zelle is turned on but has no payment details/);
    const ready = { ...DEFAULT_STORE.payments, zelle: { enabled: true, details: "pay@x.co" } };
    expect(checkoutMethods(ready).map((m) => [m.id, m.available])).toEqual([["zelle", true]]);
    expect(paymentWarnings(ready)).toEqual([]);
  });
  it("coming soon methods show greyed out or stay hidden", () => {
    const p = { ...DEFAULT_STORE.payments, zelle: { enabled: true, details: "x" }, card: { enabled: false, comingSoon: "show" as const } };
    expect(checkoutMethods(p).map((m) => [m.id, m.available])).toEqual([
      ["zelle", true],
      ["card", false],
    ]);
  });
});

// ---------------------------------------------------------------- Money: shipping and labels
describe("shipping income and label cost in the money engine", () => {
  const order = (over: Partial<OrderRec> = {}): OrderRec => ({
    id: "o1",
    date: day(5),
    customer: "",
    customerId: null,
    paymentMethod: "Zelle",
    note: "",
    soldBy: "W",
    discountType: "$",
    discountValue: 0,
    tipCents: 0,
    createdAt: day(5),
    ...ORDER_DEFAULTS,
    source: "online",
    status: "paid",
    lines: [{ id: "l1", orderId: "o1", productId: "v5", productName: "BPC 5mg", quantity: 1, unitPriceCents: 4000, unitCostCents: 1000, cutPercent: 10, sortOrder: 0 }],
    ...over,
  });
  const label = (cost: number, over: Partial<LabelRec> = {}): LabelRec => ({ id: "lb1", orderId: "o1", date: day(6), costCents: cost, carrier: "USPS", service: "", trackingNumber: "", labelUrl: "", shippoTransactionId: "", voided: false, createdAt: day(6), ...over });

  it("shipping charged goes 100% to the business and is never split", () => {
    const plain = computeLedger(appData({ orders: [order()] }));
    const shipped = computeLedger(appData({ orders: [order({ shippingCents: 800 })] }));
    expect(shipped.businessCents - plain.businessCents).toBe(800);
    expect([shipped.pendingA, shipped.pendingB]).toEqual([plain.pendingA, plain.pendingB]);
    expect(shipped.orders.get("o1")).toMatchObject({ shipping: 800, total: 4800 });
    expect(shipped.shippingCollected).toBe(800);
    // profit 3000, cut 10% -> 2700 split 50/50
    expect([shipped.pendingA, shipped.pendingB]).toEqual([1350, 1350]);
  });
  it("buying a label subtracts its cost from business money", () => {
    const l = computeLedger(appData({ orders: [order({ shippingCents: 800 })], labels: [label(455)] }));
    const no = computeLedger(appData({ orders: [order({ shippingCents: 800 })] }));
    expect(no.businessCents - l.businessCents).toBe(455);
    expect(l.labelCosts).toBe(455);
    expect([l.pendingA, l.pendingB]).toEqual([no.pendingA, no.pendingB]);
  });
  it("free shipping means the business pays the label", () => {
    const base = computeLedger(appData({ orders: [order()] }));
    const free = computeLedger(appData({ orders: [order({ shippingCents: 0 })], labels: [label(455)] }));
    expect(free.businessCents).toBe(base.businessCents - 455);
  });
  it("a voided label costs nothing", () => {
    expect(computeLedger(appData({ labels: [label(455, { voided: true })] })).labelCosts).toBe(0);
  });
  it("split plan covers shipping as business money, and the plan still equals pending", () => {
    const d = appData({ orders: [order({ shippingCents: 800 })] });
    const ledger = computeLedger(d);
    const plan = planSplit(d, ledger);
    expect([plan.partnerACents, plan.partnerBCents]).toEqual([ledger.pendingA, ledger.pendingB]);
    expect(plan.businessCents).toBe(4000 + 800 - 2700);
  });
  it("orders awaiting payment or canceled never touch stock or money", () => {
    const base = computeLedger(appData());
    const d = appData({ pendingOrders: [order({ status: "awaiting_payment", shippingCents: 800 }), order({ id: "o2", status: "canceled" })] });
    const l = computeLedger(d);
    expect(l.businessCents).toBe(base.businessCents);
    expect(l.stock.get("v5")!.stock).toBe(base.stock.get("v5")!.stock);
    expect(l.orders.size).toBe(0);
  });
});

// ---------------------------------------------------------------- Backups
describe("backups: old files still import", () => {
  it("a version 2 backup gets parents, order numbers and store defaults", () => {
    const v2 = {
      settings: { startingBalanceCents: -5000, paymentMethods: ["Cash"] },
      products: [{ id: "p1", name: "BPC 157 10mg", defaultPriceCents: 5000, costOverrideCents: null, lowStockThreshold: null, color: "red", sortOrder: 0, archived: false, createdAt: day(1) }],
      customers: [{ id: "c1", name: "Mike", phone: "", notes: "", createdAt: day(1) }],
      purchases: [],
      adjustments: [],
      orders: [
        { id: "b", date: day(3), customer: "Mike", customerId: "c1", paymentMethod: "Cash", note: "", soldBy: "A", discountType: "$", discountValue: 0, tipCents: 0, createdAt: day(3), lines: [] },
        { id: "a", date: day(2), customer: "", customerId: null, paymentMethod: "Cash", note: "", soldBy: "B", discountType: "$", discountValue: 0, tipCents: 0, createdAt: day(2), lines: [] },
      ],
      splits: [],
      payouts: [],
    };
    const out = normalizeBackup(JSON.parse(JSON.stringify(v2)));
    expect(out.listings).toHaveLength(1);
    expect(out.listings[0]).toMatchObject({ name: "BPC 157 10mg", slug: "bpc-157-10mg", showOnWebsite: false });
    expect(out.products[0]).toMatchObject({ listingId: out.listings[0].id, testingStatus: "coming_soon" });
    expect(out.orders.map((o) => [o.id, o.number, o.source, o.status])).toEqual([
      ["b", 1002, "inperson", "completed"],
      ["a", 1001, "inperson", "completed"],
    ]);
    expect(out.customers[0]).toMatchObject({ email: "", hasAccount: false });
    expect(out.store.open).toBe(false);
    expect(out.pendingOrders).toEqual([]);
  });
  it("a version 3 backup round-trips pending orders and labels", () => {
    const d = appData();
    const withWeb: AppData = { ...d, pendingOrders: [{ ...ORDER_DEFAULTS, id: "w1", number: 1007, source: "online", status: "awaiting_payment", date: day(4), createdAt: day(4), customer: "", customerId: null, paymentMethod: "Zelle", note: "", soldBy: "W", discountType: "$", discountValue: 0, tipCents: 0, lines: [], web: null }] };
    const out = normalizeBackup(JSON.parse(JSON.stringify(withWeb)));
    expect(out.pendingOrders.map((o) => o.number)).toEqual([1007]);
    expect(out.orders).toEqual([]);
    expect(out.listings.map((l) => l.id)).toEqual(["bpc", "tb", "hidden"]);
  });
});
