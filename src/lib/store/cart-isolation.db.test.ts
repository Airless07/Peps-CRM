// Proof that every account has its own cart and nothing of one account reaches another.
// Real database (fresh SQLite, every migration), real route handlers, real password sign in.
// The cookie jar stands in for one browser: signing in as B after A is "the same computer".
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => {
  const m = new Map<string, string>();
  return { m, get: (k: string) => (m.has(k) ? { name: k, value: m.get(k)! } : undefined), set: (k: string, v: string) => void (v ? m.set(k, v) : m.delete(k)) };
});
vi.mock("next/headers", () => ({ cookies: async () => jar }));

const dir = mkdtempSync(path.join(tmpdir(), "cart-test-"));
const root = path.resolve(import.meta.dirname, "../../..");
const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").split(path.sep).join("/")}`;
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";

let prisma: (typeof import("../db"))["prisma"];
let cartRoute: typeof import("../../app/api/store/cart/route");
let quoteRoute: typeof import("../../app/api/store/quote/route");
let checkoutRoute: typeof import("../../app/api/store/checkout/route");
let accountRoute: typeof import("../../app/api/store/account/route");
let logoutRoute: typeof import("../../app/api/auth/logout/route");
let orderView: typeof import("./order-view");
let middleware: (typeof import("../../middleware"))["middleware"];
let session: typeof import("../session");
let cartLib: typeof import("./cart-server");

const BASE = "http://store.test";
const STORE = { open: true, siteUrl: BASE, payments: { zelle: { enabled: true, details: "pay@x.test" } }, qtyDeals: [], alertEmails: [] };
const shipTo = { name: "Ann Lee", street1: "1 Main St", street2: "", city: "Denver", state: "CO", zip: "80202", country: "US" };

const req = (url: string, method = "GET", body?: unknown) =>
  new NextRequest(`${BASE}${url}`, { method, headers: { host: "store.test", origin: BASE, "content-type": "application/json", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = { params: Promise.resolve({}) } as never;
const fresh = () => ((globalThis as { __storeSnap?: unknown }).__storeSnap = undefined);
async function call(handler: (r: NextRequest, c: never) => Promise<Response>, url: string, method = "GET", body?: unknown) {
  fresh();
  const res = await handler(req(url, method, body), ctx);
  return { status: res.status, headers: res.headers, json: (await res.json()) as Record<string, any> };
}
const cart = {
  get: () => call(cartRoute.GET, "/api/store/cart"),
  save: (accountId: string | null, items: unknown[], code = "", referral = "") => call(cartRoute.POST, "/api/store/cart", "POST", { action: "save", accountId, items, code, referral }),
  merge: (accountId: string | null, items: unknown[]) => call(cartRoute.POST, "/api/store/cart", "POST", { action: "merge", accountId, items }),
  add: (accountId: string | null, variantId: string, quantity: number, items: unknown[] = []) => call(cartRoute.POST, "/api/store/cart", "POST", { action: "add", accountId, variantId, quantity, items }),
};
const account = (body: Record<string, unknown>) => call(accountRoute.POST, "/api/store/account", "POST", body);
const signIn = async (email: string) => (await account({ action: "signin", email, password: "password-123" })).json.account.id as string;
const signOut = () => account({ action: "signout" });
const quote = (body: Record<string, unknown>) => call(quoteRoute.POST, "/api/store/quote", "POST", { code: "", referralCode: "", ...body });

let A = "";
let B = "";

beforeAll(async () => {
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("../db"));
  cartRoute = await import("../../app/api/store/cart/route");
  quoteRoute = await import("../../app/api/store/quote/route");
  checkoutRoute = await import("../../app/api/store/checkout/route");
  accountRoute = await import("../../app/api/store/account/route");
  logoutRoute = await import("../../app/api/auth/logout/route");
  orderView = await import("./order-view");
  ({ middleware } = await import("../../middleware"));
  session = await import("../session");
  cartLib = await import("./cart-server");
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: "x" }), { status: 200 }));
  await prisma.settings.create({ data: { id: 1, startingBalanceCents: 0, storeJson: JSON.stringify(STORE) } });
  await prisma.listing.create({ data: { id: "l-bpc", name: "BPC-157", slug: "bpc-157", showOnWebsite: true } });
  await prisma.product.create({ data: { id: "bpc", name: "BPC-157", variantLabel: "10mg", defaultPriceCents: 5000, listingId: "l-bpc" } });
  await prisma.listing.create({ data: { id: "l-reta", name: "Retatrutide", slug: "retatrutide", showOnWebsite: true } });
  await prisma.product.create({ data: { id: "reta10", name: "Retatrutide", variantLabel: "10mg", defaultPriceCents: 9000, listingId: "l-reta" } });
  await prisma.product.create({ data: { id: "reta20", name: "Retatrutide", variantLabel: "20mg", defaultPriceCents: 15000, listingId: "l-reta", variantSort: 1 } });
  // Stock: 50 BPC, 5 Retatrutide 10mg, 0 of the 20mg (sold out).
  await prisma.purchase.create({ data: { id: "p1", date: new Date("2026-01-01T12:00:00Z"), productId: "bpc", quantity: 50, totalCostCents: 60000, fromInvestment: true } });
  await prisma.purchase.create({ data: { id: "p2", date: new Date("2026-01-01T12:00:00Z"), productId: "reta10", quantity: 5, totalCostCents: 15000, fromInvestment: true } });
  // Two accounts on the same browser. A is the owner of the business (also an admin), B a normal customer.
  await account({ action: "signup", name: "Ann Owner", email: "ann@example.com", password: "password-123" });
  await account({ action: "signup", name: "Ben Buyer", email: "ben@example.com", password: "password-123" });
  A = (await prisma.customer.findFirstOrThrow({ where: { email: "ann@example.com" } })).id;
  B = (await prisma.customer.findFirstOrThrow({ where: { email: "ben@example.com" } })).id;
  await prisma.promotion.create({ data: { id: "promo10", kind: "code", code: "SAVE10", name: "10% off", discountType: "%", discountValue: 10 } });
}, 180_000);

