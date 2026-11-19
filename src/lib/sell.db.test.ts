// Database tests for saved (open) in-person orders and the Sell cart quick buttons.
// Fresh SQLite file with every migration applied. Emails go to a fake Resend.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Draft } from "./draft";

const dir = mkdtempSync(path.join(tmpdir(), "sell-saved-test-"));
const root = path.resolve(import.meta.dirname, "../..");
const dbPath = path.join(dir, "test.db");
process.env.DATABASE_URL = `file:${dbPath.split(path.sep).join("/")}`;
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.RESEND_API_KEY = "re_test_key";

let prisma: (typeof import("./db"))["prisma"];
let sell: typeof import("./sell-ops");
let saved: typeof import("./saved-orders");
let schemas: typeof import("./schemas");
let ser: typeof import("./serialize");
let money: typeof import("./money");
let restoreMod: typeof import("./restore");
let customers: typeof import("./customer-ops");
let draftLib: typeof import("./draft");

const sent: { to: string[]; subject: string }[] = [];
const realFetch = globalThis.fetch;
const ORIGIN = "http://localhost:3000";
const NOW = "2026-03-10T15:00:00.000Z";

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("./db"));
  sell = await import("./sell-ops");
  saved = await import("./saved-orders");
  schemas = await import("./schemas");
  ser = await import("./serialize");
  money = await import("./money");
  restoreMod = await import("./restore");
  customers = await import("./customer-ops");
  draftLib = await import("./draft");

  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith("https://api.resend.com/")) {
      const b = JSON.parse(String(init?.body));
      sent.push({ to: b.to, subject: b.subject });
      return new Response(JSON.stringify({ id: `email-${sent.length}` }), { status: 200 });
    }
    return realFetch(url as never, init);
  });

  await prisma.settings.create({ data: { id: 1, startingBalanceCents: -50000, startDate: new Date("2026-01-01T00:00:00Z"), lowStockThreshold: 3, storeJson: JSON.stringify({ alertEmails: ["owner@buckshot.test"] }) } });
  await prisma.listing.create({ data: { id: "l-reta", name: "Reta", slug: "reta" } });
  await prisma.product.createMany({
    data: [
      { id: "r10", name: "Reta 10mg", variantLabel: "10mg", defaultPriceCents: 7000, listingId: "l-reta" },
      { id: "kpv", name: "KPV", defaultPriceCents: 4000 },
    ],
  });
  const d = new Date("2026-01-05T12:00:00Z");
  await prisma.purchase.createMany({
    data: [
      { id: "pu-r10", date: d, productId: "r10", quantity: 6, totalCostCents: 12000 },
      { id: "pu-kpv", date: d, productId: "kpv", quantity: 10, totalCostCents: 10000 },
    ],
  });
  await prisma.customer.create({ data: { id: "cust", name: "Dana Reed" } });
  // An earlier completed sale, so "nothing changes" is checked against real money, not zeros.
  await prisma.order.create({
    data: { id: "old", date: new Date("2026-02-01T12:00:00Z"), number: 1001, soldBy: "A", paymentMethod: "Cash", tipCents: 300, lines: { create: [{ id: "old-1", productId: "kpv", productName: "KPV", quantity: 1, unitPriceCents: 4000, unitCostCents: 1000, cutPercent: 10 }] } },
  });
}, 120_000);

