// Who received the money of each sale (Cash held on the Money page: Ahmad, Mo or Bank).
// Proves: an in-person sale can't be saved without "Money received by" (no default); Zelle to Mo in person
// counts for Mo; online orders go to who Settings > Payments says (Mo by default) and a Settings change only
// affects orders paid after it; refunds take the money back from whoever received it; changing it later
// from the Actions menu is logged; business money, payback, profit and the split never move; the one-time
// fixes for #1012 and website orders paid before this existed.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeSale } from "./saved-orders";
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
let sell: typeof import("./sell-ops");
let schemas: typeof import("./schemas");

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
  sell = await import("./sell-ops");
  schemas = await import("./schemas");
  vi.stubGlobal("fetch", async (url: string | URL | Request) => {
    throw new Error(`Unexpected network call: ${url}`);
  });
  await prisma.settings.create({ data: { id: 1, startingBalanceCents: 0, partnerAName: "Ahmad", partnerBName: "Mo", storeJson: JSON.stringify(STORE) } });
  await prisma.product.create({ data: { id: "ghk", name: "GHK-Cu", variantLabel: "100mg", defaultPriceCents: 5000 } });
  await prisma.purchase.create({ data: { id: "pu", date: new Date("2026-01-01T12:00:00Z"), productId: "ghk", quantity: 500, totalCostCents: 500000, fromInvestment: true } });
}, 120_000);

