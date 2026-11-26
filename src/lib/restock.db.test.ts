// Restock orders against a real database. Proves: nothing is saved until "Yes, save restock" (the review is
// only a plan); saving raises stock, sets cost per vial (weighted with stock there), lowers business money by
// the total and takes it out of whoever paid; editing adjusts by the difference; deleting reverses all of it;
// every change is logged; "Paid by" has no default; Adjust stock never touches money; old restocks untouched.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));

const dir = mkdtempSync(path.join(tmpdir(), "restock-test-"));
const root = path.resolve(import.meta.dirname, "../..");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").split(path.sep).join("/")}`;
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";

let prisma: (typeof import("./db"))["prisma"];
let ser: typeof import("./serialize");
let money: typeof import("./money");
let cash: typeof import("./cash");
let ops: typeof import("./restock-ops");
let schemas: typeof import("./schemas");
let rs: typeof import("./restock");

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("./db"));
  ser = await import("./serialize");
  money = await import("./money");
  cash = await import("./cash");
  ops = await import("./restock-ops");
  schemas = await import("./schemas");
  rs = await import("./restock");
  await prisma.settings.create({ data: { id: 1, startingBalanceCents: 0, partnerAName: "Ahmad", partnerBName: "Mo" } });
}, 120_000);

beforeEach(async () => {
  await prisma.restockEvent.deleteMany();
  await prisma.restockOrder.deleteMany();
  await prisma.stockAdjustment.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.product.deleteMany();
  await prisma.product.create({ data: { id: "rt10", name: "Retatrutide 10mg", defaultPriceCents: 6000, costOverrideCents: 1000 } });
  await prisma.product.create({ data: { id: "klow", name: "KLOW 80mg", defaultPriceCents: 9500, costOverrideCents: null } });
  // An older one-by-one restock: 10 RT10 at $10 each, from the bank.
  await prisma.purchase.create({ data: { id: "old", date: new Date("2026-11-01T12:00:00Z"), productId: "rt10", quantity: 10, totalCostCents: 10000, note: "old" } });
});

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const input = (over: Record<string, unknown> = {}) =>
  schemas.restockInput.parse({
    name: "Restock Nov 26, 2026",
    date: "2026-11-26T17:00:00.000Z",
    supplier: "Supplier",
    lot: "BL2611",
    paidBy: "A",
    feeMode: "percent",
    feeValue: 500, // 5% Zelle fee
    lines: [
      { productId: "rt10", quantity: 20, lineCents: 17000, free: false },
      { productId: "klow", quantity: 20, lineCents: 38000, free: false },
      { productId: "rt10", quantity: 1, lineCents: 0, free: true },
    ],
    ...over,
  });

const snap = async () => {
  const data = await ser.loadAll();
  const l = money.computeLedger(data);
  const p = cash.cashPosition(data, l);
  const prods = await prisma.product.findMany();
  return {
    business: l.businessCents,
    A: p.A,
    B: p.B,
    bank: p.bank,
    stock: { rt10: l.stock.get("rt10")!.stock, klow: l.stock.get("klow")!.stock },
    cost: Object.fromEntries(prods.map((x) => [x.id, x.costOverrideCents])),
    purchases: await prisma.purchase.count(),
    data,
  };
};

describe("save", () => {
  it("nothing is saved by the review (the plan); only Yes saves", async () => {
    const before = await snap();
    const plan = rs.planRestock(input().lines, input());
    expect(plan.totalCents).toBe(57750); // $550 + 5%
    const after = await snap();
    expect(after.purchases).toBe(before.purchases);
    expect(await prisma.restockOrder.count()).toBe(0);
  });

  it("Yes: stock up, cost per vial weighted with stock there, business money down by the total, out of whoever paid", async () => {
    const before = await snap();
    const id = randomUUID();
    await ops.createRestock(id, input());
    const after = await snap();
    expect(after.stock.rt10 - before.stock.rt10).toBe(21);
    expect(after.stock.klow - before.stock.klow).toBe(20);
    expect(before.business - after.business).toBe(57750);
    expect(before.A - after.A).toBe(57750);
    expect(after.bank).toBe(before.bank);
    // RT10: 10 left at $10.00, + 20 at $8.93 (17850 incl. fee) + 1 free = (10000 + 17850) / 31
    expect(after.cost.rt10).toBe(Math.round((10000 + 17850) / 31));
    // KLOW had no stock: its cost is this order's, $19.95
    expect(after.cost.klow).toBe(1995);
    const lines = await prisma.purchase.findMany({ where: { restockOrderId: id }, orderBy: { createdAt: "asc" } });
    expect(lines.map((l) => [l.productId, l.quantity, l.listCents, l.totalCostCents, l.paidBy])).toEqual([
      ["rt10", 20, 17000, 17850, "A"],
      ["klow", 20, 38000, 39900, "A"],
      ["rt10", 1, 0, 0, "A"],
    ]);
    const ev = await prisma.restockEvent.findMany({ where: { restockId: id } });
    expect(ev[0].message).toMatch(/^Saved "Restock Nov 26, 2026": 3 lines, 41 vials, \$577\.50 paid by Ahmad\./);
    expect(after.data.restockOrders?.[0]).toMatchObject({ id, name: "Restock Nov 26, 2026", lot: "BL2611", paidBy: "A" });
  });

  it("Paid by is required and has no default; the server refuses an order that doesn't add up", async () => {
    const { paidBy: _p, ...rest } = input();
    expect(() => schemas.restockInput.parse({ ...rest, date: "2026-11-26" })).toThrow(/Pick who paid/);
    await expect(ops.createRestock(randomUUID(), input({ discountCents: 999_999 }))).rejects.toThrow(/more than the order/);
    await expect(ops.createRestock(randomUUID(), input({ lines: [{ productId: "gone", quantity: 1, lineCents: 100 }] }))).rejects.toThrow(/no longer exists/);
    expect(await prisma.restockOrder.count()).toBe(0);
  });
});

