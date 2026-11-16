// Tests that need a real database: a fresh SQLite file with every migration applied.
// Covers order numbering, placing an order, Mark paid, auto-cancel, labels, and combine / split variants.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Ledger } from "../money";
import type { AppData } from "../types";

const dir = mkdtempSync(path.join(tmpdir(), "peps-test-"));
const root = path.resolve(import.meta.dirname, "../../..");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
delete process.env.RESEND_API_KEY;
process.env.SHIPPO_API_KEY = "shippo_test_fake";

type Ops = typeof import("../order-ops");
type Cat = typeof import("../catalog-ops");
let prisma: (typeof import("../db"))["prisma"];
let ops: Ops;
let cat: Cat;
let loadAll: () => Promise<AppData>;
let computeLedger: (d: AppData) => Ledger;
let restore: (typeof import("../restore"))["restore"];

const money = (l: Ledger) => ({ business: l.businessCents, a: l.pendingA, b: l.pendingB });
const state = async () => {
  const data = await loadAll();
  return { data, ledger: computeLedger(data) };
};

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("../db"));
  ops = await import("../order-ops");
  cat = await import("../catalog-ops");
  ({ loadAll } = await import("../serialize"));
  ({ computeLedger } = await import("../money"));
  ({ restore } = await import("../restore"));

  const store = { open: true, payments: { zelle: { enabled: true, details: "pay@buckshot.test" } }, alertEmails: [], shipFrom: { name: "Buckshot", street1: "1 Main St", city: "Austin", state: "TX", zip: "78701", country: "US", phone: "5125550100", email: "ship@buckshot.test" } };
  await prisma.settings.create({ data: { id: 1, startingBalanceCents: 0, storeJson: JSON.stringify(store) } });
  await prisma.listing.createMany({
    data: [
      { id: "l-a", name: "BPC-157 5mg", slug: "bpc-157-5mg", showOnWebsite: true, summary: "kept" },
      { id: "l-b", name: "BPC-157 10mg", slug: "bpc-157-10mg", showOnWebsite: true },
    ],
  });
  await prisma.product.createMany({
    data: [
      { id: "a", name: "BPC-157 5mg", defaultPriceCents: 4000, listingId: "l-a", sortOrder: 0 },
      { id: "b", name: "BPC-157 10mg", defaultPriceCents: 7000, listingId: "l-b", sortOrder: 1 },
    ],
  });
  const d = new Date("2026-01-01T12:00:00Z");
  await prisma.purchase.createMany({
    data: [
      { id: "pu-a", date: d, productId: "a", quantity: 10, totalCostCents: 10000, fromInvestment: true },
      { id: "pu-b", date: d, productId: "b", quantity: 1, totalCostCents: 2500, fromInvestment: true },
    ],
  });
  await prisma.customer.create({ data: { id: "cust", name: "Dana Reed", email: "dana@example.com", passwordHash: "x" } });
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const shipTo = { name: "Dana Reed", street1: "500 Oak Ave", street2: "", city: "Denver", state: "CO", zip: "80202", country: "US" };
const checkout = (over: Partial<Parameters<Ops["placeOrder"]>[0]> = {}) =>
  ops.placeOrder({
    customerId: "cust",
    name: "Dana Reed",
    email: "dana@example.com",
    phone: "",
    shipTo,
    items: [{ variantId: "a", quantity: 2 }],
    code: "",
    tier: "standard",
    payChoice: "zelle",
    // 2 x $40 with the default 5% off for two = $76, + $6.95 standard shipping
    expectedTotalCents: 7600 + 695,
    origin: "http://localhost:3000",
    ...over,
  });

describe("order numbering", () => {
  it("in-person and website orders share one sequence starting at 1001", async () => {
    expect(await ops.nextOrderNumber(prisma)).toBe(1001);
    await prisma.order.create({ data: { id: "ip1", number: await ops.nextOrderNumber(prisma), date: new Date("2026-01-02T12:00:00Z"), soldBy: "A", lines: { create: [{ id: "ip1-l", productId: "a", productName: "BPC-157 5mg", quantity: 1, unitPriceCents: 4000, unitCostCents: 1000, cutPercent: 10 }] } } });
    const web = await checkout();
    expect(web.number).toBe(1002);
    expect(await ops.nextOrderNumber(prisma)).toBe(1003);
  });
});

