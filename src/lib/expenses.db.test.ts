// Expenses (Money > Expenses), against a real database.
// Proves: an expense lowers business money and can make it negative; payback mode is on while it is below
// $0 and off once sales bring it back to $0 (then profit splits 50/50 as usual); cash held drops for whoever
// paid (Ahmad, Mo or Bank); edit and delete reverse exactly and every change is logged; "Paid by" has no
// default; Performance totals include expenses; restocks, sales and the split work as before.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));

const dir = mkdtempSync(path.join(tmpdir(), "expenses-test-"));
const root = path.resolve(import.meta.dirname, "../..");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").split(path.sep).join("/")}`;
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
delete process.env.RESEND_API_KEY;

let prisma: (typeof import("./db"))["prisma"];
let ser: typeof import("./serialize");
let money: typeof import("./money");
let cash: typeof import("./cash");
let sell: typeof import("./sell-ops");
let schemas: typeof import("./schemas");
let xo: typeof import("./expense-ops");
let ex: typeof import("./expenses");
let up: typeof import("./uploads");
let dataDir: typeof import("./data-dir");

const STORE = { open: true, siteUrl: "https://shop.test", payments: {}, qtyDeals: [], alertEmails: [] };
const DAY = 864e5;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("./db"));
  ser = await import("./serialize");
  money = await import("./money");
  cash = await import("./cash");
  sell = await import("./sell-ops");
  schemas = await import("./schemas");
  xo = await import("./expense-ops");
  ex = await import("./expenses");
  up = await import("./uploads");
  dataDir = await import("./data-dir");
  vi.stubGlobal("fetch", async (url: string | URL | Request) => {
    throw new Error(`Unexpected network call: ${url}`);
  });
  await prisma.settings.create({ data: { id: 1, startingBalanceCents: 0, partnerAName: "Ahmad", partnerBName: "Mo", storeJson: JSON.stringify(STORE) } });
  await prisma.product.create({ data: { id: "reta", name: "Retatrutide", variantLabel: "10mg", defaultPriceCents: 5000 } });
  await prisma.product.create({ data: { id: "ghk", name: "GHK-Cu", variantLabel: "100mg", defaultPriceCents: 5000 } });
  // Stock paid from the investment: it does not touch business money, so each test starts at $0.
  await prisma.purchase.create({ data: { id: "pu", date: new Date("2026-01-01T12:00:00Z"), productId: "ghk", quantity: 500, totalCostCents: 500000, fromInvestment: true } });
}, 120_000);

beforeEach(async () => {
  await prisma.expenseEvent.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.orderEvent.deleteMany();
  await prisma.orderLine.deleteMany();
  await prisma.order.deleteMany();
});

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

/** An in-person sale: 1 x $50, item cost $10, sold by Mo. Profit $40, 10% cut, so $18 each to split. */
async function sale(over: Record<string, unknown> = {}) {
  const id = randomUUID();
  const { fromSavedId, ...s } = schemas.saleInput.parse({
    id, date: new Date().toISOString(), customer: "", customerId: null, paymentMethod: "Cash", note: "", soldBy: "B", discountType: "$", discountValue: 0, tipCents: 0, cashTo: "B",
    lines: [{ id: `${id}-l`, productId: "ghk", productName: "GHK-Cu 100mg", quantity: 1, unitPriceCents: 5000, unitCostCents: 1000, cutPercent: 10 }],
    ...over,
  });
  await sell.recordSale(s, "https://shop.test", fromSavedId);
  return id;
}

const input = (over: Record<string, unknown> = {}) =>
  schemas.expenseInput.parse({ date: ago(1), category: "lab_testing", vendor: "KMD Analytical", amountCents: 20000, paidBy: "bank", productIds: ["reta"], lots: "BL2611-RETA10", ...over });
const add = (over: Record<string, unknown> = {}) => xo.createExpense(randomUUID(), input(over));

const snap = async () => {
  const data = await ser.loadAll();
  const l = money.computeLedger(data);
  const p = cash.cashPosition(data, l);
  return { business: l.businessCents, A: p.A, B: p.B, bank: p.bank, pendingA: l.pendingA, pendingB: l.pendingB, inPayback: l.inPayback, left: l.leftToBreakEven, expenses: l.expenseCosts };
};

