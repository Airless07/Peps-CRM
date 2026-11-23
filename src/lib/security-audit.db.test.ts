// Security audit 2026-11-23: proofs for the fixes made, plus sweeps over every admin route.
/// <reference types="vite/client" />
// Real database (fresh SQLite, every migration) and the real route handlers.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => {
  const m = new Map<string, string>();
  return { m, get: (k: string) => (m.has(k) ? { name: k, value: m.get(k)! } : undefined), set: (k: string, v: string) => void (v ? m.set(k, v) : m.delete(k)) };
});
vi.mock("next/headers", () => ({ cookies: async () => jar }));

const dir = mkdtempSync(path.join(tmpdir(), "audit-test-"));
const root = path.resolve(import.meta.dirname, "../..");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").split(path.sep).join("/")}`;
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "audit-secret-audit-secret-audit-secret";
process.env.APP_PASSWORD = "a-long-real-passphrase-71";
process.env.RESEND_API_KEY = "re_test";

let prisma: (typeof import("./db"))["prisma"];
let account: typeof import("./account");
let accountRoute: typeof import("../app/api/store/account/route");
let checkoutRoute: typeof import("../app/api/store/checkout/route");
let lookupRoute: typeof import("../app/api/store/lookup/route");
let dataRoute: typeof import("../app/api/data/route");
let logoutRoute: typeof import("../app/api/auth/logout/route");
let loginRoute: typeof import("../app/api/auth/login/route");

const ORIGIN = "http://store.test";
const STORE = { open: true, siteUrl: ORIGIN, payments: { zelle: { enabled: true, details: "pay@x.test" } }, qtyDeals: [], alertEmails: [] };
const shipTo = { name: "Kim Park", street1: "1 Main St", street2: "", city: "Denver", state: "CO", zip: "80202", country: "US" };
const sent: { to: string[]; subject: string; text: string }[] = [];

let ip = 1;
const req = (url: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`${ORIGIN}${url}`, { method, headers: { host: "store.test", origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": `10.9.${ip}.1`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = { params: Promise.resolve({ id: "x", token: "x" }) } as never;
async function call(handler: (r: NextRequest, c: never) => Promise<Response>, url: string, method = "GET", body?: unknown, headers?: Record<string, string>) {
  (globalThis as { __storeSnap?: unknown }).__storeSnap = undefined;
  const res = await handler(req(url, method, body, headers), params);
  const text = await res.text();
  let json: Record<string, any> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {}
  return { status: res.status, json };
}
const acct = (body: Record<string, unknown>) => call(accountRoute.POST, "/api/store/account", "POST", body);
const order = (body: Record<string, unknown>) => call(checkoutRoute.POST, "/api/store/checkout", "POST", body);
const goodOrder = { shipTo, items: [{ variantId: "ghk", quantity: 2 }], tier: "standard", payChoice: "zelle", expectedTotalCents: 10695, consent: true };

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("./db"));
  account = await import("./account");
  accountRoute = await import("../app/api/store/account/route");
  checkoutRoute = await import("../app/api/store/checkout/route");
  lookupRoute = await import("../app/api/store/lookup/route");
  dataRoute = await import("../app/api/data/route");
  logoutRoute = await import("../app/api/auth/logout/route");
  loginRoute = await import("../app/api/auth/login/route");
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith("https://api.resend.com/")) {
      const b = JSON.parse(String(init?.body));
      sent.push({ to: b.to, subject: b.subject, text: b.text });
      return new Response(JSON.stringify({ id: `e${sent.length}` }), { status: 200 });
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
  ip += 1;
  await prisma.revokedSession.deleteMany();
  await prisma.orderEvent.deleteMany();
  await prisma.order.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.customer.create({ data: { id: "kim", name: "Kim Park", email: "kim@example.com", referralCode: "KIMP4444", passwordHash: await account.hashPassword("password-123") } });
  await prisma.customer.create({ data: { id: "ben", name: "Ben Ode", email: "ben@example.com", referralCode: "BENO5555", passwordHash: await account.hashPassword("password-456") } });
});

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

/** Sign in as the admin through the real route; the cookie it sets goes into the jar. */
async function adminLogin() {
  const res = await (loginRoute.POST as never as (r: NextRequest, c: never) => Promise<Response>)(req("/api/auth/login", "POST", { password: "a-long-real-passphrase-71" }), params);
  const m = /peps_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "");
  if (m) jar.set("peps_session", m[1]);
  return res.status;
}

