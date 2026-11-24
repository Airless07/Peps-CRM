// Sale prices: automatic percent deals with no minimum or cap are shown on products (regular price
// crossed out) and charged exactly that at checkout. Everything else stays an order discount + badge.
import { describe, expect, it } from "vitest";
import { applySellDeals } from "../bogo";
import { computeLedger } from "../money";
import type { AppData, ListingRec, ProductRec, PromotionRec } from "../types";
import { DEFAULT_SETTINGS, PRODUCT_DEFAULTS, emptyStoreData } from "../types";
import { buildCatalog, pricedVariants } from "./catalog";
import { dealBadge, discountedUnit, orderLinesOf, priceCart, promoHeadlines, saleBlock, salePrice } from "./pricing";

const day = (n: number) => new Date(Date.UTC(2026, 0, n, 12)).toISOString();
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
  qtyDeals: [],
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
  costOverrideCents: 1000,
  lowStockThreshold: null,
  color: "slate",
  sortOrder: 0,
  archived: false,
  createdAt: day(1),
  ...PRODUCT_DEFAULTS,
  listingId,
  ...over,
});
const data = (promotions: PromotionRec[], over: Partial<AppData> = {}): AppData => ({
  settings: { ...DEFAULT_SETTINGS, startingBalanceCents: 0 },
  products: [product("bpc5", "bpc", 5000, { variantLabel: "5mg" }), product("bpc10", "bpc", 11000, { variantLabel: "10mg", variantSort: 1 }), product("tb", "tb", 5555), product("ghk", "ghk", 4000)],
  customers: [],
  purchases: [],
  adjustments: [],
  orders: [],
  splits: [],
  payouts: [],
  ...emptyStoreData(),
  listings: [listing("bpc", { groupIds: ["g1"] }), listing("tb"), listing("ghk", { qtyDeals: [{ minQty: 2, percentOff: 10 }] })],
  groups: [{ id: "g1", name: "Recovery", slug: "recovery", sortOrder: 0, createdAt: day(1) }],
  promotions,
  ...over,
});
const deal = (over: Partial<PromotionRec> = {}): PromotionRec => ({
  id: over.id ?? "sale",
  kind: "auto",
  name: "Black Friday",
  code: "",
  discountType: "%",
  discountValue: 30,
  minSubtotalCents: 0,
  startsAt: null,
  endsAt: null,
  maxUses: null,
  oncePerEmail: false,
  listingIds: [],
  groupIds: [],
  shippingTiers: [],
  active: true,
  createdAt: day(1),
  uses: [],
  ...over,
});
const code10 = deal({ id: "code", kind: "code", code: "SAVE10", name: "", discountValue: 10 });

const catalogOf = (d: AppData, now = NOW) => buildCatalog(d, computeLedger(d), now);
const productOf = (d: AppData, id: string, now = NOW) => catalogOf(d, now).products.find((p) => p.id === id)!;
const quote = (d: AppData, items: { variantId: string; quantity: number }[], code = "", now = NOW) =>
  priceCart({ items, variants: pricedVariants(d), promotions: d.promotions, code, now });