describe("business money and payback", () => {
  it("an expense lowers business money and can make it negative (payback mode on)", async () => {
    await sale();
    const before = await snap();
    expect(before.business).toBe(5000);
    expect(before.inPayback).toBe(false);
    await add({ amountCents: 20000, date: new Date().toISOString() });
    const after = await snap();
    expect(after.business).toBe(5000 - 20000);
    expect(after.business).toBeLessThan(0);
    expect(after.inPayback).toBe(true);
    expect(after.left).toBe(15000);
    expect(after.expenses).toBe(20000);
  });

  it("while below $0 every sale goes to the business (nothing to split); at $0 payback ends and the next sale splits 50/50", async () => {
    await add({ amountCents: 10000, date: ago(1) });
    let s = await snap();
    expect(s.business).toBe(-10000);
    expect(s.inPayback).toBe(true);

    await sale(); // $50 in, all of it pays the business back
    s = await snap();
    expect(s.business).toBe(-5000);
    expect(s.inPayback).toBe(true);
    expect(s.pendingA + s.pendingB).toBe(0);

    await sale(); // exactly back to $0
    s = await snap();
    expect(s.business).toBe(0);
    expect(s.inPayback).toBe(false);
    expect(s.left).toBe(0);
    expect(s.pendingA + s.pendingB).toBe(0);

    await sale(); // normal: $40 profit, 10% business cut, $18 each
    s = await snap();
    expect(s.business).toBe(5000);
    expect(s.pendingA).toBe(1800);
    expect(s.pendingB).toBe(1800);
  });

  it("works exactly like a restock of the same amount on the same day", async () => {
    await add({ amountCents: 7000, date: ago(1) });
    await sale();
    const withExpense = await snap();
    await prisma.expense.deleteMany();
    await prisma.purchase.create({ data: { id: "restock", date: new Date(ago(1)), productId: "reta", quantity: 1, totalCostCents: 7000 } });
    const withRestock = await snap();
    await prisma.purchase.delete({ where: { id: "restock" } });
    expect(withExpense.business).toBe(withRestock.business);
    expect(withExpense.pendingA).toBe(withRestock.pendingA);
    expect(withExpense.pendingB).toBe(withRestock.pendingB);
    expect(withExpense.inPayback).toBe(withRestock.inPayback);
  });
});

describe("cash held: comes out of whoever paid", () => {
  it.each([
    ["A", { A: -20000, B: 0, bank: 0 }],
    ["B", { A: 0, B: -20000, bank: 0 }],
    ["bank", { A: 0, B: 0, bank: -20000 }],
  ] as const)("paid by %s", async (paidBy, delta) => {
    await sale({ cashTo: "A" });
    await sale({ cashTo: "B" });
    const before = await snap();
    await add({ paidBy });
    const after = await snap();
    expect(after.A - before.A).toBe(delta.A);
    expect(after.B - before.B).toBe(delta.B);
    expect(after.bank - before.bank).toBe(delta.bank);
    expect(after.business - before.business).toBe(-20000);
    expect(after.A + after.B + after.bank).toBe(after.business);
  });
});

describe("edit and delete reverse exactly, every change logged", () => {
  it("edit moves money to the new amount and payer; delete puts everything back", async () => {
    await sale({ cashTo: "A" });
    const before = await snap();
    const x = await add({ amountCents: 20000, paidBy: "A" });
    let s = await snap();
    expect(s.business).toBe(before.business - 20000);
    expect(s.A).toBe(before.A - 20000);

    const { changed } = await xo.updateExpense(x.id, input({ amountCents: 30000, paidBy: "bank" }));
    expect(changed).toEqual(["amount $200.00 → $300.00", "paid by Ahmad → Bank"]);
    s = await snap();
    expect(s.business).toBe(before.business - 30000);
    expect(s.A).toBe(before.A);
    expect(s.bank).toBe(before.bank - 30000);

    await xo.deleteExpense(x.id);
    expect(await snap()).toEqual(before);
    expect(await prisma.expense.count()).toBe(0);

    const history = await prisma.expenseEvent.findMany({ where: { expenseId: x.id }, orderBy: { at: "asc" } });
    expect(history.map((h) => h.action)).toEqual(["created", "edited", "deleted"]);
    expect(history[0].message).toBe("Added: Lab testing · KMD Analytical · $200.00 · paid by Ahmad.");
    expect(history[1].message).toContain("amount $200.00 → $300.00; paid by Ahmad → Bank");
    expect(history[2].message).toMatch(/^Deleted: Lab testing · KMD Analytical · \$300\.00 · paid by Bank/);
    // The history is still on the Money page after the delete.
    expect((await ser.loadAll()).expenseEvents?.filter((e) => e.expenseId === x.id)).toHaveLength(3);
  });

  it("saving without changes logs nothing", async () => {
    const x = await add();
    const { changed } = await xo.updateExpense(x.id, input());
    expect(changed).toEqual([]);
    expect(await prisma.expenseEvent.count({ where: { expenseId: x.id } })).toBe(1);
  });

  it("editing or deleting a missing expense says so", async () => {
    await expect(xo.updateExpense("nope", input())).rejects.toThrow(/no longer exists/);
    await expect(xo.deleteExpense("nope")).rejects.toThrow(/no longer exists/);
  });
});