beforeEach(async () => {
  jar.m.clear();
  await prisma.customerCart.deleteMany();
});

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("every account has its own cart", () => {
  it("A's cart and codes are never visible to B on the same browser, and A gets them back", async () => {
    expect(await signIn("ann@example.com")).toBe(A);
    const saved = await cart.save(A, [{ variantId: "bpc", quantity: 2 }], "SAVE10", "");
    expect(saved.status).toBe(200);
    expect((await cart.get()).json).toMatchObject({ accountId: A, items: [{ variantId: "bpc", quantity: 2 }], code: "SAVE10" });

    await signOut();
    // Signed out: no account cart at all.
    expect((await cart.get()).json).toMatchObject({ accountId: null, items: [], code: "", referral: "" });

    expect(await signIn("ben@example.com")).toBe(B);
    const asB = await cart.get();
    expect(asB.json).toMatchObject({ accountId: B, items: [], code: "", referral: "" });
    // B's quote never carries A's code or A's credit.
    const q = await quote({ items: [{ variantId: "bpc", quantity: 1 }] });
    expect(q.json.accountId).toBe(B);
    expect(q.json.code).toBe("");

    await signOut();
    await signIn("ann@example.com");
    expect((await cart.get()).json).toMatchObject({ accountId: A, items: [{ variantId: "bpc", quantity: 2 }] });
  });

  it("a cart save for another account is refused and writes nothing (tab still showing A after B signed in)", async () => {
    await signIn("ben@example.com");
    const r = await cart.save(A, [{ variantId: "bpc", quantity: 9 }], "SAVE10");
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ accountChanged: true, accountId: B });
    expect(await prisma.customerCart.findUnique({ where: { customerId: A } })).toBeNull();
    expect(await prisma.customerCart.findUnique({ where: { customerId: B } })).toBeNull();
    // A guest browser can't save into any account either.
    await signOut();
    expect((await cart.save(B, [{ variantId: "bpc", quantity: 1 }])).status).toBe(401);
  });

  it("signing in merges the guest cart (quantities added, capped at stock) and drops every code", async () => {
    await signIn("ann@example.com");
    await cart.save(A, [{ variantId: "bpc", quantity: 1 }, { variantId: "reta10", quantity: 3 }], "SAVE10", "SOMEONE");
    await signOut();
    await signIn("ann@example.com");
    const m = await cart.merge(A, [{ variantId: "bpc", quantity: 2 }, { variantId: "reta10", quantity: 4 }, { variantId: "nope", quantity: 1 }]);
    expect(m.status).toBe(200);
    expect(m.json.items).toEqual([
      { variantId: "bpc", quantity: 3 },
      { variantId: "reta10", quantity: 5 }, // 3 + 4 capped at the 5 in stock
    ]);
    expect(m.json.code).toBe("");
    expect(m.json.referral).toBe("");
    const row = await prisma.customerCart.findUniqueOrThrow({ where: { customerId: A } });
    expect([row.code, row.referral]).toEqual(["", ""]);
  });

  it("signing out ends both sessions (store and admin) in this browser", async () => {
    await signIn("ann@example.com");
    const { token } = await (await import("../admin-auth")).createAdminToken();
    jar.set(session.SESSION_COOKIE, token);
    await signOut();
    expect(jar.m.size).toBe(0);
    // And the admin sign out ends the store session too.
    await signIn("ann@example.com");
    jar.set(session.SESSION_COOKIE, token);
    const res = await logoutRoute.POST();
    const set = res.headers.getSetCookie().join("\n");
    expect(set).toMatch(/peps_session=;/);
    expect(set).toMatch(/peps_account=;/);
  });
});