describe("website order flow", () => {
  let orderId = "";

  it("an order awaiting payment does not touch stock or money", async () => {
    const before = await state();
    const placed = await checkout();
    orderId = placed.id;
    const after = await state();
    expect(money(after.ledger)).toEqual(money(before.ledger));
    expect(after.ledger.stock.get("a")!.stock).toBe(before.ledger.stock.get("a")!.stock);
    const o = after.data.pendingOrders.find((x) => x.id === orderId)!;
    expect(o).toMatchObject({ status: "awaiting_payment", source: "online", shippingCents: 695, soldBy: "W" });
    // Buy more, save more is stored as a lower unit price on the line.
    expect(o.lines[0]).toMatchObject({ quantity: 2, unitPriceCents: 3800, unitCostCents: 0 });
    expect(o.web).toMatchObject({ email: "dana@example.com", payChoice: "zelle", shippingTier: "standard" });
    expect(o.web!.token).toHaveLength(32);
    expect(new Date(o.web!.expiresAt!).getTime() - new Date(o.web!.placedAt!).getTime()).toBe(24 * 3600_000);
  });

  it("refuses when the price changed, the cart is empty, or an item is sold out", async () => {
    await expect(checkout({ expectedTotalCents: 1 })).rejects.toThrow(/price changed/);
    await expect(checkout({ items: [] })).rejects.toThrow(/cart is empty/);
    await prisma.stockAdjustment.create({ data: { id: "adj-out", date: new Date("2026-01-01T13:00:00Z"), productId: "b", quantity: -1 } });
    await expect(checkout({ items: [{ variantId: "b", quantity: 1 }], expectedTotalCents: 7695 })).rejects.toThrow(/sold out/);
    await prisma.stockAdjustment.delete({ where: { id: "adj-out" } });
  });

  it("Mark paid turns it into a normal sale in the shared money math", async () => {
    const before = await state();
    expect(await ops.stockShortfalls(orderId)).toEqual([]);
    await ops.markPaid(orderId, { paymentMethod: "Zelle" });
    const after = await state();
    const o = after.data.orders.find((x) => x.id === orderId)!;
    expect(o).toMatchObject({ status: "paid", soldBy: "W", paymentMethod: "Zelle", customerId: "cust", customer: "Dana Reed" });
    // Cost and cut are snapshotted now: $100 / 10 units = $10 each, cut 10%.
    expect(o.lines[0]).toMatchObject({ unitCostCents: 1000, cutPercent: 10 });
    expect(after.ledger.stock.get("a")!.stock).toBe(before.ledger.stock.get("a")!.stock - 2);
    const r = after.ledger.orders.get(orderId)!;
    // Revenue $76, cost $20, profit $56, 10% business cut -> $50.40 split 50/50. Shipping $6.95 all business.
    expect(r).toMatchObject({ revenue: 7600, cost: 2000, profit: 5600, a: 2520, b: 2520, shipping: 695, total: 8295 });
    expect(after.ledger.businessCents - before.ledger.businessCents).toBe(8295);
    expect(after.ledger.pendingA - before.ledger.pendingA).toBe(2520);
    expect(after.data.pendingOrders.some((x) => x.id === orderId)).toBe(false);
    await expect(ops.markPaid(orderId, { paymentMethod: "Zelle" })).rejects.toThrow(/already marked paid/);
  });

  it("warns when a size lacks stock, and still allows marking paid", async () => {
    const placed = await checkout({ items: [{ variantId: "b", quantity: 1 }], expectedTotalCents: 7695 });
    await prisma.stockAdjustment.create({ data: { id: "adj-short", date: new Date(), productId: "b", quantity: -1 } });
    expect(await ops.stockShortfalls(placed.id)).toEqual([{ name: "BPC-157 10mg", need: 1, have: 0 }]);
    await ops.cancelOrder(placed.id, "Canceled: test", { notify: false });
    await prisma.stockAdjustment.delete({ where: { id: "adj-short" } });
  });

  it("buying a label records the cost as a shipping expense and saves tracking", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.endsWith("/shipments/")) {
        return json({
          rates: [
            { object_id: "rate_prio", amount: "9.10", provider: "USPS", servicelevel: { name: "Priority Mail", token: "usps_priority" }, estimated_days: 2 },
            { object_id: "rate_ga", amount: "4.55", provider: "USPS", servicelevel: { name: "Ground Advantage", token: "usps_ground_advantage" }, estimated_days: 4 },
          ],
        });
      }
      if (url.endsWith("/transactions/")) return json({ status: "SUCCESS", tracking_number: "9400100000000000000000", label_url: "https://shippo.test/label.pdf", object_id: "tx_1" });
      return json({});
    });
    try {
      const before = await state();
      const rates = await ops.labelRates(orderId);
      expect(rates.suggestedRateId).toBe("rate_ga"); // the customer picked Standard = Ground Advantage
      const label = await ops.buyLabel(orderId);
      expect(label).toMatchObject({ cents: 455, trackingNumber: "9400100000000000000000", carrier: "USPS" });
      const after = await state();
      expect(before.ledger.businessCents - after.ledger.businessCents).toBe(455);
      expect(after.ledger.labelCosts).toBe(455);
      expect([after.ledger.pendingA, after.ledger.pendingB]).toEqual([before.ledger.pendingA, before.ledger.pendingB]);
      const o = after.data.orders.find((x) => x.id === orderId)!;
      expect(o.status).toBe("label_purchased");
      expect(o.web).toMatchObject({ trackingNumber: "9400100000000000000000", labelUrl: "https://shippo.test/label.pdf" });
      await expect(ops.buyLabel(orderId)).rejects.toThrow(/already bought/);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("shipped, then delivered (with a review link), following carrier tracking", async () => {
    const r1 = await ops.applyTrack(orderId, { status: "TRANSIT", detail: "", shippedAt: "2026-02-01T10:00:00.000Z", deliveredAt: null });
    expect(r1.changed).toBe(true);
    expect((await prisma.order.findUnique({ where: { id: orderId } }))!.status).toBe("shipped");
    await ops.applyTrack(orderId, { status: "DELIVERED", detail: "", shippedAt: null, deliveredAt: "2026-02-03T10:00:00.000Z" });
    const row = (await prisma.order.findUnique({ where: { id: orderId } }))!;
    expect(row.status).toBe("delivered");
    expect(row.reviewToken).toBeTruthy();
    const events = (await prisma.orderEvent.findMany({ where: { orderId }, orderBy: { at: "asc" } })).map((e) => e.message);
    expect(events).toEqual(expect.arrayContaining(["Order placed. Waiting for payment.", "Marked paid.", "Shipping label purchased.", "Carrier picked it up. Marked shipped.", "Carrier reports delivered."]));
    // Emails were attempted and logged even though no email key is set.
    expect(events.some((m) => m.startsWith("Order received email: Not sent"))).toBe(true);
  });
});

