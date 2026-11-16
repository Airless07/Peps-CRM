// Tests for customers and payment methods. None of this may change money.
import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { normalizeBackup } from "./backup";
import { deleteCustomerData, groupCustomersFromOrders, mergeCustomersData, mergedFields, searchCustomers } from "./customers";
import { resolveDraftCustomer, type Draft } from "./draft";
import { customerStats, daysAgo, paymentBreakdown } from "./insights";
import { computeLedger, planSplit } from "./money";
import type { AppData, CustomerRec, OrderLineRec, OrderRec, SettingsRec } from "./types";
import { ORDER_DEFAULTS, PRODUCT_DEFAULTS, emptyStoreData } from "./types";

// ---------------------------------------------------------------- builders
const day = (n: number, h = 12) => new Date(Date.UTC(2026, 0, n, h)).toISOString();
let seq = 0;

function settings(over: Partial<SettingsRec> = {}): SettingsRec {
  return {
    startingBalanceCents: -1000,
    startDate: day(1, 0),
    businessCutPercent: 10,
    partnerAName: "Ahmad",
    partnerBName: "Mo",
    partnerARatio: 50,
    tipHandling: "profit",
    defaultSoldBy: "A",
    lowStockThreshold: 3,
    paymentMethods: ["Cash", "Zelle", "Cash App", "Venmo", "Apple Pay", "Other"],
    ...over,
  };
}

type L = { price: number; cost: number; qty?: number; productId?: string; name?: string };
function order(date: string, lines: L[], over: Partial<OrderRec> = {}): OrderRec {
  const oid = over.id ?? `o${++seq}`;
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
    ...ORDER_DEFAULTS,
    ...over,
    lines: lines.map(
      (l, i): OrderLineRec => ({
        id: `${oid}-l${i}`,
        orderId: oid,
        productId: l.productId ?? "p1",
        productName: l.name ?? "Vial A",
        quantity: l.qty ?? 1,
        unitPriceCents: l.price,
        unitCostCents: l.cost,
        cutPercent: 10,
        sortOrder: i,
      }),
    ),
  };
}

function data(over: Partial<AppData> = {}): AppData {
  return {
    settings: settings(),
    products: [
      { id: "p1", name: "Vial A", defaultPriceCents: 5000, costOverrideCents: null, lowStockThreshold: null, color: "blue", sortOrder: 0, archived: false, createdAt: day(1, 0), ...PRODUCT_DEFAULTS },
      { id: "p2", name: "Vial B", defaultPriceCents: 3000, costOverrideCents: null, lowStockThreshold: null, color: "red", sortOrder: 1, archived: false, createdAt: day(1, 0), ...PRODUCT_DEFAULTS },
    ],
    customers: [],
    purchases: [
      { id: "pu1", date: day(1, 1), productId: "p1", quantity: 20, totalCostCents: 20000, note: "", fromInvestment: false, createdAt: day(1, 1) },
      { id: "pu2", date: day(1, 1), productId: "p2", quantity: 20, totalCostCents: 10000, note: "", fromInvestment: true, createdAt: day(1, 1) },
    ],
    adjustments: [],
    orders: [],
    splits: [],
    payouts: [],
    ...emptyStoreData(),
    ...over,
  };
}

/** Everything money-related a ledger produces, as plain JSON for comparison. */
function moneySnapshot(d: AppData) {
  const l = computeLedger(d);
  const plan = planSplit(d, l);
  return JSON.stringify({
    ...l,
    orders: [...l.orders.entries()].sort(),
    stock: [...l.stock.entries()].sort(),
    plan,
  });
}

