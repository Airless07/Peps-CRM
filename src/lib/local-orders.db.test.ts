// Local pickup and delivery proof: ZIP radius detection (bundled Census data), checkout options, server-side
// re-checks, fees in cents, pay at pickup, privacy of the pickup spot, statuses, Shippo skipping and money.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { deliveryFeeCents, localOffer } from "./local/rules";
import { isLocalZip, localArea, milesBetween, zipInfo } from "./local/zips";
import { cleanLocal, DEFAULT_STORE } from "./store/config";

const jar = vi.hoisted(() => {
  const m = new Map<string, string>();
  return { m, get: (k: string) => (m.has(k) ? { name: k, value: m.get(k)! } : undefined), set: (k: string, v: string) => void (v ? m.set(k, v) : m.delete(k)) };
});
vi.mock("next/headers", () => ({ cookies: async () => jar }));

const dir = mkdtempSync(path.join(tmpdir(), "local-test-"));
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

const sent: { to: string[]; subject: string; html: string }[] = [];
const ORIGIN = "http://localhost:3000";
const SPOT = { name: "Target parking lot", street1: "123 Secret Spot Rd", city: "Dearborn Heights", state: "MI", zip: "48127", instructions: "Park by the cart return." };
const LOCAL = {
  homeZip: "48127",
  radiusMiles: 15,
  pickup: { enabled: true, ...SPOT },
  delivery: { enabled: true, feeCents: 200, freeOverCents: 15000 },
  payAtPickup: true,
  windows: ["Weekdays 5–9pm", "Sat–Sun 12–6pm"],
};
const STORE = { open: true, siteUrl: "https://shop.test", payments: { zelle: { enabled: true, details: "pay@buckshot.test" } }, qtyDeals: [], alertEmails: [], local: LOCAL };
const setStore = (over: Record<string, unknown>) => prisma.settings.update({ where: { id: 1 }, data: { storeJson: JSON.stringify({ ...STORE, ...over }) } });