describe("30% sitewide deal: shown prices", () => {
  const d = data([deal()]);
  it("single price: regular crossed out, sale price, 30% OFF", () => {
    const tb = productOf(d, "tb");
    expect(tb.variants[0]).toMatchObject({ listPriceCents: 5555, priceCents: 3889 }); // 55.55 x 0.7 = 38.885 -> $38.89, like checkout
    expect(tb).toMatchObject({ priceFromCents: 3889, priceToCents: 3889, listFromCents: 5555, listToCents: 5555, sale: { percent: 30, name: "Black Friday" } });
  });
  it("price range: both ends crossed out and both discounted ($50 - $110 -> $35 - $77)", () => {
    const bpc = productOf(d, "bpc");
    expect([bpc.listFromCents, bpc.listToCents, bpc.priceFromCents, bpc.priceToCents]).toEqual([5000, 11000, 3500, 7700]);
  });
  it("every size has its own sale price (what the product page shows when the size changes)", () => {
    expect(productOf(d, "bpc").variants.map((v) => [v.label, v.listPriceCents, v.priceCents])).toEqual([
      ["5mg", 5000, 3500],
      ["10mg", 11000, 7700],
    ]);
  });
  it("cart lines and totals equal the shown price exactly", () => {
    const cat = productOf(d, "bpc");
    const q = quote(d, [
      { variantId: "bpc5", quantity: 1 },
      { variantId: "bpc10", quantity: 1 },
      { variantId: "tb", quantity: 3 },
    ]);
    const shown = cat.variants[0].priceCents + cat.variants[1].priceCents + 3 * productOf(d, "tb").variants[0].priceCents;
    expect(q.subtotalCents).toBe(shown);
    expect(q.subtotalCents - q.discountCents).toBe(shown);
    expect(q.lines.map((l) => [l.variantId, l.listPriceCents, l.unitPriceCents])).toEqual([
      ["bpc5", 5000, 3500],
      ["bpc10", 11000, 7700],
      ["tb", 5555, 3889],
    ]);
    expect(q.saleSavingsCents).toBe(5000 + 11000 + 3 * 5555 - shown);
    expect(q.listSubtotalCents - q.saleSavingsCents - q.qtySavingsCents).toBe(q.subtotalCents);
    // Recorded once on the order like any deal, but never counted as a second discount.
    expect(q.applied).toEqual([{ id: "sale", kind: "auto", label: "Black Friday: 30% off (sale price)", cents: q.saleSavingsCents, sale: true }]);
    expect(q.discountCents).toBe(0);
  });
  it("order lines keep the regular price and the deal name, and charge the sale price", () => {
    const q = quote(d, [{ variantId: "tb", quantity: 2 }]);
    expect(orderLinesOf(q)).toEqual([{ variantId: "tb", name: "TB", quantity: 2, unitPriceCents: 3889, dealId: "", dealName: "Black Friday: 30% off", fullPriceCents: 5555 }]);
  });
  it("buy more, save more works on top of the sale price (same math as the product page)", () => {
    const ghk = productOf(d, "ghk");
    const q = quote(d, [{ variantId: "ghk", quantity: 2 }]);
    expect(q.lines[0].unitPriceCents).toBe(discountedUnit(ghk.variants[0].priceCents, 10)); // 4000 -> 2800 -> 2520
    expect(q.lines[0].unitPriceCents).toBe(2520);
    expect(ghk.dealBadges).toEqual(["Buy 2, save 10%"]);
  });
  it("discount codes still apply on top, on the sale-priced items", () => {
    const q = quote(d, [{ variantId: "tb", quantity: 1 }], "SAVE10");
    expect(q.subtotalCents).toBe(3889);
    const withCode = priceCart({ items: [{ variantId: "tb", quantity: 1 }], variants: pricedVariants(d), promotions: [deal(), code10], code: "SAVE10", now: NOW });
    expect(withCode.discountCents).toBe(389); // 10% of $38.89, rounded like before
    expect(withCode.applied.map((a) => a.kind)).toEqual(["auto", "code"]);
  });
  it("the banner says it", () => {
    expect(promoHeadlines([deal()], NOW)).toEqual([{ text: "Black Friday: 30% off everything. Sale prices shown.", code: "" }]);
  });
});

describe("deals that do not change the shown price: badge only", () => {
  const regular = (d: AppData) => {
    const bpc = productOf(d, "bpc");
    expect([bpc.priceFromCents, bpc.priceToCents, bpc.listFromCents, bpc.listToCents, bpc.sale]).toEqual([5000, 11000, 5000, 11000, null]);
    return bpc;
  };
  it("a minimum subtotal", () => {
    const d = data([deal({ minSubtotalCents: 7000 })]);
    expect(regular(d).dealBadges).toEqual(["30% off orders $70+"]);
    expect(saleBlock(d.promotions[0])).toBe("has a minimum");
    // Still taken off the order at checkout once the minimum is met.
    expect(quote(d, [{ variantId: "bpc10", quantity: 1 }]).discountCents).toBe(3300);
  });
  it("a stop-after-N-orders cap", () => {
    const d = data([deal({ maxUses: 5 })]);
    expect(regular(d).dealBadges).toEqual(["30% off: 5 left"]);
  });
  it("a fixed $ amount off the order", () => {
    const d = data([deal({ discountType: "$", discountValue: 2000, minSubtotalCents: 7000 })]);
    expect(regular(d).dealBadges).toEqual(["$20 off orders $70+"]);
    expect(dealBadge(deal({ discountType: "$", discountValue: 500 }))).toBe("$5 off your order");
  });
  it("Show sale price turned off", () => {
    const d = data([deal({ showSalePrice: false })]);
    expect(regular(d).dealBadges).toEqual(["30% off"]);
    expect(quote(d, [{ variantId: "bpc5", quantity: 1 }]).discountCents).toBe(1500);
  });
});