describe("auto-cancel", () => {
  it("cancels unpaid orders after the time limit, with the reason, and frees promotion uses", async () => {
    // Clear unpaid orders left by the earlier tests so this one counts only its own.
    await ops.autoCancelDue(new Date(Date.now() + 1000 * 3600_000));
    await prisma.promotion.create({ data: { id: "deal", kind: "auto", name: "Launch", discountType: "$", discountValue: 1000, maxUses: 5 } });
    const before = await state();
    const placed = await checkout({ expectedTotalCents: 7600 - 1000 + 695 });
    expect(await prisma.promotionUse.count({ where: { promotionId: "deal" } })).toBe(1);

    expect(await ops.autoCancelDue(new Date(Date.now() + 23 * 3600_000))).toBe(0);
    expect(await ops.autoCancelDue(new Date(Date.now() + 25 * 3600_000))).toBe(1);

    const row = (await prisma.order.findUnique({ where: { id: placed.id } }))!;
    expect(row).toMatchObject({ status: "canceled", cancelReason: "Canceled: payment not received in time" });
    expect(await prisma.promotionUse.count({ where: { promotionId: "deal" } })).toBe(0);
    const after = await state();
    expect(money(after.ledger)).toEqual(money(before.ledger));
    expect(after.ledger.stock.get("a")!.stock).toBe(before.ledger.stock.get("a")!.stock);
    await expect(ops.markPaid(placed.id, { paymentMethod: "Zelle" })).rejects.toThrow(/canceled/);
    await prisma.promotion.delete({ where: { id: "deal" } });
  });

  it("paid orders are never auto-canceled", async () => {
    const placed = await checkout();
    await ops.markPaid(placed.id, { paymentMethod: "Zelle", notify: false });
    expect(await ops.autoCancelDue(new Date(Date.now() + 100 * 3600_000))).toBe(0);
    expect((await prisma.order.findUnique({ where: { id: placed.id } }))!.status).toBe("paid");
  });

  it("canceling a paid order takes it back out of stock and money", async () => {
    const before = await state();
    const placed = await checkout();
    await ops.markPaid(placed.id, { paymentMethod: "Zelle", notify: false });
    expect((await state()).ledger.businessCents).toBe(before.ledger.businessCents + 8295);
    await ops.cancelOrder(placed.id, "Canceled: refunded", { notify: false });
    const after = await state();
    expect(money(after.ledger)).toEqual(money(before.ledger));
    expect(after.ledger.stock.get("a")!.stock).toBe(before.ledger.stock.get("a")!.stock);
  });
});