const dearborn = { name: "Kim Park", street1: "500 Michigan Ave", street2: "", city: "Dearborn", state: "MI", zip: "48124", country: "US" };
const beverlyHills = { name: "Kim Park", street1: "1 Rodeo Dr", street2: "", city: "Beverly Hills", state: "CA", zip: "90210", country: "US" };

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
      sent.push({ to: b.to, subject: b.subject, html: b.html });
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
  jar.m.clear();
  await prisma.creditEntry.deleteMany();
  await prisma.promotionUse.deleteMany();
  await prisma.promotion.deleteMany();
  await prisma.orderEvent.deleteMany();
  await prisma.labelPurchase.deleteMany();
  await prisma.order.deleteMany();
  await prisma.customer.deleteMany();
  await setStore({});
  await prisma.customer.createMany({
    data: [
      { id: "kim", name: "Kim Park", email: "kim@example.com", referralCode: "KIMP4444", passwordHash: "x" },
      { id: "sam", name: "Sam Lee", email: "sam@example.com", referralCode: "SAMM3333", passwordHash: "x" },
    ],
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

type Checkout = Parameters<(typeof ops)["placeOrder"]>[0];
/** Kim, 2 x $50, local pickup in Dearborn, paying by Zelle. */
const checkout = (over: Partial<Checkout> = {}) =>
  ops.placeOrder({ customerId: "kim", name: "Kim Park", email: "kim@example.com", phone: "313-555-0100", shipTo: dearborn, items: [{ variantId: "ghk", quantity: 2 }], code: "", tier: "", fulfillment: "pickup", localTime: "Weekdays 5–9pm", localNotes: "Blue car", payChoice: "zelle", expectedTotalCents: 10000, origin: ORIGIN, ...over });
const order = async (id: string) => (await prisma.order.findUnique({ where: { id }, include: { lines: true } }))!;
const paid = (id: string) => ops.markPaid(id, { paymentMethod: "Zelle", notify: false });
const quote = async (shipTo: typeof dearborn, items = [{ variantId: "ghk", quantity: 2 }]) => ops.quoteCheckout(await ser.loadAll(), { items, code: "", email: "kim@example.com", shipTo });

// ---------------------------------------------------------------- ZIP detection
describe("local detection (bundled Census ZIP data, haversine)", () => {
  const local = { homeZip: "48127", radiusMiles: 15 };

  it("Dearborn (48124) is local to 48127; Beverly Hills (90210) is not", () => {
    expect(zipInfo("48127")).toMatchObject({ town: "Dearborn Heights", state: "MI" });
    expect(milesBetween(zipInfo("48127")!, zipInfo("48124")!)).toBeLessThan(5);
    expect(isLocalZip(local, "48124")).toBe(true);
    expect(isLocalZip(local, "48124-1234")).toBe(true);
    expect(isLocalZip(local, "90210")).toBe(false);
  });

  it("the radius edge: a ZIP exactly at the edge is in, a hair less radius leaves it out", () => {
    const area = localArea("48127", 15).list;
    const edge = area[area.length - 1]; // farthest ZIP still inside 15 mi
    expect(edge.miles).toBeLessThanOrEqual(15);
    expect(isLocalZip({ homeZip: "48127", radiusMiles: 15 }, edge.zip)).toBe(true);
    const exact = milesBetween(zipInfo("48127")!, zipInfo(edge.zip)!);
    expect(isLocalZip({ homeZip: "48127", radiusMiles: Math.floor((exact - 0.05) * 10) / 10 }, edge.zip)).toBe(false);
  });

  it("changing the radius (or home ZIP) changes the ZIP list", () => {
    const five = localArea("48127", 5);
    const fifteen = localArea("48127", 15);
    expect(fifteen.list.length).toBeGreaterThan(five.list.length);
    expect(five.list.every((z) => fifteen.set.has(z.zip))).toBe(true);
    const far = fifteen.list.find((z) => !five.set.has(z.zip))!;
    expect(isLocalZip({ homeZip: "48127", radiusMiles: 5 }, far.zip)).toBe(false);
    expect(isLocalZip({ homeZip: "48127", radiusMiles: 15 }, far.zip)).toBe(true);
    expect(localArea("90210", 15).set.has("48124")).toBe(false);
  });

  it("unknown ZIPs are never local; no home ZIP = nothing is local", () => {
    expect(zipInfo("00000")).toBeNull();
    expect(isLocalZip(local, "00000")).toBe(false);
    expect(isLocalZip(local, "abc")).toBe(false);
    expect(isLocalZip({ homeZip: "", radiusMiles: 15 }, "48124")).toBe(false);
    expect(isLocalZip({ homeZip: "00000", radiusMiles: 15 }, "48124")).toBe(false);
  });
});

// ---------------------------------------------------------------- Options and fees
describe("checkout options", () => {
  const L = cleanLocal(LOCAL);

  it("delivery fee and free-over threshold in integer cents", () => {
    expect(deliveryFeeCents({ enabled: true, feeCents: 200, freeOverCents: 5000 }, 4999)).toBe(200);
    expect(deliveryFeeCents({ enabled: true, feeCents: 200, freeOverCents: 5000 }, 5000)).toBe(0);
    expect(deliveryFeeCents({ enabled: true, feeCents: 250, freeOverCents: null }, 999999)).toBe(250);
    expect(DEFAULT_STORE.local.delivery.feeCents).toBe(200);
    expect(DEFAULT_STORE.local.radiusMiles).toBe(15);
    expect(DEFAULT_STORE.local.payAtPickup).toBe(false);
  });

  it("only methods turned on are offered; nothing for non-local addresses", () => {
    expect(localOffer(L, false, 10000)).toBeNull();
    expect(localOffer(L, true, 10000)).toMatchObject({ pickup: { town: "Dearborn Heights" }, delivery: { cents: 200 } });
    expect(localOffer({ ...L, pickup: { ...L.pickup, enabled: false } }, true, 10000)).toMatchObject({ pickup: null, delivery: { cents: 200 } });
    expect(localOffer({ ...L, delivery: { ...L.delivery, enabled: false } }, true, 10000)).toMatchObject({ pickup: { town: "Dearborn Heights" }, delivery: null });
    expect(localOffer({ ...L, pickup: { ...L.pickup, enabled: false }, delivery: { ...L.delivery, enabled: false } }, true, 10000)).toBeNull();
    // Pickup with no spot filled in is hidden (there would be nothing to share).
    expect(localOffer({ ...L, pickup: { ...L.pickup, name: "" } }, true, 10000)?.pickup).toBeNull();
  });

  it("the quote offers local options for Dearborn and none for 90210", async () => {
    expect((await quote(dearborn)).local).toMatchObject({ pickup: { town: "Dearborn Heights" }, delivery: { cents: 200 }, windows: LOCAL.windows, payAtPickup: true });
    expect((await quote(beverlyHills)).local).toBeNull();
    // Free local delivery over $150 (items after discounts): 3 x $50 = $150.
    expect((await quote(dearborn, [{ variantId: "ghk", quantity: 3 }])).local?.delivery?.cents).toBe(0);
  });

  it("the pickup spot address and the home ZIP are never sent before the order is placed", async () => {
    await prisma.listing.update({ where: { id: "l-ghk" }, data: { showOnWebsite: true } });
    const { POST } = await import("../app/api/store/quote/route");
    const res = await POST(new NextRequest(`${ORIGIN}/api/store/quote`, { method: "POST", headers: { "content-type": "application/json", host: "localhost:3000" }, body: JSON.stringify({ items: [{ variantId: "ghk", quantity: 2 }], code: "", shipTo: dearborn }) }), { params: Promise.resolve({}) } as never);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text).local.pickup).toEqual({ town: "Dearborn Heights" });
    expect(text).not.toContain(SPOT.street1);
    expect(text).not.toContain(SPOT.name);
    expect(text).not.toContain(SPOT.instructions);
    expect(text).not.toContain("48127");
  });
});

