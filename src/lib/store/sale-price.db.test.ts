// Sale prices through the real checkout: the catalog's crossed-out price is what the order charges and
// stores, business money and the split come out the same as a normal sale at that price, and pausing
// the deal puts prices back right away.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Ledger } from "../money";
import type { AppData } from "../types";

const dir = mkdtempSync(path.join(tmpdir(), "sale-test-"));
const root = path.resolve(import.meta.dirname, "../../..");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`;
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
delete process.env.RESEND_API_KEY;
process.env.SHIPPO_API_KEY = "shippo_test_fake";

let prisma: (typeof import("../db"))["prisma"];
let ops: typeof import("../order-ops");
let loadAll: () => Promise<AppData>;
let computeLedger: (d: AppData) => Ledger;
let buildCatalog: (typeof import("./catalog"))["buildCatalog"];
let orderTotals: (typeof import("../money"))["orderTotals"];

const money = (l: Ledger) => ({ business: l.businessCents, a: l.pendingA, b: l.pendingB });
const catalog = async () => {
  const d = await loadAll();
  return buildCatalog(d, computeLedger(d));
};
const shipTo = { name: "Dana Reed", street1: "500 Oak Ave", street2: "", city: "Denver", state: "CO", zip: "80202", country: "US" };
const checkout = (items: { variantId: string; quantity: number }[], expectedTotalCents: number, code = "") =>
  ops.placeOrder({ customerId: "cust", name: "Dana Reed", email: "dana@example.com", phone: "", shipTo, items, code, tier: "standard", payChoice: "zelle", expectedTotalCents, origin: "http://localhost:3000" });
const SHIP = 695;

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("../db"));
  ops = await import("../order-ops");
  ({ loadAll } = await import("../serialize"));
  ({ computeLedger, orderTotals } = await import("../money"));
  ({ buildCatalog } = await import("./catalog"));
  const store = { open: true, qtyDeals: [], payments: { zelle: { enabled: true, details: "pay@buckshot.test" } }, alertEmails: [], shipFrom: { name: "Buckshot", street1: "1 Main St", city: "Austin", state: "TX", zip: "78701", country: "US", phone: "5125550100", email: "ship@buckshot.test" } };
  await prisma.settings.create({ data: { id: 1, startingBalanceCents: 0, storeJson: JSON.stringify(store) } });
  await prisma.listing.create({ data: { id: "l-bpc", name: "BPC-157", slug: "bpc-157", showOnWebsite: true } });
  await prisma.product.createMany({
    data: [
      { id: "s", name: "BPC-157", variantLabel: "5mg", defaultPriceCents: 5000, listingId: "l-bpc", sortOrder: 0 },
      { id: "m", name: "BPC-157", variantLabel: "10mg", defaultPriceCents: 11000, listingId: "l-bpc", sortOrder: 1, variantSort: 1 },
    ],
  });
  const d = new Date("2026-01-01T12:00:00Z");
  await prisma.purchase.createMany({
    data: [
      { id: "pu-s", date: d, productId: "s", quantity: 20, totalCostCents: 20000, fromInvestment: true },
      { id: "pu-m", date: d, productId: "m", quantity: 20, totalCostCents: 40000, fromInvestment: true },
    ],
  });
  await prisma.customer.create({ data: { id: "cust", name: "Dana Reed", email: "dana@example.com", passwordHash: "x" } });
  await prisma.promotion.create({ data: { id: "bf", kind: "auto", name: "Black Friday", discountType: "%", discountValue: 30 } });
  await prisma.promotion.create({ data: { id: "c10", kind: "code", code: "SAVE10", discountType: "%", discountValue: 10 } });
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("30% sitewide sale through checkout", () => {
  it("the order charges and stores exactly the crossed-out price shown", async () => {
    const p = (await catalog()).products[0];
    expect([p.listFromCents, p.listToCents, p.priceFromCents, p.priceToCents, p.sale?.percent]).toEqual([5000, 11000, 3500, 7700, 30]);
    const shown = p.variants[0].priceCents + 2 * p.variants[1].priceCents; // 3500 + 2 x 7700
    // The browser sends the total it showed. A different number would be refused ("A price changed").
    await expect(checkout([{ variantId: "s", quantity: 1 }, { variantId: "m", quantity: 2 }], shown + SHIP + 1)).rejects.toThrow(/price changed/);
    const { id } = await checkout([{ variantId: "s", quantity: 1 }, { variantId: "m", quantity: 2 }], shown + SHIP);
    const row = await prisma.order.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
    const uses = await prisma.promotionUse.findMany({ where: { orderId: id } });
    expect(row.lines.map((l) => [l.productId, l.quantity, l.unitPriceCents, l.fullPriceCents, l.dealId, l.dealName])).toEqual([
      ["s", 1, 3500, 5000, "", "Black Friday: 30% off"],
      ["m", 2, 7700, 11000, "", "Black Friday: 30% off"],
    ]);
    expect(row.discountValue).toBe(0);
    expect(JSON.parse(row.promoJson).labels).toEqual(["Black Friday: 30% off (sale price)"]);
    expect(uses.map((u) => u.promotionId)).toEqual(["bf"]);
    const o = (await loadAll()).pendingOrders.find((x) => x.id === id)!;
    expect(orderTotals(o).total).toBe(shown + SHIP);
  });

  it("business money, payback and the split match a normal sale at the same prices", async () => {
    // Sale order.
    let before = money(computeLedger(await loadAll()));
    const sale = await checkout([{ variantId: "s", quantity: 1 }], 3500 + SHIP);
    await ops.markPaid(sale.id, { paymentMethod: "Zelle", notify: false });
    let after = money(computeLedger(await loadAll()));
    const saleDelta = { business: after.business - before.business, a: after.a - before.a, b: after.b - before.b };
    // The same item with its regular price set to $35 and no deal.
    await prisma.promotion.update({ where: { id: "bf" }, data: { active: false } });
    await prisma.product.update({ where: { id: "s" }, data: { defaultPriceCents: 3500 } });
    before = money(computeLedger(await loadAll()));
    const plain = await checkout([{ variantId: "s", quantity: 1 }], 3500 + SHIP);
    await ops.markPaid(plain.id, { paymentMethod: "Zelle", notify: false });
    after = money(computeLedger(await loadAll()));
    expect({ business: after.business - before.business, a: after.a - before.a, b: after.b - before.b }).toEqual(saleDelta);
    await prisma.product.update({ where: { id: "s" }, data: { defaultPriceCents: 5000 } });
    await prisma.promotion.update({ where: { id: "bf" }, data: { active: true } });
  });

  it("a discount code still applies on top of the sale prices", async () => {
    // $35 sale price, then 10% off with the code = $3.50 off.
    const { id } = await checkout([{ variantId: "s", quantity: 1 }], 3500 - 350 + SHIP, "SAVE10");
    const row = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(row.discountValue).toBe(350);
  });

  it("pausing the deal puts the regular prices back at once, and checkout charges them", async () => {
    await prisma.promotion.update({ where: { id: "bf" }, data: { active: false } });
    const p = (await catalog()).products[0];
    expect([p.priceFromCents, p.priceToCents, p.listFromCents, p.sale]).toEqual([5000, 11000, 5000, null]);
    await expect(checkout([{ variantId: "s", quantity: 1 }], 3500 + SHIP)).rejects.toThrow(/price changed/);
    const { id } = await checkout([{ variantId: "s", quantity: 1 }], 5000 + SHIP);
    const row = await prisma.order.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    expect(row.lines.map((l) => [l.unitPriceCents, l.fullPriceCents, l.dealName])).toEqual([[5000, null, ""]]);
    // An end date in the past does the same.
    await prisma.promotion.update({ where: { id: "bf" }, data: { active: true, endsAt: new Date(Date.now() - 60_000) } });
    expect((await catalog()).products[0].sale).toBeNull();
  });

  it("Show sale price off: regular prices on the site, the deal comes off the order at checkout instead", async () => {
    await prisma.promotion.update({ where: { id: "bf" }, data: { endsAt: null, showSalePrice: false } });
    const p = (await catalog()).products[0];
    expect([p.priceFromCents, p.sale, p.dealBadges]).toEqual([5000, null, ["30% off"]]);
    const { id } = await checkout([{ variantId: "s", quantity: 1 }], 3500 + SHIP);
    const row = await prisma.order.findUniqueOrThrow({ where: { id }, include: { lines: true } });
    expect([row.lines[0].unitPriceCents, row.discountValue]).toEqual([5000, 1500]);
  });
});
