import { describe, expect, it } from "vitest";
import {
  allocateDiscount,
  computeLedger,
  discountAmount,
  orderTotals,
  planSplit,
} from "./money";
import type {
  AppData,
  OrderLineRec,
  OrderRec,
  PurchaseRec,
  SettingsRec,
  SplitRec,
} from "./types";

// ---------------------------------------------------------------- builders
let seq = 0;
const id = (p: string) => `${p}${++seq}`;
const day = (n: number, h = 12) => new Date(Date.UTC(2026, 0, n, h)).toISOString();

function settings(over: Partial<SettingsRec> = {}): SettingsRec {
  return {
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
    ...over,
  };
}

function data(over: Partial<AppData> = {}): AppData {
  return {
    settings: settings(),
    products: [
      {
        id: "p1",
        name: "Vial A",
        defaultPriceCents: 5000,
        costOverrideCents: null,
        lowStockThreshold: null,
        color: "blue",
        sortOrder: 0,
        archived: false,
        createdAt: day(1, 0),
      },
    ],
    customers: [],
    purchases: [],
    adjustments: [],
    orders: [],
    splits: [],
    payouts: [],
    ...over,
  };
}

type L = { price: number; cost: number; qty?: number; cut?: number; productId?: string };
function order(date: string, lines: L[], over: Partial<OrderRec> = {}): OrderRec {
  const oid = over.id ?? id("o");
  return {
    id: oid,
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
    ...over,
    lines: lines.map(
      (l, i): OrderLineRec => ({
        id: `${oid}-l${i}`,
        orderId: oid,
        productId: l.productId ?? "p1",
        productName: "Vial A",
        quantity: l.qty ?? 1,
        unitPriceCents: l.price,
        unitCostCents: l.cost,
        cutPercent: l.cut ?? 10,
        sortOrder: i,
      }),
    ),
  };
}

function purchase(date: string, qty: number, total: number, fromInvestment = false): PurchaseRec {
  return {
    id: id("pu"),
    date,
    productId: "p1",
    quantity: qty,
    totalCostCents: total,
    note: "",
    fromInvestment,
    createdAt: date,
  };
}

/** Turn the current split plan into a confirmed split record (what the API does). */
function confirmSplit(d: AppData, date: string): SplitRec {
  const plan = planSplit(d);
  const sid = id("s");
  return {
    id: sid,
    date,
    note: "",
    partnerACents: plan.partnerACents,
    partnerBCents: plan.partnerBCents,
    businessCents: plan.businessCents,
    createdAt: date,
    items: plan.items.map((it, i) => ({
      id: `${sid}-i${i}`,
      splitId: sid,
      orderId: it.orderId,
      partnerACents: it.partnerACents,
      partnerBCents: it.partnerBCents,
      businessCents: it.businessCents,
    })),
  };
}

// ---------------------------------------------------------------- tests

describe("payback mode", () => {
  it("pays back the -$1,300 starting balance with 100% of revenue", () => {
    const o = order(day(2), [{ price: 5000, cost: 2000 }]);
    const l = computeLedger(data({ orders: [o] }));
    const r = l.orders.get(o.id)!;
    expect(r.a).toBe(0);
    expect(r.b).toBe(0);
    expect(r.business).toBe(5000);
    expect(l.businessCents).toBe(-125000);
    expect(l.inPayback).toBe(true);
    expect(l.leftToBreakEven).toBe(125000);
    expect(l.pendingA + l.pendingB).toBe(0);
  });

  it("splits a sale that crosses zero: the part to reach $0 goes to the business", () => {
    // Balance -$30. Sale $50 (cost $20, profit $30). $30 pays back, $20 remainder (40%) follows normal rule.
    const o = order(day(2), [{ price: 5000, cost: 2000 }]);
    const l = computeLedger(data({ settings: settings({ startingBalanceCents: -3000 }), orders: [o] }));
    const r = l.orders.get(o.id)!;
    // Normal splittable would be 90% of $30 = $27. 40% of that = $10.80 → $5.40 each.
    expect(r.lines[0].payback).toBe(3000);
    expect(r.a).toBe(540);
    expect(r.b).toBe(540);
    expect(r.business).toBe(5000 - 1080);
    expect(l.businessCents).toBe(2000);
    expect(l.inPayback).toBe(false);
    expect(l.pendingA).toBe(540);
  });
});

