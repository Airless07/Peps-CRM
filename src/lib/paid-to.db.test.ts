// Website payments count toward the cash held by whoever receives that payment method (Settings > Payments).
// Proves: Zelle -> Mo by default; refunds take it back from the same holder; business money, payback and the
// split never move; in-person orders unchanged; a Settings change only affects orders paid after it; the
// one-time backfill of orders paid before this existed.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseStore } from "./store/config";
import { receiverOf } from "./store/payments";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));

const dir = mkdtempSync(path.join(tmpdir(), "paid-to-test-"));
const root = path.resolve(import.meta.dirname, "../..");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").split(path.sep).join("/")}`;
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
delete process.env.RESEND_API_KEY;

let prisma: (typeof import("./db"))["prisma"];
let ops: typeof import("./order-ops");
let ser: typeof import("./serialize");
let money: typeof import("./money");
let cash: typeof import("./cash");
let dm: typeof import("./data-migrations");

const STORE = { open: true, siteUrl: "https://shop.test", payments: { zelle: { enabled: true, details: "pay@buckshot.test" }, cashapp: { enabled: true, details: "$bl" } }, qtyDeals: [], alertEmails: [] };
const setStore = (over: Record<string, unknown>) => prisma.settings.update({ where: { id: 1 }, data: { storeJson: JSON.stringify({ ...STORE, ...over }) } });

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("./db"));
  ops = await import("./order-ops");
  ser = await import("./serialize");
  money = await import("./money");
  cash = await import("./cash");
  dm = await import("./data-migrations");
  vi.stubGlobal("fetch", async (url: string | URL | Request) => {
    throw new Error(`Unexpected network call: ${url}`);
  });
  await prisma.settings.create({ data: { id: 1, startingBalanceCents: 0, storeJson: JSON.stringify(STORE) } });
  await prisma.product.create({ data: { id: "ghk", name: "GHK-Cu", variantLabel: "100mg", defaultPriceCents: 5000 } });
  await prisma.purchase.create({ data: { id: "pu", date: new Date("2026-01-01T12:00:00Z"), productId: "ghk", quantity: 500, totalCostCents: 500000, fromInvestment: true } });
}, 120_000);

beforeEach(async () => {
  await prisma.dataMigration.deleteMany();
  await prisma.creditEntry.deleteMany();
  await prisma.orderEvent.deleteMany();
  await prisma.order.deleteMany();
  await setStore({});
});

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let n = 3000;
/** Website order: 2 x $50 + $8 shipping = $108, waiting for payment. */
async function webOrder(payChoice = "zelle") {
  const id = randomUUID();
  await prisma.order.create({
    data: {
      id, number: n++, date: new Date(), placedAt: new Date(), source: "online", status: "awaiting_payment", soldBy: "W", customer: "Kim", email: "kim@example.com",
      shipToJson: "", shippingCents: 800, shippingMethod: "USPS", fulfillment: "ship", payChoice, token: randomUUID(),
      lines: { create: [{ id: randomUUID(), productId: "ghk", productName: "GHK-Cu", quantity: 2, unitPriceCents: 5000, unitCostCents: 0, cutPercent: 10 }] },
    },
  });
  return id;
}
/** In-person sale: 1 x $50, sold by Ahmad. */
async function inPerson(paymentMethod: string, cashTo: "A" | "B" | null) {
  const id = randomUUID();
  await prisma.order.create({
    data: { id, date: new Date(), source: "inperson", status: "completed", soldBy: "A", paymentMethod, cashTo, lines: { create: [{ id: randomUUID(), productId: "ghk", productName: "GHK-Cu", quantity: 1, unitPriceCents: 5000, unitCostCents: 1000, cutPercent: 10 }] } },
  });
  return id;
}
const snap = async () => {
  const data = await ser.loadAll();
  const l = money.computeLedger(data);
  const p = cash.cashPosition(data, l);
  return { A: p.A, B: p.B, bank: p.bank, business: l.businessCents, pendingA: l.pendingA, pendingB: l.pendingB, payback: l.leftToBreakEven, inPayback: l.inPayback };
};
const unchangedMoney = (a: Awaited<ReturnType<typeof snap>>, b: Awaited<ReturnType<typeof snap>>) => {
  expect(b.business).toBe(a.business);
  expect(b.pendingA).toBe(a.pendingA);
  expect(b.pendingB).toBe(a.pendingB);
  expect(b.payback).toBe(a.payback);
  expect(b.inPayback).toBe(a.inPayback);
};