describe("quick add respects stock and goes to the right cart", () => {
  it("caps at stock, refuses sold out, and saves only into the signed-in account", async () => {
    await signIn("ben@example.com");
    const one = await cart.add(B, "reta10", 3);
    expect(one.json).toMatchObject({ added: 3, capped: false });
    const two = await cart.add(B, "reta10", 4, one.json.items);
    expect(two.json).toMatchObject({ added: 2, capped: true, available: 5, message: "Only 5 available. 2 added." });
    expect(two.json.items).toEqual([{ variantId: "reta10", quantity: 5 }]);
    const out = await cart.add(B, "reta20", 1, two.json.items);
    expect(out.json).toMatchObject({ added: 0, message: "Sold out." });
    expect((await cart.get()).json.items).toEqual([{ variantId: "reta10", quantity: 5 }]);
    expect(await prisma.customerCart.findUnique({ where: { customerId: A } })).toBeNull();
    // Wrong account id: refused, nothing added anywhere.
    const wrong = await cart.add(A, "bpc", 1);
    expect(wrong.status).toBe(409);
  });

  it("guests get the capped cart back and nothing is stored on the server", async () => {
    const r = await cart.add(null, "bpc", 2, [{ variantId: "bpc", quantity: 1 }]);
    expect(r.json).toMatchObject({ accountId: null, added: 2, items: [{ variantId: "bpc", quantity: 3 }] });
    expect(await prisma.customerCart.count()).toBe(0);
  });
});