describe("the form's rules", () => {
  it("Paid by is required and has no default", () => {
    const base = { date: ago(0), amountCents: 100 };
    expect(() => schemas.expenseInput.parse(base)).toThrow(/Pick who paid/);
    expect(() => schemas.expenseInput.parse({ ...base, paidBy: null })).toThrow(/Pick who paid/);
    expect(() => schemas.expenseInput.parse({ ...base, paidBy: "" })).toThrow(/Pick who paid/);
    expect(schemas.expenseInput.parse({ ...base, paidBy: "B" }).paidBy).toBe("B");
  });

  it("category defaults to Lab testing; the amount must be over $0 and whole cents", () => {
    const ok = schemas.expenseInput.parse({ date: ago(0), amountCents: 100, paidBy: "bank" });
    expect(ok.category).toBe("lab_testing");
    expect(ok.productIds).toEqual([]);
    expect(() => schemas.expenseInput.parse({ date: ago(0), amountCents: 0, paidBy: "bank" })).toThrow();
    expect(() => schemas.expenseInput.parse({ date: ago(0), amountCents: 10.5, paidBy: "bank" })).toThrow();
  });

  it("keeps products tested and the lot; unknown products are dropped", async () => {
    const x = await add({ productIds: ["reta", "ghk", "reta", "gone"], lots: "BL2611-RETA10" });
    expect(x.productIds).toEqual(["reta", "ghk"]);
    expect(x.lots).toBe("BL2611-RETA10");
    const loaded = (await ser.loadAll()).expenses!.find((e) => e.id === x.id)!;
    expect(loaded.productIds).toEqual(["reta", "ghk"]);
  });

  it("an attachment is private and removed with the expense", async () => {
    const { file, mime } = await up.saveInvoice(Buffer.from("%PDF-1.4\n%test invoice\n"));
    expect(mime).toBe("application/pdf");
    const full = path.join(dataDir.privateUploadsDir(), file);
    expect(existsSync(full)).toBe(true);
    expect(existsSync(path.join(dataDir.publicUploadsDir(), file))).toBe(false);
    const x = await add({ file, fileName: "kmd-invoice.pdf", mime });
    expect(x.file).toBe(file);
    await xo.deleteExpense(x.id);
    expect(existsSync(full)).toBe(false);
  });
});

describe("Performance totals include expenses", () => {
  it("cost and profit for the period include expenses; Testing spent is lab testing only; the range filters by date", async () => {
    await sale();
    await add({ amountCents: 20000, category: "lab_testing", date: ago(0) });
    await add({ amountCents: 1500, category: "packaging", vendor: "Uline", date: ago(0) });
    await add({ amountCents: 9900, category: "lab_testing", vendor: "Janoshik", date: ago(40) });
    const data = await ser.loadAll();
    const l = money.computeLedger(data);
    const salesProfit = [...l.orders.values()].reduce((x, o) => x + o.profit, 0);
    const salesCost = [...l.orders.values()].reduce((x, o) => x + o.cost, 0);

    const all = ex.periodExpenses(data.expenses!);
    expect(all).toMatchObject({ total: 31400, testing: 29900, count: 3 });

    const week = (iso: string) => Date.now() - new Date(iso).getTime() < 7 * DAY;
    const p = ex.periodExpenses(data.expenses!, week);
    expect(p).toMatchObject({ total: 21500, testing: 20000, count: 2 });
    // What the Performance cards show for the week: Cost = item cost + expenses, Profit after expenses.
    expect(salesCost + p.total).toBe(1000 + 21500);
    expect(salesProfit - p.total).toBe(4000 - 21500);
    expect([...p.byDay.values()].reduce((a, b) => a + b, 0)).toBe(21500);
  });
});

describe("nothing else changes", () => {
  it("with no expenses, every number is what it was before expenses existed", async () => {
    await sale({ cashTo: "A" });
    await sale({ cashTo: "bank", paymentMethod: "Zelle" });
    const data = await ser.loadAll();
    expect(data.expenses).toEqual([]);
    const withField = money.computeLedger(data);
    const { expenses: _x, expenseEvents: _e, ...old } = data;
    const without = money.computeLedger(old as typeof data);
    expect(withField.businessCents).toBe(without.businessCents);
    expect(withField.pendingA).toBe(without.pendingA);
    expect(withField.pendingB).toBe(without.pendingB);
    expect(withField.history).toEqual(without.history);
    expect(cash.cashPosition(data, withField)).toEqual(cash.cashPosition(old as typeof data, without));
  });
});