beforeEach(async () => {
  await prisma.dataMigration.deleteMany();
  await prisma.creditEntry.deleteMany();
  await prisma.orderEvent.deleteMany();
  await prisma.orderLine.deleteMany();
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
/** An in-person sale as the Sell screen posts it: 1 x $50, sold by Mo. */
function saleBody(over: Record<string, unknown> = {}) {
  const id = (over.id as string) ?? randomUUID();
  return schemas.saleInput.parse({
    id, date: new Date().toISOString(), customer: "", customerId: null, paymentMethod: "Zelle", note: "", soldBy: "B", discountType: "$", discountValue: 0, tipCents: 0,
    lines: [{ id: `${id}-l`, productId: "ghk", productName: "GHK-Cu 100mg", quantity: 1, unitPriceCents: 5000, unitCostCents: 1000, cutPercent: 10 }],
    ...over,
  });
}
const recordSale = async (over: Record<string, unknown> = {}) => {
  const { fromSavedId, ...sale } = saleBody(over);
  await sell.recordSale(sale, "https://shop.test", fromSavedId);
  return sale.id;
};
const snap = async () => {
  const data = await ser.loadAll();
  const l = money.computeLedger(data);
  const p = cash.cashPosition(data, l);
  const profit = [...l.orders.values()].reduce((x, o) => x + o.profit, 0);
  return { A: p.A, B: p.B, bank: p.bank, business: l.businessCents, pendingA: l.pendingA, pendingB: l.pendingB, payback: l.leftToBreakEven, inPayback: l.inPayback, profit };
};
type Snap = Awaited<ReturnType<typeof snap>>;
const unchangedMoney = (a: Snap, b: Snap) => {
  expect(b.business).toBe(a.business);
  expect(b.pendingA).toBe(a.pendingA);
  expect(b.pendingB).toBe(a.pendingB);
  expect(b.payback).toBe(a.payback);
  expect(b.inPayback).toBe(a.inPayback);
  expect(b.profit).toBe(a.profit);
};

describe("in-person sales: Money received by is required, any payment method", () => {
  it("can't be saved without a choice: the server refuses it and nothing is recorded", async () => {
    const before = await snap();
    await expect(recordSale({ cashTo: null })).rejects.toThrow(/Pick who received the money/);
    await expect(recordSale({ cashTo: undefined })).rejects.toThrow(/Pick who received the money/);
    expect(await prisma.order.count()).toBe(0);
    expect(await snap()).toEqual(before);
    // An unknown value is refused by the schema.
    expect(() => saleBody({ cashTo: "C" })).toThrow();
  });

  it("is never defaulted from the seller or the payment method (cart and saved order)", () => {
    const draft = { id: "d", date: "", customer: "", customerId: null, paymentMethod: "Cash", note: "", soldBy: "A" as const, discountType: "$" as const, discountValue: 0, tipCents: 0, lines: [] };
    const ctx = { customers: [], unitCost: () => 0, cutPercent: 10 };
    expect(finalizeSale(draft, ctx).final.cashTo).toBeNull();
    expect(finalizeSale({ ...draft, cashTo: "bank" }, ctx).final.cashTo).toBe("bank");
    expect(finalizeSale({ ...draft, paymentMethod: "Zelle", cashTo: "B" }, ctx).final.cashTo).toBe("B");
  });

  it("Zelle to Mo counts for Mo, cash to Ahmad for Ahmad, Bank for the bank; the money is the same whoever has it", async () => {
    const mo = await recordSale({ paymentMethod: "Zelle", cashTo: "B" });
    await recordSale({ paymentMethod: "Cash", cashTo: "A" });
    await recordSale({ paymentMethod: "Zelle", cashTo: "bank" });
    const s = await snap();
    expect(s).toMatchObject({ A: 5000, B: 5000 });
    expect(s.A + s.B + s.bank).toBe(s.business);
    expect((await prisma.order.findUnique({ where: { id: mo } }))!.cashTo).toBe("B");
    // Same sales, all to the bank: only the holders differ.
    await prisma.order.updateMany({ data: { cashTo: "bank" } });
    const bank = await snap();
    unchangedMoney(s, bank);
    expect(bank).toMatchObject({ A: 0, B: 0, bank: s.bank + 10000 });
  });

  it("editing a sale keeps who received the money (any method)", async () => {
    const id = await recordSale({ paymentMethod: "Zelle", cashTo: "B" });
    const row = await ser.loadAll();
    const o = row.orders.find((x) => x.id === id)!;
    const { lines, ...rest } = schemas.orderInput.parse({ ...o, date: o.date, lines: o.lines, note: "edited" });
    expect(sell.cleanSale({ ...rest, lines }).cashTo).toBe("B");
  });

  it("older sales with nothing recorded stay in the bank", async () => {
    await prisma.order.create({ data: { id: "old", date: new Date(), source: "inperson", status: "completed", soldBy: "B", paymentMethod: "Zelle", cashTo: null, lines: { create: [{ id: "old-l", productId: "ghk", productName: "GHK-Cu", quantity: 1, unitPriceCents: 5000, unitCostCents: 1000, cutPercent: 10 }] } } });
    expect(await snap()).toMatchObject({ A: 0, B: 0 });
    expect(cash.moneyHolderOf({ source: "inperson", cashTo: null })).toBe("bank");
    // A stray paidTo on an in-person row is ignored.
    expect(cash.cashHolderOf({ source: "inperson", cashTo: null, paidTo: "B" })).toBeNull();
  });
});

describe("Settings > Payments: Online order payments go to", () => {
  it("Mo by default; older settings keep their Zelle choice; a bad value falls back to Mo", () => {
    expect(parseStore("{}").onlineReceiver).toBe("B");
    expect(receiverOf(parseStore("{}"))).toBe("B");
    expect(parseStore(JSON.stringify({ payments: { zelle: { enabled: true, details: "x", receiver: "A" } } })).onlineReceiver).toBe("A");
    expect(parseStore(JSON.stringify({ onlineReceiver: "evil" })).onlineReceiver).toBe("B");
    expect(parseStore(JSON.stringify({ onlineReceiver: "bank" })).onlineReceiver).toBe("bank");
    expect(receiverOf({ onlineReceiver: "bank" })).toBeNull();
    // The old per-method choice is gone from saved settings.
    expect("receiver" in parseStore(JSON.stringify({ payments: { zelle: { receiver: "A" } } })).payments.zelle).toBe(false);
  });
});

describe("online orders: credited to who receives online payments", () => {
  it("a paid order goes to Mo (whatever the method); Ahmad and Bank don't get it", async () => {
    const zelle = await webOrder();
    const cashapp = await webOrder("cashapp");
    const before = await snap();
    await ops.markPaid(zelle, { paymentMethod: "Zelle", notify: false });
    await ops.markPaid(cashapp, { paymentMethod: "Cash App", notify: false });
    const after = await snap();
    const rows = await prisma.order.findMany({ where: { id: { in: [zelle, cashapp] } }, select: { paidTo: true } });
    expect(rows.map((r) => r.paidTo)).toEqual(["B", "B"]);
    expect(after.B - before.B).toBe(21600);
    expect(after.A).toBe(before.A);
    expect(after.bank - before.bank).toBe(after.business - before.business - 21600);
    expect(after.A + after.B + after.bank).toBe(after.business);
  });

  it("changing the setting only affects orders paid after the change (Mo -> Bank -> Ahmad)", async () => {
    const first = await webOrder();
    await ops.markPaid(first, { paymentMethod: "Zelle", notify: false });
    const pending = await webOrder(); // placed before the change, paid after it
    await setStore({ onlineReceiver: "bank" });
    await ops.markPaid(pending, { paymentMethod: "Zelle", notify: false });
    await setStore({ onlineReceiver: "A" });
    const third = await webOrder();
    await ops.markPaid(third, { paymentMethod: "Zelle", notify: false });
    const paidTo = async (id: string) => (await prisma.order.findUnique({ where: { id } }))!.paidTo;
    expect(await paidTo(first)).toBe("B");
    expect(await paidTo(pending)).toBeNull();
    expect(await paidTo(third)).toBe("A");
    expect(await snap()).toMatchObject({ A: 10800, B: 10800 });
  });

  it("the timeline says who received it", async () => {
    const id = await webOrder();
    await ops.markPaid(id, { paymentMethod: "Zelle", notify: false });
    const e = await prisma.orderEvent.findFirst({ where: { orderId: id, message: "Marked paid." } });
    expect(e!.detail).toBe("Zelle · held by Mo");
  });
});

describe("refunds take the money back from whoever received it", () => {
  it("online order to Mo: Mo -$30; Ahmad and Bank unchanged", async () => {
    const id = await webOrder();
    await ops.markPaid(id, { paymentMethod: "Zelle", notify: false });
    const before = await snap();
    await ops.refundOrder(id, { amountCents: 3000, expectedRefundedCents: 0 });
    const after = await snap();
    expect(after.B - before.B).toBe(-3000);
    expect(after.A).toBe(before.A);
    expect(after.bank - before.bank).toBe(after.business - before.business + 3000);
  });

  it("in-person sales: from Ahmad, from Mo, from the bank", async () => {
    const a = await recordSale({ paymentMethod: "Cash", cashTo: "A" });
    const b = await recordSale({ paymentMethod: "Zelle", cashTo: "B" });
    const k = await recordSale({ paymentMethod: "Zelle", cashTo: "bank" });
    for (const [id, who] of [[a, "A"], [b, "B"], [k, "bank"]] as const) {
      const before = await snap();
      await ops.refundOrder(id, { amountCents: 1000, expectedRefundedCents: 0 });
      const after = await snap();
      expect(after.business - before.business).toBe(-1000);
      for (const h of ["A", "B", "bank"] as const) expect(after[h] - before[h]).toBe(h === who ? -1000 : 0);
    }
  });
});

describe("change it later from the order's Actions menu", () => {
  it("in person: moves Cash held only, and the order history says so", async () => {
    const id = await recordSale({ paymentMethod: "Zelle", cashTo: "bank" });
    const before = await snap();
    const r = await ops.setMoneyTo(id, "B");
    expect(r).toEqual({ changed: true, message: "Money received by: Mo." });
    const after = await snap();
    unchangedMoney(before, after);
    expect(after.B - before.B).toBe(5000);
    expect(after.bank - before.bank).toBe(-5000);
    const e = await prisma.orderEvent.findFirst({ where: { orderId: id, message: { startsWith: "Money received by" } } });
    expect(e!.message).toBe("Money received by changed: Bank → Mo.");
    // Same choice again: nothing changes, nothing logged.
    expect((await ops.setMoneyTo(id, "B")).changed).toBe(false);
    expect(await prisma.orderEvent.count({ where: { orderId: id } })).toBe(1);
  });

  it("an older sale with nothing recorded says so in the history", async () => {
    await prisma.order.create({ data: { id: "old2", date: new Date(), source: "inperson", status: "completed", soldBy: "B", paymentMethod: "Zelle", cashTo: null, lines: { create: [{ id: "old2-l", productId: "ghk", productName: "GHK-Cu", quantity: 1, unitPriceCents: 5000, unitCostCents: 1000, cutPercent: 10 }] } } });
    await ops.setMoneyTo("old2", "A");
    expect((await prisma.orderEvent.findFirst({ where: { orderId: "old2" } }))!.message).toBe("Money received by changed: Not recorded → Ahmad.");
  });

  it("website order: only once paid; Bank is saved as no partner", async () => {
    const id = await webOrder();
    await expect(ops.setMoneyTo(id, "A")).rejects.toThrow(/Mark it paid first/);
    await ops.markPaid(id, { paymentMethod: "Zelle", notify: false });
    const before = await snap();
    await ops.setMoneyTo(id, "bank");
    expect((await prisma.order.findUnique({ where: { id } }))!.paidTo).toBeNull();
    const after = await snap();
    unchangedMoney(before, after);
    expect(after.B - before.B).toBe(-10800);
    expect(after.bank - before.bank).toBe(10800);
  });
});

describe("one-time fix: sale #1012 (in person, Zelle to Mo) -> Mo", () => {
  async function make1012(over: { paymentMethod?: string; cashTo?: string | null } = {}) {
    await prisma.order.create({
      data: {
        id: "o1012", number: 1012, date: new Date(), source: "inperson", status: "completed", soldBy: "B", paymentMethod: over.paymentMethod ?? "Zelle", cashTo: over.cashTo ?? null, discountType: "$", discountValue: 1700,
        lines: { create: [{ id: "o1012-l", productId: "ghk", productName: "GHK-Cu", quantity: 1, unitPriceCents: 9000, unitCostCents: 2000, cutPercent: 10 }] },
      },
    });
  }

  it("moves its $73 Bank -> Mo once, logged; business money, payback, profit and split unchanged", async () => {
    await make1012();
    const before = await snap();
    expect(await dm.moveSale1012ToMo()).toEqual({ moved: true, why: "#1012 Zelle: Bank -> Mo" });
    const after = await snap();
    unchangedMoney(before, after);
    expect(after.B - before.B).toBe(7300);
    expect(after.bank - before.bank).toBe(-7300);
    expect((await prisma.orderEvent.findFirst({ where: { orderId: "o1012" } }))!.message).toBe("Money received by changed: Not recorded → Mo.");
    // Runs once: changed by hand later, never written back.
    await prisma.order.update({ where: { id: "o1012" }, data: { cashTo: "bank" } });
    expect(await dm.moveSale1012ToMo()).toBeNull();
    expect((await prisma.order.findUnique({ where: { id: "o1012" } }))!.cashTo).toBe("bank");
  });

  it("leaves it alone if it is not the Zelle sale we expect", async () => {
    await make1012({ paymentMethod: "Cash", cashTo: "A" });
    expect(await dm.moveSale1012ToMo()).toMatchObject({ moved: false });
    expect((await prisma.order.findUnique({ where: { id: "o1012" } }))!.cashTo).toBe("A");
  });
});

describe("one-time backfill of website orders paid before this existed", () => {
  it("moves paid orders Bank -> the online receiver once; skips unpaid and canceled; money unchanged", async () => {
    const paid = await webOrder();
    const refunded = await webOrder();
    const unpaid = await webOrder();
    const canceled = await webOrder();
    for (const id of [paid, refunded]) await ops.markPaid(id, { paymentMethod: "Zelle", notify: false });
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
    for (const id of [unpaid, canceled]) expect((await prisma.order.findUnique({ where: { id } }))!.paidTo).toBeNull();
    await prisma.order.update({ where: { id: paid }, data: { paidTo: "A" } });
    expect(await dm.backfillPaidTo(() => 0)).toBeNull();
    expect((await prisma.order.findUnique({ where: { id: paid } }))!.paidTo).toBe("A");
  });
});
