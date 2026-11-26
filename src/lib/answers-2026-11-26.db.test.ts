// The owner's answers to the restock check, applied once. Proves: the $1,300 first restock (starting balance)
// is held against Ahmad in cash held; Nov 13 entries are tagged Batch #1 (shipment 1); the Nov 22 KLOW +10
// becomes a stock correction (stock unchanged, no money); #1004 goes to Mo; future cost per vial updated;
// business money, pending and stock never change; it runs once and skips records not as found.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));

const dir = mkdtempSync(path.join(tmpdir(), "answers-test-"));
const root = path.resolve(import.meta.dirname, "../..");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").split(path.sep).join("/")}`;
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";

let prisma: (typeof import("./db"))["prisma"];
let ser: typeof import("./serialize");
let money: typeof import("./money");
let cash: typeof import("./cash");
let fix: typeof import("./answers-2026-11-26");

const KLOW = "2def801b-0233-43c8-8a10-c66276cc6446";
const TESA = "b39c55dc-7318-4752-a1c1-09424b35c0cc";
const RT10 = "e9ce7018-19e6-430b-ae59-58b0eb8826e0";

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("./db"));
  ser = await import("./serialize");
  money = await import("./money");
  cash = await import("./cash");
  fix = await import("./answers-2026-11-26");
  await prisma.settings.create({ data: { id: 1, startingBalanceCents: -130000, partnerAName: "Ahmad", partnerBName: "Mo" } });
  for (const [id, name, cost] of [[RT10, "Retatrutide 10mg", 1000], [KLOW, "KLOW 80mg", 2000], [TESA, "Tesa 10mg", 1800]] as const)
    await prisma.product.create({ data: { id, name, defaultPriceCents: 6000, costOverrideCents: cost } });
  const d13 = new Date("2026-11-13T09:00:00Z");
  await prisma.purchase.create({ data: { id: "b905bc58-acc1-4991-b26b-7131626ffb59", date: d13, productId: RT10, quantity: 10, totalCostCents: 0, fromInvestment: true } });
  await prisma.purchase.create({ data: { id: "db54cc92-4009-434d-9dd0-b72de7b854cb", date: d13, productId: KLOW, quantity: 10, totalCostCents: 0, fromInvestment: true } });
  await prisma.purchase.create({ data: { id: "61964ac0-7169-493d-bcb9-de08905490b8", date: d13, productId: TESA, quantity: 10, totalCostCents: 0, fromInvestment: false } });
  await prisma.purchase.create({ data: { id: "7def3b2d-777e-448c-aa04-c85e4240b523", date: new Date("2026-11-22T04:30:49Z"), productId: KLOW, quantity: 10, totalCostCents: 0 } });
  // #1004: $130 in person by Zelle, money received by not recorded. Plus a cash sale held by Ahmad.
  for (const [n, cashTo] of [[1004, null], [1005, "A"]] as const)
    await prisma.order.create({
      data: {
        id: `o${n}`, number: n, date: new Date("2026-11-23T02:00:00Z"), soldBy: "B", paymentMethod: n === 1004 ? "Zelle" : "Cash", cashTo,
        lines: { create: [{ id: `l${n}`, productId: RT10, productName: "Reta 10mg", quantity: 1, unitPriceCents: 13000, unitCostCents: 1000, cutPercent: 10 }] },
      },
    });
}, 120_000);
afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const snap = async () => {
  const data = await ser.loadAll();
  const l = money.computeLedger(data);
  const p = cash.cashPosition(data, l);
  return { business: l.businessCents, pending: l.pendingA + l.pendingB, A: p.A, B: p.B, bank: p.bank, stock: Object.fromEntries([...l.stock].map(([k, s]) => [k, s.stock])), unit: Object.fromEntries([...l.stock].map(([k, s]) => [k, s.unitCost])) };
};

describe("restock answers (2026-11-26)", () => {
  it("applies once: cash held moves, business money, pending and stock don't", async () => {
    const before = await snap();
    expect(before.bank).toBe(-130000 + 26000 - 13000); // the $1,300 sat in Bank
    const log = await fix.applyAnswers20261126();
    expect(log).toHaveLength(5);
    const after = await snap();
    expect(after.business).toBe(before.business);
    expect(after.pending).toBe(before.pending);
    expect(after.stock).toEqual(before.stock);
    // Ahmad paid the $1,300; #1004's $130 went to Mo.
    expect(after.A).toBe(before.A - 130000);
    expect(after.B).toBe(before.B + 13000);
    expect(after.bank).toBe(before.bank + 130000 - 13000);
    expect(after.A + after.B + after.bank).toBe(after.business);
    // Cost per vial for future sales; Tesa (not in shipment 2) keeps its cost.
    expect(after.unit[RT10]).toBe(890);
    expect(after.unit[KLOW]).toBe(1990);
    expect(after.unit[TESA]).toBe(1800);
    // Past sales keep their recorded cost.
    expect((await prisma.orderLine.findUnique({ where: { id: "l1004" } }))!.unitCostCents).toBe(1000);
    // Records.
    const nov13 = await prisma.purchase.findMany({ where: { date: { lt: new Date("2026-11-14") } } });
    expect(nov13.every((p) => p.note === fix.SHIP1 && p.paidBy === "A" && p.fromInvestment)).toBe(true);
    expect(await prisma.purchase.findUnique({ where: { id: "7def3b2d-777e-448c-aa04-c85e4240b523" } })).toBeNull();
    const corr = await prisma.stockAdjustment.findFirst({ where: { productId: KLOW } });
    expect(corr).toMatchObject({ quantity: 10, reason: "correction", lot: "BL2611", costCents: 0 });
    expect(corr!.note).toMatch(/^Batch #1 \(shipment 1\): count correction/);
    expect((await prisma.order.findUnique({ where: { id: "o1004" } }))!.cashTo).toBe("B");
    expect((await prisma.settings.findUnique({ where: { id: 1 } }))!.startingPaidBy).toBe("A");
    // Once.
    expect(await fix.applyAnswers20261126()).toBeNull();
  });

  it("starting balance paid by: not recorded = the bank (as before)", () => {
    const pos = (startingPaidBy: "A" | "B" | "bank" | null) =>
      cash.cashPosition({ orders: [], settings: { startingBalanceCents: -130000, startingPaidBy } as never }, { businessCents: -130000, orders: new Map() });
    expect(pos(null)).toMatchObject({ A: 0, B: 0, bank: -130000 });
    expect(pos("bank")).toMatchObject({ A: 0, B: 0, bank: -130000 });
    expect(pos("A")).toMatchObject({ A: -130000, B: 0, bank: 0 });
  });
});