// ---------------------------------------------------------------- Sign out ends the session on the server
describe("sign out ends the session on the server, not just in the browser", () => {
  it("admin: a copy of the cookie taken before sign out is refused after it", async () => {
    expect(await adminLogin()).toBe(200);
    const stolen = jar.m.get("peps_session")!;
    expect((await call(dataRoute.GET as never, "/api/data")).status).toBe(200);
    await logoutRoute.POST();
    jar.set("peps_session", stolen); // the attacker replays the copied cookie
    expect((await call(dataRoute.GET as never, "/api/data")).status).toBe(401);
    // A fresh sign in still works.
    jar.m.clear();
    expect(await adminLogin()).toBe(200);
    expect((await call(dataRoute.GET as never, "/api/data")).status).toBe(200);
  });

  it("customer: a copy of the cookie taken before sign out is refused after it (account, cart, checkout)", async () => {
    expect((await acct({ action: "signin", email: "kim@example.com", password: "password-123" })).status).toBe(200);
    const stolen = jar.m.get("peps_account")!;
    expect((await call(accountRoute.GET as never, "/api/store/account")).json.account?.id).toBe("kim");
    await acct({ action: "signout" });
    jar.set("peps_account", stolen);
    expect((await call(accountRoute.GET as never, "/api/store/account")).json.account).toBeNull();
    expect((await order(goodOrder)).status).toBe(401);
    // Signing in again works (a new cookie).
    jar.m.clear();
    expect((await acct({ action: "signin", email: "kim@example.com", password: "password-123" })).status).toBe(200);
    expect((await call(accountRoute.GET as never, "/api/store/account")).json.account?.id).toBe("kim");
  });

  it("signing out with a made-up cookie adds nothing (no junk rows)", async () => {
    jar.set("peps_account", "c1.99999999999999.kim:abc.deadbeef");
    jar.set("peps_session", "v2.99999999999999.0.deadbeef");
    await acct({ action: "signout" });
    jar.set("peps_session", "v2.99999999999999.0.deadbeef");
    await logoutRoute.POST();
    expect(await prisma.revokedSession.count()).toBe(0);
  });
});