// ---------------------------------------------------------------- Placing orders
describe("placing local orders (server re-checks everything)", () => {
  it("a pickup order: free, the spot is saved on the order and shared after it is placed", async () => {
    const o = await checkout();
    const row = await order(o.id);
    expect(row).toMatchObject({ fulfillment: "pickup", shippingCents: 0, shippingTier: "", shippingMethod: "Local pickup", localTime: "Weekdays 5–9pm", localNotes: "Blue car", payAtPickup: false, status: "awaiting_payment" });
    expect(JSON.parse(row.localJson)).toMatchObject(SPOT);
    const { publicOrderByToken } = await import("./store/order-view");
    const view = (await publicOrderByToken(o.token, (await ser.loadAll()).store))!;
    expect(view.local).toMatchObject({ method: "pickup", spot: { name: SPOT.name, address: "123 Secret Spot Rd, Dearborn Heights, MI 48127", instructions: SPOT.instructions }, time: "Weekdays 5–9pm" });
    const mail = sent.find((m) => m.subject.includes("received"))!;
    expect(mail.html).toContain(SPOT.street1);
    expect(mail.html).toContain("Weekdays 5–9pm");
    expect(mail.html).toContain("text you to confirm the exact time.");
  });

  it("a faked local order for a far ZIP is refused", async () => {
    await expect(checkout({ shipTo: beverlyHills })).rejects.toThrow(/only for addresses near us/);
    await expect(checkout({ shipTo: beverlyHills, fulfillment: "delivery", expectedTotalCents: 10200 })).rejects.toThrow(/only for addresses near us/);
    expect(await prisma.order.count()).toBe(0);
  });

  it("a method that is turned off is refused even for a local ZIP", async () => {
    await setStore({ local: { ...LOCAL, pickup: { ...LOCAL.pickup, enabled: false } } });
    await expect(checkout()).rejects.toThrow(/pickup is not available/);
    await setStore({ local: { ...LOCAL, delivery: { ...LOCAL.delivery, enabled: false } } });
    await expect(checkout({ fulfillment: "delivery", expectedTotalCents: 10200 })).rejects.toThrow(/delivery is not available/);
  });

  it("local orders need a phone number and a valid time window", async () => {
    await expect(checkout({ phone: "" })).rejects.toThrow(/phone number/);
    await expect(checkout({ localTime: "Midnight" })).rejects.toThrow(/preferred time/);
  });

  it("delivery charges the fee in cents; free over the threshold; the total must match", async () => {
    await expect(checkout({ fulfillment: "delivery" })).rejects.toThrow(/price changed/); // forgot the $2.00
    const a = await checkout({ fulfillment: "delivery", expectedTotalCents: 10200 });
    expect(await order(a.id)).toMatchObject({ shippingCents: 200, shippingMethod: "Local delivery", localJson: "" });
    const b = await checkout({ fulfillment: "delivery", items: [{ variantId: "ghk", quantity: 3 }], expectedTotalCents: 15000 });
    expect((await order(b.id)).shippingCents).toBe(0);
  });

  it("free shipping rules never apply to local delivery (it has its own threshold) and are not used up", async () => {
    await prisma.promotion.create({ data: { id: "fs", kind: "free_shipping", shippingTiersJson: JSON.stringify(["standard"]), minSubtotalCents: 0 } });
    const q = await quote(dearborn);
    expect(q.pricing.freeTiers).toContain("standard");
    expect(q.local?.delivery?.cents).toBe(200);
    const o = await checkout({ fulfillment: "delivery", expectedTotalCents: 10200 });
    expect(await prisma.promotionUse.count({ where: { orderId: o.id } })).toBe(0);
  });

  it("pay at pickup: only for local orders, only when on; never auto-canceled", async () => {
    await expect(checkout({ fulfillment: "ship", tier: "standard", payChoice: "pickup", expectedTotalCents: 10695 })).rejects.toThrow(/only for local pickup or delivery/);
    await setStore({ local: { ...LOCAL, payAtPickup: false } });
    await expect(checkout({ payChoice: "pickup" })).rejects.toThrow(/only for local pickup or delivery/);
    await setStore({});
    const o = await checkout({ payChoice: "pickup" });
    const row = await order(o.id);
    expect(row).toMatchObject({ payAtPickup: true, expiresAt: null, status: "awaiting_payment" });
    expect(await ops.autoCancelDue(new Date(Date.now() + 365 * 86400_000))).toBe(0);
    expect((await order(o.id)).status).toBe("awaiting_payment");
  });

  it("shipped orders still work as before (tier required, normal shipping)", async () => {
    const o = await checkout({ fulfillment: "ship", tier: "standard", shipTo: beverlyHills, expectedTotalCents: 10695 });
    expect(await order(o.id)).toMatchObject({ fulfillment: "ship", shippingTier: "standard", shippingCents: 695 });
  });
});