describe("normal mode", () => {
  it("keeps cost + 10% cut of profit, splits the rest 50/50", () => {
    const o = order(day(2), [{ price: 5000, cost: 2000 }]);
    const l = computeLedger(data({ settings: settings({ startingBalanceCents: 0 }), orders: [o] }));
    const r = l.orders.get(o.id)!;
    expect(r.profit).toBe(3000);
    expect(r.a).toBe(1350);
    expect(r.b).toBe(1350);
    expect(r.business).toBe(2300); // $20 cost + $3 cut
    expect(l.businessCents).toBe(5000);
    expect(l.pendingA).toBe(1350);
    expect(l.pendingB).toBe(1350);
  });

  it("changing the cut percent only affects later sales (snapshot per line)", () => {
    const o1 = order(day(2), [{ price: 5000, cost: 2000, cut: 10 }]);
    const o2 = order(day(3), [{ price: 5000, cost: 2000, cut: 20 }]);
    // Settings now say 20%, but o1 keeps its 10% snapshot.
    const l = computeLedger(
      data({ settings: settings({ startingBalanceCents: 0, businessCutPercent: 20 }), orders: [o1, o2] }),
    );
    expect(l.orders.get(o1.id)!.a).toBe(1350);
    expect(l.orders.get(o2.id)!.a).toBe(1200);
    expect(l.orders.get(o2.id)!.business).toBe(2600);
  });

  it("uses a custom partner ratio", () => {
    const o = order(day(2), [{ price: 5000, cost: 2000 }]);
    const l = computeLedger(
      data({ settings: settings({ startingBalanceCents: 0, partnerARatio: 60 }), orders: [o] }),
    );
    const r = l.orders.get(o.id)!;
    expect(r.a).toBe(1620);
    expect(r.b).toBe(1080);
    expect(r.business).toBe(2300);
  });

  it("gives rounding cents to the business", () => {
    // profit 333: 90% = 299.7 → 299 splittable; 299 / 2 = 149.5 → 149 each. Business keeps the rest.
    const o = order(day(2), [{ price: 333, cost: 0 }]);
    const l = computeLedger(data({ settings: settings({ startingBalanceCents: 0 }), orders: [o] }));
    const r = l.orders.get(o.id)!;
    expect(r.a).toBe(149);
    expect(r.b).toBe(149);
    expect(r.business).toBe(35);
    expect(r.a + r.b + r.business).toBe(333);
  });
});

