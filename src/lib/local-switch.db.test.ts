// Switch a shipped order to local pickup / delivery from the admin, and the local status emails.
// Proves: only offered with no label; money for each difference option (store credit, refund owed, keep,
// unpaid lower); the order leaves the ship queue and shows in Local; every email sends once.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { switchBlocker, switchQuote } from "./local/rules";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));

const dir = mkdtempSync(path.join(tmpdir(), "local-switch-test-"));
const root = path.resolve(import.meta.dirname, "../..");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").split(path.sep).join("/")}`;
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.RESEND_API_KEY = "re_test_key";

let prisma: (typeof import("./db"))["prisma"];
let ops: typeof import("./order-ops");
let ser: typeof import("./serialize");
let money: typeof import("./money");
let counts: typeof import("./admin/counts");
let creditOps: typeof import("./credit-ops");

const sent: { to: string[]; subject: string; html: string; text: string }[] = [];
const ORIGIN = "http://localhost:3000";
const SPOT = { name: "Target parking lot", street1: "123 Spot Rd", city: "Dearborn Heights", state: "MI", zip: "48127", instructions: "Park by the cart return." };
const LOCAL = { homeZip: "48127", radiusMiles: 15, pickup: { enabled: true, ...SPOT }, delivery: { enabled: true, feeCents: 200, freeOverCents: null }, payAtPickup: false, windows: [] };
const STORE = { open: true, siteUrl: "https://shop.test", payments: { zelle: { enabled: true, details: "pay@buckshot.test" } }, qtyDeals: [], alertEmails: [], local: LOCAL };
const setStore = (over: Record<string, unknown>) => prisma.settings.update({ where: { id: 1 }, data: { storeJson: JSON.stringify({ ...STORE, ...over }) } });
const ADDR = { name: "Kassem Test", street1: "1 Main St", street2: "", city: "Dearborn", state: "MI", zip: "48126", country: "US" };

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("./db"));
  ops = await import("./order-ops");
  ser = await import("./serialize");
  money = await import("./money");
  counts = await import("./admin/counts");
  creditOps = await import("./credit-ops");
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith("https://api.resend.com/")) {
      const b = JSON.parse(String(init?.body));
      sent.push({ to: b.to, subject: b.subject, html: b.html, text: b.text });
      return new Response(JSON.stringify({ id: `email-${sent.length}` }), { status: 200 });
    }
    throw new Error(`Unexpected network call: ${url}`);
  });
  await prisma.settings.create({ data: { id: 1, startingBalanceCents: 0, storeJson: JSON.stringify(STORE) } });
  await prisma.listing.create({ data: { id: "l-ghk", name: "GHK-Cu", slug: "ghk-cu", showOnWebsite: true } });
  await prisma.product.create({ data: { id: "ghk", name: "GHK-Cu", variantLabel: "100mg", defaultPriceCents: 5000, listingId: "l-ghk" } });
  await prisma.purchase.create({ data: { id: "pu", date: new Date("2026-01-01T12:00:00Z"), productId: "ghk", quantity: 500, totalCostCents: 500000, fromInvestment: true } });
}, 120_000);

