// Lab testing (Inventory > Adjust stock and "Send samples to lab"), against a real database.
// Proves: a Lab testing adjustment lowers stock but never business money or cash held; its cost (cost per vial
// at the time) shows as Testing cost in reports; a multi-product lab shipment works in one go; the
// "Sent for testing" history shows the right rows and totals per period; other reasons cost nothing.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));

const dir = mkdtempSync(path.join(tmpdir(), "lab-test-"));
const root = path.resolve(import.meta.dirname, "../..");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").split(path.sep).join("/")}`;
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";

let prisma: (typeof import("./db"))["prisma"];
let ser: typeof import("./serialize");
let money: typeof import("./money");
let cash: typeof import("./cash");
let lab: typeof import("./lab-testing");
let ex: typeof import("./expenses");
let schemas: typeof import("./schemas");

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("./db"));
  ser = await import("./serialize");
  money = await import("./money");
  cash = await import("./cash");
  lab = await import("./lab-testing");
  ex = await import("./expenses");
  schemas = await import("./schemas");
  await prisma.settings.create({ data: { id: 1, startingBalanceCents: 0, partnerAName: "Ahmad", partnerBName: "Mo" } });
  await prisma.product.create({ data: { id: "rt10", name: "Retatrutide 10mg", defaultPriceCents: 6000, costOverrideCents: 890 } });
  await prisma.product.create({ data: { id: "klow", name: "KLOW 80mg", defaultPriceCents: 9500 } });
  // Stock: 30 RT10 (cost set to $8.90) and 20 KLOW at $19.90 (average), paid by Ahmad.
  await prisma.purchase.create({ data: { id: "p1", date: new Date("2026-11-01T12:00:00Z"), productId: "rt10", quantity: 30, totalCostCents: 26700, paidBy: "A" } });
  await prisma.purchase.create({ data: { id: "p2", date: new Date("2026-11-01T12:00:00Z"), productId: "klow", quantity: 20, totalCostCents: 39800, paidBy: "A" } });
}, 120_000);
beforeEach(async () => {
  await prisma.stockAdjustment.deleteMany();
  await prisma.expense.deleteMany();
});
afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const snap = async () => {
  const data = await ser.loadAll();
  const l = money.computeLedger(data);
  const p = cash.cashPosition(data, l);
  return { data, business: l.businessCents, A: p.A, B: p.B, bank: p.bank, pending: l.pendingA + l.pendingB, rt10: l.stock.get("rt10")!.stock, klow: l.stock.get("klow")!.stock };
};
const adj = (over: Record<string, unknown>) => schemas.adjustmentCreate.parse({ id: crypto.randomUUID(), date: "2026-11-20T12:00:00Z", productId: "rt10", quantity: -2, reason: "lab_testing", ...over });

describe("Lab testing adjustment", () => {
  it("lowers stock but not business money or cash held; keeps lab, sample ID, lot and the cost of the vials", async () => {
    await prisma.expense.create({ data: { id: "fee", date: new Date("2026-11-20T12:00:00Z"), category: "lab_testing", vendor: "KMD Analytical", amountCents: 25000, paidBy: "A" } });
    const before = await snap();
    const a = await lab.createAdjustment(adj({ lab: "KMD Analytical", sampleId: "BL-05", lot: "BL2611", expenseId: "fee" }));
    const after = await snap();
    expect(after.rt10).toBe(before.rt10 - 2);
    expect(after.business).toBe(before.business);
    expect([after.A, after.B, after.bank]).toEqual([before.A, before.B, before.bank]);
    expect(after.pending).toBe(before.pending);
    expect(a).toMatchObject({ lab: "KMD Analytical", sampleId: "BL-05", lot: "BL2611", expenseId: "fee", costCents: 1780 });
  });

  it("only takes vials out; other reasons cost nothing and keep no lab fields", async () => {
    expect(() => adj({ quantity: 3 })).toThrow(/removes vials/);
    const b = await lab.createAdjustment(adj({ reason: "breakage", lab: "KMD", sampleId: "X" }));
    expect(b).toMatchObject({ costCents: 0, lab: "", sampleId: "" });
    expect(adj({}).reason).toBe("lab_testing");
  });

  it("editing keeps the cost per vial it was sent at; switching reason clears the testing cost", async () => {
    const a = await lab.createAdjustment(adj({ quantity: -2 }));
    await prisma.product.update({ where: { id: "rt10" }, data: { costOverrideCents: 1500 } });
    expect((await lab.updateAdjustment(a.id, { quantity: -3 })).costCents).toBe(2670);
    expect((await lab.updateAdjustment(a.id, { reason: "breakage" })).costCents).toBe(0);
    await prisma.product.update({ where: { id: "rt10" }, data: { costOverrideCents: 890 } });
  });
});