beforeEach(async () => {
  sent.length = 0;
  await prisma.order.deleteMany({ where: { id: { not: "old" } } });
  await prisma.savedOrder.deleteMany();
  // The customer a completed test sale created: each test starts without them.
  await prisma.customer.deleteMany({ where: { id: "c-sam" } });
  await prisma.product.update({ where: { id: "r10" }, data: { defaultPriceCents: 7000 } });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

/** Everything money and stock, as plain data that can be compared. */
async function snapshot() {
  const data = await ser.loadAll();
  const l = money.computeLedger(data);
  return {
    business: l.businessCents,
    pending: [l.pendingA, l.pendingB],
    earned: [l.earnedA, l.earnedB],
    paid: [l.paidA, l.paidB],
    inPayback: l.inPayback,
    leftToBreakEven: l.leftToBreakEven,
    stock: Object.fromEntries(l.stock),
    orders: Object.fromEntries(l.orders),
    history: l.history,
    orderCount: data.orders.length + data.pendingOrders.length,
  };
}

/** The snapshot without stock: everything money. Saved orders hold stock but never move money. */
const moneyOnly = ({ stock: _s, ...rest }: Awaited<ReturnType<typeof snapshot>>) => rest;
const stockNum = (snap: Awaited<ReturnType<typeof snapshot>>, id: string) => snap.stock[id].stock;

/** The cart: 2 Reta 10mg at the regular $70, 1 KPV at a custom $35, 10% off, $5 tip, a new customer, a note. */
const cart = (over: Partial<Draft> = {}): Draft => ({
  id: "sale-1",
  date: "2026-03-01T12:00:00.000Z",
  customer: "Sam Lee",
  customerId: "c-sam",
  paymentMethod: "Cash",
  note: "Pick up Friday",
  soldBy: "B",
  discountType: "%",
  discountValue: 10,
  tipCents: 500,
  lines: [
    { id: "sl-1", productId: "r10", productName: "Reta 10mg", quantity: 2, unitPriceCents: 7000, unitCostCents: 0, cutPercent: 0 },
    { id: "sl-2", productId: "kpv", productName: "KPV", quantity: 1, unitPriceCents: 3500, unitCostCents: 0, cutPercent: 0 },
  ],
  ...over,
});

/** What the Sell screen does on "Complete order": finalize with live cost and cut, then POST /api/orders. */
async function completeLikeTheSellScreen(draft: Draft, fromSavedId: string | null = null, now = NOW) {
  const data = await ser.loadAll();
  const ledger = money.computeLedger(data);
  const { final } = saved.finalizeSale(draft, { customers: data.customers, unitCost: (pid) => ledger.stock.get(pid)?.unitCost, cutPercent: data.settings.businessCutPercent, now });
  const { fromSavedId: fid, ...sale } = schemas.saleInput.parse({ ...draftLib.draftPayload(final), fromSavedId });
  await sell.recordSale(sale, ORIGIN, fid);
}

/** What "Save for later" does: build the saved order from the cart and POST /api/saved-orders. */
async function saveLikeTheSellScreen(draft: Draft) {
  const data = await ser.loadAll();
  const rec = saved.toSavedOrder(draft, data.products, data.savedOrders.find((o) => o.id === draft.id));
  await sell.saveOrderForLater(schemas.savedOrderInput.parse(rec));
}

const orderRow = async (id: string) => {
  const o = await prisma.order.findUnique({ where: { id }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!o) return null;
  const { createdAt: _c, ...rest } = o;
  return rest;
};

describe("migration 20261117120000_saved_orders_sell_buttons", () => {
  it("is additive only: one new table and one new column with a default", () => {
    const sql = readFileSync(path.join(root, "prisma/migrations/20261117120000_saved_orders_sell_buttons/migration.sql"), "utf8").replace(/^\s*--.*$/gm, "");
    expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|\bUPDATE\b|RENAME|PRAGMA|INSERT INTO/i);
    expect(sql.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(sql).toMatch(/ALTER TABLE "Settings" ADD COLUMN "sellButtonsJson" TEXT NOT NULL DEFAULT ''/);
  });
});

describe("saved orders", () => {
  it("saving holds its items out of stock, changes no money, and is not an order", async () => {
    const before = await snapshot();
    await saveLikeTheSellScreen(cart());
    const after = await snapshot();
    expect(moneyOnly(after)).toEqual(moneyOnly(before));
    expect(after.stock.r10).toMatchObject({ stock: stockNum(before, "r10") - 2, heldQty: 2, soldQty: before.stock.r10.soldQty, unitCost: before.stock.r10.unitCost });
    expect(after.stock.kpv).toMatchObject({ stock: stockNum(before, "kpv") - 1, heldQty: 1 });
    const data = await ser.loadAll();
    expect(data.savedOrders).toHaveLength(1);
    expect(data.savedOrders[0]).toMatchObject({ id: "sale-1", customer: "Sam Lee", customerId: "c-sam", soldBy: "B", note: "Pick up Friday", discountType: "%", discountValue: 10, tipCents: 500 });
    expect(data.savedOrders[0].lines.map((l) => [l.productId, l.quantity, l.unitPriceCents, l.listPriceCents])).toEqual([["r10", 2, 7000, 7000], ["kpv", 1, 3500, 4000]]);
    expect([...data.orders, ...data.pendingOrders].some((o) => o.id === "sale-1")).toBe(false);
    expect(await prisma.orderLine.count({ where: { id: { in: ["sl-1", "sl-2"] } } })).toBe(0);
    // The new customer is only created when the order is completed.
    expect(await prisma.customer.findUnique({ where: { id: "c-sam" } })).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it("saving an opened order again updates it instead of adding a second one", async () => {
    await saveLikeTheSellScreen(cart());
    const before = await snapshot();
    const opened = saved.savedToDraft((await ser.loadAll()).savedOrders[0], "Cash");
    await saveLikeTheSellScreen({ ...opened, note: "Now Saturday", lines: [{ ...opened.lines[0], quantity: 3 }, opened.lines[1]] });
    const list = (await ser.loadAll()).savedOrders;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ note: "Now Saturday" });
    expect(list[0].lines[0].quantity).toBe(3);
    const after = await snapshot();
    expect(moneyOnly(after)).toEqual(moneyOnly(before));
    // The hold follows the edit (3 now, not 2 + 3).
    expect(after.stock.r10).toMatchObject({ stock: stockNum(before, "r10") - 1, heldQty: 3 });
  });

  it("completing matches a normal sale exactly", async () => {
    const start = await snapshot();

    // A: the normal sale from the cart.
    await completeLikeTheSellScreen(cart());
    const normal = await snapshot();
    const normalRow = await orderRow("sale-1");
    expect(normal).not.toEqual(start);
    await prisma.order.delete({ where: { id: "sale-1" } });
    expect(await snapshot()).toEqual(start);

    // B: the same cart, saved for later, opened from the list and completed.
    await saveLikeTheSellScreen(cart());
    const held = await snapshot();
    expect(moneyOnly(held)).toEqual(moneyOnly(start));
    expect(stockNum(held, "r10")).toBe(stockNum(start, "r10") - 2);
    const s = (await ser.loadAll()).savedOrders[0];
    await completeLikeTheSellScreen(saved.savedToDraft(s, "Cash", NOW), s.id);
    const viaSaved = await snapshot();
    const savedRow = await orderRow("sale-1");

    // Completing turns the hold into the sale: the same stock as a normal sale, never subtracted twice.
    expect(viaSaved).toEqual(normal);
    expect(stockNum(viaSaved, "r10")).toBe(stockNum(held, "r10"));
    expect(savedRow).toEqual(normalRow);
    // And the numbers are the expected ones: $175.00 - 10% + $5.00 tip, stock down by 2 and 1.
    expect(viaSaved.orders["sale-1"]).toMatchObject({ subtotal: 17500, discount: 1750, tip: 500, total: 16250 });
    expect(viaSaved.stock.r10.stock).toBe(start.stock.r10.stock - 2);
    expect(viaSaved.stock.kpv.stock).toBe(start.stock.kpv.stock - 1);
    expect(viaSaved.business).not.toBe(start.business);
  });

  it("a completed saved order shows in Orders with the picked payment method and leaves the saved list", async () => {
    await saveLikeTheSellScreen(cart());
    const s = (await ser.loadAll()).savedOrders[0];
    await completeLikeTheSellScreen({ ...saved.savedToDraft(s, "Cash"), paymentMethod: "Zelle" }, s.id);
    const data = await ser.loadAll();
    expect(data.savedOrders).toHaveLength(0);
    const o = data.orders.find((x) => x.id === "sale-1")!;
    expect(o).toMatchObject({ source: "inperson", status: "completed", paymentMethod: "Zelle", customer: "Sam Lee", customerId: "c-sam", soldBy: "B", note: "Pick up Friday", number: 1002 });
    expect(o.date).toBe(NOW);
    expect(data.customers.some((c) => c.id === "c-sam" && c.name === "Sam Lee")).toBe(true);
    // Cost and business cut are the ones at the moment of completion, like any sale.
    expect(o.lines.map((l) => [l.unitCostCents, l.cutPercent])).toEqual([[2000, 10], [1000, 10]]);
  });

  it("one saved order can only become one sale", async () => {
    await saveLikeTheSellScreen(cart());
    const s = (await ser.loadAll()).savedOrders[0];
    await completeLikeTheSellScreen(saved.savedToDraft(s, "Cash"), s.id);
    const once = await snapshot();
    await expect(completeLikeTheSellScreen({ ...saved.savedToDraft(s, "Cash"), id: "sale-again", lines: s.lines.map((l) => ({ ...l, id: l.id + "-b" })) }, s.id)).rejects.toMatchObject({ status: 409 });
    expect(await snapshot()).toEqual(once);
    // Saving it again after it was completed is refused too.
    await expect(saveLikeTheSellScreen(cart())).rejects.toMatchObject({ status: 409 });
    expect((await ser.loadAll()).savedOrders).toHaveLength(0);
  });

  it("deleting a saved order puts its stock back and changes no money", async () => {
    const before = await snapshot();
    await saveLikeTheSellScreen(cart());
    await saveLikeTheSellScreen(cart({ id: "sale-2", lines: [{ id: "s2-1", productId: "kpv", productName: "KPV", quantity: 4, unitPriceCents: 4000, unitCostCents: 0, cutPercent: 0 }] }));
    await sell.deleteSavedOrder("sale-1");
    const data = await ser.loadAll();
    expect(data.savedOrders.map((o) => o.id)).toEqual(["sale-2"]);
    const one = await snapshot();
    expect(moneyOnly(one)).toEqual(moneyOnly(before));
    // sale-1's stock is back; sale-2 still holds its 4 KPV.
    expect(stockNum(one, "r10")).toBe(stockNum(before, "r10"));
    expect(stockNum(one, "kpv")).toBe(stockNum(before, "kpv") - 4);
    await sell.deleteSavedOrder("sale-2");
    await sell.deleteSavedOrder("sale-2"); // deleting twice is harmless
    expect((await ser.loadAll()).savedOrders).toHaveLength(0);
    expect(await snapshot()).toEqual(before);
    expect(await prisma.customer.findUnique({ where: { id: "c-sam" } })).toBeNull();
  });

  it("completing with too little stock warns first", async () => {
    // 6 Reta 10mg in stock. Someone else sells 5 while the order for 2 sits saved.
    await saveLikeTheSellScreen(cart());
    const s = (await ser.loadAll()).savedOrders[0];
    // Like the Sell screen: completing a saved order may use the units it holds itself.
    const stockOf = async (forSaved?: typeof s) => {
      const l = money.computeLedger(await ser.loadAll());
      return (pid: string) => (l.stock.get(pid)?.stock ?? 0) + saved.heldBy(forSaved, pid);
    };
    expect(saved.stockShortfalls(s.lines, await stockOf(s))).toEqual([]);
    const other = [{ id: "o-1", productId: "r10", productName: "Reta 10mg", quantity: 5, unitPriceCents: 7000, unitCostCents: 0, cutPercent: 0 }];
    // The saved order holds 2 of the 6, so selling 5 more now warns (only 4 left).
    expect(saved.stockShortfalls(other, await stockOf())).toEqual(["Reta 10mg"]);
    await completeLikeTheSellScreen(cart({ id: "other", customer: "", customerId: null, lines: other }));
    // Sold anyway: now the saved order would go below zero, and the warning lists the size.
    expect(saved.stockShortfalls(s.lines, await stockOf(s))).toEqual(["Reta 10mg"]);
    // After "Complete anyway" it completes like any oversold sale.
    await completeLikeTheSellScreen(saved.savedToDraft(s, "Cash"), s.id);
    expect((await snapshot()).stock.r10.stock).toBe(-1);
  });

  it("prices and discount stay as saved when the product price changes later", async () => {
    await saveLikeTheSellScreen(cart());
    await prisma.product.update({ where: { id: "r10" }, data: { defaultPriceCents: 9000 } });
    const data = await ser.loadAll();
    const s = data.savedOrders[0];
    expect(saved.savedTotals(s)).toMatchObject({ subtotal: 17500, discount: 1750, total: 16250 });
    expect(saved.priceChanges(s, data.products)).toEqual([{ lineId: "sl-1", productName: "Reta 10mg", wasCents: 7000, nowCents: 9000, savedCents: 7000 }]);
    await completeLikeTheSellScreen(saved.savedToDraft(s, "Cash"), s.id);
    const row = await orderRow("sale-1");
    expect(row!.lines.map((l) => l.unitPriceCents)).toEqual([7000, 3500]);
    expect((await snapshot()).orders["sale-1"]).toMatchObject({ subtotal: 17500, discount: 1750, total: 16250 });
  });

  it("holding stock in a saved order sends the low stock alert, once (completing it does not send it again)", async () => {
    await saveLikeTheSellScreen(cart({ lines: [{ id: "sl-1", productId: "r10", productName: "Reta 10mg", quantity: 4, unitPriceCents: 7000, unitCostCents: 0, cutPercent: 0 }] }));
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["owner@buckshot.test"]);
    const s = (await ser.loadAll()).savedOrders[0];
    await completeLikeTheSellScreen(saved.savedToDraft(s, "Cash"), s.id);
    expect(sent).toHaveLength(1);
  });

  it("renaming, merging or deleting a customer keeps saved orders consistent", async () => {
    await saveLikeTheSellScreen(cart({ customer: "Dana Reed", customerId: "cust" }));
    await customers.updateCustomer("cust", { name: "Dana R." });
    expect((await ser.loadAll()).savedOrders[0]).toMatchObject({ customer: "Dana R.", customerId: "cust" });
    await customers.deleteCustomer("cust");
    expect((await ser.loadAll()).savedOrders[0]).toMatchObject({ customer: "Dana R.", customerId: null });
    await prisma.customer.create({ data: { id: "cust", name: "Dana Reed" } });
  });

  it("saved orders and quick buttons survive a backup and restore, and money is unchanged", async () => {
    await saveLikeTheSellScreen(cart());
    const buttons = { discounts: [{ type: "%", value: 20 }, { type: "$", value: 1500 }], tips: [300, 700] };
    await prisma.settings.update({ where: { id: 1 }, data: { sellButtonsJson: JSON.stringify(buttons) } });
    const before = await snapshot();
    const savedBefore = (await ser.loadAll()).savedOrders;
    const backup = JSON.parse(JSON.stringify(await ser.loadBackup()));
    await restoreMod.restore(backup);
    const data = await ser.loadAll();
    expect(data.savedOrders).toEqual(savedBefore);
    expect(data.settings.sellButtons).toEqual(buttons);
    expect(await snapshot()).toEqual(before);
    // A backup made before this feature has neither: nothing breaks, defaults apply.
    const { savedOrders: _s, ...oldData } = backup;
    delete oldData.settings.sellButtons;
    await restoreMod.restore(oldData);
    const old = await ser.loadAll();
    expect(old.savedOrders).toEqual([]);
    expect(old.settings.sellButtons.discounts).toHaveLength(4);
    // No saved orders in that backup, so nothing is held: same money, the held units are back in stock.
    const restored = await snapshot();
    expect(moneyOnly(restored)).toEqual(moneyOnly(before));
    expect(stockNum(restored, "r10")).toBe(stockNum(before, "r10") + 2);
    await prisma.settings.update({ where: { id: 1 }, data: { sellButtonsJson: "" } });
  });
});

describe("Sell cart quick buttons in the database", () => {
  it("an empty column means the defaults; saved buttons come back in the saved order", async () => {
    expect((await ser.loadAll()).settings.sellButtons).toEqual({ discounts: [{ type: "$", value: 500 }, { type: "$", value: 1000 }, { type: "$", value: 2000 }, { type: "%", value: 10 }], tips: [500, 1000, 2000] });
    const mine = { discounts: [{ type: "%", value: 5 }, { type: "$", value: 1000 }, { type: "%", value: 20 }], tips: [2000, 500] };
    await prisma.settings.update({ where: { id: 1 }, data: { sellButtonsJson: JSON.stringify(mine) } });
    expect((await ser.loadAll()).settings.sellButtons).toEqual(mine);
    await prisma.settings.update({ where: { id: 1 }, data: { sellButtonsJson: "" } });
  });

  it("changing the buttons never changes past orders or money", async () => {
    // A sale made with the "-10%" button and the "$5" tip button.
    await completeLikeTheSellScreen(cart());
    const before = await snapshot();
    const row = await orderRow("sale-1");
    await prisma.settings.update({ where: { id: 1 }, data: { sellButtonsJson: JSON.stringify({ discounts: [{ type: "%", value: 50 }], tips: [9900] }) } });
    expect(await snapshot()).toEqual(before);
    expect(await orderRow("sale-1")).toEqual(row);
    expect(row).toMatchObject({ discountType: "%", discountValue: 10, tipCents: 500 });
    await prisma.settings.update({ where: { id: 1 }, data: { sellButtonsJson: "" } });
  });
});

describe("owner price, BOGO and cash in the database", () => {
  it("an owner purchase is saved at cost with no discount or tip, even if the screen sent other numbers", async () => {
    const before = await snapshot();
    // The screen (or an old tab) sends a price, a discount and a tip: the server keeps cost only.
    const { fromSavedId: _f, ...sale } = schemas.saleInput.parse({
      ...draftLib.draftPayload(cart({ id: "own-1", owner: "A", customer: "", customerId: null })),
      lines: [{ id: "ol-1", productId: "r10", productName: "Reta 10mg", quantity: 2, unitPriceCents: 7000, unitCostCents: 2000, cutPercent: 10 }],
    });
    await sell.recordSale(sale, ORIGIN);
    const row = await orderRow("own-1");
    expect(row).toMatchObject({ owner: "A", discountValue: 0, tipCents: 0, cashTo: "B" });
    expect(row!.lines[0]).toMatchObject({ unitPriceCents: 2000, unitCostCents: 2000, fullPriceCents: null });
    const after = await snapshot();
    expect(after.orders["own-1"]).toMatchObject({ revenue: 4000, cost: 4000, profit: 0, a: 0, b: 0 });
    expect(after.business - before.business).toBe(4000);
    expect(after.pending).toEqual(before.pending);
    expect(stockNum(after, "r10")).toBe(stockNum(before, "r10") - 2);
  });

  it("a BOGO line is saved with its deal, counts one use, and keeps cost and stock", async () => {
    await prisma.promotion.create({ data: { id: "deal-reta", kind: "bogo", name: "Buy 1 Reta, get 1 free", discountType: "%", discountValue: 100, bogoJson: JSON.stringify({ buy: { listingIds: ["l-reta"], variantIds: [], qty: 1 }, get: { same: true, listingIds: [], variantIds: [], qty: 1, percentOff: 100 }, online: true, inPerson: true, noCodes: false }) } });
    const data = await ser.loadAll();
    const bogoLib = await import("./bogo");
    const withDeal = bogoLib.applySellDeals(cart({ id: "bogo-1", discountValue: 0, tipCents: 0 }), { promotions: data.promotions, products: data.products });
    expect(withDeal.lines.filter((l) => l.dealId)).toHaveLength(1);
    const before = await snapshot();
    await completeLikeTheSellScreen(withDeal);
    const row = await orderRow("bogo-1");
    expect(row!.lines.map((l) => [l.quantity, l.unitPriceCents, l.dealId, l.fullPriceCents])).toEqual([
      [1, 7000, "", null],
      [1, 0, "deal-reta", 7000],
      [1, 3500, "", null],
    ]);
    expect(await prisma.promotionUse.count({ where: { promotionId: "deal-reta", orderId: "bogo-1" } })).toBe(1);
    const after = await snapshot();
    expect(after.orders["bogo-1"]).toMatchObject({ revenue: 10500, units: 3 });
    // The free Reta still costs its $20: 2 Reta + 1 KPV at cost.
    expect(after.orders["bogo-1"]).toMatchObject({ cost: 2 * before.stock["r10"].unitCost + before.stock["kpv"].unitCost, profit: 10500 - (2 * before.stock["r10"].unitCost + before.stock["kpv"].unitCost) });
    expect(stockNum(after, "r10")).toBe(stockNum(before, "r10") - 2);
    // Undo (delete) gives the use back.
    await prisma.$transaction([prisma.promotionUse.deleteMany({ where: { orderId: "bogo-1" } }), prisma.order.delete({ where: { id: "bogo-1" } })]);
    expect(await prisma.promotionUse.count({ where: { promotionId: "deal-reta" } })).toBe(0);
    await prisma.promotion.delete({ where: { id: "deal-reta" } });
  });

  it("cash hand-offs are saved, survive a backup and restore, and never change business money", async () => {
    await completeLikeTheSellScreen(cart({ id: "cash-1", soldBy: "A", cashTo: "B" }));
    const before = await snapshot();
    await prisma.cashHandoff.create({ data: { id: "h-1", date: new Date(NOW), fromHolder: "B", toHolder: "bank", amountCents: 5000, note: "Deposit" } });
    const data = await ser.loadAll();
    expect(data.orders.find((o) => o.id === "cash-1")?.cashTo).toBe("B");
    expect(data.cashHandoffs).toEqual([expect.objectContaining({ id: "h-1", from: "B", to: "bank", amountCents: 5000, note: "Deposit" })]);
    expect(await snapshot()).toEqual(before);
    const backup = JSON.parse(JSON.stringify(await ser.loadBackup()));
    await restoreMod.restore(backup);
    const back = await ser.loadAll();
    expect(back.cashHandoffs).toEqual(data.cashHandoffs);
    expect(back.orders.find((o) => o.id === "cash-1")).toMatchObject({ cashTo: "B", owner: null });
    expect(moneyOnly(await snapshot())).toEqual(moneyOnly(before));
    await prisma.cashHandoff.deleteMany();
  });
});