beforeEach(async () => {
  sent.length = 0;
  await prisma.creditEntry.deleteMany();
  await prisma.orderEvent.deleteMany();
  await prisma.labelPurchase.deleteMany();
  await prisma.order.deleteMany();
  await prisma.customer.deleteMany();
  await setStore({});
  await prisma.customer.create({ data: { id: "kim", name: "Kassem Test", email: "kim@example.com", referralCode: "KIMP4444" } });
});

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let nextNumber = 2000;
/** A website order shipped by USPS: 2 x $50 + $8.00 shipping. Paid (default) or still unpaid. */
async function shippedOrder(opts: { paid?: boolean; shippingCents?: number; customer?: boolean } = {}) {
  const id = randomUUID();
  await prisma.order.create({
    data: {
      id,
      number: nextNumber++,
      date: new Date(),
      placedAt: new Date(),
      source: "online",
      status: "awaiting_payment",
      soldBy: "W",
      customer: "Kassem Test",
      customerId: opts.customer === false ? null : "kim",
      email: "kim@example.com",
      phone: "313-555-0100",
      shipToJson: JSON.stringify(ADDR),
      shippingCents: opts.shippingCents ?? 800,
      shippingMethod: "USPS Ground Advantage",
      shippingTier: "standard",
      fulfillment: "ship",
      payChoice: "zelle",
      token: randomUUID(),
      lines: { create: [{ id: randomUUID(), productId: "ghk", productName: "GHK-Cu", quantity: 2, unitPriceCents: 5000, unitCostCents: 0, cutPercent: 10 }] },
    },
  });
  if (opts.paid !== false) await ops.markPaid(id, { paymentMethod: "Zelle", notify: false });
  sent.length = 0;
  return id;
}

const row = async (id: string) => (await prisma.order.findUnique({ where: { id } }))!;
const rec = async (id: string) => {
  const d = await ser.loadAll();
  return [...d.orders, ...d.pendingOrders].find((o) => o.id === id)!;
};
const events = async (id: string) => (await prisma.orderEvent.findMany({ where: { orderId: id }, orderBy: { at: "asc" } })).map((e) => `${e.message}${e.detail ? ` | ${e.detail}` : ""}`);
const snapshot = async (id: string) => {
  const data = await ser.loadAll();
  const l = money.computeLedger(data);
  const o = l.orders.get(id);
  return { business: l.businessCents, shipping: l.shippingCollected, a: o?.a ?? 0, b: o?.b ?? 0, orderTotal: o?.total ?? null, credit: await creditOps.creditBalance(prisma, "kim"), stock: l.stock.get("ghk")?.stock };
};
const sw = (id: string, over: Partial<Parameters<(typeof ops)["switchToLocal"]>[1]> = {}) =>
  ops.switchToLocal(id, { to: "delivery", handling: "credit", notify: true, by: "Ahmad", expectedShippingCents: 800, ...over }, { origin: ORIGIN });

