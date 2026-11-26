// Batch #1 (shipment 2): the one-time fix of the 2026-11-26 restock, on a copy of exactly what was entered.
// Proves: $1,744 total paid by Ahmad spread over the paid lines (unit costs as on the supplier order),
// the free RT10 vial added at $0, Retatrutide 20mg back to one 20-vial line with stock unchanged, the
// duplicate $83 fee expense removed (logged), cash held takes it out of Ahmad, it runs once, and it
// changes nothing if the records were edited since. Plus "Paid by" on any restock.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));

const dir = mkdtempSync(path.join(tmpdir(), "ship2-test-"));
const root = path.resolve(import.meta.dirname, "../..");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").split(path.sep).join("/")}`;
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";

let prisma: (typeof import("./db"))["prisma"];
let ser: typeof import("./serialize");
let money: typeof import("./money");
let cash: typeof import("./cash");
let fix: typeof import("./batch1-shipment2");

const DATE = new Date("2026-11-26T05:45:09.240Z");

async function seed() {
  await prisma.expenseEvent.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.stockAdjustment.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.dataMigration.deleteMany();
  for (const l of fix.ORDER)
    await prisma.purchase.create({ data: { id: l.purchase, date: DATE, productId: l.was.productId, quantity: l.was.qty, totalCostCents: l.was.cost, note: "Batch 1" } });
  await prisma.stockAdjustment.create({ data: { id: "ee21dff3-b8c8-4e9e-a773-8003dbe24ded", date: DATE, productId: "bb00b46d-b608-459f-a67d-7da5eff81d53", quantity: -1, reason: "correction" } });
  await prisma.expense.create({ data: { id: "9daaee72-2dc3-4d07-a073-8f0ad933505e", date: new Date("2026-11-26T17:00:00Z"), category: "other", vendor: "Zelle peps", amountCents: 8300, paidBy: "A" } });
}

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("./db"));
  ser = await import("./serialize");
  money = await import("./money");
  cash = await import("./cash");
  fix = await import("./batch1-shipment2");
  await prisma.settings.create({ data: { id: 1, startingBalanceCents: 0, partnerAName: "Ahmad", partnerBName: "Mo" } });
  const ids = new Set(fix.ORDER.flatMap((l) => [l.productId, l.was.productId]));
  for (const id of ids) await prisma.product.create({ data: { id, name: id.slice(0, 6), defaultPriceCents: 5000 } });
}, 120_000);
beforeEach(seed);
afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const state = async () => {
  const data = await ser.loadAll();
  const l = money.computeLedger(data);
  const p = cash.cashPosition(data, l);
  const stock = Object.fromEntries([...l.stock].map(([id, s]) => [id, s.stock]));
  return { data, l, p, stock };
};

describe("spread", () => {
  it("adds up to exactly what was paid, in proportion, $0 lines stay $0", () => {
    const costs = fix.spread(fix.ORDER.map((l) => l.line), 174400);
    expect(costs.reduce((a, b) => a + b, 0)).toBe(174400);
    expect(costs[costs.length - 1]).toBe(0);
    expect(fix.ORDER.reduce((x, l) => x + l.line, 0)).toBe(166500); // products $1,665
    expect(166500 - 300 - 100 + 8300).toBe(174400); // - $3 - $1 + $83 Zelle fee (shipping waived)
  });
});