describe("Settings > Payments: who receives each method", () => {
  it("Zelle -> Mo (B) by default; methods without a choice -> Bank", () => {
    const p = parseStore("{}").payments;
    expect(p.zelle.receiver).toBe("B");
    expect(p.cashapp.receiver).toBe("bank");
    expect(receiverOf(p, "Zelle")).toBe("B");
    expect(receiverOf(p, "Cash App")).toBeNull();
    expect(receiverOf(p, "Cash")).toBeNull();
    expect(receiverOf(p, "Unknown")).toBeNull();
    // Settings saved before this existed get the default; a bad value falls back to it.
    expect(parseStore(JSON.stringify({ payments: { zelle: { enabled: true, details: "x" } } })).payments.zelle.receiver).toBe("B");
    expect(parseStore(JSON.stringify({ payments: { zelle: { receiver: "evil" } } })).payments.zelle.receiver).toBe("B");
    expect(parseStore(JSON.stringify({ payments: { venmo: { receiver: "A" } } })).payments.venmo.receiver).toBe("A");
  });
});

describe("online payments count toward the receiver's cash held", () => {
  it("Zelle order paid: Mo's cash +$108, Ahmad unchanged, Bank does not get it; business money = Bank + Ahmad + Mo", async () => {
    const id = await webOrder();
    const before = await snap();
    await ops.markPaid(id, { paymentMethod: "Zelle", notify: false });
    const after = await snap();
    expect((await prisma.order.findUnique({ where: { id } }))!.paidTo).toBe("B");
    expect(after.B - before.B).toBe(10800);
    expect(after.A).toBe(before.A);
    expect(after.bank - before.bank).toBe(after.business - before.business - 10800);
    expect(after.A + after.B + after.bank).toBe(after.business);
  });

  it("business money, payback and the split are the same whoever holds the cash", async () => {
    const id = await webOrder();
    await ops.markPaid(id, { paymentMethod: "Zelle", notify: false });
    const mo = await snap();
    await prisma.order.update({ where: { id }, data: { paidTo: null } });
    const bank = await snap();
    unchangedMoney(mo, bank);
    expect(bank.B).toBe(mo.B - 10800);
    expect(bank.bank).toBe(mo.bank + 10800);
  });

  it("a refund takes the money back from the same holder (Mo)", async () => {
    const id = await webOrder();
    await ops.markPaid(id, { paymentMethod: "Zelle", notify: false });
    const before = await snap();
    await ops.refundOrder(id, { amountCents: 3000, expectedRefundedCents: 0 });
    const after = await snap();
    expect(after.B - before.B).toBe(-3000);
    expect(after.A).toBe(before.A);
    expect(after.A + after.B + after.bank).toBe(after.business);
  });

  it("a method set to Bank (Cash App) stays in Bank", async () => {
    const id = await webOrder("cashapp");
    const before = await snap();
    await ops.markPaid(id, { paymentMethod: "Cash App", notify: false });
    const after = await snap();
    expect((await prisma.order.findUnique({ where: { id } }))!.paidTo).toBeNull();
    expect(after.B).toBe(before.B);
    expect(after.A).toBe(before.A);
  });

  it("changing the setting only affects orders paid after the change", async () => {
    const first = await webOrder();
    await ops.markPaid(first, { paymentMethod: "Zelle", notify: false });
    await setStore({ payments: { ...STORE.payments, zelle: { enabled: true, details: "x", receiver: "A" } } });
    const second = await webOrder();
    await ops.markPaid(second, { paymentMethod: "Zelle", notify: false });
    const rows = await prisma.order.findMany({ where: { id: { in: [first, second] } }, select: { id: true, paidTo: true } });
    expect(rows.find((r) => r.id === first)!.paidTo).toBe("B");
    expect(rows.find((r) => r.id === second)!.paidTo).toBe("A");
    const s = await snap();
    expect(s.A).toBe(10800);
    expect(s.B).toBe(10800);
  });

  it("the timeline says who holds it", async () => {
    const id = await webOrder();
    await ops.markPaid(id, { paymentMethod: "Zelle", notify: false });
    const e = await prisma.orderEvent.findFirst({ where: { orderId: id, message: "Marked paid." } });
    expect(e!.detail).toBe("Zelle · held by Mo");
  });
});