// ---------------------------------------------------------------- After the order
describe("statuses, emails and Shippo", () => {
  it("Placed -> Paid -> Ready (email) -> Picked up", async () => {
    const o = await checkout();
    await expect(ops.markReady(o.id, { notify: false })).rejects.toThrow(/not paid yet/);
    await expect(ops.markHandedOver(o.id)).rejects.toThrow(/not paid yet/);
    await paid(o.id);
    expect((await order(o.id)).status).toBe("paid");
    sent.length = 0;
    await ops.markReady(o.id, { origin: ORIGIN });
    expect((await order(o.id)).status).toBe("ready");
    expect(sent.map((m) => m.subject)).toEqual([expect.stringMatching(/is ready for pickup/)]);
    await expect(ops.markReady(o.id)).rejects.toThrow(/already marked ready/);
    await ops.markHandedOver(o.id);
    expect(await order(o.id)).toMatchObject({ status: "picked_up" });
    expect((await order(o.id)).deliveredAt).not.toBeNull();
  });

  it("pay at pickup: can be ready before paid; paid when the money comes; then delivered", async () => {
    const o = await checkout({ fulfillment: "delivery", payChoice: "pickup", expectedTotalCents: 10200 });
    await ops.markReady(o.id, { notify: false });
    expect(await order(o.id)).toMatchObject({ status: "awaiting_payment" });
    expect((await order(o.id)).readyAt).not.toBeNull();
    await paid(o.id); // money received at the door
    expect((await order(o.id)).status).toBe("ready");
    await ops.markHandedOver(o.id);
    expect((await order(o.id)).status).toBe("delivered");
  });

  it("local orders never go to the ship queue and never buy a label", async () => {
    const o = await checkout();
    await paid(o.id);
    const data = await ser.loadAll();
    const rec = data.orders.find((x) => x.id === o.id)!;
    expect(counts.isReadyToShip(rec)).toBe(false);
    expect(counts.isOpenLocal(rec)).toBe(true);
    expect(counts.adminCounts(data)).toMatchObject({ readyToShip: 0, local: 1 });
    await expect(ops.buyLabel(o.id)).rejects.toThrow(/never need a shipping label/);
    await expect(ops.labelRates(o.id)).rejects.toThrow(/never need a shipping label/);
    await expect(ops.markShipped(o.id)).rejects.toThrow(/local order/);
    expect(await prisma.labelPurchase.count()).toBe(0);
    // A shipped order, for comparison, is in the queue.
    const s = await checkout({ fulfillment: "ship", tier: "standard", expectedTotalCents: 10695 });
    await paid(s.id);
    expect(counts.isReadyToShip((await ser.loadAll()).orders.find((x) => x.id === s.id)!)).toBe(true);
  });
});

