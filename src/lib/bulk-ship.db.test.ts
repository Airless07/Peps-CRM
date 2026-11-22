// Bulk shipping proof against a real database (fresh SQLite, every migration). Shippo is a local fake:
// no real label is bought and nothing is charged.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "bulk-ship-test-"));
const root = path.resolve(import.meta.dirname, "../..");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").split(path.sep).join("/")}`;
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
delete process.env.RESEND_API_KEY;
process.env.SHIPPO_API_KEY = "shippo_test_fake";

let prisma: (typeof import("./db"))["prisma"];
let ops: typeof import("./order-ops");
let bulk: typeof import("./bulk-ship");
let ser: typeof import("./serialize");
let money: typeof import("./money");

const shipTo = (name: string, zip = "80202") => ({ name, street1: "500 Oak Ave", street2: "", city: "Denver", state: "CO", zip, country: "US" });
let labelPdf: Uint8Array;
const calls = { tx: 0, shipments: 0 };

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("./db"));
  ops = await import("./order-ops");
  bulk = await import("./bulk-ship");
  ser = await import("./serialize");
  money = await import("./money");
  const one = await PDFDocument.create();
  one.addPage([288, 432]);
  labelPdf = await one.save();
  // Fake Shippo: rates for every address except ZIP 00000 (no rates), unique tracking per label, PDF labels.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/shipments/")) {
      calls.shipments++;
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.address_to?.zip === "00000") return json({ rates: [], messages: [{ text: "Address not found" }] });
      return json({
        rates: [
          { object_id: "rate_prio", amount: "9.10", provider: "USPS", servicelevel: { name: "Priority Mail", token: "usps_priority" }, estimated_days: 2 },
          { object_id: "rate_ga", amount: "4.55", provider: "USPS", servicelevel: { name: "Ground Advantage", token: "usps_ground_advantage" }, estimated_days: 4 },
        ],
      });
    }
    if (url.endsWith("/transactions/")) {
      calls.tx++;
      // Slow on purpose, so two bulk runs at once really overlap.
      await new Promise((r) => setTimeout(r, 60));
      return json({ status: "SUCCESS", tracking_number: `94001000000000000${String(calls.tx).padStart(5, "0")}`, label_url: `https://shippo.test/label-${calls.tx}.pdf`, object_id: `tx_${calls.tx}` });
    }
    if (url.startsWith("https://shippo.test/label-")) return new Response(new Uint8Array(labelPdf), { status: 200, headers: { "Content-Type": "application/pdf" } });
    return json({});
  });
  const store = {
    open: true,
    payments: { zelle: { enabled: true, details: "pay@x.test" } },
    alertEmails: [],
    shipFrom: { name: "Buckshot", street1: "1 Main St", city: "Austin", state: "TX", zip: "78701", country: "US", phone: "5125550100", email: "ship@x.test" },
    local: { enabled: true, homeZip: "80202", radiusMiles: 30, pickup: { enabled: true, name: "Spot", street1: "1 A St", city: "Denver", state: "CO", zip: "80202", instructions: "" }, delivery: { enabled: false } },
  };
  await prisma.settings.create({ data: { id: 1, startingBalanceCents: 0, storeJson: JSON.stringify(store) } });
  await prisma.listing.create({ data: { id: "l-a", name: "MOTS-c", slug: "mots-c", showOnWebsite: true } });
  await prisma.product.create({ data: { id: "a", name: "MOTS-c", variantLabel: "10mg", defaultPriceCents: 4000, listingId: "l-a" } });
  await prisma.purchase.create({ data: { id: "pu", date: new Date("2026-01-01T12:00:00Z"), productId: "a", quantity: 100, totalCostCents: 100000, fromInvestment: true } });
  await prisma.customer.create({ data: { id: "c", name: "Dana Reed", email: "dana@example.com", passwordHash: "x" } });
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let n = 0;
async function order(opts: { paid?: boolean; zip?: string; fulfillment?: "ship" | "pickup" } = {}) {
  n++;
  const id = `o${n}`;
  await prisma.order.create({
    data: {
      id,
      number: 2000 + n,
      date: new Date(),
      placedAt: new Date(),
      source: "online",
      status: "awaiting_payment",
      soldBy: "W",
      customer: `Buyer ${n}`,
      customerId: "c",
      email: `b${n}@example.com`,
      shipToJson: JSON.stringify(shipTo(`Buyer ${n}`, opts.zip)),
      shippingCents: 695,
      shippingTier: "standard",
      shippingMethod: "Standard (USPS Ground Advantage)",
      fulfillment: opts.fulfillment ?? "ship",
      token: `tok-${id}-0123456789abcdef`,
      lines: { create: [{ id: `${id}-l`, productId: "a", productName: "MOTS-c 10mg", quantity: 2, unitPriceCents: 4000, unitCostCents: 0, cutPercent: 10, sortOrder: 0 }] },
    },
  });
  if (opts.paid !== false) await ops.markPaid(id, { paymentMethod: "Zelle", notify: false });
  return id;
}