describe("in-person orders keep working exactly as before", () => {
  it("cash -> the partner who received it; Zelle in person -> Bank; the setting changes nothing", async () => {
    await inPerson("Cash", "A");
    await inPerson("Zelle", null);
    const before = await snap();
    expect(before.A).toBe(5000);
    expect(before.B).toBe(0);
    await setStore({ payments: { ...STORE.payments, zelle: { enabled: true, details: "x", receiver: "A" } } });
    expect(await snap()).toEqual(before);
    // Even a stray paidTo on an in-person row is ignored.
    const data = await ser.loadAll();
    expect(data.orders.every((o) => o.source !== "inperson" || !o.paidTo)).toBe(true);
    expect(cash.cashHolderOf({ source: "inperson", paymentMethod: "Zelle", cashTo: null, paidTo: "B" })).toBeNull();
    expect(cash.cashHolderOf({ source: "inperson", paymentMethod: "Cash", cashTo: "A", paidTo: "B" })).toBe("A");
  });
});

describe("one-time backfill of website orders paid before this existed", () => {
  it("moves paid Zelle orders Bank -> Mo once; skips unpaid, canceled and Bank methods; money unchanged", async () => {
    const paid = await webOrder();
    const refunded = await webOrder();
    const unpaid = await webOrder();
    const canceled = await webOrder();
    const cashapp = await webOrder("cashapp");
    for (const id of [paid, refunded]) await ops.markPaid(id, { paymentMethod: "Zelle", notify: false });
    await ops.markPaid(cashapp, { paymentMethod: "Cash App", notify: false });
    await ops.refundOrder(refunded, { amountCents: 2000, expectedRefundedCents: 0 });
    await ops.cancelOrder(canceled, "x", { notify: false });
    // As if paid before the setting existed.
    await prisma.order.updateMany({ data: { paidTo: null } });
    const before = await snap();
    expect(before.B).toBe(0);
    const ledger = money.computeLedger(await ser.loadAll());
    const moved = await dm.backfillPaidTo((id) => ledger.orders.get(id)?.total ?? 0);
    expect(moved!.map((m) => [m.number, m.totalCents, m.from, m.to])).toEqual([
      [(await prisma.order.findUnique({ where: { id: paid } }))!.number, 10800, "bank", "B"],
      [(await prisma.order.findUnique({ where: { id: refunded } }))!.number, 8800, "bank", "B"],
    ]);
    const after = await snap();
    unchangedMoney(before, after);
    expect(after.B).toBe(19600);
    expect(after.bank).toBe(before.bank - 19600);
    for (const id of [unpaid, canceled, cashapp]) expect((await prisma.order.findUnique({ where: { id } }))!.paidTo).toBeNull();
    // Runs once: a holder changed by hand later is never written back.
    await prisma.order.update({ where: { id: paid }, data: { paidTo: "A" } });
    expect(await dm.backfillPaidTo(() => 0)).toBeNull();
    expect((await prisma.order.findUnique({ where: { id: paid } }))!.paidTo).toBe("A");
  });
});
