// Customer accounts, store credit and referrals against a real database (fresh SQLite, every migration).
// Cookies are a fake jar; emails go to a fake Resend. The admin API routes are called as real handlers.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const jar = vi.hoisted(() => {
  const m = new Map<string, string>();
  return {
    m,
    get: (k: string) => (m.has(k) ? { name: k, value: m.get(k)! } : undefined),
    set: (k: string, v: string) => void (v ? m.set(k, v) : m.delete(k)),
  };
});
vi.mock("next/headers", () => ({ cookies: async () => jar }));

const dir = mkdtempSync(path.join(tmpdir(), "accounts-credit-test-"));
const root = path.resolve(import.meta.dirname, "../..");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").split(path.sep).join("/")}`;
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.RESEND_API_KEY = "re_test_key";

let prisma: (typeof import("./db"))["prisma"];
let account: typeof import("./account");
let creditOps: typeof import("./credit-ops");
let sell: typeof import("./sell-ops");
let ops: typeof import("./order-ops");
let ser: typeof import("./serialize");
let money: typeof import("./money");
let session: typeof import("./session");

const sent: { to: string[]; subject: string; html: string; text: string }[] = [];
const realFetch = globalThis.fetch;
const ORIGIN = "http://localhost:3000";
const shipTo = { name: "Dana Reed", street1: "500 Oak Ave", street2: "", city: "Denver", state: "CO", zip: "80202", country: "US" };

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("./db"));
  account = await import("./account");
  creditOps = await import("./credit-ops");
  sell = await import("./sell-ops");
  ops = await import("./order-ops");
  ser = await import("./serialize");
  money = await import("./money");
  session = await import("./session");

  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith("https://api.resend.com/")) {
      const b = JSON.parse(String(init?.body));
      sent.push({ to: b.to, subject: b.subject, html: b.html, text: b.text });
      return new Response(JSON.stringify({ id: `email-${sent.length}` }), { status: 200 });
    }
    return realFetch(url as never, init);
  });

  const store = { open: true, siteUrl: "https://shop.test", payments: { zelle: { enabled: true, details: "pay@buckshot.test" } }, qtyDeals: [], alertEmails: [] };
  await prisma.settings.create({ data: { id: 1, startingBalanceCents: 0, storeJson: JSON.stringify(store) } });
  await prisma.listing.create({ data: { id: "l-ghk", name: "GHK-Cu", slug: "ghk-cu", showOnWebsite: true } });
  await prisma.product.create({ data: { id: "ghk", name: "GHK-Cu", variantLabel: "100mg", defaultPriceCents: 5000, listingId: "l-ghk" } });
  await prisma.purchase.create({ data: { id: "pu", date: new Date("2026-01-01T12:00:00Z"), productId: "ghk", quantity: 100, totalCostCents: 100000, fromInvestment: true } });
}, 120_000);