// A realistic mix of orders: discounts ($ and %), tips, both sellers
function sampleOrders(): OrderRec[] {
  return [
    order(day(2), [{ price: 5000, cost: 1000, qty: 2 }], { id: "a1", customer: "mike", tipCents: 500 }),
    order(day(3), [{ price: 3000, cost: 500, productId: "p2", name: "Vial B" }], { id: "a2", customer: "Mike ", discountType: "%", discountValue: 10, soldBy: "B" }),
    order(day(4), [{ price: 5000, cost: 1000 }, { price: 3000, cost: 500, productId: "p2", name: "Vial B", qty: 3 }], { id: "a3", customer: "Sara", discountValue: 700 }),
    order(day(5), [{ price: 5000, cost: 1000 }], { id: "a4", customer: "" }),
    order(day(6), [{ price: 4500, cost: 1000, qty: 2 }], { id: "a5", customer: "  ", tipCents: 1000, soldBy: "B" }),
  ];
}

// ---------------------------------------------------------------- customer grouping
describe("customer grouping from order names", () => {
  it("trims and matches case-insensitively; blank names get no customer", () => {
    const orders = sampleOrders();
    let n = 0;
    const g = groupCustomersFromOrders(orders, () => `c${++n}`);
    expect(g.customers.map((c) => c.name).sort()).toEqual(["Mike", "Sara"]);
    const mike = g.customers.find((c) => c.name === "Mike")!;
    expect(g.links.get("a1")).toBe(mike.id);
    expect(g.links.get("a2")).toBe(mike.id);
    expect(g.links.has("a4")).toBe(false);
    expect(g.links.has("a5")).toBe(false);
    // createdAt = first order's date
    expect(mike.createdAt).toBe(day(2));
  });

  it("uses the spelling from the most recent order", () => {
    const orders = [
      order(day(5), [{ price: 100, cost: 0 }], { customer: "MIKE" }),
      order(day(2), [{ price: 100, cost: 0 }], { customer: "mike" }),
    ];
    expect(groupCustomersFromOrders(orders).customers.map((c) => c.name)).toEqual(["MIKE"]);
  });
});