describe("combine into one product and split variant out", () => {
  it("combining keeps each size's stock, cost, price and sales history", async () => {
    const before = await state();
    const id = await cat.combineProducts({ name: "BPC-157", items: [{ productId: "a", label: "5mg" }, { productId: "b", label: "10mg" }] });
    const after = await state();
    const variants = after.data.products.filter((p) => p.listingId === id);
    expect(variants.map((v) => [v.id, v.variantLabel, v.variantSort, v.defaultPriceCents])).toEqual([
      ["a", "5mg", 0, 4000],
      ["b", "10mg", 1, 7000],
    ]);
    const l = after.data.listings.find((x) => x.id === id)!;
    // Website fields come from the first product's parent; the old parents are gone.
    expect(l).toMatchObject({ name: "BPC-157", slug: "bpc-157", summary: "kept", showOnWebsite: true });
    expect(after.data.listings.map((x) => x.id)).toEqual([id]);
    expect(money(after.ledger)).toEqual(money(before.ledger));
    for (const pid of ["a", "b"]) expect(after.ledger.stock.get(pid)).toEqual(before.ledger.stock.get(pid));
    expect(after.data.orders.flatMap((o) => o.lines).filter((x) => x.productId === "a").length).toBe(before.data.orders.flatMap((o) => o.lines).filter((x) => x.productId === "a").length);
    expect(await prisma.purchase.count()).toBe(2);
  });

  it("refuses bad input and changes nothing", async () => {
    await expect(cat.combineProducts({ name: "X", items: [{ productId: "a", label: "5mg" }] })).rejects.toThrow(/at least two/);
    await expect(cat.combineProducts({ name: "X", items: [{ productId: "a", label: "5mg" }, { productId: "b", label: "5MG" }] })).rejects.toThrow(/same label/);
    expect(await prisma.listing.count()).toBe(1);
  });

  it("split variant out undoes it for one size", async () => {
    const before = await state();
    const newId = await cat.splitVariantOut("b");
    const after = await state();
    const b = after.data.products.find((p) => p.id === "b")!;
    expect(b).toMatchObject({ listingId: newId, variantLabel: "", defaultPriceCents: 7000 });
    expect(after.data.listings.find((l) => l.id === newId)).toMatchObject({ name: "BPC-157 10mg", slug: "bpc-157-10mg", showOnWebsite: false });
    expect(after.data.products.find((p) => p.id === "a")!.listingId).not.toBe(newId);
    expect(money(after.ledger)).toEqual(money(before.ledger));
    expect(after.ledger.stock.get("b")).toEqual(before.ledger.stock.get("b"));
    await expect(cat.splitVariantOut("b")).rejects.toThrow(/only one size/);
  });

  it("ensureCatalog gives orphan products a parent and a slug", async () => {
    await prisma.product.create({ data: { id: "orphan", name: "TB-500 5mg", defaultPriceCents: 5000 } });
    await cat.ensureCatalog();
    const p = (await prisma.product.findUnique({ where: { id: "orphan" }, include: { listing: true } }))!;
    expect(p.listing).toMatchObject({ name: "TB-500 5mg", slug: "tb-500-5mg", showOnWebsite: false });
  });
});

describe("JSON backup includes the store data", () => {
  it("export then import brings everything back with identical money", async () => {
    const { loadBackup } = await import("../serialize");
    const before = await state();
    const backup = JSON.parse(JSON.stringify(await loadBackup()));
    const counts = async () => ({
      orders: await prisma.order.count(),
      lines: await prisma.orderLine.count(),
      events: await prisma.orderEvent.count(),
      labels: await prisma.labelPurchase.count(),
      listings: await prisma.listing.count(),
      customers: await prisma.customer.count(),
    });
    const c0 = await counts();
    await prisma.order.deleteMany();
    await restore(backup);
    expect(await counts()).toEqual(c0);
    const after = await state();
    expect(money(after.ledger)).toEqual(money(before.ledger));
    expect(after.data.store.payments.zelle.details).toBe("pay@buckshot.test");
    // Accounts survive (password hash is part of the backup, never of the admin data).
    expect((await prisma.customer.findUnique({ where: { id: "cust" } }))!.passwordHash).toBe("x");
    expect(after.data.orders.find((o) => o.status === "delivered")!.web!.trackingNumber).toBe("9400100000000000000000");
  });
});