describe("Send samples to lab (several sizes in one go)", () => {
  it("takes every row out of stock with the lab and lot set once; money unchanged", async () => {
    const before = await snap();
    const rows = await lab.sendLabShipment(
      schemas.labShipmentInput.parse({
        id: "ship1", date: "2026-11-21T12:00:00Z", lab: "Janoshik", lot: "BL2611",
        rows: [{ productId: "rt10", quantity: 5, sampleId: "BL-01" }, { productId: "klow", quantity: 4, sampleId: "BL-02" }, { productId: "rt10", quantity: 1, sampleId: "BL-03" }],
      }),
    );
    expect(rows).toHaveLength(3);
    const after = await snap();
    expect(after.rt10).toBe(before.rt10 - 6);
    expect(after.klow).toBe(before.klow - 4);
    expect(after.business).toBe(before.business);
    expect([after.A, after.B, after.bank]).toEqual([before.A, before.B, before.bank]);
    const saved = await prisma.stockAdjustment.findMany({ where: { shipmentId: "ship1" }, orderBy: { createdAt: "asc" } });
    expect(saved.map((s) => [s.productId, s.quantity, s.lab, s.lot, s.sampleId, s.costCents])).toEqual([
      ["rt10", -5, "Janoshik", "BL2611", "BL-01", 4450],
      ["klow", -4, "Janoshik", "BL2611", "BL-02", 7960],
      ["rt10", -1, "Janoshik", "BL2611", "BL-03", 890],
    ]);
  });

  it("refuses a shipment with an unknown product, and saves nothing", async () => {
    await expect(lab.sendLabShipment(schemas.labShipmentInput.parse({ id: "s2", date: "2026-11-21", rows: [{ productId: "rt10", quantity: 1 }, { productId: "gone", quantity: 1 }] }))).rejects.toThrow(/no longer exists/);
    expect(await prisma.stockAdjustment.count()).toBe(0);
  });
});

describe("reports and history", () => {
  it("Sent for testing: rows newest first, total vials and cost per period; Testing cost apart from sales cost", async () => {
    await lab.createAdjustment(adj({ date: "2026-10-05T12:00:00Z", quantity: -1, lab: "KMD Analytical" }));
    await lab.sendLabShipment(schemas.labShipmentInput.parse({ id: "s3", date: "2026-11-21T12:00:00Z", lab: "Janoshik", rows: [{ productId: "rt10", quantity: 2 }, { productId: "klow", quantity: 3 }] }));
    await lab.createAdjustment(adj({ reason: "breakage", quantity: -1 }));
    const { data } = await snap();
    const all = ex.testingSummary(data.adjustments);
    expect(all.vials).toBe(6);
    expect(all.costCents).toBe(890 + 2 * 890 + 3 * 1990);
    expect(all.rows.map((r) => r.lab)).toEqual(["Janoshik", "Janoshik", "KMD Analytical"]);
    const nov = ex.testingSummary(data.adjustments, (iso) => iso >= "2026-11-01");
    expect(nov).toMatchObject({ vials: 5, costCents: 2 * 890 + 3 * 1990 });
    // Breakage is not testing; sales cost (orders) is untouched: there are no orders, so ledger cost is 0.
    expect(all.rows.every((r) => r.reason === "lab_testing")).toBe(true);
    expect([...money.computeLedger(data).orders.values()].length).toBe(0);
  });
});