// ---------------------------------------------------------------- the real SQL migration
describe("database migration (SQL)", () => {
  const dir = path.resolve(import.meta.dirname, "../../prisma/migrations");
  const sql = (name: string) => readFileSync(path.join(dir, name, "migration.sql"), "utf8");

  function migrated() {
    const db = new DatabaseSync(":memory:");
    db.exec(sql("20261113120000_init"));
    db.exec(`INSERT INTO "Settings" ("id","startingBalanceCents","startDate","businessCutPercent","partnerAName","partnerBName","partnerARatio","tipHandling","defaultSoldBy","lowStockThreshold","updatedAt") VALUES (1,-1000,0,10,'A','B',50,'profit','A',3,0)`);
    db.exec(`INSERT INTO "Product" ("id","name") VALUES ('p1','Vial A')`);
    const ins = db.prepare(`INSERT INTO "Order" ("id","date","customer","createdAt") VALUES (?,?,?,?)`);
    const rows: [string, number, string][] = [
      ["o1", 1000, "mike"],
      ["o2", 3000, "Mike "],
      ["o3", 2000, " MIKE"],
      ["o4", 1500, "Sara"],
      ["o5", 1600, ""],
      ["o6", 1700, "   "],
    ];
    for (const [id, date, name] of rows) ins.run(id, date, name, date);
    db.exec(`INSERT INTO "OrderLine" ("id","orderId","productId","productName","quantity","unitPriceCents","unitCostCents","cutPercent") VALUES ('l1','o1','p1','Vial A',2,5000,1000,10)`);
    db.exec(sql("20261113150000_customers_payment_methods"));
    return db;
  }

  it("creates one customer per name and links the orders", () => {
    const db = migrated();
    const customers = db.prepare(`SELECT "id","name","createdAt" FROM "Customer" ORDER BY "name"`).all() as { id: string; name: string; createdAt: number }[];
    expect(customers.map((c) => c.name)).toEqual(["Mike", "Sara"]); // latest spelling (o2, date 3000), trimmed
    expect(customers[0].createdAt).toBe(1000); // first order date
    const orders = db.prepare(`SELECT "id","customer","customerId","paymentMethod" FROM "Order" ORDER BY "id"`).all() as Record<string, string | null>[];
    const mike = customers[0].id;
    expect(orders.map((o) => o.customerId)).toEqual([mike, mike, mike, customers[1].id, null, null]);
    expect(orders.slice(0, 3).every((o) => o.customer === "Mike")).toBe(true);
    expect(orders.every((o) => o.paymentMethod === "Unknown")).toBe(true);
  });

  it("keeps every existing row", () => {
    const db = migrated();
    const count = (t: string) => (db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n;
    expect(count("Order")).toBe(6);
    expect(count("OrderLine")).toBe(1);
    expect(count("Product")).toBe(1);
    const s = db.prepare(`SELECT "paymentMethods","startingBalanceCents" FROM "Settings"`).get() as { paymentMethods: string; startingBalanceCents: number };
    expect(JSON.parse(s.paymentMethods)).toEqual(["Cash", "Zelle", "Cash App", "Venmo", "Apple Pay", "Other"]);
    expect(s.startingBalanceCents).toBe(-1000);
  });
});

// ---------------------------------------------------------------- payment breakdown
describe("payment method breakdown", () => {
  it("sums totals after discounts including tips, with order counts, in Settings order", () => {
    const orders = [
      order(day(2), [{ price: 5000, cost: 0, qty: 2 }], { paymentMethod: "Zelle", tipCents: 500 }), // 10000 + 500
      order(day(3), [{ price: 3000, cost: 0 }], { paymentMethod: "Cash", discountType: "%", discountValue: 10 }), // 2700
      order(day(4), [{ price: 5000, cost: 0 }], { paymentMethod: "Cash", discountValue: 700, tipCents: 200 }), // 4500
      order(day(5), [{ price: 1000, cost: 0 }], { paymentMethod: "Unknown" }), // 1000
      order(day(6), [{ price: 2000, cost: 0 }], { paymentMethod: "Bitcoin" }), // removed method, kept
    ];
    const rows = paymentBreakdown(orders, ["Cash", "Zelle", "Venmo"]);
    expect(rows).toEqual([
      { method: "Cash", total: 7200, orders: 2 },
      { method: "Zelle", total: 10500, orders: 1 },
      { method: "Bitcoin", total: 2000, orders: 1 },
      { method: "Unknown", total: 1000, orders: 1 },
    ]);
    // Grand total equals the ledger's order totals
    const d = data({ orders });
    const l = computeLedger(d);
    const ledgerTotal = [...l.orders.values()].reduce((s, r) => s + r.total, 0);
    expect(rows.reduce((s, r) => s + r.total, 0)).toBe(ledgerTotal);
  });

  it("is empty for no orders", () => {
    expect(paymentBreakdown([], ["Cash"])).toEqual([]);
  });
});

// ---------------------------------------------------------------- merge / delete
describe("merge and delete customers", () => {
  const customers: CustomerRec[] = [
    { id: "c1", name: "Mike", phone: "", email: "", hasAccount: false, addresses: [], notes: "likes blue", createdAt: day(1) },
    { id: "c2", name: "Mikey", phone: "555-1234", email: "", hasAccount: false, addresses: [], notes: "pays Zelle", createdAt: day(2) },
    { id: "c3", name: "Sara", phone: "", email: "", hasAccount: false, addresses: [], notes: "", createdAt: day(3) },
  ];
  const orders = [
    order(day(2), [{ price: 5000, cost: 1000 }], { id: "m1", customerId: "c1", customer: "Mike" }),
    order(day(3), [{ price: 3000, cost: 500 }], { id: "m2", customerId: "c2", customer: "Mikey", tipCents: 300 }),
    order(day(4), [{ price: 2000, cost: 500 }], { id: "m3", customerId: "c3", customer: "Sara" }),
  ];

  it("moves all orders to the target and removes the duplicate", () => {
    const before = data({ customers, orders });
    const after = mergeCustomersData(before, "c2", "c1");
    expect(after.customers.map((c) => c.id)).toEqual(["c1", "c3"]);
    expect(after.orders.find((o) => o.id === "m2")).toMatchObject({ customerId: "c1", customer: "Mike" });
    expect(after.orders.find((o) => o.id === "m3")!.customerId).toBe("c3");
    // Phone filled from duplicate, notes combined
    expect(after.customers[0]).toMatchObject({ phone: "555-1234", notes: "likes blue\npays Zelle" });
    // Stats follow
    const st = customerStats(after.customers, after.orders, after.products).get("c1")!;
    expect(st.orders).toBe(2);
    expect(st.totalSpent).toBe(5000 + 3300);
    expect(st.avgOrder).toBe(4150);
    // Money unchanged
    expect(moneySnapshot(after)).toBe(moneySnapshot(before));
  });

  it("does nothing when merging into itself", () => {
    const d = data({ customers, orders });
    expect(mergeCustomersData(d, "c1", "c1")).toBe(d);
  });

  it("keeps the target's own phone", () => {
    expect(mergedFields({ phone: "111", notes: "" }, { phone: "222", notes: "" }).phone).toBe("111");
  });

  it("delete unlinks orders and never deletes them", () => {
    const before = data({ customers, orders });
    const after = deleteCustomerData(before, "c1");
    expect(after.orders).toHaveLength(3);
    expect(after.orders.find((o) => o.id === "m1")).toMatchObject({ customerId: null, customer: "Mike" });
    expect(moneySnapshot(after)).toBe(moneySnapshot(before));
  });

  it("search finds by name or phone digits", () => {
    expect(searchCustomers(customers, "mik").map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(searchCustomers(customers, "(555) 12").map((c) => c.id)).toEqual(["c2"]);
  });
});

// ---------------------------------------------------------------- customer stats
describe("customer stats", () => {
  it("favorite product, last order and days ago", () => {
    const customers: CustomerRec[] = [{ id: "c1", name: "Mike", phone: "", email: "", hasAccount: false, addresses: [], notes: "", createdAt: day(1) }];
    const orders = [
      order(day(2), [{ price: 100, cost: 0, qty: 1 }, { price: 100, cost: 0, qty: 3, productId: "p2", name: "Vial B" }], { customerId: "c1" }),
      order(day(9), [{ price: 100, cost: 0, qty: 1 }], { customerId: "c1", discountValue: 50 }),
    ];
    const d = data({ customers, orders });
    const st = customerStats(d.customers, d.orders, d.products).get("c1")!;
    expect(st.favoriteProduct).toEqual({ name: "Vial B", units: 3 });
    expect(st.lastOrder).toBe(day(9));
    expect(st.totalSpent).toBe(400 + 50);
    expect(daysAgo(day(9), new Date(day(12)))).toBe("3 days ago");
    // Calendar days in local time
    expect(daysAgo(new Date(2026, 0, 12, 0, 30).toISOString(), new Date(2026, 0, 12, 23, 30))).toBe("today");
    expect(daysAgo(new Date(2026, 0, 11, 23, 30).toISOString(), new Date(2026, 0, 12, 0, 30))).toBe("yesterday");
  });
});

// ---------------------------------------------------------------- cart customer linking
describe("cart customer linking", () => {
  const draft = (over: Partial<Draft>): Draft => ({
    id: "d1", date: day(2), customer: "", customerId: null, paymentMethod: "Cash", note: "", soldBy: "A",
    discountType: "$", discountValue: 0, tipCents: 0, lines: [], ...over,
  });
  const customers: CustomerRec[] = [{ id: "c1", name: "Mike", phone: "", email: "", hasAccount: false, addresses: [], notes: "", createdAt: day(1) }];

  it("reuses an existing customer typed in any case", () => {
    const r = resolveDraftCustomer(draft({ customer: " mike " }), customers);
    expect(r.created).toBeNull();
    expect(r.draft).toMatchObject({ customerId: "c1", customer: "Mike" });
  });
  it("creates a new customer for a new name", () => {
    const r = resolveDraftCustomer(draft({ customer: "Sara" }), customers, day(2));
    expect(r.created).toMatchObject({ name: "Sara" });
    expect(r.draft.customerId).toBe(r.created!.id);
  });
  it("leaves walk-ins without a customer", () => {
    expect(resolveDraftCustomer(draft({ customer: "  " }), customers)).toEqual({ draft: expect.objectContaining({ customerId: null, customer: "" }), created: null });
  });
});

// ---------------------------------------------------------------- old backup import
describe("old backup import", () => {
  // A version 1 backup: no customers, no payment methods, orders without customerId/paymentMethod
  function v1() {
    const d = data({ orders: sampleOrders() });
    const { paymentMethods: _p, ...oldSettings } = d.settings;
    return {
      settings: oldSettings,
      products: d.products,
      purchases: d.purchases,
      adjustments: d.adjustments,
      orders: d.orders.map(({ customerId: _c, paymentMethod: _m, ...o }) => o),
      splits: [],
      payouts: [],
    };
  }

  it("fills defaults and rebuilds customers from order names", () => {
    let n = 0;
    const out = normalizeBackup(v1() as never, () => `c${++n}`);
    expect(out.settings.paymentMethods).toEqual(["Cash", "Zelle", "Cash App", "Venmo", "Apple Pay", "Other"]);
    expect(out.orders.every((o) => o.paymentMethod === "Unknown")).toBe(true);
    expect(out.customers.map((c) => c.name).sort()).toEqual(["Mike", "Sara"]);
    expect(out.orders.filter((o) => o.customerId).length).toBe(3);
    expect(out.orders.find((o) => o.id === "a4")!.customerId).toBeNull();
    expect(out.orders).toHaveLength(5);
  });

  it("produces exactly the same money as the original data", () => {
    const original = data({ orders: sampleOrders() });
    const imported = normalizeBackup(v1() as never);
    expect(moneySnapshot(imported)).toBe(moneySnapshot(original));
  });

  it("new backups round-trip and drop links to missing customers", () => {
    const d = data({
      customers: [{ id: "c1", name: "Mike", phone: "1", email: "", hasAccount: false, addresses: [], notes: "", createdAt: day(1) }],
      orders: [
        order(day(2), [{ price: 100, cost: 0 }], { id: "x1", customerId: "c1", customer: "Mike", paymentMethod: "Zelle" }),
        order(day(3), [{ price: 100, cost: 0 }], { id: "x2", customerId: "ghost", customer: "Ghost" }),
      ],
    });
    const out = normalizeBackup(JSON.parse(JSON.stringify(d)));
    expect(out.customers).toEqual(d.customers);
    expect(out.orders[0]).toMatchObject({ customerId: "c1", paymentMethod: "Zelle" });
    expect(out.orders[1]).toMatchObject({ customerId: null, customer: "Ghost" });
  });
});

// ---------------------------------------------------------------- money unchanged
describe("money totals are identical before and after these features", () => {
  it("customer links and payment methods never change business money, splits or pay", () => {
    // "Before": data as it was, every order Unknown and unlinked
    const before = data({ orders: sampleOrders().map((o) => ({ ...o, paymentMethod: "Unknown", customerId: null })) });
    // "After": same orders with customers linked and payment methods set
    const g = groupCustomersFromOrders(before.orders);
    const methods = ["Cash", "Zelle", "Venmo", "Apple Pay", "Other"];
    const after: AppData = {
      ...before,
      settings: { ...before.settings, paymentMethods: ["Venmo", "Cash"] },
      customers: g.customers,
      orders: before.orders.map((o, i) => ({ ...o, customerId: g.links.get(o.id) ?? null, paymentMethod: methods[i % methods.length] })),
    };
    expect(moneySnapshot(after)).toBe(moneySnapshot(before));
    const l = computeLedger(after);
    expect(l.businessCents).toBe(computeLedger(before).businessCents);
    expect([l.earnedA, l.earnedB, l.pendingA, l.pendingB]).toEqual((({ earnedA, earnedB, pendingA, pendingB }) => [earnedA, earnedB, pendingA, pendingB])(computeLedger(before)));
  });
});