describe("restocks", () => {
  it("a restock can push business money negative again and payback kicks back in", () => {
    const s1 = order(day(2), [{ price: 5000, cost: 2000 }]);
    const p = purchase(day(3), 10, 10000);
    const s2 = order(day(4), [{ price: 5000, cost: 2000 }]);
    const s3 = order(day(5), [{ price: 5000, cost: 2000 }]);
    const l = computeLedger(
      data({ settings: settings({ startingBalanceCents: 0 }), orders: [s1, s2, s3], purchases: [p] }),
    );
    expect(l.orders.get(s1.id)!.a).toBe(1350); // normal
    expect(l.orders.get(s2.id)!.a).toBe(0); // payback: balance was -$50
    expect(l.orders.get(s2.id)!.business).toBe(5000);
    expect(l.orders.get(s3.id)!.a).toBe(1350); // back to normal
    expect(l.businessCents).toBe(5000);
  });

  it("a purchase paid from starting investment adds stock and cost but not business money", () => {
    const inv = purchase(day(2), 10, 50000, true);
    const normal = purchase(day(3), 10, 30000, false);
    const l = computeLedger(data({ purchases: [inv, normal] }));
    expect(l.businessCents).toBe(-130000 - 30000);
    const st = l.stock.get("p1")!;
    expect(st.stock).toBe(20);
    expect(st.avgCost).toBe(4000); // (500 + 300) / 20
    expect(st.unitCost).toBe(4000);
  });

  it("only the investment purchase leaves the balance untouched", () => {
    const l = computeLedger(data({ purchases: [purchase(day(2), 5, 25000, true)] }));
    expect(l.businessCents).toBe(-130000);
    expect(l.stock.get("p1")!.stock).toBe(5);
  });

  it("stock goes down with sales and up/down with adjustments; override wins over average", () => {
    const d = data({
      purchases: [purchase(day(2), 10, 20000, true)],
      orders: [order(day(3), [{ price: 5000, cost: 2000, qty: 3 }])],
      adjustments: [
        { id: "ad1", date: day(4), productId: "p1", quantity: -1, reason: "breakage", note: "", createdAt: day(4) },
      ],
    });
    d.products[0].costOverrideCents = 1800;
    const st = computeLedger(d).stock.get("p1")!;
    expect(st.stock).toBe(6);
    expect(st.avgCost).toBe(2000);
    expect(st.unitCost).toBe(1800);
  });
});

describe("discounts", () => {
  it("spreads a -$20 discount across a 3-item order proportionally", () => {
    const t = orderTotals({
      discountType: "$",
      discountValue: 2000,
      tipCents: 0,
      lines: [
        { quantity: 1, unitPriceCents: 6000 },
        { quantity: 1, unitPriceCents: 4000 },
        { quantity: 1, unitPriceCents: 10000 },
      ],
    });
    expect(t.subtotal).toBe(20000);
    expect(t.discount).toBe(2000);
    expect(t.lineRevenue).toEqual([5400, 3600, 9000]);
    expect(t.total).toBe(18000);
  });

  it("puts the leftover rounding cent on the largest line", () => {
    expect(allocateDiscount([1000, 1000, 1001], 100)).toEqual([33, 33, 34]);
    const a = allocateDiscount([1000, 1000, 1000], 100);
    expect(a.reduce((x, y) => x + y, 0)).toBe(100);
  });

  it("supports a % discount", () => {
    const t = orderTotals({
      discountType: "%",
      discountValue: 10,
      tipCents: 500,
      lines: [
        { quantity: 2, unitPriceCents: 3000 },
        { quantity: 1, unitPriceCents: 4000 },
      ],
    });
    expect(t.subtotal).toBe(10000);
    expect(t.discount).toBe(1000);
    expect(t.lineRevenue).toEqual([5400, 3600]);
    expect(t.total).toBe(9500);
  });

  it("caps a discount larger than the subtotal", () => {
    expect(discountAmount("$", 9999, 5000)).toBe(5000);
    expect(discountAmount("%", 150, 5000)).toBe(5000);
    const t = orderTotals({ discountType: "$", discountValue: 10000, tipCents: 0, lines: [{ quantity: 1, unitPriceCents: 5000 }] });
    expect(t.discount).toBe(5000);
    expect(t.total).toBe(0);
    expect(t.lineRevenue).toEqual([0]);
  });

  it("a discount sale below cost: everything goes to the business, nothing splittable", () => {
    const o = order(day(2), [{ price: 5000, cost: 4000 }], { discountValue: 2000 });
    const l = computeLedger(data({ settings: settings({ startingBalanceCents: 0 }), orders: [o] }));
    const r = l.orders.get(o.id)!;
    expect(r.revenue).toBe(3000);
    expect(r.profit).toBe(-1000);
    expect(r.a).toBe(0);
    expect(r.b).toBe(0);
    expect(r.business).toBe(3000);
  });

  it("the money logic uses each line's revenue after discount", () => {
    const o = order(
      day(2),
      [
        { price: 6000, cost: 1000 },
        { price: 4000, cost: 1000 },
        { price: 10000, cost: 1000 },
      ],
      { discountValue: 2000 },
    );
    const r = computeLedger(data({ settings: settings({ startingBalanceCents: 0 }), orders: [o] })).orders.get(o.id)!;
    // profits 4400, 2600, 8000 → splittable 3960, 2340, 7200 → halves
    expect(r.lines.map((x) => x.a)).toEqual([1980, 1170, 3600]);
    expect(r.a).toBe(6750);
  });
});