// ---------------------------------------------------------------- Money and credit
describe("money", () => {
  it("the delivery fee is counted exactly like shipping: 100% business money, never split, no label cost", async () => {
    const d = await checkout({ fulfillment: "delivery", expectedTotalCents: 10200 });
    await paid(d.id);
    const ledger = money.computeLedger(await ser.loadAll());
    const r = ledger.orders.get(d.id)!;
    expect(r.shipping).toBe(200);
    expect(r.total).toBe(10200);
    expect(r.revenue).toBe(10000); // the fee is not revenue
    expect(r.business).toBe(r.revenue + r.shipping - r.a - r.b); // all of the fee stays with the business
    expect(ledger.shippingCollected).toBe(200);
    expect(ledger.labelCosts).toBe(0);
  });

  it("referral credit and store credit work the same on local orders", async () => {
    await creditOps.adjustCredit({ customerId: "kim", amountCents: 1000, reason: "Giveaway", by: "Ahmad" });
    const o = await checkout({ referralCode: "samm3333", storeCreditCents: 1000, expectedTotalCents: 9000 });
    expect(await creditOps.creditPending(prisma, "sam")).toBe(1000);
    await paid(o.id);
    expect(await creditOps.creditBalance(prisma, "sam")).toBe(1000);
    expect(await creditOps.creditBalance(prisma, "kim")).toBe(0);
  });

  it("existing orders are untouched by the migration: they default to shipped", async () => {
    await prisma.$executeRawUnsafe(`INSERT INTO "Order" ("id","date","status") VALUES ('legacy',CURRENT_TIMESTAMP,'completed')`);
    expect(await prisma.order.findUnique({ where: { id: "legacy" } })).toMatchObject({ fulfillment: "ship", localTime: "", localJson: "", payAtPickup: false, readyAt: null });
  });
});