describe("more than one deal, limits, and when a deal ends", () => {
  it("only the products / groups the deal is limited to", () => {
    const d = data([deal({ groupIds: ["g1"] })]);
    expect(productOf(d, "bpc").priceFromCents).toBe(3500);
    expect(productOf(d, "tb").priceFromCents).toBe(5555);
    expect(productOf(d, "tb").sale).toBeNull();
    expect(quote(d, [{ variantId: "tb", quantity: 1 }]).subtotalCents).toBe(5555);
  });
  it("two percent deals on one product: the best one, the same in the shop and the cart", () => {
    const d = data([deal({ id: "all", discountValue: 20 }), deal({ id: "rec", discountValue: 30, groupIds: ["g1"] })]);
    expect(productOf(d, "bpc").priceFromCents).toBe(3500);
    expect(productOf(d, "tb").priceFromCents).toBe(4444);
    const q = quote(d, [
      { variantId: "bpc5", quantity: 1 },
      { variantId: "tb", quantity: 1 },
    ]);
    expect(q.subtotalCents).toBe(3500 + 4444);
    expect(q.discountCents).toBe(0);
  });
  it("ended, paused, not started yet or turned off: regular prices again, nothing taken off", () => {
    for (const over of [{ endsAt: day(14) }, { active: false }, { startsAt: day(16) }]) {
      const d = data([deal(over)]);
      expect(productOf(d, "tb").priceFromCents).toBe(5555);
      expect(productOf(d, "tb").sale).toBeNull();
      expect(quote(d, [{ variantId: "tb", quantity: 1 }])).toMatchObject({ subtotalCents: 5555, discountCents: 0, saleSavingsCents: 0 });
    }
    // The same deal, before and after its end date: the catalog is built with the time it is built.
    const d = data([deal({ endsAt: day(20) })]);
    expect(productOf(d, "tb", NOW).priceFromCents).toBe(3889);
    expect(productOf(d, "tb", new Date(day(21))).priceFromCents).toBe(5555);
  });
  it("rounding: integer cents, exactly what checkout charges", () => {
    // Exact integer math (no float drift): 5555 x 70 / 100 = 3888.5 -> 3889.
    for (const cents of [1, 999, 5555, 12345, 9999]) expect(salePrice(cents, { percent: 30 })).toBe(Math.round((cents * 70) / 100));
    expect(Number.isInteger(salePrice(5555, { percent: 33.3 }))).toBe(true);
  });
});

describe("owner price still wins (Sell screen)", () => {
  it("an owner purchase stays at cost; sale deals never touch Sell lines", () => {
    const line = { id: "l1", productId: "tb", productName: "TB", quantity: 2, unitPriceCents: 1000, unitCostCents: 1000, cutPercent: 10, fullPriceCents: 5555 };
    const owner = applySellDeals({ lines: [line], owner: "A" } as never, { promotions: [deal()], products: [{ id: "tb", listingId: "tb" }], now: NOW });
    expect(owner.lines.map((l) => l.unitPriceCents)).toEqual([1000]);
    const sale = applySellDeals({ lines: [{ ...line, unitPriceCents: 5555, fullPriceCents: undefined }] } as never, { promotions: [deal()], products: [{ id: "tb", listingId: "tb" }], now: NOW });
    expect(sale.lines.map((l) => l.unitPriceCents)).toEqual([5555]);
  });
});