describe("tips", () => {
  const base = (tipHandling: SettingsRec["tipHandling"], soldBy: "A" | "B" = "B") => {
    const o = order(day(2), [{ price: 5000, cost: 2000 }], { tipCents: 1000, soldBy });
    const l = computeLedger(data({ settings: settings({ startingBalanceCents: 0, tipHandling }), orders: [o] }));
    return l.orders.get(o.id)!;
  };

  it("treat as profit: business cut applies, rest splits by ratio", () => {
    const r = base("profit");
    expect(r.tipA).toBe(450);
    expect(r.tipB).toBe(450);
    expect(r.tipBusiness).toBe(100);
    expect(r.a).toBe(1350 + 450);
    expect(r.total).toBe(6000);
  });

  it("goes to the seller", () => {
    const r = base("seller", "B");
    expect(r.tipA).toBe(0);
    expect(r.tipB).toBe(1000);
    expect(r.b).toBe(1350 + 1000);
    const r2 = base("seller", "A");
    expect(r2.tipA).toBe(1000);
  });

  it("all to business", () => {
    const r = base("business");
    expect(r.tipA + r.tipB).toBe(0);
    expect(r.tipBusiness).toBe(1000);
    expect(r.business).toBe(2300 + 1000);
  });

  it("a tip during payback mode goes to the business", () => {
    const o = order(day(2), [{ price: 5000, cost: 2000 }], { tipCents: 2000 });
    const l = computeLedger(data({ settings: settings({ tipHandling: "seller" }), orders: [o] }));
    const r = l.orders.get(o.id)!;
    expect(r.tipBusiness).toBe(2000);
    expect(r.a + r.b).toBe(0);
    expect(l.businessCents).toBe(-130000 + 7000);
  });

  it("a tip that crosses zero only splits the remainder", () => {
    // Balance -$5. Line $2 (all payback) → -$3. Tip $10: $3 payback, $7 normal → 90% = $6.30 → $3.15 each.
    const o = order(day(2), [{ price: 200, cost: 0 }], { tipCents: 1000 });
    const l = computeLedger(data({ settings: settings({ startingBalanceCents: -500 }), orders: [o] }));
    const r = l.orders.get(o.id)!;
    expect(r.a).toBe(315);
    expect(r.b).toBe(315);
    expect(l.businessCents).toBe(700);
  });
});

