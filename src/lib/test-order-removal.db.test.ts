// The one-time removal of canceled test order #1008: only that exact order, its free test label goes too,
// money changes only by the label, stock and every other order are untouched.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "test-order-"));
const root = path.resolve(import.meta.dirname, "../..");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").split(path.sep).join("/")}`;
process.env.DATA_DIR = dir;

let prisma: (typeof import("./db"))["prisma"];
let mig: typeof import("./data-migrations");
let ledgerOf: () => Promise<{ business: number; labels: number; stock: number; orders: number }>;

const ID = "9f667fd9-9c3e-4302-aab5-3da931406aca";
const TX = "1e0eaf8bd9ac484f9a7085d40dc64d31";

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("./db"));
  mig = await import("./data-migrations");
  const { loadAll } = await import("./serialize");
  const { computeLedger } = await import("./money");
  ledgerOf = async () => {
    const data = await loadAll();
    const l = computeLedger(data);
    return { business: l.businessCents, labels: l.labelCosts, stock: l.stock.get("p1")?.stock ?? 0, orders: await prisma.order.count() };
  };
  await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1, startingBalanceCents: -10000 } });
  await prisma.product.create({ data: { id: "p1", name: "BUCK2O 10ml", defaultPriceCents: 1000 } });
  await prisma.purchase.create({ data: { id: "pu1", productId: "p1", quantity: 10, totalCostCents: 1000, date: new Date("2026-11-01") } });
  // A real in-person sale (#1007) and the canceled test order (#1008) with its label.
  await prisma.order.create({ data: { id: "real", number: 1007, date: new Date("2026-11-20"), soldBy: "A", lines: { create: [{ id: "rl", productId: "p1", productName: "BUCK2O 10ml", quantity: 1, unitPriceCents: 1000, unitCostCents: 100, cutPercent: 10 }] } } });
  await prisma.order.create({
    data: {
      id: ID, number: 1008, date: new Date("2026-11-23"), soldBy: "W", source: "online", status: "canceled", cancelReason: "Canceled: test order", customer: "Moe (owner)", token: "t-1008-0123456789abcdef0123",
      lines: { create: [{ id: "tl", productId: "p1", productName: "BUCK2O 10ml", quantity: 1, unitPriceCents: 1000, unitCostCents: 100, cutPercent: 10 }] },
      events: { create: [{ id: "ev1", kind: "status", message: "Canceled: test order" }] },
    },
  });
  await prisma.labelPurchase.create({ data: { id: "lb1", orderId: ID, date: new Date("2026-11-23"), costCents: 549, carrier: "USPS", service: "Ground Advantage", trackingNumber: "9300", shippoTransactionId: TX } });
});
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("remove test order #1008", () => {
  it("removes only that order and its test label; business money goes up by the label only; stock unchanged; runs once", async () => {
    const before = await ledgerOf();
    expect(before.labels).toBe(549);
    expect(await mig.removeTestOrder()).toEqual({ removed: true, why: "removed" });
    const after = await ledgerOf();
    expect(after.business - before.business).toBe(549);
    expect(after.labels).toBe(0);
    expect(after.stock).toBe(before.stock);
    expect(after.orders).toBe(before.orders - 1);
    expect(await prisma.order.findUnique({ where: { id: "real" } })).not.toBeNull();
    expect(await prisma.orderLine.count({ where: { orderId: ID } })).toBe(0);
    expect(await prisma.orderEvent.count({ where: { orderId: ID } })).toBe(0);
    expect(await prisma.labelPurchase.count()).toBe(0);
    // The removed rows are kept for undo, and it never runs again.
    const row = await prisma.dataMigration.findUniqueOrThrow({ where: { id: mig.TEST_ORDER_ID } });
    expect(JSON.parse(row.detail).order.number).toBe(1008);
    expect(await mig.removeTestOrder()).toBeNull();
  });

  it("does nothing when the order does not match (e.g. a real order later got that id/number)", async () => {
    await prisma.dataMigration.delete({ where: { id: mig.TEST_ORDER_ID } });
    await prisma.order.create({ data: { id: ID, number: 1008, date: new Date(), soldBy: "W", source: "online", status: "paid", token: "t-real-0123456789abcdef0123" } });
    expect(await mig.removeTestOrder()).toEqual({ removed: false, why: "order does not match the test order" });
    expect(await prisma.order.findUnique({ where: { id: ID } })).not.toBeNull();
  });
});