// ---------------------------------------------------------------- When it is offered
describe("switch is only offered on shipped-type orders with no label", () => {
  const base = { number: 1010, source: "online", fulfillment: "ship", status: "paid", labelUrl: "", labelLockAt: null, labels: 0, refundedCents: 0 };
  it("paid or unpaid, no label: offered", () => {
    expect(switchBlocker(base)).toBeNull();
    expect(switchBlocker({ ...base, status: "awaiting_payment" })).toBeNull();
  });
  it("hidden once a label exists (label URL, label row, or a purchase in progress)", () => {
    expect(switchBlocker({ ...base, labelUrl: "https://label.pdf" })).toMatch(/label was already bought/);
    expect(switchBlocker({ ...base, labels: 1 })).toMatch(/label was already bought/);
    expect(switchBlocker({ ...base, labelLockAt: new Date() })).toMatch(/label was already bought/);
    expect(switchBlocker({ ...base, status: "label_purchased" })).toMatch(/can't be switched/);
  });
  it("hidden on canceled, refunded, shipped, delivered, local and in-person orders", () => {
    expect(switchBlocker({ ...base, status: "canceled" })).toMatch(/canceled/);
    expect(switchBlocker({ ...base, refundedCents: 100 })).toMatch(/refund/);
    expect(switchBlocker({ ...base, status: "shipped" })).toMatch(/can't be switched/);
    expect(switchBlocker({ ...base, status: "delivered" })).toMatch(/can't be switched/);
    expect(switchBlocker({ ...base, fulfillment: "delivery" })).toMatch(/already a local/);
    expect(switchBlocker({ ...base, source: "inperson" })).toMatch(/Only website orders/);
  });
  it("fee: delivery from settings (free-over respected), pickup free, never more than charged", () => {
    expect(switchQuote(LOCAL, { shippingCents: 800, merchandiseCents: 10000 }, "delivery")).toEqual({ feeCents: 200, diffCents: 600 });
    expect(switchQuote(LOCAL, { shippingCents: 800, merchandiseCents: 10000 }, "pickup")).toEqual({ feeCents: 0, diffCents: 800 });
    expect(switchQuote({ delivery: { ...LOCAL.delivery, freeOverCents: 5000 } }, { shippingCents: 800, merchandiseCents: 10000 }, "delivery")).toEqual({ feeCents: 0, diffCents: 800 });
    // Free shipping order: local fee is waived, nothing is added.
    expect(switchQuote(LOCAL, { shippingCents: 0, merchandiseCents: 10000 }, "delivery")).toEqual({ feeCents: 0, diffCents: 0 });
  });
  it("the server refuses when a label row exists, even if the screen was stale", async () => {
    const id = await shippedOrder();
    await prisma.labelPurchase.create({ data: { id: randomUUID(), orderId: id, date: new Date(), costCents: 549 } });
    await expect(sw(id)).rejects.toThrow(/label was already bought/);
    expect((await row(id)).fulfillment).toBe("ship");
  });
  it("refused for canceled and already-shipped orders", async () => {
    const c = await shippedOrder({ paid: false });
    await ops.cancelOrder(c, "test", { notify: false });
    await expect(sw(c)).rejects.toThrow(/canceled/);
    const s = await shippedOrder();
    await ops.markShipped(s, { trackingNumber: "9400", carrier: "usps" });
    await expect(sw(s)).rejects.toThrow(/can't be switched/);
  });
});

// ---------------------------------------------------------------- Money for each option
describe("totals and money for each difference option", () => {
  it("store credit: $6 credit added once; business money, split, stock unchanged; total stays what was paid", async () => {
    const id = await shippedOrder();
    const before = await snapshot(id);
    expect(before).toMatchObject({ orderTotal: 10800, credit: 0 });
    await sw(id, { handling: "credit" });
    const after = await snapshot(id);
    expect(after.credit).toBe(600);
    expect(after.business).toBe(before.business);
    expect(after.a).toBe(before.a);
    expect(after.b).toBe(before.b);
    expect(after.stock).toBe(before.stock);
    expect(after.orderTotal).toBe(10800);
    const o = await row(id);
    expect(o).toMatchObject({ fulfillment: "delivery", shippingCents: 800, shippingMethod: "Local delivery", shippingTier: "" });
    const entries = await prisma.creditEntry.findMany({ where: { customerId: "kim" } });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ amountCents: 600, kind: "manual", orderId: id, by: "Ahmad" });
    // A later order sync (edit, refund...) never undoes the manual credit.
    await prisma.$transaction((tx) => creditOps.syncOrderCredit(tx, id, { by: "Admin" }));
    expect(await creditOps.creditBalance(prisma, "kim")).toBe(600);
    // The difference given as credit can't also be refunded in cash.
    await expect(ops.refundOrder(id, { amountCents: 10800, expectedRefundedCents: 0 })).rejects.toThrow(/At most \$102\.00/);
  });

  it("refund owed: shipping drops to the $2 fee, business money -$6, split unchanged; paid back once", async () => {
    const id = await shippedOrder();
    const before = await snapshot(id);
    await sw(id, { handling: "refund_owed" });
    const after = await snapshot(id);
    expect(after.business).toBe(before.business - 600);
    expect(after.shipping).toBe(before.shipping - 600);
    expect(after.a).toBe(before.a);
    expect(after.b).toBe(before.b);
    expect(after.credit).toBe(0);
    expect(after.orderTotal).toBe(10200);
    const r = await rec(id);
    expect(r.localSwitch).toMatchObject({ handling: "refund_owed", refundOwedCents: 600, refundPaidAt: null, diffCents: 600, feeCents: 200 });
    await ops.markSwitchRefundPaid(id, "Mo");
    await expect(ops.markSwitchRefundPaid(id, "Mo")).rejects.toThrow(/already marked paid back/);
    expect((await rec(id)).localSwitch?.refundPaidAt).toBeTruthy();
    expect((await snapshot(id)).business).toBe(after.business);
  });

  it("keep: nothing changes in money or credit", async () => {
    const id = await shippedOrder();
    const before = await snapshot(id);
    await sw(id, { handling: "keep", to: "pickup" });
    const after = await snapshot(id);
    expect(after).toEqual(before);
    expect(await row(id)).toMatchObject({ fulfillment: "pickup", shippingCents: 800 });
    expect((await rec(id)).localSpot).toMatchObject({ name: "Target parking lot" });
  });

  it("unpaid order: the total to pay drops (no credit or refund), and it still counts nowhere until paid", async () => {
    const id = await shippedOrder({ paid: false });
    await sw(id, { handling: "credit" });
    const o = await rec(id);
    expect(o.localSwitch?.handling).toBe("lower");
    expect(money.orderTotals(o).total).toBe(10200);
    expect(await creditOps.creditBalance(prisma, "kim")).toBe(0);
    await ops.markPaid(id, { paymentMethod: "Zelle", notify: false });
    expect((await snapshot(id)).orderTotal).toBe(10200);
  });

  it("history logs who, when, old vs new method and amounts", async () => {
    const id = await shippedOrder();
    await sw(id, { handling: "credit", note: "Dropping it off myself" });
    const log = (await events(id)).find((e) => e.startsWith("Switched"))!;
    expect(log).toContain("Switched from shipping to local delivery by Ahmad.");
    expect(log).toContain("Was: USPS Ground Advantage, $8.00.");
    expect(log).toContain("Now: Local delivery, local fee $2.00 (order keeps $8.00 charged).");
    expect(log).toContain("Difference $6.00: refunded as store credit.");
    expect(log).toContain("Note: Dropping it off myself");
    const at = (await rec(id)).localSwitch!.at;
    expect(Date.now() - new Date(at).getTime()).toBeLessThan(60_000);
  });

  it("a double click or a stale dialog switches once", async () => {
    const id = await shippedOrder();
    const r = await Promise.allSettled([sw(id), sw(id)]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await creditOps.creditBalance(prisma, "kim")).toBe(600);
    await expect(sw(id)).rejects.toThrow(/already a local/);
  });

  it("store credit needs a linked customer", async () => {
    const id = await shippedOrder({ paid: false, customer: false });
    await prisma.order.update({ where: { id }, data: { status: "paid", paidAt: new Date() } });
    await expect(sw(id, { handling: "credit" })).rejects.toThrow(/no customer linked/);
  });
});

// ---------------------------------------------------------------- Queues
describe("the order leaves the ship queue and appears in Local", () => {
  it("ready to ship before, open local after; Buy label refused", async () => {
    const id = await shippedOrder();
    expect(counts.isReadyToShip(await rec(id))).toBe(true);
    await sw(id);
    const o = await rec(id);
    expect(counts.isReadyToShip(o)).toBe(false);
    expect(counts.isOpenLocal(o)).toBe(true);
    await expect(ops.buyLabel(id)).rejects.toThrow(/Local orders never need a shipping label/);
    await expect(ops.labelRates(id)).rejects.toThrow(/Local orders never need a shipping label/);
  });
});

// ---------------------------------------------------------------- Emails
describe("customer emails, each once", () => {
  it("switched email: items, address, store credit refunded, support email", async () => {
    const id = await shippedOrder();
    await sw(id, { handling: "credit" });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe(`Your order #${(await row(id)).number} will be delivered locally`);
    expect(sent[0].text).toMatch(/GHK-Cu.* × 2: \$100\.00/);
    expect(sent[0].text).toContain("1 Main St");
    expect(sent[0].text).toContain("Store credit added to your account: $6.00");
    expect(sent[0].text).toContain("Local delivery: $2.00");
    expect(sent[0].text).toContain("support@buckshotlabs.com");
    expect((await events(id)).some((e) => e.startsWith("Switched to local email: Sent"))).toBe(true);
  });
  it("switched to pickup: pickup spot; no email when the box is off", async () => {
    const a = await shippedOrder();
    await sw(a, { to: "pickup", handling: "keep" });
    expect(sent[0].subject).toMatch(/is set for local pickup$/);
    expect(sent[0].text).toContain("Target parking lot");
    sent.length = 0;
    const b = await shippedOrder();
    await sw(b, { notify: false });
    expect(sent).toHaveLength(0);
  });

  it("mark ready (delivery): out for delivery soon, with the editable line; once", async () => {
    await setStore({ deliveryReadyLine: "Expect it tomorrow evening." });
    const id = await shippedOrder();
    await sw(id, { notify: false });
    await ops.markReady(id, { origin: ORIGIN });
    await expect(ops.markReady(id, { origin: ORIGIN })).rejects.toThrow(/already marked ready/);
    expect(sent).toHaveLength(1);
    const n = (await row(id)).number;
    expect(sent[0].subject).toBe(`Your order #${n} is out for delivery soon`);
    expect(sent[0].text).toContain("Expect it tomorrow evening.");
    expect(sent[0].text).toContain("support@buckshotlabs.com");
    expect(sent[0].text).toContain("1 Main St");
    expect((await events(id)).filter((e) => e.startsWith("Out for delivery email"))).toEqual([expect.stringMatching(/^Out for delivery email: Sent/)]);
  });
  it("default delivery line is the 1 to 2 days sentence", async () => {
    const id = await shippedOrder();
    await sw(id, { notify: false });
    await ops.markReady(id, { origin: ORIGIN });
    expect(sent[0].text).toContain("We'll deliver it within the next 1 to 2 days.");
  });
  it("mark ready (pickup): ready for pickup with the spot and instructions; once", async () => {
    const id = await shippedOrder();
    await sw(id, { to: "pickup", handling: "keep", notify: false });
    await Promise.allSettled([ops.markReady(id, { origin: ORIGIN }), ops.markReady(id, { origin: ORIGIN })]);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe(`Your order #${(await row(id)).number} is ready for pickup`);
    expect(sent[0].text).toContain("Target parking lot");
    expect(sent[0].text).toContain("Park by the cart return.");
    expect(sent[0].text).toContain("support@buckshotlabs.com");
  });
  it("delivered and picked up: once each", async () => {
    const d = await shippedOrder();
    const p = await shippedOrder();
    await sw(d, { notify: false });
    await ops.markReady(d, { notify: false });
    await Promise.all([ops.markHandedOver(d), ops.markHandedOver(d)]);
    await sw(p, { to: "pickup", handling: "keep", notify: false });
    await ops.markHandedOver(p);
    await ops.markHandedOver(p);
    expect(sent.map((m) => m.subject)).toEqual([`Your order #${(await row(d)).number} was delivered`, `Your order #${(await row(p)).number} was picked up`]);
  });
  it("each toggle off in Settings, Email: nothing sent, the timeline says why", async () => {
    await setStore({ handoverEmails: { readyDelivery: false, readyPickup: false, delivered: false, pickedUp: false, switched: false } });
    const d = await shippedOrder();
    await sw(d);
    await ops.markReady(d);
    await ops.markHandedOver(d);
    expect(sent).toHaveLength(0);
    const log = await events(d);
    expect(log).toContain("Switched to local email: Not sent: turned off in Settings, Email.");
    expect(log).toContain("Out for delivery email: Not sent: turned off in Settings, Email.");
    expect(log).toContain("Delivered email: Not sent: turned off in Settings, Email.");
  });
  it("a failed send is written to the timeline", async () => {
    const id = await shippedOrder();
    await sw(id, { notify: false });
    const prev = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      await ops.markReady(id);
    } finally {
      process.env.RESEND_API_KEY = prev;
    }
    expect((await events(id)).some((e) => e.startsWith("Out for delivery email: Not sent: RESEND_API_KEY is not set"))).toBe(true);
  });
});