describe("bulk shipping", () => {
  let good: string[] = [];
  let unpaid = "";
  let local = "";
  let badAddress = "";

  it("quotes one rate per order (the service paid for), with the total, and flags what can't be bought", async () => {
    good = [await order(), await order(), await order()];
    unpaid = await order({ paid: false });
    local = await order({ fulfillment: "pickup" });
    badAddress = await order({ zip: "00000" });
    const q = await bulk.quoteBulkLabels([...good, unpaid, local, badAddress]);
    expect(q.count).toBe(3);
    expect(q.totalCents).toBe(3 * 455); // Standard paid -> Ground Advantage $4.55 each
    const by = new Map(q.rows.map((r) => [r.id, r]));
    expect(by.get(unpaid)).toMatchObject({ ok: false, error: "Not paid yet." });
    expect(by.get(local)).toMatchObject({ ok: false, error: "Local pickup order: no shipping label needed." });
    expect(by.get(badAddress)!.ok).toBe(false);
    expect(by.get(badAddress)!.error).toMatch(/no rates/i);
    expect(calls.tx).toBe(0); // a quote never buys
  });

  it("never buys a label twice, even when two bulk runs overlap, and reports failures and skips", async () => {
    const before = money.computeLedger(await ser.loadAll());
    const ids = [...good, unpaid, local, badAddress];
    const [r1, r2] = await Promise.all([bulk.buyBulkLabels(ids), bulk.buyBulkLabels(ids)]);
    expect(calls.tx).toBe(3);
    expect(await prisma.labelPurchase.count()).toBe(3);
    for (const id of good) expect(await prisma.labelPurchase.count({ where: { orderId: id } })).toBe(1);
    const all = [...r1, ...r2];
    expect(all.filter((r) => r.ok).length).toBe(3);
    // Unpaid and local are skipped (not failures of the carrier); the bad address fails with the reason.
    expect(r1.find((r) => r.id === unpaid)).toMatchObject({ ok: false, skipped: true, message: "Not paid yet." });
    expect(r1.find((r) => r.id === local)).toMatchObject({ ok: false, skipped: true });
    expect(r1.find((r) => r.id === badAddress)).toMatchObject({ ok: false, skipped: false });
    // Running it again: every order with a label is skipped, nothing is bought.
    const again = await bulk.buyBulkLabels(good);
    expect(again.every((r) => r.skipped && r.message === "Label already bought.")).toBe(true);
    expect(calls.tx).toBe(3);
    // Label costs go into the money exactly like single labels: business money down by the label cost, partners untouched.
    const after = money.computeLedger(await ser.loadAll());
    expect(after.labelCosts - before.labelCosts).toBe(3 * 455);
    expect(before.businessCents - after.businessCents).toBe(3 * 455);
    expect([after.pendingA, after.pendingB]).toEqual([before.pendingA, before.pendingB]);
    // No label lock is left behind.
    expect(await prisma.order.count({ where: { labelLockAt: { not: null } } })).toBe(0);
  });

  it("prints every label as one 4x6 PDF in queue order, and every packing slip as one PDF", async () => {
    const labels = await bulk.combinedLabels([...good, unpaid]);
    const doc = await PDFDocument.load(labels.pdf);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(0).getSize()).toEqual({ width: 288, height: 432 });
    expect(labels.included).toEqual([2001, 2002, 2003]);
    expect(labels.skipped).toEqual([{ number: 2004, reason: "Not paid yet." }]);
    const slips = await PDFDocument.load(await bulk.combinedPackingSlips(good));
    expect(slips.getPageCount()).toBe(3);
  });

  it("marks orders shipped, skipping what can't be shipped", async () => {
    const r = await bulk.shipBulk([...good, unpaid, local]);
    expect(r.filter((x) => x.ok).map((x) => x.id)).toEqual(good);
    for (const id of good) expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("shipped");
    expect(r.find((x) => x.id === unpaid)).toMatchObject({ skipped: true });
    expect(r.find((x) => x.id === local)).toMatchObject({ skipped: true });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: unpaid } })).status).toBe("awaiting_payment");
  });
});