describe("prices are worked out on the server for the account signed in now", () => {
  it("an order can't be placed with a cart built for another account", async () => {
    await signIn("ben@example.com");
    const q = await quote({ items: [{ variantId: "bpc", quantity: 1 }], shipTo });
    const total = q.json.subtotalCents - q.json.discountCents + q.json.shipping[0].cents;
    const r = await call(checkoutRoute.POST, "/api/store/checkout", "POST", {
      accountId: A, phone: "", shipTo, items: [{ variantId: "bpc", quantity: 1 }], code: "", tier: q.json.shipping[0].tier, payChoice: "zelle", expectedTotalCents: total, consent: true,
    });
    expect(r.status).toBe(409);
    expect(await prisma.order.count()).toBe(0);
  });

  it("checkout consent: refused on the server without the box; saved on the order (text, time, IP) with it", async () => {
    await signIn("ben@example.com");
    const items = [{ variantId: "bpc", quantity: 1 }];
    const q = await quote({ items, shipTo });
    const total = q.json.subtotalCents - q.json.discountCents + q.json.shipping[0].cents;
    const base = { accountId: B, phone: "", shipTo, items, code: "", tier: q.json.shipping[0].tier, payChoice: "zelle", expectedTotalCents: total };
    for (const consent of [undefined, false]) {
      const r = await call(checkoutRoute.POST, "/api/store/checkout", "POST", { ...base, ...(consent === undefined ? {} : { consent }) });
      expect(r.status).toBe(400);
      expect(r.json.error).toMatch(/Tick the box to confirm your age/);
    }
    expect(await prisma.order.count()).toBe(0);
    const before = Date.now();
    const ok = await call(checkoutRoute.POST, "/api/store/checkout", "POST", { ...base, consent: true });
    expect(ok.status).toBe(200);
    const o = await prisma.order.findFirstOrThrow({ where: { number: ok.json.number } });
    expect(o.consentAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(o.consentText).toBe("I confirm I am 21 or older and this purchase is for laboratory research use only, not for human consumption. I agree to the Terms and Research Use Policy.");
    expect(o.consentIp).toMatch(/^10\.0\.0\.\d+$/);
    // In-person (Sell) orders never carry it.
    expect(await prisma.order.count({ where: { source: { not: "online" }, consentAt: { not: null } } })).toBe(0);
    await prisma.order.deleteMany();
  });

  it("a guest-built cart with more than is in stock is refused at checkout", async () => {
    await signIn("ben@example.com");
    const items = [{ variantId: "reta10", quantity: 6 }]; // 5 in stock
    const q = await quote({ items, shipTo });
    const total = q.json.subtotalCents - q.json.discountCents + q.json.shipping[0].cents;
    const r = await call(checkoutRoute.POST, "/api/store/checkout", "POST", { accountId: B, phone: "", shipTo, items, code: "", tier: q.json.shipping[0].tier, payChoice: "zelle", expectedTotalCents: total, consent: true });
    expect(r.status).toBe(409);
    expect(r.json.error).toMatch(/^Only 5 Retatrutide 10mg left\./);
    expect(await prisma.order.count()).toBe(0);
  });

  it("owner price never applies to a website order: not for the owner, not for anyone, whatever the browser sends", async () => {
    // Ann is also the admin (owner) and is signed in to both. The web cart is priced at the normal price.
    await signIn("ann@example.com");
    const { token } = await (await import("../admin-auth")).createAdminToken();
    jar.set(session.SESSION_COOKIE, token);
    const q = await quote({ items: [{ variantId: "bpc", quantity: 2 }], owner: "A", ownerPrice: true, shipTo });
    expect(q.json.lines[0].unitPriceCents).toBe(5000);
    const total = q.json.subtotalCents - q.json.discountCents + q.json.shipping[0].cents;
    // A browser that sends a lower total (cost price) is refused.
    const cheap = await call(checkoutRoute.POST, "/api/store/checkout", "POST", { accountId: A, phone: "", shipTo, items: [{ variantId: "bpc", quantity: 2 }], code: "", tier: q.json.shipping[0].tier, payChoice: "zelle", expectedTotalCents: 2400 + q.json.shipping[0].cents, consent: true, owner: "A" });
    expect(cheap.status).toBe(409);
    const ok = await call(checkoutRoute.POST, "/api/store/checkout", "POST", { accountId: A, phone: "", shipTo, items: [{ variantId: "bpc", quantity: 2 }], code: "", tier: q.json.shipping[0].tier, payChoice: "zelle", expectedTotalCents: total, consent: true, owner: "A" });
    expect(ok.status).toBe(200);
    const o = await prisma.order.findFirstOrThrow({ where: { customerId: A }, include: { lines: true } });
    expect(o.owner).toBeNull();
    expect(o.lines[0].unitPriceCents).toBe(5000);
    // The account's saved cart is emptied once the order is placed.
    expect(await prisma.customerCart.findUnique({ where: { customerId: A } })).toBeNull();
    await prisma.orderEvent.deleteMany();
    await prisma.promotionUse.deleteMany();
    await prisma.orderLine.deleteMany();
    await prisma.order.deleteMany();
  });
});

describe("account data never leaks", () => {
  it("account pages and every API answer say private, no-store", async () => {
    for (const p of ["/account", "/account/referrals", "/checkout", "/cart", "/order/abc", "/order-lookup", "/refer"]) {
      const res = await middleware(new NextRequest(`${BASE}${p}`, { headers: { host: "store.test" } }));
      expect(res.headers.get("Cache-Control"), p).toBe("private, no-store");
    }
    for (const r of [await cart.get(), await quote({ items: [{ variantId: "bpc", quantity: 1 }] }), await account({ action: "signin", email: "x@x.com", password: "nope-nope" })]) {
      expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    }
  });

  it("someone else's order can't be opened by changing the id or token", async () => {
    const { prisma: db } = await import("../db");
    await db.order.create({ data: { id: "o-ben", number: 1001, date: new Date(), source: "online", status: "awaiting_payment", customerId: B, customer: "Ben", email: "ben@example.com", token: "ben-secret-token-0123456789abcdef" } });
    const { store } = { store: (await import("./config")).parseStore(JSON.stringify(STORE)) };
    expect(await orderView.publicOrderByToken("ben-secret-token-0123456789abcdee", store)).toBeNull();
    expect(await orderView.publicOrderByToken("o-ben", store)).toBeNull();
    // A's order list never has B's order.
    expect((await orderView.accountOrders(A, store)).map((o) => o.number)).not.toContain(1001);
    // Admin order API with only a customer session: refused by the middleware.
    await signIn("ann@example.com");
    const cookie = `peps_account=${jar.m.get("peps_account")}`;
    for (const u of ["/api/orders/o-ben", "/api/orders/o-ben/detail", "/api/customers/" + B, "/api/referrals/" + B]) {
      const res = await middleware(new NextRequest(`${BASE}${u}`, { headers: { host: "store.test", cookie } }));
      expect(res.status, u).toBe(401);
    }
    // Order lookup needs the number AND the email on the order.
    const lookup = await import("../../app/api/store/lookup/route");
    expect((await call(lookup.POST, "/api/store/lookup", "POST", { number: 1001, email: "ann@example.com" })).status).toBe(404);
    expect((await call(lookup.POST, "/api/store/lookup", "POST", { number: 1001, email: "ben@example.com" })).status).toBe(200);
    await db.order.delete({ where: { id: "o-ben" } });
  });
});

describe("cart helpers", () => {
  it("clean, cap and merge", () => {
    const stock = (id: string) => ({ a: 3, b: 0 } as Record<string, number>)[id];
    expect(cartLib.cleanItems([{ variantId: "a", quantity: 2 }, { variantId: "a", quantity: 1.7 }, { variantId: "", quantity: 1 }, { variantId: "b", quantity: -1 }, null])).toEqual([{ variantId: "a", quantity: 3 }]);
    expect(cartLib.mergeCarts([{ variantId: "a", quantity: 2 }], [{ variantId: "a", quantity: 5 }, { variantId: "b", quantity: 1 }, { variantId: "zz", quantity: 1 }], stock)).toEqual([
      { variantId: "a", quantity: 3 },
      { variantId: "b", quantity: 1 },
    ]);
    expect(cartLib.addLine([], "a", 1, stock).added).toBe(1);
    expect(cartLib.addLine([{ variantId: "a", quantity: 3 }], "a", 1, stock)).toMatchObject({ added: 0, capped: true, message: "You already have all 3 available in your cart." });
  });
});
