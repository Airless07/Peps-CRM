// Referral program proof, against a real database (fresh SQLite, every migration, real triggers).
// Covers: code rules and uniqueness (DB-enforced, shared with discount codes), code changes, self-referral,
// stacking, pending -> available, refunds and cancels (full and partial), negative balances, idempotency,
// owner price, the credit math in cents, and that the migration keeps existing customers, codes and credit.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makeReferralCode } from "./credit";

const jar = vi.hoisted(() => {
  const m = new Map<string, string>();
  return { m, get: (k: string) => (m.has(k) ? { name: k, value: m.get(k)! } : undefined), set: (k: string, v: string) => void (v ? m.set(k, v) : m.delete(k)) };
});
vi.mock("next/headers", () => ({ cookies: async () => jar }));

const dir = mkdtempSync(path.join(tmpdir(), "referral-test-"));
const root = path.resolve(import.meta.dirname, "../..");
const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").split(path.sep).join("/")}`;
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";

let prisma: (typeof import("./db"))["prisma"];
let creditOps: typeof import("./credit-ops");
let codes: typeof import("./referral-codes");
let sell: typeof import("./sell-ops");
let ops: typeof import("./order-ops");
let ser: typeof import("./serialize");
let money: typeof import("./money");
let stats: typeof import("./referral-stats");
let rules: typeof import("./referral-rules");
let refs: typeof import("./store/referral");

const ORIGIN = "http://localhost:3000";
const shipTo = { name: "Kim Park", street1: "500 Oak Ave", street2: "", city: "Denver", state: "CO", zip: "80202", country: "US" };
const STORE = { open: true, siteUrl: "https://shop.test", payments: { zelle: { enabled: true, details: "pay@buckshot.test" } }, qtyDeals: [], alertEmails: [] };
const setReferrals = (r: Record<string, unknown>) => prisma.settings.update({ where: { id: 1 }, data: { storeJson: JSON.stringify({ ...STORE, referrals: r }) } });

beforeAll(async () => {
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("./db"));
  creditOps = await import("./credit-ops");
  codes = await import("./referral-codes");
  sell = await import("./sell-ops");
  ops = await import("./order-ops");
  ser = await import("./serialize");
  money = await import("./money");
  stats = await import("./referral-stats");
  rules = await import("./referral-rules");
  refs = await import("./store/referral");
  // No real emails.
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: "x" }), { status: 200 }));
  await prisma.settings.create({ data: { id: 1, startingBalanceCents: 0, storeJson: JSON.stringify(STORE) } });
  await prisma.listing.create({ data: { id: "l-ghk", name: "GHK-Cu", slug: "ghk-cu", showOnWebsite: true } });
  await prisma.product.create({ data: { id: "ghk", name: "GHK-Cu", variantLabel: "100mg", defaultPriceCents: 5000, listingId: "l-ghk" } });
  await prisma.purchase.create({ data: { id: "pu", date: new Date("2026-01-01T12:00:00Z"), productId: "ghk", quantity: 500, totalCostCents: 500000, fromInvestment: true } });
}, 120_000);

