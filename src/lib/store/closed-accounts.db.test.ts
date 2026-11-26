// Accounts while the store is closed ("getting ready to open"). Real database, real pages and routes.
// Proves: the Coming soon page offers Create an account / Sign in (My account / My referral code when
// signed in); account, referrals, /refer, reset and invite pages load while closed; sign up and sign in work
// the same as when open and the new account has its referral code right away; shop, product, cart and
// checkout pages and the product/pricing APIs stay blocked; a referral share link saves the code for 30 days
// and the cart uses it once the store is open; with the store open everything is as before.
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
    delete: (k: string) => void m.delete(k),
    getAll: () => [...m].map(([name, value]) => ({ name, value })),
  };
});
vi.mock("next/headers", () => ({ cookies: async () => jar, headers: async () => new Headers({ "user-agent": "vitest" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {}, replace() {} }), usePathname: () => "/account", useSearchParams: () => new URLSearchParams() }));

const dir = mkdtempSync(path.join(tmpdir(), "closed-accounts-test-"));
const root = path.resolve(import.meta.dirname, "../../..");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").split(path.sep).join("/")}`;
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
delete process.env.RESEND_API_KEY;

let prisma: (typeof import("../db"))["prisma"];
let account: typeof import("../account");
const ORIGIN = "http://localhost:3000";
const STORE = { siteUrl: "https://shop.test", payments: { zelle: { enabled: true, details: "pay@buckshot.test" } }, qtyDeals: [], alertEmails: [] };
const setOpen = async (open: boolean) => {
  await prisma.settings.update({ where: { id: 1 }, data: { storeJson: JSON.stringify({ ...STORE, open }) } });
  (globalThis as { __storeSnap?: unknown }).__storeSnap = undefined;
};
const req = (url: string, method = "GET", body?: unknown) =>
  new NextRequest(`${ORIGIN}${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json", host: "localhost:3000", origin: ORIGIN } });
const ctx = { params: Promise.resolve({}) };
const text = async (el: Promise<React.ReactNode> | React.ReactNode) => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return renderToStaticMarkup((await el) as React.ReactElement).replace(/<[^>]+>/g, " ").replace(/&#x27;|&apos;/g, "'").replace(/\s+/g, " ");
};

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("../db"));
  account = await import("../account");
  vi.stubGlobal("fetch", async (url: string | URL | Request) => {
    throw new Error(`Unexpected network call: ${url}`);
  });
  await prisma.settings.create({ data: { id: 1, startingBalanceCents: 0, storeJson: JSON.stringify({ ...STORE, open: false }) } });
  await prisma.listing.create({ data: { id: "l-ghk", name: "GHK-Cu", slug: "ghk-cu", showOnWebsite: true } });
  await prisma.product.create({ data: { id: "ghk", name: "GHK-Cu", variantLabel: "100mg", defaultPriceCents: 5000, listingId: "l-ghk" } });
  await prisma.purchase.create({ data: { id: "pu", date: new Date("2026-01-01T12:00:00Z"), productId: "ghk", quantity: 100, totalCostCents: 100000, fromInvestment: true } });
}, 120_000);
beforeEach(async () => {
  jar.m.clear();
  await setOpen(false);
});
afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

async function signUp(email: string) {
  const { POST } = await import("../../app/api/store/account/route");
  const res = await POST(req("/api/store/account", "POST", { action: "signup", name: "Dana Reed", email, password: "a-good-password-1" }), ctx);
  return { status: res.status, json: (await res.json()) as { account?: { id: string } } };
}

describe("Coming soon page (store closed)", () => {
  it("signed out: Create an account and Sign in next to Look up an order, plus the referral line", async () => {
    const { default: ShopGate } = await import("../../app/(store)/(shop)/layout");
    const t = await text(ShopGate({ children: "SHOP CONTENT" }));
    expect(t).toContain("is getting ready to open");
    expect(t).not.toContain("SHOP CONTENT");
    expect(t).toMatch(/Create an account .*Sign in .*Look up an order/);
    expect(t).toContain("Create your account now to get your referral code ready for launch.");
    expect(t).not.toContain("My account");
  });

  it("signed in: My account and My referral code instead", async () => {
    expect((await signUp("dana@example.com")).status).toBe(200);
    const { default: ShopGate } = await import("../../app/(store)/(shop)/layout");
    const t = await text(ShopGate({ children: "SHOP CONTENT" }));
    expect(t).toMatch(/My account .*My referral code .*Look up an order/);
    expect(t).not.toContain("Create an account");
  });
});

describe("account pages work while closed", () => {
  it("sign up works exactly like when open and the account gets its referral code right away; sign out and sign in too", async () => {
    const r = await signUp("kim@example.com");
    expect(r.status).toBe(200);
    expect(jar.get(account.ACCOUNT_COOKIE)).toBeDefined();
    const row = await prisma.customer.findFirst({ where: { email: "kim@example.com" } });
    expect(row?.referralCode).toMatch(/^[A-Z0-9-]{3,}$/);
    expect(row?.passwordHash).toBeTruthy();
    // Same validation as when open.
    const { POST } = await import("../../app/api/store/account/route");
    const weak = await POST(req("/api/store/account", "POST", { action: "signup", name: "Al", email: "al@example.com", password: "short" }), ctx);
    expect(weak.status).toBe(400);
    expect((await POST(req("/api/store/account", "POST", { action: "signout" }), ctx)).status).toBe(200);
    expect(jar.get(account.ACCOUNT_COOKIE)).toBeUndefined();
    const back = await POST(req("/api/store/account", "POST", { action: "signin", email: "kim@example.com", password: "a-good-password-1" }), ctx);
    expect(back.status).toBe(200);
    expect(jar.get(account.ACCOUNT_COOKIE)).toBeDefined();
  });

  it("/account, /account/referrals, /refer and the reset page load (no Coming soon)", async () => {
    await signUp("lee@example.com");
    const code = (await prisma.customer.findFirst({ where: { email: "lee@example.com" } }))!.referralCode!;
    const { default: AccountPage } = await import("../../app/(store)/account/page");
    const a = await text(AccountPage({ searchParams: Promise.resolve({}) }));
    expect(a).toContain(code);
    expect(a).not.toContain("getting ready to open");
    const { default: Referrals } = await import("../../app/(store)/account/referrals/page");
    expect(await text(Referrals())).toContain(code);
    const { default: Refer } = await import("../../app/(store)/refer/page");
    expect(await text(Refer())).toContain("Refer");
    const { default: Reset } = await import("../../app/(store)/account/reset/page");
    expect(await text(Reset({ searchParams: Promise.resolve({ token: "x".repeat(20) }) } as never))).not.toContain("getting ready to open");
  });

  it("signed out, /account?start=signup opens Create an account", async () => {
    const { default: AccountPage } = await import("../../app/(store)/account/page");
    const t = await text(AccountPage({ searchParams: Promise.resolve({ start: "signup" }) }));
    expect(t).toMatch(/Create (an |your )?account/i);
  });
});

describe("shopping stays closed", () => {
  it("shop, product, cart and checkout pages are inside the Coming soon gate", async () => {
    const fs = await import("node:fs");
    const shop = path.join(root, "src", "app", "(store)", "(shop)");
    for (const p of ["shop", "product", "cart", "checkout", "collections"]) expect(fs.existsSync(path.join(shop, p))).toBe(true);
    // /refer moved out of the gate; account pages were never in it.
    expect(fs.existsSync(path.join(shop, "refer"))).toBe(false);
    const { default: ShopGate } = await import("../../app/(store)/(shop)/layout");
    expect(await text(ShopGate({ children: "SHOP CONTENT" }))).not.toContain("SHOP CONTENT");
  });

  it("the product and pricing APIs refuse while closed, and work when open", async () => {
    const { GET: products } = await import("../../app/api/store/products/route");
    const { POST: quote } = await import("../../app/api/store/quote/route");
    const { POST: code } = await import("../../app/api/store/code/route");
    const { POST: checkout } = await import("../../app/api/store/checkout/route");
    const body = { items: [{ variantId: "ghk", quantity: 1 }] };
    expect((await products(req("/api/store/products"), ctx)).status).toBe(403);
    expect((await quote(req("/api/store/quote", "POST", body), ctx)).status).toBe(403);
    expect((await code(req("/api/store/code", "POST", { code: "X", items: body.items }), ctx)).status).toBe(403);
    expect((await checkout(req("/api/store/checkout", "POST", body), ctx)).status).toBe(403);
    await setOpen(true);
    expect((await products(req("/api/store/products"), ctx)).status).toBe(200);
    expect((await quote(req("/api/store/quote", "POST", body), ctx)).status).toBe(200);
    const { default: ShopGate } = await import("../../app/(store)/(shop)/layout");
    expect(await text(ShopGate({ children: "SHOP CONTENT" }))).toContain("SHOP CONTENT");
  });
});

describe("referral share links", () => {
  it("?ref=CODE saves the code for 30 days, on any store page, open or closed", async () => {
    const { middleware } = await import("../../middleware");
    const res = await middleware(new NextRequest(`${ORIGIN}/shop?ref=dana-r`, { headers: { host: "localhost:3000" } }));
    const c = res.cookies.get("bl_ref");
    expect(c?.value).toBe("DANA-R");
    expect(c?.maxAge).toBe(30 * 86_400);
    expect(c?.httpOnly).toBeFalsy(); // the Coming soon page and the cart read it
    expect((await middleware(new NextRequest(`${ORIGIN}/account?ref=x!`, { headers: { host: "localhost:3000" } }))).cookies.get("bl_ref")).toBeUndefined();
  });

  it("closed: kept and not applied; open: fills an empty cart, then the saved code is cleared (removing it sticks)", async () => {
    const { referralOnLoad, cleanRefCode } = await import("./referral-cookie");
    expect(referralOnLoad("", "", "DANA-R", false)).toEqual({ referral: "", clearSaved: false });
    expect(referralOnLoad("", "", "DANA-R", true)).toEqual({ referral: "DANA-R", clearSaved: true });
    // A code already on the cart, or in the link, wins.
    expect(referralOnLoad("KIM", "", "DANA-R", true)).toEqual({ referral: "KIM", clearSaved: true });
    expect(referralOnLoad("", "LEE", "DANA-R", true)).toEqual({ referral: "LEE", clearSaved: true });
    // After it was cleared and the customer removed it: nothing comes back.
    expect(referralOnLoad("", "", "", true)).toEqual({ referral: "", clearSaved: false });
    expect(cleanRefCode(" dana r ")).toBe("DANAR");
  });

  it("the saved code is a real referral code that works at checkout once open", async () => {
    await signUp("owner@example.com");
    const code = (await prisma.customer.findFirst({ where: { email: "owner@example.com" } }))!.referralCode!;
    jar.m.clear(); // a friend, signed out
    await setOpen(true);
    const { POST: quote } = await import("../../app/api/store/quote/route");
    const res = await quote(req("/api/store/quote", "POST", { items: [{ variantId: "ghk", quantity: 1 }], referralCode: code }), ctx);
    const json = (await res.json()) as { referral?: { code: string } | null };
    expect(res.status).toBe(200);
    expect(json.referral?.code).toBe(code);
  });
});