describe("splits", () => {
  it("confirming a split moves pending to partners and out of business money", () => {
    const o = order(day(2), [{ price: 5000, cost: 2000 }]);
    let d = data({ settings: settings({ startingBalanceCents: 0 }), orders: [o] });
    const sp = confirmSplit(d, day(3));
    expect(sp.partnerACents).toBe(1350);
    expect(sp.businessCents).toBe(2300);
    d = { ...d, splits: [sp] };
    const l = computeLedger(d);
    expect(l.pendingA).toBe(0);
    expect(l.pendingB).toBe(0);
    expect(l.earnedA).toBe(1350);
    expect(l.businessCents).toBe(5000 - 2700);
    expect(planSplit(d).items).toHaveLength(0);
  });

  it("editing an already-split order adds the difference as a pending adjustment", () => {
    const o = order(day(2), [{ price: 5000, cost: 2000 }]);
    let d = data({ settings: settings({ startingBalanceCents: 0 }), orders: [o] });
    d = { ...d, splits: [confirmSplit(d, day(3))] };

    // Price raised from $50 to $60 → profit +$10 → splittable +$9 → +$4.50 each
    const edited = order(day(2), [{ price: 6000, cost: 2000 }], { id: o.id });
    d = { ...d, orders: [edited] };
    let l = computeLedger(d);
    expect(l.pendingA).toBe(450);
    let plan = planSplit(d, l);
    expect(plan.adjustedOrderIds).toEqual([o.id]);
    expect(plan.items[0].adjustment).toBe(true);
    expect(plan.partnerACents).toBe(450);

    // Lowered to $40 instead → negative adjustment
    const lowered = order(day(2), [{ price: 4000, cost: 2000 }], { id: o.id });
    d = { ...d, orders: [lowered] };
    l = computeLedger(d);
    plan = planSplit(d, l);
    expect(l.pendingA).toBe(-450);
    expect(plan.partnerACents).toBe(-450);

    // After the next split everything balances out
    d = { ...d, splits: [...d.splits, confirmSplit(d, day(4))] };
    l = computeLedger(d);
    expect(l.pendingA).toBe(0);
    expect(l.earnedA).toBe(900);
  });

  it("deleting an already-split order makes a negative adjustment", () => {
    const o = order(day(2), [{ price: 5000, cost: 2000 }]);
    let d = data({ settings: settings({ startingBalanceCents: 0 }), orders: [o] });
    const sp = confirmSplit(d, day(3));
    // Simulate DB "SET NULL" on the split item when the order is deleted
    sp.items = sp.items.map((i) => ({ ...i, orderId: null }));
    d = { ...d, orders: [], splits: [sp] };
    const l = computeLedger(d);
    expect(l.pendingA).toBe(-1350);
    const plan = planSplit(d, l);
    expect(plan.hasOrphanAdjustment).toBe(true);
    expect(plan.partnerACents).toBe(-1350);
  });

  it("manual payouts reduce business money; split payouts do not count twice", () => {
    const o = order(day(2), [{ price: 5000, cost: 2000 }]);
    let d = data({ settings: settings({ startingBalanceCents: 0 }), orders: [o] });
    const sp = confirmSplit(d, day(3));
    d = {
      ...d,
      splits: [sp],
      payouts: [
        { id: "py1", date: day(3), person: "A", amountCents: 1350, note: "", splitId: sp.id, createdAt: day(3) },
        { id: "py2", date: day(3), person: "B", amountCents: 1350, note: "", splitId: sp.id, createdAt: day(3) },
        { id: "py3", date: day(4), person: "B", amountCents: 500, note: "advance", splitId: null, createdAt: day(4) },
      ],
    };
    const l = computeLedger(d);
    expect(l.businessCents).toBe(5000 - 2700 - 500);
    expect(l.paidA).toBe(1350);
    expect(l.paidB).toBe(1850);
  });

  it("editing an old record re-flows every later number", () => {
    // Two sales in payback; making the first one bigger pulls the second one into normal mode.
    const o1 = order(day(2), [{ price: 5000, cost: 2000 }]);
    const o2 = order(day(3), [{ price: 5000, cost: 2000 }]);
    const s = settings({ startingBalanceCents: -10000 });
    let l = computeLedger(data({ settings: s, orders: [o1, o2] }));
    expect(l.orders.get(o2.id)!.a).toBe(0);
    const big = order(day(2), [{ price: 10000, cost: 2000 }], { id: o1.id });
    l = computeLedger(data({ settings: s, orders: [big, o2] }));
    expect(l.orders.get(big.id)!.a).toBe(0);
    expect(l.orders.get(o2.id)!.a).toBe(1350);
  });
});