// ---------------------------------------------------------------- Reset links
describe("password reset links", () => {
  it("work once, even when submitted twice at the same moment", async () => {
    expect((await acct({ action: "reset-request", email: "kim@example.com" })).status).toBe(200);
    const token = /token=([\w-]+)/.exec(sent.at(-1)!.text)![1];
    const results = await Promise.all([
      acct({ action: "reset", token, password: "new-password-1" }),
      acct({ action: "reset", token, password: "new-password-2" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    expect((await acct({ action: "reset", token, password: "new-password-3" })).status).toBe(400);
  });

  it("the answer is the same whether or not the email has an account (no enumeration)", async () => {
    const a = await acct({ action: "reset-request", email: "kim@example.com" });
    const b = await acct({ action: "reset-request", email: "nobody-here@example.com" });
    expect(a.status).toBe(b.status);
    expect(a.json).toEqual(b.json);
  });
});

// ---------------------------------------------------------------- Every admin route needs the admin
const PUBLIC = [/^store\//, /^auth\/login$/, /^auth\/logout$/, /^webhooks\//];
function routeFiles(d = path.join(root, "src", "app", "api"), base = ""): string[] {
  return readdirSync(d).flatMap((n) => {
    const full = path.join(d, n);
    if (statSync(full).isDirectory()) return routeFiles(full, base ? `${base}/${n}` : n);
    return n === "route.ts" ? [base] : [];
  });
}
const ROUTES = import.meta.glob("../app/api/**/route.ts");
const adminRoutes = routeFiles().filter((r) => !PUBLIC.some((p) => p.test(r)));

describe("every admin API route refuses callers who are not the admin", () => {
  it("found the admin routes", () => {
    expect(adminRoutes.length).toBeGreaterThan(40);
  });

  it.each(adminRoutes)("/api/%s: no session, a customer session, or a forged token = 401 for every method", async (r) => {
    const mod = (await ROUTES[`../app/api/${r}/route.ts`]()) as Record<string, unknown>;
    const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((m) => typeof mod[m] === "function");
    expect(methods.length).toBeGreaterThan(0);
    const { signValue } = await import("./session");
    const customer = (await signValue("kim:whatever", 1)).token;
    for (const m of methods) {
      for (const cookie of [null, `peps_account=${customer}`, "forged"]) {
        jar.m.clear();
        if (cookie === "forged") jar.set("peps_session", "v2.99999999999999.0.deadbeef");
        else if (cookie) {
          jar.set("peps_account", customer);
          jar.set("peps_session", customer); // a customer cookie pasted into the admin cookie
        }
        const res = await (mod[m] as (r: NextRequest, c: never) => Promise<Response>)(req(`/api/${r}`, m, m === "GET" || m === "DELETE" ? undefined : {}), params);
        expect(res.status, `${m} /api/${r} (${cookie ?? "no cookie"})`).toBe(401);
      }
    }
  });
});

// ---------------------------------------------------------------- Middleware
describe("middleware: the gate in front of every page and API", () => {
  const mw = async (p: string, method = "GET", headers: Record<string, string> = {}) => {
    const { middleware } = await import("../middleware");
    return middleware(new NextRequest(`${ORIGIN}${p}`, { method, headers: { host: "store.test", ...headers } }));
  };

  it("admin pages redirect to sign in, admin APIs answer 401, without a session", async () => {
    for (const p of ["/admin", "/admin/orders", "/admin/money", "/admin/settings"]) {
      const r = await mw(p);
      expect(r.status, p).toBe(307);
      expect(r.headers.get("location"), p).toMatch(/\/admin\/login$/);
    }
    for (const p of ["/api/data", "/api/backups", "/api/export", "/api/customers", "/api/orders/x/action"]) expect((await mw(p)).status, p).toBe(401);
    expect((await mw("/admin/login")).status).toBe(200);
  });

  it("a state-changing API call from another site is refused (CSRF), even with a session", async () => {
    const { createAdminToken } = await import("./admin-auth");
    const t = (await createAdminToken()).token;
    expect((await mw("/api/settings", "POST", { origin: "https://evil.test", cookie: `peps_session=${t}` })).status).toBe(403);
    expect((await mw("/api/store/checkout", "POST", { origin: "https://evil.test" })).status).toBe(403);
    expect((await mw("/api/store/account", "POST", {})).status).toBe(403); // no Origin / Referer at all
    expect((await mw("/api/store/account", "POST", { origin: ORIGIN })).status).toBe(200);
  });
});

// ---------------------------------------------------------------- Price and quantity tampering (HTTP)
describe("checkout through the real API: the browser can't set prices or quantities", () => {
  beforeEach(async () => {
    expect((await acct({ action: "signin", email: "kim@example.com", password: "password-123" })).status).toBe(200);
  });

  it("negative, zero, fractional and huge quantities are refused", async () => {
    for (const quantity of [-1, 0, 1.5, 100, 1e9]) expect((await order({ ...goodOrder, items: [{ variantId: "ghk", quantity }] })).status, String(quantity)).toBe(400);
    expect(await prisma.order.count()).toBe(0);
  });

  it("a lower total, a fake price, a fake owner price or a negative credit is never used", async () => {
    expect((await order({ ...goodOrder, expectedTotalCents: 1 })).status).toBe(409);
    expect((await order({ ...goodOrder, storeCreditCents: -5000 })).status).toBe(400);
    expect((await order({ ...goodOrder, storeCreditCents: 5000, expectedTotalCents: 5695 })).status).toBe(409); // has no credit
    const r = await order({ ...goodOrder, items: [{ variantId: "ghk", quantity: 2, unitPriceCents: 1, priceCents: 1 }], owner: "A", unitPriceCents: 1, discountCents: 9999, shippingCents: 0 });
    expect(r.status).toBe(200);
    const o = await prisma.order.findFirstOrThrow({ include: { lines: true } });
    expect(o.owner).toBeNull();
    expect(o.lines[0].unitPriceCents).toBe(5000);
    expect(o.shippingCents).toBe(695);
    expect(o.discountValue).toBe(0);
  });

  it("an unknown product id adds nothing and a cart of only unknown ids is refused", async () => {
    expect((await order({ ...goodOrder, items: [{ variantId: "not-a-product", quantity: 1 }], expectedTotalCents: 0 })).status).toBe(400);
  });
});

// ---------------------------------------------------------------- IDOR: other customers' orders
describe("IDOR: another customer's order", () => {
  it("order lookup needs the matching email; the account cookie decides whose orders a checkout is for", async () => {
    await prisma.order.create({ data: { id: "o-ben", number: 1001, date: new Date(), source: "online", status: "awaiting_payment", customerId: "ben", customer: "Ben", email: "ben@example.com", token: "ben-secret-token-0123456789abcdef" } });
    expect((await call(lookupRoute.POST, "/api/store/lookup", "POST", { number: 1001, email: "kim@example.com" })).status).toBe(404);
    expect((await call(lookupRoute.POST, "/api/store/lookup", "POST", { number: 1001, email: "ben@example.com" })).json.token).toBe("ben-secret-token-0123456789abcdef");
    // Kim, signed in, sends Ben's account id: refused, nothing placed under either account.
    await acct({ action: "signin", email: "kim@example.com", password: "password-123" });
    expect((await order({ ...goodOrder, accountId: "ben" })).status).toBe(409);
    expect(await prisma.order.count({ where: { customerId: "ben" } })).toBe(1);
  });
});