beforeEach(async () => {
  sent.length = 0;
  jar.m.clear();
  await prisma.creditEntry.deleteMany();
  await prisma.promotionUse.deleteMany();
  await prisma.orderEvent.deleteMany();
  await prisma.order.deleteMany();
  await prisma.savedOrder.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.customer.createMany({
    data: [
      { id: "dana", name: "Dana Reed", email: "dana@example.com", referralCode: "DANA2222" },
      { id: "sam", name: "Sam Lee", email: "", referralCode: "SAMM3333" },
      { id: "kim", name: "Kim Park", email: "kim@example.com", referralCode: "KIMP4444", passwordHash: "$2a$11$abcdefghijklmnopqrstuuSdlbZb2l0g0v9R0QO1Xq7T0Q5Q9Gk6e" },
    ],
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const tokenOf = (url: string) => new URL(url).searchParams.get("token")!;
const balance = (id: string) => creditOps.creditBalance(prisma, id);
const give = (id: string, cents: number) => creditOps.adjustCredit({ customerId: id, amountCents: cents, reason: "Giveaway", by: "Ahmad" });

/** An in-person sale of `qty` GHK-Cu at $50 (cost $10). */
function sale(over: Record<string, unknown> = {}) {
  const id = (over.id as string) ?? `s-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    date: new Date("2026-03-01T12:00:00Z"),
    customer: "Dana Reed",
    customerId: "dana",
    paymentMethod: "Cash",
    note: "",
    soldBy: "A" as const,
    discountType: "$" as const,
    discountValue: 0,
    tipCents: 0,
    owner: null,
    cashTo: null,
    storeCreditCents: 0,
    referredById: null as string | null,
    lines: [{ id: `${id}-l`, productId: "ghk", productName: "GHK-Cu 100mg", quantity: 2, unitPriceCents: 5000, unitCostCents: 1000, cutPercent: 10, dealId: "", dealName: "", fullPriceCents: null }],
    ...over,
  };
}

const checkout = (over: Partial<Parameters<(typeof ops)["placeOrder"]>[0]> = {}) =>
  ops.placeOrder({ customerId: "kim", name: "Kim Park", email: "kim@example.com", phone: "", shipTo, items: [{ variantId: "ghk", quantity: 2 }], code: "", tier: "standard", payChoice: "zelle", expectedTotalCents: 10000 + 695, origin: ORIGIN, ...over });

async function adminCookie() {
  const { token } = await session.createSessionToken();
  jar.set(session.SESSION_COOKIE, token);
}
const req = (url: string, method: string, body: unknown) => new NextRequest(`${ORIGIN}${url}`, { method, body: JSON.stringify(body), headers: { "content-type": "application/json", host: "localhost:3000" } });

// ---------------------------------------------------------------- Invites
describe("invite links", () => {
  it("open with the name and the right store credit, set a hashed password, sign in, and work only once", async () => {
    await give("dana", 2500);
    const link = await account.newInviteLink("dana", ORIGIN);
    expect(link.days).toBe(14);
    expect(link.expiresAt.getTime() - Date.now()).toBeGreaterThan(13.9 * 86_400_000);
    const token = tokenOf(link.url);
    expect(await account.inviteInfo(token)).toEqual({ name: "Dana Reed", creditCents: 2500 });
    // Only a hash of the token is stored.
    const row = await prisma.customer.findUnique({ where: { id: "dana" } });
    expect(row!.inviteTokenHash).not.toContain(token);

    const acc = await account.claimInvite(token, "a-good-password");
    expect(acc.id).toBe("dana");
    expect(jar.get(account.ACCOUNT_COOKIE)?.value).toBeTruthy();
    const after = await prisma.customer.findUnique({ where: { id: "dana" } });
    expect(after!.passwordHash).toMatch(/^\$2[aby]\$11\$/);
    expect(after!.passwordHash).not.toContain("a-good-password");
    expect(after!.inviteTokenHash).toBeNull();
    expect(after!.lastLoginAt).toBeTruthy();
    expect(ser.toCustomer(after!).accountStatus).toBe("active");

    // Single use.
    expect(await account.inviteInfo(token)).toBeNull();
    await expect(account.claimInvite(token, "another-password")).rejects.toThrow(/expired or was already used/);
  });

  it("expire", async () => {
    const token = tokenOf((await account.newInviteLink("dana", ORIGIN)).url);
    await prisma.customer.update({ where: { id: "dana" }, data: { inviteExpiresAt: new Date(Date.now() - 1000) } });
    expect(await account.inviteInfo(token)).toBeNull();
    await expect(account.claimInvite(token, "a-good-password")).rejects.toThrow(/expired/);
    expect((await prisma.customer.findUnique({ where: { id: "dana" } }))!.passwordHash).toBeNull();
  });

  it("making a new link turns off the old one", async () => {
    const old = tokenOf((await account.newInviteLink("dana", ORIGIN)).url);
    const fresh = tokenOf((await account.newInviteLink("dana", ORIGIN)).url);
    expect(old).not.toBe(fresh);
    expect(await account.inviteInfo(old)).toBeNull();
    await expect(account.claimInvite(old, "a-good-password")).rejects.toThrow();
    await account.claimInvite(fresh, "a-good-password");
    expect((await prisma.customer.findUnique({ where: { id: "dana" } }))!.passwordHash).toBeTruthy();
  });

  it("need an email, and the invite email carries the link and the credit", async () => {
    await expect(account.newInviteLink("sam", ORIGIN)).rejects.toThrow(/Add an email/);
    await give("dana", 1200);
    const out = await account.sendInvite("dana", ORIGIN);
    expect(out.sent).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["dana@example.com"]);
    expect(sent[0].text).toContain("$12.00 store credit");
    expect(sent[0].text).toMatch(/https:\/\/shop\.test\/account\/invite\?token=/);
  });
});

// ---------------------------------------------------------------- Sign up with a known email
describe("signing up with an email that already belongs to a customer", () => {
  it("never signs in or creates anything: it emails a claim link instead", async () => {
    await give("dana", 4000);
    const r = await account.signUp({ name: "Someone Else", email: "DANA@example.com", password: "attacker-password" }, ORIGIN);
    expect(r).toEqual({ claim: true, message: "This email already has an account with us. We sent a link to claim it." });
    expect(jar.get(account.ACCOUNT_COOKIE)).toBeUndefined();
    const row = await prisma.customer.findUnique({ where: { id: "dana" } });
    expect(row!.passwordHash).toBeNull(); // the typed password was NOT attached
    expect(row!.name).toBe("Dana Reed");
    expect(await prisma.customer.count()).toBe(3);
    // The claim link went to the real inbox, and it works there.
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["dana@example.com"]);
    expect(sent[0].subject).toMatch(/Claim your/);
    const token = sent[0].text.match(/token=([A-Za-z0-9_-]+)/)![1];
    expect(await account.inviteInfo(token)).toEqual({ name: "Dana Reed", creditCents: 4000 });
  });

  it("same for an account that already has a password: its password is not touched", async () => {
    const before = (await prisma.customer.findUnique({ where: { id: "kim" } }))!.passwordHash;
    const r = await account.signUp({ name: "Kim", email: "kim@example.com", password: "attacker-password" }, ORIGIN);
    expect("claim" in r).toBe(true);
    expect(jar.get(account.ACCOUNT_COOKIE)).toBeUndefined();
    expect((await prisma.customer.findUnique({ where: { id: "kim" } }))!.passwordHash).toBe(before);
  });

  it("a new email still creates a normal account with a hashed password", async () => {
    const r = await account.signUp({ name: "New Person", email: "new@example.com", password: "brand-new-pass" }, ORIGIN);
    expect("account" in r).toBe(true);
    const row = await prisma.customer.findFirst({ where: { email: "new@example.com" } });
    expect(row!.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(row!.referralCode).toMatch(/^[A-Z2-9]{8}$/);
  });
});

// ---------------------------------------------------------------- Passwords never leave the server
describe("passwords are hashed and never returned", () => {
  const leaks = (json: unknown) => {
    const text = JSON.stringify(json);
    return /passwordHash|resetTokenHash|inviteTokenHash|\$2[aby]\$|temp-pass-1234/.test(text);
  };

  it("admin customer API: create, edit, account actions and /api/data", async () => {
    await adminCookie();
    const { POST: create } = await import("../app/api/customers/route");
    const { PATCH } = await import("../app/api/customers/[id]/route");
    const { POST: accountAction } = await import("../app/api/customers/[id]/account/route");
    const { GET: dataRoute } = await import("../app/api/data/route");

    const created = await create(req("/api/customers", "POST", { id: "neo", name: "Neo", email: "Neo@Example.com", phone: "", notes: "" }), { params: Promise.resolve({}) });
    expect(created.status).toBe(200);
    const c = await created.json();
    expect(c).toMatchObject({ id: "neo", email: "neo@example.com", accountStatus: "invited", hasAccount: false });
    expect(leaks(c)).toBe(false);

    // Email must be unique.
    const dup = await create(req("/api/customers", "POST", { id: "neo2", name: "Neo 2", email: "dana@example.com" }), { params: Promise.resolve({}) });
    expect(dup.status).toBe(409);

    const tmp = await accountAction(req("/api/customers/neo/account", "POST", { action: "temp-password", password: "temp-pass-1234" }), { params: Promise.resolve({ id: "neo" }) });
    const tmpJson = await tmp.json();
    expect(tmp.status).toBe(200);
    expect(tmpJson.customer).toMatchObject({ accountStatus: "active", mustChangePassword: true });
    expect(leaks(tmpJson)).toBe(false);
    const stored = (await prisma.customer.findUnique({ where: { id: "neo" } }))!.passwordHash!;
    expect(stored).toMatch(/^\$2[aby]\$11\$/);
    expect(stored).not.toContain("temp-pass-1234");

    const patched = await PATCH(req("/api/customers/neo", "PATCH", { name: "Neo A." }), { params: Promise.resolve({ id: "neo" }) });
    expect(leaks(await patched.json())).toBe(false);

    const link = await accountAction(req("/api/customers/dana/account", "POST", { action: "invite-link" }), { params: Promise.resolve({ id: "dana" }) });
    const linkJson = await link.json();
    expect(linkJson.url).toMatch(/\/account\/invite\?token=/);
    expect(leaks(linkJson)).toBe(false);

    const all = await (await dataRoute(req("/api/data", "GET", undefined), { params: Promise.resolve({}) })).json();
    expect(all.customers.length).toBeGreaterThanOrEqual(4);
    expect(leaks(all)).toBe(false);
  });

  it("a temporary password must be changed at the next sign in", async () => {
    await account.setTemporaryPassword("dana", "temp-pass-1234");
    const signed = await account.signIn({ email: "dana@example.com", password: "temp-pass-1234" });
    expect(signed.mustChangePassword).toBe(true);
    await expect(account.requireAccount()).rejects.toThrow(/Choose a new password/);
    await account.changePassword("dana", "my-own-password");
    expect((await account.requireAccount()).mustChangePassword).toBe(false);
    await expect(account.signIn({ email: "dana@example.com", password: "temp-pass-1234" })).rejects.toThrow();
    expect((await prisma.customer.findUnique({ where: { id: "dana" } }))!.lastLoginAt).toBeTruthy();
  });

  it("admin reset link goes only to accounts with a password", async () => {
    await expect(account.sendPasswordReset("dana", ORIGIN)).rejects.toThrow(/invite link instead/);
    const out = await account.sendPasswordReset("kim", ORIGIN);
    expect(out.sent).toBe(true);
    expect(sent.at(-1)!.to).toEqual(["kim@example.com"]);
  });
});

// ---------------------------------------------------------------- Store credit
describe("store credit", () => {
  it("in person: apply all or part; deducted when completed; works like a discount in the money", async () => {
    await give("dana", 3000);
    const before = money.computeLedger(await ser.loadAll());
    await sell.recordSale(sale({ id: "p1", storeCreditCents: 1200 }), ORIGIN);
    expect(await balance("dana")).toBe(1800);
    await sell.recordSale(sale({ id: "p2", storeCreditCents: 1800 }), ORIGIN); // the rest of it
    expect(await balance("dana")).toBe(0);
    const data = await ser.loadAll();
    const ledger = money.computeLedger(data);
    const r = ledger.orders.get("p1")!;
    expect(r).toMatchObject({ subtotal: 10000, credit: 1200, revenue: 8800, cost: 2000, profit: 6800, total: 8800 });
    expect(ledger.businessCents - before.businessCents).toBe(8800 + 8200);
    const hist = data.creditEntries!.filter((e) => e.orderId === "p1");
    expect(hist).toEqual([expect.objectContaining({ amountCents: -1200, kind: "order", reason: expect.stringMatching(/^Used on order #\d+$/), by: "Ahmad" })]);
  });

  it("can't use more than the balance or more than the total", async () => {
    await give("dana", 1000);
    await expect(sell.recordSale(sale({ storeCreditCents: 1500 }), ORIGIN)).rejects.toThrow(/\$10\.00 store credit available/);
    expect(await prisma.order.count()).toBe(0);
    await give("dana", 50000);
    await sell.recordSale(sale({ id: "big", storeCreditCents: 50000 }), ORIGIN);
    const o = await prisma.order.findUnique({ where: { id: "big" } });
    expect(o!.storeCreditCents).toBe(10000); // capped at the $100 order
    expect(await balance("dana")).toBe(51000 - 10000);
    // A walk-in (no customer) can't use credit at all.
    await sell.recordSale(sale({ id: "walk", customerId: null, customer: "", storeCreditCents: 500 }), ORIGIN);
    expect((await prisma.order.findUnique({ where: { id: "walk" } }))!.storeCreditCents).toBe(0);
  });

  it("saved orders keep the credit but only take it when completed; deleting the sale gives it back", async () => {
    await give("dana", 2000);
    const s = sale({ id: "sv1", storeCreditCents: 1500 });
    const { date: _d, ...savedInput } = s;
    await sell.saveOrderForLater({ ...savedInput, lines: s.lines.map((l) => ({ ...l, listPriceCents: 5000 })) }, ORIGIN);
    expect((await prisma.savedOrder.findUnique({ where: { id: "sv1" } }))!.storeCreditCents).toBe(1500);
    expect(await balance("dana")).toBe(2000); // not taken yet
    // Held: another order can't spend it meanwhile.
    expect((await creditOps.creditAvailable(prisma, "dana")).available).toBe(500);
    await expect(sell.recordSale(sale({ storeCreditCents: 1000 }), ORIGIN)).rejects.toThrow(/held by other open orders/);
    // Complete it.
    await sell.recordSale(s, ORIGIN, "sv1");
    expect(await balance("dana")).toBe(500);
    // Undo (delete the sale): refunded.
    const { DELETE } = await import("../app/api/orders/[id]/route");
    await adminCookie();
    const res = await DELETE(req("/api/orders/sv1", "DELETE", undefined), { params: Promise.resolve({ id: "sv1" }) });
    expect(res.status).toBe(200);
    expect(await balance("dana")).toBe(2000);
    const refund = await prisma.creditEntry.findFirst({ where: { orderId: "sv1", amountCents: 1500 } });
    expect(refund!.reason).toMatch(/^Refund: order #\d+ deleted$/);
  });

  it("online: held while unpaid, taken when marked paid, refunded when canceled", async () => {
    await give("kim", 3000);
    await expect(checkout({ storeCreditCents: 3500, expectedTotalCents: 10000 - 3500 + 695 })).rejects.toThrow(/\$30\.00 store credit available/);
    const web = await checkout({ storeCreditCents: 2000, expectedTotalCents: 10000 - 2000 + 695 });
    expect(await balance("kim")).toBe(3000); // not paid yet: nothing taken
    expect((await creditOps.creditAvailable(prisma, "kim")).available).toBe(1000);
    await ops.markPaid(web.id, { paymentMethod: "Zelle", notify: false });
    expect(await balance("kim")).toBe(1000);
    const ledger = money.computeLedger(await ser.loadAll());
    expect(ledger.orders.get(web.id)).toMatchObject({ credit: 2000, revenue: 8000, shipping: 695, total: 8695 });
    await ops.cancelOrder(web.id, "Canceled: out of stock", { notify: false });
    expect(await balance("kim")).toBe(3000);
  });

  it("an unpaid order that is canceled never took anything", async () => {
    await give("kim", 3000);
    const web = await checkout({ storeCreditCents: 3000, expectedTotalCents: 10000 - 3000 + 695 });
    await ops.cancelOrder(web.id, ops.CANCEL_UNPAID_REASON, { notify: false, by: "Automatic" });
    expect(await balance("kim")).toBe(3000);
    expect(await prisma.creditEntry.count({ where: { orderId: web.id } })).toBe(0);
    expect((await creditOps.creditAvailable(prisma, "kim")).available).toBe(3000);
  });

  it("manual changes need a reason and never take the balance below $0", async () => {
    await expect(creditOps.adjustCredit({ customerId: "dana", amountCents: 500, reason: "  ", by: "Mo" })).rejects.toThrow(/reason/);
    await give("dana", 500);
    await expect(creditOps.adjustCredit({ customerId: "dana", amountCents: -600, reason: "Correction", by: "Mo" })).rejects.toThrow(/can't be removed/);
    await creditOps.adjustCredit({ customerId: "dana", amountCents: -500, reason: "Correction", by: "Mo" });
    expect(await balance("dana")).toBe(0);
  });
});

// ---------------------------------------------------------------- Referrals
describe("referrals", () => {
  it("in person: 10% of the order after discounts and store credit, without the tip", async () => {
    await give("dana", 1000);
    await sell.recordSale(sale({ id: "r1", referredById: "sam", discountValue: 555, storeCreditCents: 1000, tipCents: 2000 }), ORIGIN);
    // 10000 - 5.55 - 10.00 = 84.45; 10% = 8.445 -> $8.45 (rounded to cents)
    expect(await balance("sam")).toBe(845);
    const e = await prisma.creditEntry.findFirst({ where: { customerId: "sam" } });
    expect(e).toMatchObject({ kind: "referral", orderId: "r1", by: "Ahmad" });
    expect(e!.reason).toMatch(/^Referral: Dana Reed's order #\d+ \(10%\)$/);
    // The customer now remembers who referred them.
    expect((await prisma.customer.findUnique({ where: { id: "dana" } }))!.referredById).toBe("sam");
  });

  it("online: only when marked paid, without shipping; the referral code sets Referred by", async () => {
    await expect(checkout({ referralCode: "NOPE9999" })).rejects.toThrow(/wasn't found/);
    await expect(checkout({ referralCode: "kimp4444" })).rejects.toThrow(/your own referral code/);
    const web = await checkout({ referralCode: " samm3333 " });
    expect((await prisma.order.findUnique({ where: { id: web.id } }))!.referredById).toBe("sam");
    expect(await balance("sam")).toBe(0); // unpaid: nothing yet
    await ops.markPaid(web.id, { paymentMethod: "Zelle", notify: false });
    expect(await balance("sam")).toBe(1000); // 10% of $100, not of $106.95
    // Canceled after paying: taken back.
    await ops.cancelOrder(web.id, "Canceled: refunded", { notify: false });
    expect(await balance("sam")).toBe(0);
    expect(await prisma.creditEntry.findFirst({ where: { customerId: "sam", amountCents: -1000 } })).toMatchObject({ reason: expect.stringMatching(/Referral reversed: order #\d+ canceled/) });
  });

  it("no self-referral and none on owner price", async () => {
    await expect(sell.recordSale(sale({ referredById: "dana" }), ORIGIN)).rejects.toThrow(/can't refer themselves/);
    await sell.recordSale(sale({ id: "own", owner: "A", referredById: "sam", lines: sale().lines.map((l) => ({ ...l, unitPriceCents: 1000 })) }), ORIGIN);
    expect(await balance("sam")).toBe(0);
  });

  it("a reversal stops at $0 and notes the shortfall", async () => {
    await sell.recordSale(sale({ id: "r2", referredById: "sam" }), ORIGIN);
    expect(await balance("sam")).toBe(1000);
    // Sam spends $7 of it.
    await sell.recordSale(sale({ id: "spend", customerId: "sam", customer: "Sam Lee", storeCreditCents: 700 }), ORIGIN);
    expect(await balance("sam")).toBe(300);
    await adminCookie();
    const { DELETE } = await import("../app/api/orders/[id]/route");
    await DELETE(req("/api/orders/r2", "DELETE", undefined), { params: Promise.resolve({ id: "r2" }) });
    expect(await balance("sam")).toBe(0);
    const rev = await prisma.creditEntry.findFirst({ where: { orderId: "r2", amountCents: { lt: 0 } } });
    expect(rev).toMatchObject({ amountCents: -300, shortfallCents: 700 });
    expect(rev!.reason).toMatch(/\$7\.00 could not be taken back/);
  });

  it("first order only, and the new customer's own reward, follow Settings", async () => {
    await prisma.settings.update({ where: { id: 1 }, data: { storeJson: JSON.stringify({ open: true, siteUrl: "https://shop.test", payments: { zelle: { enabled: true, details: "x" } }, qtyDeals: [], referrals: { percent: 10, firstOrderOnly: true, newCustomerPercent: 5 } }) } });
    try {
      await sell.recordSale(sale({ id: "f1", referredById: "sam" }), ORIGIN);
      await sell.recordSale(sale({ id: "f2", referredById: "sam", date: new Date("2026-03-02T12:00:00Z") }), ORIGIN);
      expect(await balance("sam")).toBe(1000); // only the first order
      expect(await balance("dana")).toBe(500); // 5% of her first order
    } finally {
      await prisma.settings.update({ where: { id: 1 }, data: { storeJson: JSON.stringify({ open: true, siteUrl: "https://shop.test", payments: { zelle: { enabled: true, details: "pay@buckshot.test" } }, qtyDeals: [] }) } });
    }
  });
});
