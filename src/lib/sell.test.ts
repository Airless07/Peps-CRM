// Pure tests: Sell cart quick buttons (Settings) and the saved-order helpers.
import { describe, expect, it } from "vitest";
import type { Draft } from "./draft";
import { computeLedger, orderTotals } from "./money";
import { finalizeSale, priceChanges, savedProfit, savedSummary, savedToDraft, savedTotals, stockShortfalls, toSavedOrder } from "./saved-orders";
import { saleInput, savedOrderInput, settingsUpdate } from "./schemas";
import {
  DEFAULT_SELL_BUTTONS,
  MAX_SELL_BUTTONS,
  cleanSellButtons,
  defaultSellButtons,
  discountButtonLabel,
  isDiscountButtonOn,
  moveItem,
  sellButtonsError,
  tapDiscountButton,
  tapTipButton,
  tipButtonLabel,
  type SellButtons,
} from "./sell-buttons";
import { DEFAULT_SETTINGS, ORDER_DEFAULTS, PRODUCT_DEFAULTS, emptyStoreData, type AppData, type OrderRec, type ProductRec } from "./types";

const line = (id: string, productId: string, qty: number, price: number) => ({ id, productId, productName: productId.toUpperCase(), quantity: qty, unitPriceCents: price, unitCostCents: 1000, cutPercent: 10 });
const draft = (over: Partial<Draft> = {}): Draft => ({
  id: "d1",
  date: "2026-02-01T12:00:00.000Z",
  customer: "",
  customerId: null,
  paymentMethod: "Cash",
  note: "",
  soldBy: "A",
  discountType: "$",
  discountValue: 0,
  tipCents: 0,
  lines: [line("l1", "p1", 2, 5000), line("l2", "p2", 1, 3000)], // subtotal $130.00
  ...over,
});
const product = (id: string, price: number): ProductRec => ({ id, name: id.toUpperCase(), defaultPriceCents: price, costOverrideCents: null, lowStockThreshold: null, color: "slate", sortOrder: 0, archived: false, createdAt: "2026-01-01T00:00:00.000Z", ...PRODUCT_DEFAULTS });