describe("edit and delete", () => {
  it("edit adjusts stock, cost and money by the difference; delete reverses everything; all logged", async () => {
    const before = await snap();
    const id = randomUUID();
    await ops.createRestock(id, input());
    const saved = await snap();

    // Edit: KLOW 20 -> 10 vials ($190), paid by Bank instead of Ahmad, no fee.
    await ops.updateRestock(id, input({ paidBy: "bank", feeValue: 0, lines: [{ productId: "rt10", quantity: 20, lineCents: 17000 }, { productId: "klow", quantity: 10, lineCents: 19000 }, { productId: "rt10", quantity: 1, lineCents: 0, free: true }] }));
    const edited = await snap();
    expect(edited.stock.klow - saved.stock.klow).toBe(-10);
    expect(edited.stock.rt10).toBe(saved.stock.rt10);
    expect(before.business - edited.business).toBe(36000);
    expect(edited.A).toBe(before.A); // Ahmad gets his money back
    expect(before.bank - edited.bank).toBe(36000);
    expect(edited.cost.klow).toBe(1900);
    expect(edited.cost.rt10).toBe(Math.round((10000 + 17000) / 31));

    await ops.deleteRestock(id);
    const gone = await snap();
    expect(gone.business).toBe(before.business);
    expect([gone.A, gone.B, gone.bank]).toEqual([before.A, before.B, before.bank]);
    expect(gone.stock).toEqual(before.stock);
    expect(gone.cost.rt10).toBe(1000); // back to $10.00
    expect(gone.purchases).toBe(before.purchases);
    expect(await prisma.purchase.findUnique({ where: { id: "old" } })).not.toBeNull(); // the older restock is untouched

    const log = await prisma.restockEvent.findMany({ where: { restockId: id }, orderBy: { at: "asc" } });
    expect(log.map((e) => e.action)).toEqual(["created", "edited", "deleted"]);
    expect(log[1].message).toMatch(/total \$577\.50 → \$360\.00; paid by Ahmad → Bank; vials 41 → 31/);
    expect(log[2].message).toMatch(/reversed/);
  });

  it("editing or deleting a missing order says so", async () => {
    await expect(ops.updateRestock("nope", input())).rejects.toThrow(/no longer exists/);
    await expect(ops.deleteRestock("nope")).rejects.toThrow(/no longer exists/);
  });
});

describe("Adjust stock", () => {
  it("changes stock only, never money or cash held; a reason is required", async () => {
    const before = await snap();
    await prisma.stockAdjustment.create({ data: { ...schemas.adjustmentCreate.parse({ id: "adj", date: "2026-11-26", productId: "rt10", quantity: -2, reason: "breakage" }) } });
    const after = await snap();
    expect(after.stock.rt10).toBe(before.stock.rt10 - 2);
    expect(after.business).toBe(before.business);
    expect([after.A, after.B, after.bank]).toEqual([before.A, before.B, before.bank]);
    expect(after.cost).toEqual(before.cost);
    expect(() => schemas.adjustmentCreate.parse({ id: "x", date: "2026-11-26", productId: "rt10", quantity: 1 })).toThrow(/Pick a reason/);
    expect(schemas.adjustmentCreate.parse({ id: "x", date: "2026-11-26", productId: "rt10", quantity: 1, reason: "recount" }).reason).toBe("recount");
  });
});