describe("the fix", () => {
  it("matches the supplier order: $1,744 by Ahmad, unit costs, free vial, lot and batch name", async () => {
    const before = await state();
    const r = await fix.fixBatch1Shipment2();
    expect(r?.applied).toBe(true);
    const unit = Object.fromEntries(r!.lines!.map((x) => [x.code, (x.costCents / x.qty / 100).toFixed(2)]));
    expect(unit).toEqual({ RT10: "8.90", RT20: "14.66", KL80: "19.90", MS10: "6.81", MS20: "9.43", CU100: "5.24", "MT-2": "4.19", CP10: "10.47", KP10: "6.29", BA10: "1.05", "RT10 free": "0.00" });
    const rows = await prisma.purchase.findMany();
    expect(rows.reduce((x, p) => x + p.totalCostCents, 0)).toBe(174400);
    expect(rows.every((p) => p.paidBy === "A" && p.note.startsWith("Batch #1 (shipment 2) · lot BL2611"))).toBe(true);
    // RT10 over 21 vials
    const rt10 = rows.filter((p) => p.productId === "e9ce7018-19e6-430b-ae59-58b0eb8826e0");
    expect(rt10.reduce((x, p) => x + p.quantity, 0)).toBe(21);
    expect((rt10.reduce((x, p) => x + p.totalCostCents, 0) / 21 / 100).toFixed(2)).toBe("8.48");

    const after = await state();
    // Business money: was $1,665 + $83 fee expense = $1,748 out; now $1,744 out.
    expect(after.l.businessCents - before.l.businessCents).toBe(174800 - 174400);
    expect(after.l.expenseCosts).toBe(0);
    // Stock: only the free RT10 vial is new. RT20 stays 20 (21 - 1 before, 20 - 1 + 1 now).
    expect(after.stock["e9ce7018-19e6-430b-ae59-58b0eb8826e0"] - before.stock["e9ce7018-19e6-430b-ae59-58b0eb8826e0"]).toBe(1);
    expect(after.stock["bb00b46d-b608-459f-a67d-7da5eff81d53"]).toBe(before.stock["bb00b46d-b608-459f-a67d-7da5eff81d53"]);
    for (const l of fix.ORDER.slice(2, 10)) expect(after.stock[l.productId]).toBe(before.stock[l.productId]);
    // Cash held: Ahmad paid all $1,744 (before: only the $83 fee came out of Ahmad, the rest out of the bank).
    expect(after.p.A).toBe(before.p.A + 8300 - 174400);
    expect(after.p.bank).toBe(before.p.bank + 166500);
    expect(after.p.A + after.p.B + after.p.bank).toBe(after.l.businessCents);
    // The fee expense delete is in the expense history.
    const ev = await prisma.expenseEvent.findMany();
    expect(ev).toHaveLength(1);
    expect(ev[0].message).toMatch(/counted twice/);
  });

  it("runs once", async () => {
    expect((await fix.fixBatch1Shipment2())?.applied).toBe(true);
    expect(await fix.fixBatch1Shipment2()).toBeNull();
  });

  it("changes nothing if a line was edited since", async () => {
    await prisma.purchase.update({ where: { id: fix.ORDER[0].purchase }, data: { totalCostCents: 17500 } });
    const before = await prisma.purchase.findMany({ orderBy: { id: "asc" } });
    const r = await fix.fixBatch1Shipment2();
    expect(r?.applied).toBe(false);
    expect(await prisma.purchase.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    expect(await prisma.expense.count()).toBe(1);
  });
});

describe("Paid by on a restock", () => {
  it("a partner who paid out of pocket: it comes out of their cash held; not recorded = the bank, as before", async () => {
    await prisma.purchase.deleteMany();
    await prisma.expense.deleteMany();
    await prisma.stockAdjustment.deleteMany();
    await prisma.purchase.create({ data: { id: "x1", date: DATE, productId: fix.ORDER[0].productId, quantity: 5, totalCostCents: 5000 } });
    const a = await state();
    expect([a.p.A, a.p.B, a.p.bank]).toEqual([0, 0, -5000]);
    await prisma.purchase.update({ where: { id: "x1" }, data: { paidBy: "B" } });
    const b = await state();
    expect([b.p.A, b.p.B, b.p.bank]).toEqual([0, -5000, 0]);
    expect(b.l.businessCents).toBe(a.l.businessCents);
    await prisma.purchase.update({ where: { id: "x1" }, data: { fromInvestment: true } });
    const c = await state();
    expect([c.p.A, c.p.B, c.p.bank]).toEqual([0, 0, 0]);
  });
});