// ---------------------------------------------------------------- Quick buttons
describe("Sell cart quick buttons", () => {
  it("defaults are -$5, -$10, -$20, -10% and tips $5, $10, $20", () => {
    expect(DEFAULT_SELL_BUTTONS.discounts.map(discountButtonLabel)).toEqual(["-$5", "-$10", "-$20", "-10%"]);
    expect(DEFAULT_SELL_BUTTONS.tips.map(tipButtonLabel)).toEqual(["$5", "$10", "$20"]);
    expect(DEFAULT_SETTINGS.sellButtons).toEqual(DEFAULT_SELL_BUTTONS);
  });

  it("labels show cents only when needed", () => {
    expect(discountButtonLabel({ type: "$", value: 250 })).toBe("-$2.50");
    expect(discountButtonLabel({ type: "%", value: 12.5 })).toBe("-12.5%");
    expect(tipButtonLabel(1550)).toBe("$15.50");
  });

  it("a $ button takes that amount off the order", () => {
    const d = tapDiscountButton(draft(), { type: "$", value: 1000 });
    expect(d).toMatchObject({ discountType: "$", discountValue: 1000 });
    expect(orderTotals(d)).toMatchObject({ subtotal: 13000, discount: 1000, total: 12000 });
  });

  it("a % button takes that percent off the order subtotal, the same as the typed % discount", () => {
    const d = tapDiscountButton(draft(), { type: "%", value: 20 });
    expect(d).toMatchObject({ discountType: "%", discountValue: 20 });
    expect(orderTotals(d)).toMatchObject({ subtotal: 13000, discount: 2600, total: 10400 });
    // Same numbers as typing 20 in the existing % field.
    expect(orderTotals(d)).toEqual(orderTotals(draft({ discountType: "%", discountValue: 20 })));
    // The percent is of the subtotal only: a tip is not discounted.
    expect(orderTotals({ ...d, tipCents: 1000 })).toMatchObject({ discount: 2600, tip: 1000, total: 11400 });
  });

  it("the discount is still capped at the subtotal", () => {
    expect(orderTotals(tapDiscountButton(draft(), { type: "$", value: 50000 }))).toMatchObject({ discount: 13000, total: 0 });
    expect(orderTotals(tapDiscountButton(draft(), { type: "%", value: 100 }))).toMatchObject({ discount: 13000, total: 0 });
    expect(orderTotals({ ...tapDiscountButton(draft(), { type: "$", value: 50000 }), tipCents: 500 }).total).toBe(500);
  });

  it("tapping the button that is on clears the discount; tapping another one switches", () => {
    const five = { type: "$", value: 500 } as const;
    const ten = { type: "%", value: 10 } as const;
    const on = tapDiscountButton(draft(), five);
    expect(isDiscountButtonOn(on, five)).toBe(true);
    expect(isDiscountButtonOn(on, ten)).toBe(false);
    expect(tapDiscountButton(on, five).discountValue).toBe(0);
    expect(tapDiscountButton(on, ten)).toMatchObject({ discountType: "%", discountValue: 10 });
  });

  it("a tip button sets the tip to its amount", () => {
    const d = tapTipButton(draft(), 1500);
    expect(d.tipCents).toBe(1500);
    expect(orderTotals(d)).toMatchObject({ tip: 1500, total: 14500 });
  });

  it("the buttons come back in exactly the saved order", () => {
    const saved: SellButtons = {
      discounts: [
        { type: "%", value: 20 },
        { type: "$", value: 1000 },
        { type: "%", value: 5 },
        { type: "$", value: 500 },
      ],
      tips: [2000, 500, 1000],
    };
    const read = cleanSellButtons(JSON.stringify(saved));
    expect(read).toEqual(saved);
    expect(read.discounts.map(discountButtonLabel)).toEqual(["-20%", "-$10", "-5%", "-$5"]);
    expect(read.tips.map(tipButtonLabel)).toEqual(["$20", "$5", "$10"]);
  });

  it("drag to reorder moves one button and keeps the rest in order", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    const same = ["a", "b"];
    expect(moveItem(same, 1, 1)).toBe(same);
    expect(moveItem(same, 0, 5)).toBe(same);
    const moved = { ...defaultSellButtons(), discounts: moveItem(defaultSellButtons().discounts, 3, 0) };
    expect(cleanSellButtons(JSON.stringify(moved)).discounts.map(discountButtonLabel)).toEqual(["-10%", "-$5", "-$10", "-$20"]);
  });

  it("empty, broken or missing stored buttons fall back to the defaults", () => {
    for (const v of ["", "not json", "{}", null, undefined, '{"discounts":[],"tips":[]}', '{"discounts":"x","tips":7}']) expect(cleanSellButtons(v)).toEqual(DEFAULT_SELL_BUTTONS);
  });

  it("invalid and repeated buttons are dropped, and never more than 8 are kept", () => {
    const read = cleanSellButtons({
      discounts: [{ type: "$", value: 500 }, { type: "$", value: 500 }, { type: "$", value: -1 }, { type: "%", value: 150 }, { type: "x", value: 5 }, { type: "$", value: 2.5 }, { type: "%", value: 15 }],
      tips: [500, 500, 0, -5, 1.5, "9", ...Array.from({ length: 12 }, (_, i) => (i + 2) * 100)],
    });
    expect(read.discounts).toEqual([{ type: "$", value: 500 }, { type: "%", value: 15 }]);
    expect(read.tips).toHaveLength(MAX_SELL_BUTTONS);
    expect(read.tips[0]).toBe(500);
  });

  it("keeps at least 1 and at most 8 buttons per list", () => {
    const ok = defaultSellButtons();
    expect(sellButtonsError(ok)).toBeNull();
    expect(sellButtonsError({ ...ok, discounts: [] })).toMatch(/at least 1 discount/);
    expect(sellButtonsError({ ...ok, tips: [] })).toMatch(/at least 1 tip/);
    expect(sellButtonsError({ ...ok, tips: Array.from({ length: 9 }, (_, i) => (i + 1) * 100) })).toMatch(/No more than 8 tip/);
    expect(sellButtonsError({ ...ok, tips: Array.from({ length: 8 }, (_, i) => (i + 1) * 100) })).toBeNull();
    expect(sellButtonsError({ ...ok, discounts: [{ type: "%", value: 101 }] })).toMatch(/above 0/);
    expect(sellButtonsError({ ...ok, discounts: [{ type: "$", value: 0 }] })).toMatch(/above 0/);
    expect(sellButtonsError({ ...ok, tips: [500, 500] })).toMatch(/same/);
  });

  it("the settings API accepts valid buttons and refuses 0 or 9 of them", () => {
    expect(settingsUpdate.parse({ sellButtons: defaultSellButtons() }).sellButtons).toEqual(DEFAULT_SELL_BUTTONS);
    expect(settingsUpdate.safeParse({ sellButtons: { discounts: [], tips: [500] } }).success).toBe(false);
    expect(settingsUpdate.safeParse({ sellButtons: { discounts: [{ type: "$", value: 500 }], tips: Array.from({ length: 9 }, (_, i) => (i + 1) * 100) } }).success).toBe(false);
    expect(settingsUpdate.safeParse({ sellButtons: { discounts: [{ type: "%", value: 500 }], tips: [500] } }).success).toBe(false);
    // Other settings can still be saved without sending the buttons.
    expect(settingsUpdate.safeParse({ lowStockThreshold: 2 }).success).toBe(true);
  });

  it("changing the buttons never changes a past order", () => {
    const o: OrderRec = { ...ORDER_DEFAULTS, ...draft({ id: "o1", discountType: "%", discountValue: 10, tipCents: 500 }), createdAt: "2026-02-01T12:00:00.000Z", lines: draft().lines.map((l, i) => ({ ...l, orderId: "o1", sortOrder: i })) };
    const base: AppData = { settings: { ...DEFAULT_SETTINGS, startDate: "2026-01-01T00:00:00.000Z" }, products: [product("p1", 5000), product("p2", 3000)], customers: [], purchases: [], adjustments: [], orders: [o], splits: [], payouts: [], ...emptyStoreData() };
    const changed: AppData = { ...base, settings: { ...base.settings, sellButtons: { discounts: [{ type: "%", value: 50 }], tips: [9900] } } };
    expect(computeLedger(changed)).toEqual(computeLedger(base));
    expect(computeLedger(changed).orders.get("o1")).toMatchObject({ subtotal: 13000, discount: 1300, tip: 500 });
  });
});