beforeEach(async () => {
  await prisma.creditEntry.deleteMany();
  await prisma.promotionUse.deleteMany();
  await prisma.promotion.deleteMany();
  await prisma.orderEvent.deleteMany();
  await prisma.order.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.settings.update({ where: { id: 1 }, data: { storeJson: JSON.stringify(STORE) } });
  await prisma.customer.createMany({
    data: [
      // Sam owns the code; Kim (signed in) buys; Dana is another customer.
      { id: "sam", name: "Sam Lee", email: "sam@example.com", referralCode: "SAMM3333", passwordHash: "x", addressesJson: JSON.stringify([{ name: "Sam Lee", street1: "9 Elm St", street2: "", city: "Austin", state: "TX", zip: "73301", country: "US" }]) },
      { id: "kim", name: "Kim Park", email: "kim@example.com", referralCode: "KIMP4444", passwordHash: "x" },
      { id: "dana", name: "Dana Reed", email: "dana@example.com", referralCode: "DANA2222", passwordHash: "x" },
    ],
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const balance = (id: string) => creditOps.creditBalance(prisma, id);
const pending = (id: string) => creditOps.creditPending(prisma, id);
const entries = (orderId: string) => prisma.creditEntry.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
type Checkout = Parameters<(typeof ops)["placeOrder"]>[0];
/** Kim checks out 2 x $50 with standard shipping ($6.95). */
const checkout = (over: Partial<Checkout> = {}) =>
  ops.placeOrder({ customerId: "kim", name: "Kim Park", email: "kim@example.com", phone: "", shipTo, items: [{ variantId: "ghk", quantity: 2 }], code: "", tier: "standard", payChoice: "zelle", expectedTotalCents: 10000 + 695, origin: ORIGIN, referralCode: "SAMM3333", ...over });
const paid = (id: string) => ops.markPaid(id, { paymentMethod: "Zelle", notify: false });
const order = async (id: string) => (await prisma.order.findUnique({ where: { id }, include: { lines: true } }))!;
function sale(over: Record<string, unknown> = {}) {
  const id = (over.id as string) ?? `s-${Math.random().toString(36).slice(2)}`;
  return {
    id, date: new Date("2026-03-01T12:00:00Z"), customer: "Dana Reed", customerId: "dana", paymentMethod: "Cash", note: "", soldBy: "A" as const,
    discountType: "$" as const, discountValue: 0, tipCents: 0, owner: null, cashTo: null, storeCreditCents: 0, referredById: null as string | null,
    lines: [{ id: `${id}-l`, productId: "ghk", productName: "GHK-Cu 100mg", quantity: 2, unitPriceCents: 5000, unitCostCents: 1000, cutPercent: 10, dealId: "", dealName: "", fullPriceCents: null }],
    ...over,
  };
}
const promo = (code: string, pct = 10) => prisma.promotion.create({ data: { id: `p-${code}`, kind: "code", code, discountType: "%", discountValue: pct } });

// ---------------------------------------------------------------- Codes
describe("code rules", () => {
  it("3 to 20 letters, numbers and dashes", () => {
    expect(rules.codeProblem("ab")).toBe("too_short");
    expect(rules.codeProblem("a".repeat(21))).toBe("too_long");
    expect(rules.codeProblem("sarah k")).toBe("invalid_chars");
    expect(rules.codeProblem("sarah_k")).toBe("invalid_chars");
    expect(rules.codeProblem("Sarah-K")).toBeNull();
    expect(rules.codeProblem("ABC")).toBeNull();
  });

  it("blocks profanity and slurs anywhere, with look-alike swaps; reserves official words", () => {
    for (const bad of ["fuck", "XFUCKX", "F-U-C-K", "fuuuck", "sh1t", "5hit", "b1tch", "N1GGA", "a55", "my-ass", "admin", "ADMIN1", "buckshot10", "Bucksh0t", "staff", "test", "T3ST-ME", "support", "0wner"]) {
      expect(rules.codeProblem(bad), bad).toBe("not_allowed");
    }
    // Normal words that contain a short blocked word are fine.
    for (const ok of ["Classic", "Cassie", "Titan", "Spicy-Sam", "Grape", "Sarah-K", "DANA7K2P"]) expect(rules.codeProblem(ok), ok).toBeNull();
  });

  it("auto-generated codes always pass the rules", () => {
    for (let i = 0; i < 300; i++) expect(rules.codeProblem(makeReferralCode(i % 2 ? "Fuck Admin" : "Dana Reed"))).toBeNull();
  });

  it("buyers show as first name + last initial only", () => {
    expect(rules.shortName("sarah kim")).toBe("Sarah K.");
    expect(rules.shortName("Dana")).toBe("Dana");
    expect(rules.shortName("Mary Jo Ann Smith")).toBe("Mary S.");
    expect(rules.shortName("")).toBe("A customer");
  });
});

describe("code uniqueness (database-enforced, shared with discount codes, not case sensitive)", () => {
  it("referral vs referral: case does not matter", async () => {
    await expect(codes.changeReferralCode("dana", "samm3333", "Customer")).rejects.toThrow(/taken/);
    await expect(codes.changeReferralCode("dana", "SaMm3333", "Customer")).rejects.toThrow(/taken/);
    // Even bypassing the app check, the database refuses it.
    await expect(prisma.customer.update({ where: { id: "dana" }, data: { referralCode: "SAMM3333" } })).rejects.toThrow();
  });

  it("referral vs discount code, both ways", async () => {
    await promo("SAVE10");
    await expect(codes.changeReferralCode("dana", "save10", "Customer")).rejects.toThrow(/taken/);
    await expect(codes.codeAvailability(prisma, "Save10", "dana")).resolves.toMatch(/taken/);
    // A discount code that is a customer's referral code is refused by the database.
    await expect(promo("SAMM3333")).rejects.toThrow(/CodeClaim|UNIQUE/i);
    // The admin promotions API gives a clear message.
    const { POST } = await import("../app/api/promotions/route");
    const { NextRequest } = await import("next/server");
    const session = await import("./session");
    jar.set(session.SESSION_COOKIE, (await (await import("./admin-auth")).createAdminToken()).token);
    const res = await POST(new NextRequest(`${ORIGIN}/api/promotions`, { method: "POST", headers: { "content-type": "application/json", host: "localhost:3000", origin: ORIGIN }, body: JSON.stringify({ id: "pp", kind: "code", name: "", code: "SAMM3333", discountType: "%", discountValue: 10, minSubtotalCents: 0, startsAt: null, endsAt: null, maxUses: null, oncePerEmail: false, listingIds: [], groupIds: [], shippingTiers: [], active: true }) }), { params: Promise.resolve({}) } as never);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/referral code/);
  });

  it("a changed code is stored uppercase, shown as typed; the old one is freed at once; credit and old orders stay", async () => {
    const o = await checkout();
    await paid(o.id);
    expect(await balance("sam")).toBe(1000);
    await codes.changeReferralCode("sam", "Sam-Lee", "Customer");
    const sam = await prisma.customer.findUnique({ where: { id: "sam" } });
    expect(sam).toMatchObject({ referralCode: "SAM-LEE", referralCodeDisplay: "Sam-Lee" });
    expect(await balance("sam")).toBe(1000); // earned credit stays
    expect((await order(o.id)).referralCode).toBe("SAMM3333"); // the old order keeps the code it used
    // Old code no longer works…
    await expect(checkout({ referralCode: "SAMM3333" })).rejects.toThrow(/wasn't found/);
    // …and anyone can claim it right away.
    await codes.changeReferralCode("dana", "samm3333", "Customer");
    expect((await prisma.customer.findUnique({ where: { id: "dana" } }))!.referralCode).toBe("SAMM3333");
    // The new code works, case-insensitively.
    const o2 = await checkout({ referralCode: "sam-lee" });
    expect((await order(o2.id)).referralCode).toBe("Sam-Lee");
    // History of the change.
    expect(await prisma.referralCodeChange.findMany({ where: { customerId: "sam" } })).toMatchObject([{ oldCode: "SAMM3333", newCode: "Sam-Lee", by: "Customer" }]);
  });

  it("blocked words are refused when changing a code (customer and admin)", async () => {
    await expect(codes.changeReferralCode("sam", "sh1thead", "Customer")).rejects.toThrow(/not allowed/);
    await expect(codes.changeReferralCode("sam", "Buckshot-VIP", "Ahmad")).rejects.toThrow(/not allowed/);
    await expect(codes.changeReferralCode("sam", "no spaces", "Ahmad")).rejects.toThrow(/letters, numbers and dashes/);
  });
});

// ---------------------------------------------------------------- Checkout
describe("checkout", () => {
  it("self-referral is blocked by account, email and shipping address", async () => {
    await expect(checkout({ referralCode: "KIMP4444" })).rejects.toThrow(rules.SELF_REFERRAL_TEXT);
    // Kim ships to Sam's saved address: same household as the code owner.
    const samsHouse = { ...shipTo, street1: "9 ELM ST.", city: "Austin", state: "TX", zip: "73301" };
    await expect(checkout({ shipTo: samsHouse })).rejects.toThrow(rules.SELF_REFERRAL_TEXT);
    // Email match (a guest or another account using the owner's email).
    const data = await ser.loadAll();
    expect(refs.resolveReferral(data, "samm3333", { email: "SAM@example.com" })).toEqual({ ok: false, error: rules.SELF_REFERRAL_TEXT });
  });

  it("guests can use a referral code (only the owner needs an account)", async () => {
    const data = await ser.loadAll();
    const q = await ops.quoteCheckout(data, { items: [{ variantId: "ghk", quantity: 2 }], code: "", email: "", referralCode: "samm3333" });
    expect(q.referral).toMatchObject({ ownerId: "sam", display: "SAMM3333" });
    expect(refs.codeKindOf(data, "samm3333")).toBe("referral");
  });

  it("stacking ON: a discount code and a referral code together", async () => {
    await promo("SAVE10");
    await setReferrals({ percent: 10, buyerDiscountPercent: 5, allowStacking: true });
    const data = await ser.loadAll();
    expect(refs.codeKindOf(data, "save10")).toBe("discount");
    const q = await ops.quoteCheckout(data, { items: [{ variantId: "ghk", quantity: 2 }], code: "SAVE10", email: "kim@example.com", referralCode: "SAMM3333", buyer: { customerId: "kim" } });
    expect(q.conflict).toBe(false);
    expect(q.pricing.code).toBe("SAVE10");
    expect(q.pricing.referralCents).toBe(450); // 5% of 9000
    const o = await checkout({ code: "SAVE10", expectedTotalCents: 10000 - 1000 - 450 + 695 });
    expect(await order(o.id)).toMatchObject({ referralCode: "SAMM3333", referralDiscountPct: 5, referralDiscountCents: 450, discountValue: 1450 });
  });

  it("stacking OFF: clear message, the order is refused, keeping one of the two works", async () => {
    await promo("SAVE10");
    await setReferrals({ percent: 10, buyerDiscountPercent: 5, allowStacking: false });
    const data = await ser.loadAll();
    const q = await ops.quoteCheckout(data, { items: [{ variantId: "ghk", quantity: 2 }], code: "SAVE10", email: "kim@example.com", referralCode: "SAMM3333", buyer: { customerId: "kim" } });
    expect(q.conflict).toBe(true);
    expect(q.referral).toBeNull();
    await expect(checkout({ code: "SAVE10", expectedTotalCents: 9000 + 695 })).rejects.toThrow(refs.STACKING_TEXT);
    // Keep the referral code:
    const a = await checkout({ expectedTotalCents: 10000 - 500 + 695 });
    expect((await order(a.id)).referredById).toBe("sam");
    // Or keep the discount code:
    const b = await checkout({ code: "SAVE10", referralCode: "", expectedTotalCents: 9000 + 695 });
    expect((await order(b.id)).referredById).toBeNull();
  });

  it("no lock-in: the next order without a code earns nothing; 'use it again' is only offered while the code exists", async () => {
    const o = await checkout();
    await paid(o.id);
    const o2 = await checkout({ referralCode: "" });
    expect((await order(o2.id)).referredById).toBeNull();
    let data = await ser.loadAll();
    expect(refs.lastReferralCode(data, { customerId: "kim" })).toBe("SAMM3333");
    await codes.changeReferralCode("sam", "Sam-Lee", "Customer");
    data = await ser.loadAll();
    expect(refs.lastReferralCode(data, { customerId: "kim" })).toBeNull(); // SAMM3333 no longer exists
  });
});

// ---------------------------------------------------------------- Credit math
describe("credit math in integer cents", () => {
  it("discount code + referral discount + shipping (+ store credit spent): reward on the subtotal after all discounts, rounded down", async () => {
    await promo("SAVE10");
    await setReferrals({ percent: 10, buyerDiscountPercent: 5, allowStacking: true });
    await creditOps.adjustCredit({ customerId: "kim", amountCents: 1000, reason: "Giveaway", by: "Ahmad" });
    // 3 x $50 = 15000. SAVE10: -1500 -> 13500. Referral 5%: -675 -> 12825. Shipping +695. Store credit -1000.
    const o = await checkout({ items: [{ variantId: "ghk", quantity: 3 }], code: "SAVE10", storeCreditCents: 1000, expectedTotalCents: 12825 - 1000 + 695 });
    const row = await order(o.id);
    expect(row.discountValue).toBe(1500 + 675);
    const t = money.orderTotals({ ...row, discountType: "$" });
    expect(t.lineRevenue.reduce((a, b) => a + b, 0)).toBe(12825 - 1000); // spread over the lines in whole cents
    t.lineRevenue.forEach((c) => expect(Number.isInteger(c)).toBe(true));
    // 10% of 12825 = 1282.5 -> 1282 pending. Store credit spent and shipping don't change it.
    expect(await pending("sam")).toBe(1282);
    await paid(o.id);
    expect(await pending("sam")).toBe(0);
    expect(await balance("sam")).toBe(1282);
  });

  it("owner-price orders earn nothing", async () => {
    await sell.recordSale(sale({ id: "own", owner: "A", referredById: "sam", lines: sale().lines.map((l) => ({ ...l, unitPriceCents: 1000, fullPriceCents: 5000 })) }), ORIGIN);
    expect(await entries("own")).toEqual([]);
    expect(await balance("sam")).toBe(0);
  });

  it("referral credit is a cost like store credit: the business pays it when the credit is spent, never at earn time", async () => {
    const before = money.computeLedger(await ser.loadAll()).businessCents;
    const o = await checkout();
    await paid(o.id);
    const afterEarn = money.computeLedger(await ser.loadAll());
    // Earning: the sale counts in full (10000 + 695 shipping), the $10 credit is only a balance owed.
    expect(afterEarn.businessCents - before).toBe(10000 + 695);
    // Spending it on a later order: that order's revenue is $10 lower (like a discount), so payback,
    // the business cut and the 50/50 split all see $10 less.
    await sell.recordSale(sale({ id: "spend", customerId: "sam", customer: "Sam Lee", storeCreditCents: 1000 }), ORIGIN);
    const l = money.computeLedger(await ser.loadAll());
    expect(l.orders.get("spend")!.revenue).toBe(10000 - 1000);
    expect(l.orders.get("spend")!.credit).toBe(1000);
  });
});

// ---------------------------------------------------------------- Lifecycle
describe("credit lifecycle", () => {
  it("placed: PENDING (visible, not spendable); paid: AVAILABLE (ledger entries, no edits)", async () => {
    const o = await checkout();
    expect(await pending("sam")).toBe(1000);
    expect(await balance("sam")).toBe(0);
    await expect(creditOps.assertCreditAvailable(prisma, "sam", 100)).rejects.toThrow(/\$0\.00 store credit available/);
    await paid(o.id);
    const es = await entries(o.id);
    expect(es.map((e) => [e.amountCents, e.pending])).toEqual([
      [1000, true],
      [1000, false],
      [-1000, true],
    ]);
    expect(await balance("sam")).toBe(1000);
  });

  it("canceled before paid: the pending credit is reversed", async () => {
    const o = await checkout();
    await ops.cancelOrder(o.id, "Canceled: changed mind", { notify: false });
    expect(await pending("sam")).toBe(0);
    expect(await balance("sam")).toBe(0);
    expect((await entries(o.id)).at(-1)).toMatchObject({ amountCents: -1000, pending: true });
    // A refund needs a paid order.
    await expect(ops.refundOrder(o.id, { amountCents: 100, expectedRefundedCents: 0 })).rejects.toThrow(/canceled/);
  });

  it("canceled after paid: the available credit is reversed", async () => {
    const o = await checkout();
    await paid(o.id);
    await ops.cancelOrder(o.id, "Canceled: out of stock", { notify: false });
    expect(await balance("sam")).toBe(0);
  });

  it("full refund reverses all of it; revenue goes down by the refund", async () => {
    const o = await checkout();
    await paid(o.id);
    await ops.refundOrder(o.id, { amountCents: 10695, expectedRefundedCents: 0, reason: "Damaged" });
    expect(await balance("sam")).toBe(0);
    expect((await entries(o.id)).at(-1)!.reason).toMatch(/Referral reversed: order #\d+ refunded/);
    const r = money.computeLedger(await ser.loadAll()).orders.get(o.id)!;
    expect(r.revenue).toBe(0);
    expect(r.refunded).toBe(10695);
    expect((await order(o.id)).status).toBe("paid");
  });

  it("partial refunds reverse in proportion", async () => {
    const o = await checkout();
    await paid(o.id);
    // Paid $106.95. Refund $53.47 -> half the credit goes.
    await ops.refundOrder(o.id, { amountCents: 5347, expectedRefundedCents: 0 });
    expect(await balance("sam")).toBe(Math.floor((1000 * (10695 - 5347)) / 10695)); // 500
    await ops.refundOrder(o.id, { amountCents: 5348, expectedRefundedCents: 5347 });
    expect(await balance("sam")).toBe(0);
    await expect(ops.refundOrder(o.id, { amountCents: 1, expectedRefundedCents: 10695 })).rejects.toThrow(/fully refunded/);
  });

  it("a reversal bigger than the balance goes negative; it can't be spent; future credit pays it off first; admin flag", async () => {
    const o = await checkout();
    await paid(o.id);
    // Sam spends $7 of the $10.
    await sell.recordSale(sale({ id: "spend", customerId: "sam", customer: "Sam Lee", storeCreditCents: 700 }), ORIGIN);
    expect(await balance("sam")).toBe(300);
    await ops.refundOrder(o.id, { amountCents: 10695, expectedRefundedCents: 0 });
    expect(await balance("sam")).toBe(-700);
    const data = await ser.loadAll();
    expect(stats.referralSummary(data, "sam")).toMatchObject({ balanceCents: -700, negative: true });
    // Can't spend while negative.
    await expect(creditOps.assertCreditAvailable(prisma, "sam", 1)).rejects.toThrow(/\$0\.00 store credit available/);
    // Next referral pays the debt first: -700 + 1000 = 300.
    const o2 = await checkout();
    await paid(o2.id);
    expect(await balance("sam")).toBe(300);
    expect(stats.referralSummary(await ser.loadAll(), "sam").negative).toBe(false);
  });

  it("idempotent: marking paid twice, syncing twice, refunding twice and canceling twice never double-count", async () => {
    const o = await checkout();
    await paid(o.id);
    await expect(paid(o.id)).rejects.toThrow(/already marked paid/);
    const n = (await entries(o.id)).length;
    await prisma.$transaction((tx) => creditOps.syncOrderCredit(tx, o.id, { by: "test" }));
    await prisma.$transaction((tx) => creditOps.syncOrderCredit(tx, o.id, { by: "test" }));
    expect((await entries(o.id)).length).toBe(n);
    expect(await balance("sam")).toBe(1000);
    // The same refund submitted twice (double click): the second is refused.
    await ops.refundOrder(o.id, { amountCents: 5347, expectedRefundedCents: 0 });
    await expect(ops.refundOrder(o.id, { amountCents: 5347, expectedRefundedCents: 0 })).rejects.toThrow(/already has \$53\.47 refunded/);
    expect(await balance("sam")).toBe(500);
    await ops.cancelOrder(o.id, "Canceled", { notify: false });
    await expect(ops.cancelOrder(o.id, "Canceled", { notify: false })).rejects.toThrow(/already canceled/);
    expect(await balance("sam")).toBe(0);
  });

  it("the customer dashboard numbers and uses table (first name + last initial only)", async () => {
    const a = await checkout();
    await paid(a.id);
    await checkout(); // still pending
    const c = await checkout();
    await ops.cancelOrder(c.id, "Canceled", { notify: false });
    const { referralDashboard } = await import("./store/referral-dashboard");
    const d = await referralDashboard("sam");
    expect(d).toMatchObject({ code: "SAMM3333", uses: 3, earnedCents: 1000, pendingCents: 1000, balanceCents: 1000, negative: false });
    expect(d.useRows.map((u) => [u.buyer, u.creditCents, u.status]).sort()).toEqual(
      [
        ["Kim P.", 1000, "Available"],
        ["Kim P.", 1000, "Pending"],
        ["Kim P.", 0, "Reversed"],
      ].sort(),
    );
    const json = JSON.stringify(d);
    expect(json).not.toContain("kim@example.com");
    expect(json).not.toContain("Kim Park");
    expect(json).not.toContain("Oak Ave");
    expect(json).not.toContain("GHK");
  });
});

// ---------------------------------------------------------------- Migration
describe("migration on an existing database", () => {
  it("keeps every customer, code and credit entry; a referral code equal to a discount code is freed", async () => {
    const mdir = mkdtempSync(path.join(tmpdir(), "referral-migrate-"));
    try {
      // The schema and migrations as they were BEFORE the referral program.
      mkdirSync(path.join(mdir, "prisma", "migrations"), { recursive: true });
      cpSync(path.join(root, "prisma", "schema.prisma"), path.join(mdir, "prisma", "schema.prisma"));
      cpSync(path.join(root, "prisma", "migrations", "migration_lock.toml"), path.join(mdir, "prisma", "migrations", "migration_lock.toml"));
      const all = (await import("node:fs")).readdirSync(path.join(root, "prisma", "migrations")).filter((d) => /^\d{14}_/.test(d)).sort();
      const NEW = "20261123120000_referral_program";
      for (const m of all.filter((d) => d < NEW)) cpSync(path.join(root, "prisma", "migrations", m), path.join(mdir, "prisma", "migrations", m), { recursive: true });
      const url = `file:${path.join(mdir, "old.db").split(path.sep).join("/")}`;
      const env = { ...process.env, DATABASE_URL: url };
      const schema = path.join(mdir, "prisma", "schema.prisma");
      execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schema], { cwd: root, env, stdio: "pipe" });
      const { PrismaClient } = await import("@prisma/client");
      const db = new PrismaClient({ datasources: { db: { url } } });
      try {
        // Data as the live app has it today (raw SQL: the new columns don't exist yet).
        await db.$executeRawUnsafe(`INSERT INTO "Settings" ("id","storeJson","updatedAt") VALUES (1,'{"referrals":{"percent":12}}',CURRENT_TIMESTAMP)`);
        await db.$executeRawUnsafe(`INSERT INTO "Customer" ("id","name","referralCode") VALUES ('a','Ann Ames','ANNA7K2P'),('b','Bo Bell','SAVE10'),('c','Cy Cole',NULL)`);
        await db.$executeRawUnsafe(`INSERT INTO "Promotion" ("id","kind","code") VALUES ('p1','code','SAVE10')`);
        await db.$executeRawUnsafe(`INSERT INTO "CreditEntry" ("id","customerId","amountCents","kind","reason") VALUES ('e1','a',1500,'referral','Referral'),('e2','b',-200,'order','Used')`);
        await db.$executeRawUnsafe(`INSERT INTO "Order" ("id","date","customerId","referredById","status") VALUES ('o1',CURRENT_TIMESTAMP,'c','a','completed')`);
        // Apply the new migration.
        cpSync(path.join(root, "prisma", "migrations", NEW), path.join(mdir, "prisma", "migrations", NEW), { recursive: true });
        execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schema], { cwd: root, env, stdio: "pipe" });
        const q = <T,>(sql: string) => db.$queryRawUnsafe<T[]>(sql);
        expect(await q<{ n: bigint }>(`SELECT COUNT(*) AS n FROM "Customer"`)).toEqual([{ n: 3n }]);
        expect(await q<{ s: bigint }>(`SELECT SUM("amountCents") AS s FROM "CreditEntry"`)).toEqual([{ s: 1300n }]);
        expect(await q(`SELECT "id","referralCode" FROM "Customer" ORDER BY "id"`)).toEqual([
          { id: "a", referralCode: "ANNA7K2P" },
          { id: "b", referralCode: null }, // clashed with discount code SAVE10: freed, regenerated at start-up
          { id: "c", referralCode: null },
        ]);
        expect(await q(`SELECT "code","kind" FROM "CodeClaim" ORDER BY "code"`)).toEqual([
          { code: "ANNA7K2P", kind: "referral" },
          { code: "SAVE10", kind: "promo" },
        ]);
        // Old referred orders keep the % in Settings today and the referrer's code.
        expect(await q(`SELECT "referralRatePct","referralCode","refundedCents" FROM "Order"`)).toEqual([{ referralRatePct: 12, referralCode: "ANNA7K2P", refundedCents: 0 }]);
        // Triggers keep the shared namespace from now on.
        await expect(db.$executeRawUnsafe(`UPDATE "Customer" SET "referralCode"='SAVE10' WHERE "id"='c'`)).rejects.toThrow(/UNIQUE/);
      } finally {
        await db.$disconnect();
      }
    } finally {
      rmSync(mdir, { recursive: true, force: true });
    }
  }, 120_000);
});