// ---------------------------------------------------------------- Saved orders (pure)
describe("saved orders: pure helpers", () => {
  const products = [product("p1", 5000), product("p2", 3000)];
  const cart = draft({ customer: " Sam Lee ", customerId: "c9", note: "Pick up Friday", soldBy: "B", discountType: "%", discountValue: 10, tipCents: 500, lines: [line("l1", "p1", 2, 5000), line("l2", "p2", 1, 2500)] });

  it("saving keeps items, prices, discount, tip, customer, sold by and note", () => {
    const s = toSavedOrder(cart, products, null, "2026-02-02T10:00:00.000Z");
    expect(s).toMatchObject({ id: "d1", savedAt: "2026-02-02T10:00:00.000Z", customer: "Sam Lee", customerId: "c9", note: "Pick up Friday", soldBy: "B", discountType: "%", discountValue: 10, tipCents: 500 });
    expect(s.lines.map((l) => [l.productId, l.quantity, l.unitPriceCents])).toEqual([["p1", 2, 5000], ["p2", 1, 2500]]);
    expect(savedTotals(s)).toEqual(orderTotals(cart));
    expect(savedOrderInput.safeParse(s).success).toBe(true);
  });

  it("opening loads the same order back into the cart", () => {
    const s = toSavedOrder(cart, products);
    const back = savedToDraft(s, "Cash");
    expect(orderTotals(back)).toEqual(orderTotals(cart));
    expect(back).toMatchObject({ id: cart.id, customer: "Sam Lee", customerId: "c9", soldBy: "B", note: "Pick up Friday", discountType: "%", discountValue: 10, tipCents: 500 });
    expect(back.lines).toEqual(cart.lines);
    expect(saleInput.safeParse(back).success).toBe(true);
  });

  it("prices and discount stay as saved when a product price changes later, with a note", () => {
    const s = toSavedOrder(cart, products);
    expect(priceChanges(s, products)).toEqual([]);
    const later = [product("p1", 6500), product("p2", 3000)];
    expect(priceChanges(s, later)).toEqual([{ lineId: "l1", productName: "P1", wasCents: 5000, nowCents: 6500, savedCents: 5000 }]);
    // The saved order itself is untouched by the new price.
    expect(savedTotals(s)).toEqual(orderTotals(cart));
    expect(savedToDraft(s, "Cash").lines[0].unitPriceCents).toBe(5000);
    // A line sold at a custom price (p2 at $25) is only flagged when the regular price really changes.
    expect(priceChanges(s, [product("p1", 5000), product("p2", 3500)])).toEqual([{ lineId: "l2", productName: "P2", wasCents: 3000, nowCents: 3500, savedCents: 2500 }]);
    // A deleted product gives no note.
    expect(priceChanges(s, [])).toEqual([]);
  });

  it("saving an opened order again keeps the price reference of the lines it already had", () => {
    const first = toSavedOrder(cart, products);
    const later = [product("p1", 6500), product("p2", 3000), product("p3", 900)];
    const edited = { ...savedToDraft(first, "Cash"), lines: [...savedToDraft(first, "Cash").lines, line("l3", "p3", 1, 900)] };
    const again = toSavedOrder(edited, later, first);
    expect(again.lines.map((l) => l.listPriceCents)).toEqual([5000, 3000, 900]);
    expect(priceChanges(again, later).map((c) => c.lineId)).toEqual(["l1"]);
  });

  it("warns when completing would push a size below zero stock", () => {
    const stock = (pid: string) => ({ p1: 3, p2: 1 })[pid] ?? 0;
    expect(stockShortfalls([line("a", "p1", 2, 1), line("b", "p2", 1, 1)], stock)).toEqual([]);
    expect(stockShortfalls([line("a", "p1", 3, 1)], stock)).toEqual([]); // exactly to zero is fine
    expect(stockShortfalls([line("a", "p1", 4, 1), line("b", "p2", 1, 1)], stock)).toEqual(["P1"]);
    // Two lines of the same size are added up.
    expect(stockShortfalls([line("a", "p1", 2, 1), line("b", "p1", 2, 9)], stock)).toEqual(["P1"]);
    expect(stockShortfalls([line("a", "gone", 1, 1)], stock)).toEqual(["GONE"]);
    expect(stockShortfalls([{ productId: null, productName: "Deleted", quantity: 5 }], stock)).toEqual([]);
  });

  it("the last step of a sale snapshots cost and cut and never touches prices, discount or tip", () => {
    const { final, created } = finalizeSale(cart, { customers: [], unitCost: (pid) => (pid === "p1" ? 1234 : undefined), cutPercent: 15, now: "2026-03-01T09:00:00.000Z" });
    expect(final.date).toBe("2026-03-01T09:00:00.000Z");
    expect(final.lines.map((l) => [l.unitPriceCents, l.quantity, l.unitCostCents, l.cutPercent])).toEqual([[5000, 2, 1234, 15], [2500, 1, 1000, 15]]);
    expect(orderTotals(final)).toEqual(orderTotals(cart));
    expect(created).toMatchObject({ id: "c9", name: "Sam Lee" });
  });

  it("the saved orders summary is exactly the sum of the saved orders", () => {
    // Current cost per unit: p1 $12.00, p2 $9.00 (the cost noted on the lines, $10.00, is ignored).
    const cost = new Map([["p1", 1200], ["p2", 900]]);
    const costOf = (pid: string) => cost.get(pid);
    const list = [
      toSavedOrder(draft({ id: "a", discountType: "%", discountValue: 10, tipCents: 500 }), products), // $130 - $13 + $5 tip
      toSavedOrder(draft({ id: "b", discountType: "$", discountValue: 2000, lines: [line("l3", "p2", 4, 3000)] }), products), // $120 - $20
      toSavedOrder(draft({ id: "c", lines: [line("l4", "gone", 1, 2500)] }), products), // deleted product: uses its noted cost
    ];
    // Each order on its own.
    expect(list.map((o) => savedTotals(o).total)).toEqual([12200, 10000, 2500]);
    expect(list.map((o) => savedProfit(o, costOf))).toEqual([12200 - (2 * 1200 + 900), 10000 - 4 * 900, 2500 - 1000]);
    // The summary = the sums.
    const sum = savedSummary(list, costOf);
    expect(sum).toEqual({
      count: 3,
      revenueCents: list.reduce((x, o) => x + savedTotals(o).total, 0),
      tipCents: 500,
      profitCents: list.reduce((x, o) => x + savedProfit(o, costOf), 0),
      discountCents: list.reduce((x, o) => x + savedTotals(o).discount, 0),
    });
    expect(sum).toMatchObject({ revenueCents: 24700, profitCents: 24700 - 3300 - 3600 - 1000, discountCents: 3300 });
    // Removing one (completed or deleted) takes it out of every number at once.
    expect(savedSummary(list.slice(1), costOf)).toMatchObject({ count: 2, revenueCents: 12500, tipCents: 0, discountCents: 2000 });
    expect(savedSummary([], costOf)).toEqual({ count: 0, revenueCents: 0, tipCents: 0, profitCents: 0, discountCents: 0 });
  });

  it("saved orders hold their items out of stock but never touch money", () => {
    const base: AppData = { settings: { ...DEFAULT_SETTINGS, startDate: "2026-01-01T00:00:00.000Z" }, products, customers: [], purchases: [{ id: "pu", date: "2026-01-02T00:00:00.000Z", productId: "p1", quantity: 5, totalCostCents: 5000, note: "", fromInvestment: false, createdAt: "2026-01-02T00:00:00.000Z" }], adjustments: [], orders: [], splits: [], payouts: [], ...emptyStoreData() };
    const withSaved: AppData = { ...base, savedOrders: [toSavedOrder(cart, products), toSavedOrder({ ...cart, id: "d2" }, products)] };
    const a = computeLedger(base);
    const b = computeLedger(withSaved);
    // Money: identical.
    expect({ ...b, stock: null, history: null }).toEqual({ ...a, stock: null, history: null });
    expect(b.history).toEqual(a.history);
    // Stock: each saved order takes its quantities out (p1: 2 + 2 held of 5; p2: 1 + 1 held of 0).
    expect(b.stock.get("p1")).toMatchObject({ stock: 1, heldQty: 4, soldQty: 0, unitCost: a.stock.get("p1")!.unitCost });
    expect(b.stock.get("p2")).toMatchObject({ stock: -2, heldQty: 2 });
    // Completing one: the hold becomes a sale, so stock stays where it was (never subtracted twice).
    const order = { ...ORDER_DEFAULTS, ...cart, id: "d2", lines: cart.lines.map((l, i) => ({ ...l, orderId: "d2", sortOrder: i })) } as OrderRec;
    const completed = computeLedger({ ...withSaved, savedOrders: withSaved.savedOrders.filter((o) => o.id !== "d2"), orders: [order] });
    expect(completed.stock.get("p1")).toMatchObject({ stock: 1, heldQty: 2, soldQty: 2 });
    // Deleting a saved order puts its stock back.
    expect(computeLedger({ ...withSaved, savedOrders: [] }).stock.get("p1")?.stock).toBe(5);
  });
});
