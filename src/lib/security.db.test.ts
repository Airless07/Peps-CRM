// Security audit proofs against a real database (fresh SQLite, every migration) and the real handlers.
// Money races, session revocation, account abuse limits, admin login hardening.
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

const dir = mkdtempSync(path.join(tmpdir(), "security-test-"));
const root = path.resolve(import.meta.dirname, "../..");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").split(path.sep).join("/")}`;
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.APP_PASSWORD = "a-long-real-passphrase-71";
process.env.RESEND_API_KEY = "re_test";

let prisma: (typeof import("./db"))["prisma"];
let ops: typeof import("./order-ops");
let accountRoute: typeof import("../app/api/store/account/route");
let loginRoute: typeof import("../app/api/auth/login/route");
let dataRoute: typeof import("../app/api/data/route");
let session: typeof import("./session");
let account: typeof import("./account");

const sent: { to: string[]; subject: string }[] = [];
const ORIGIN = "http://store.test";
const STORE = { open: true, siteUrl: ORIGIN, payments: { zelle: { enabled: true, details: "pay@x.test" } }, qtyDeals: [], alertEmails: [] };
const shipTo = { name: "Kim Park", street1: "1 Main St", street2: "", city: "Denver", state: "CO", zip: "80202", country: "US" };

let ip = 1;
const req = (url: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`${ORIGIN}${url}`, { method, headers: { host: "store.test", origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": `10.1.${ip}.1`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = { params: Promise.resolve({}) } as never;
async function call(handler: (r: NextRequest, c: never) => Promise<Response>, url: string, method = "GET", body?: unknown, headers?: Record<string, string>) {
  (globalThis as { __storeSnap?: unknown }).__storeSnap = undefined;
  const res = await handler(req(url, method, body, headers), ctx);
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : {}) as Record<string, any> };
}
const acct = (body: Record<string, unknown>, headers?: Record<string, string>) => call(accountRoute.POST, "/api/store/account", "POST", body, headers);

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("./db"));
  ops = await import("./order-ops");
  accountRoute = await import("../app/api/store/account/route");
  loginRoute = await import("../app/api/auth/login/route");
  dataRoute = await import("../app/api/data/route");
  session = await import("./session");
  account = await import("./account");
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith("https://api.resend.com/")) {
      const b = JSON.parse(String(init?.body));
      sent.push({ to: b.to, subject: b.subject });
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
  await prisma.creditEntry.deleteMany();
  await prisma.promotionUse.deleteMany();
  await prisma.codeClaim.deleteMany({ where: { kind: "promo" } });
  await prisma.promotion.deleteMany();
  await prisma.orderEvent.deleteMany();
  await prisma.order.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.customer.create({ data: { id: "kim", name: "Kim Park", email: "kim@example.com", referralCode: "KIMP4444", passwordHash: await account.hashPassword("password-123") } });
});

afterAll(async () => {
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

type Checkout = Parameters<(typeof ops)["placeOrder"]>[0];
const checkout = (over: Partial<Checkout> = {}) =>
  ops.placeOrder({ customerId: "kim", name: "Kim Park", email: "kim@example.com", phone: "", shipTo, items: [{ variantId: "ghk", quantity: 2 }], code: "", tier: "standard", payChoice: "zelle", expectedTotalCents: 10695, origin: ORIGIN, ...over });

describe("money races: two checkouts at the same moment", () => {
  it("a 1-use code is used once, not twice", async () => {
    await prisma.promotion.create({ data: { id: "p1", kind: "code", code: "ONCE10", name: "", active: true, discountType: "$", discountValue: 1000, maxUses: 1 } });
    const results = await Promise.allSettled([checkout({ code: "ONCE10", expectedTotalCents: 9695 }), checkout({ code: "ONCE10", expectedTotalCents: 9695 }), checkout({ code: "ONCE10", expectedTotalCents: 9695 })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.promotionUse.count({ where: { promotionId: "p1" } })).toBe(1);
  });

  it("a once-per-email code is used once per email, even at the same moment", async () => {
    await prisma.promotion.create({ data: { id: "p2", kind: "code", code: "FIRST10", name: "", active: true, discountType: "$", discountValue: 1000, oncePerEmail: true } });
    const results = await Promise.allSettled([checkout({ code: "FIRST10", expectedTotalCents: 9695 }), checkout({ code: "FIRST10", expectedTotalCents: 9695 })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("the same store credit can't be held by two orders at once", async () => {
    await prisma.creditEntry.create({ data: { id: "c1", customerId: "kim", amountCents: 5000, kind: "manual", reason: "gift", by: "Admin" } });
    const results = await Promise.allSettled([checkout({ storeCreditCents: 5000, expectedTotalCents: 5695 }), checkout({ storeCreditCents: 5000, expectedTotalCents: 5695 })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const held = await prisma.order.aggregate({ _sum: { storeCreditCents: true } });
    expect(held._sum.storeCreditCents).toBe(5000);
  });
});

// ---------------------------------------------------------------- Admin sessions
const adminCall = async (token: string | null) => {
  if (token) jar.set("peps_session", token);
  else jar.m.delete("peps_session");
  return call(dataRoute.GET as never, "/api/data");
};

describe("admin sessions end when they should", () => {
  it("a forged, old-format or wrong-generation token is refused; a real one works", async () => {
    const { createAdminToken } = await import("./admin-auth");
    expect((await adminCall((await createAdminToken()).token)).status).toBe(200);
    expect((await adminCall("v2.9999999999999.0.deadbeef")).status).toBe(401);
    expect((await adminCall("v1.9999999999999.abc")).status).toBe(401);
    expect((await adminCall((await session.createSessionToken("notthegeneration")).token)).status).toBe(401);
    expect((await adminCall(null)).status).toBe(401);
  });

  it("changing the admin password, or Sign out everywhere, ends every older session", async () => {
    const { createAdminToken } = await import("./admin-auth");
    const before = (await createAdminToken()).token;
    expect((await adminCall(before)).status).toBe(200);
    const pwRoute = await import("../app/api/settings/password/route");
    jar.set("peps_session", before);
    const r = await call(pwRoute.POST as never, "/api/settings/password", "POST", { current: "a-long-real-passphrase-71", next: "Correct-Horse-Battery-Staple-9" });
    expect(r.status).toBe(200);
    expect((await adminCall(before)).status, "old session after password change").toBe(401);
    const after = (await createAdminToken()).token;
    expect((await adminCall(after)).status).toBe(200);
    const sec = await import("../app/api/settings/security/route");
    jar.set("peps_session", after);
    expect((await call(sec.POST as never, "/api/settings/security", "POST", { action: "signout-everywhere" })).status).toBe(200);
    expect((await adminCall(after)).status, "old session after Sign out everywhere").toBe(401);
    await prisma.settings.update({ where: { id: 1 }, data: { passwordHash: null } });
  });

  it("a weak or short new admin password is refused", async () => {
    const { createAdminToken } = await import("./admin-auth");
    const pwRoute = await import("../app/api/settings/password/route");
    jar.set("peps_session", (await createAdminToken()).token);
    for (const next of ["short-pw", "password123", "buckshotlabs123", "aaaaaaaaaaaaaa"]) {
      const r = await call(pwRoute.POST as never, "/api/settings/password", "POST", { current: "a-long-real-passphrase-71", next });
      expect(r.status, next).toBe(400);
    }
  });

  it("a customer session never opens the admin API (data, mark paid)", async () => {
    const r = await acct({ action: "signin", email: "kim@example.com", password: "password-123" });
    expect(r.status).toBe(200);
    expect(jar.m.has("peps_account")).toBe(true);
    expect((await call(dataRoute.GET as never, "/api/data")).status).toBe(401);
    const action = await import("../app/api/orders/[id]/action/route");
    const res = await action.POST(req("/api/orders/x/action", "POST", { action: "mark-paid", paymentMethod: "Zelle" }), { params: Promise.resolve({ id: "x" }) } as never);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------- Admin login
describe("admin login", () => {
  const login = (body: Record<string, unknown>, from = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`) =>
    call(loginRoute.POST as never, "/api/auth/login", "POST", body, { "x-forwarded-for": from });

  it("two-step sign in: the password alone is not enough, and a code works once", async () => {
    const { newTotpSecret, totpCode, currentStep } = await import("./totp");
    const secret = newTotpSecret();
    await prisma.settings.update({ where: { id: 1 }, data: { totpSecret: secret, totpEnabled: true, totpLastStep: 0 } });
    try {
      const noCode = await login({ password: "a-long-real-passphrase-71" });
      expect(noCode.status).toBe(401);
      expect(noCode.json.needCode).toBe(true);
      const now = totpCode(secret, currentStep());
      expect((await login({ password: "a-long-real-passphrase-71", code: now === "000000" ? "111111" : "000000" })).status).toBe(401);
      expect((await login({ password: "a-long-real-passphrase-71", code: now })).status).toBe(200);
      expect((await login({ password: "a-long-real-passphrase-71", code: now })).status, "same code again").toBe(401);
      expect((await login({ password: "wrong-password-here", code: totpCode(secret, currentStep() + 1) })).status).toBe(401);
    } finally {
      await prisma.settings.update({ where: { id: 1 }, data: { totpSecret: "", totpEnabled: false, totpLastStep: 0 } });
    }
  });

  it("RFC 6238 test vectors", async () => {
    const { base32Encode, totpCode } = await import("./totp");
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpCode(secret, Math.floor(59 / 30))).toBe("287082");
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe("081804");
  });

  it("one IP is locked after 5 wrong passwords; all IPs together pause after 50", async () => {
    const one = "10.200.0.1";
    for (let i = 0; i < 5; i++) await login({ password: `wrong-${i}` }, one);
    expect((await login({ password: "a-long-real-passphrase-71" }, one)).status, "locked IP, even with the right password").toBe(429);
    for (let i = 0; i < 50; i++) await login({ password: `spray-${i}` }, `10.201.${i}.1`);
    expect((await login({ password: "a-long-real-passphrase-71" }, "10.202.0.1")).status, "paused for everyone").toBe(429);
  }, 60_000);
});

// ---------------------------------------------------------------- Customer accounts
describe("customer accounts", () => {
  it("a password reset signs out every other browser", async () => {
    await acct({ action: "signin", email: "kim@example.com", password: "password-123" });
    const stolen = jar.m.get("peps_account")!;
    expect((await call(accountRoute.GET as never, "/api/store/account")).json.account?.id).toBe("kim");
    const { createHash } = await import("node:crypto");
    await prisma.customer.update({ where: { id: "kim" }, data: { resetTokenHash: createHash("sha256").update("reset-token-123456").digest("hex"), resetExpiresAt: new Date(Date.now() + 3600_000) } });
    jar.m.clear();
    expect((await acct({ action: "reset", token: "reset-token-123456", password: "brand-new-password-1" })).status).toBe(200);
    jar.m.clear();
    jar.set("peps_account", stolen);
    expect((await call(accountRoute.GET as never, "/api/store/account")).json.account, "old cookie after reset").toBeNull();
  });

  it("changing the password needs the current one (unless it is a temporary password)", async () => {
    await acct({ action: "signin", email: "kim@example.com", password: "password-123" });
    expect((await acct({ action: "change-password", password: "hijacked-password-1" })).status).toBe(400);
    expect((await acct({ action: "change-password", password: "hijacked-password-1", current: "wrong" })).status).toBe(400);
    expect((await acct({ action: "change-password", password: "new-password-12345", current: "password-123" })).status).toBe(200);
    expect((await call(accountRoute.GET as never, "/api/store/account")).json.account?.id, "this browser stays signed in").toBe("kim");
  });

  it("guessing one account's password from many IPs stops after 20 wrong tries", async () => {
    for (let i = 0; i < 20; i++) await acct({ action: "signin", email: "kim@example.com", password: `guess-${i}` }, { "x-forwarded-for": `10.50.${i}.1` });
    expect((await acct({ action: "signin", email: "kim@example.com", password: "password-123" }, { "x-forwarded-for": "10.51.0.1" })).status).toBe(429);
  }, 60_000);

  it("nobody can flood an inbox with reset emails: 3 an hour per address, from any IPs", async () => {
    await prisma.customer.create({ data: { id: "flood", name: "Flo", email: "flo@example.com", referralCode: "FLOO1111", passwordHash: "x" } });
    for (let i = 0; i < 8; i++) expect((await acct({ action: "reset-request", email: "flo@example.com" }, { "x-forwarded-for": `10.60.${i}.1` })).status).toBe(200);
    expect(sent.filter((s) => s.to.includes("flo@example.com"))).toHaveLength(3);
  });
});

// ---------------------------------------------------------------- Price and input tampering
describe("price tampering", () => {
  it("the total, quantities and credit come from the server, never the browser", async () => {
    await expect(checkout({ expectedTotalCents: 1 })).rejects.toThrow(/price changed/);
    await expect(checkout({ storeCreditCents: 999_999, expectedTotalCents: 10695 })).rejects.toThrow(/store credit available/);
    const o = await checkout({ storeCreditCents: -5000 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).storeCreditCents).toBe(0);
    const { checkoutInput } = await import("./store/schemas");
    const base = { phone: "", shipTo, code: "", tier: "standard", payChoice: "zelle", expectedTotalCents: 1 };
    for (const items of [[{ variantId: "ghk", quantity: -1 }], [{ variantId: "ghk", quantity: 0 }], [{ variantId: "ghk", quantity: 1e9 }], [{ variantId: "ghk", quantity: 1.5 }]]) {
      expect(checkoutInput.safeParse({ ...base, items }).success, JSON.stringify(items)).toBe(false);
    }
    expect(checkoutInput.safeParse({ ...base, items: [{ variantId: "ghk", quantity: 1 }], storeCreditCents: -1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------- Uploads, webhooks, client address
describe("uploads and webhooks", () => {
  it("an upload with no size or over the limit is refused before it is read", async () => {
    const { formFile } = await import("./uploads");
    await expect(formFile(new Request("http://x/", { method: "POST", headers: { "content-length": String(50 * 1024 * 1024) }, body: "x" }), "file", 14)).rejects.toMatchObject({ status: 413 });
    const noLen = new Request("http://x/", { method: "POST", body: "x" });
    noLen.headers.delete("content-length");
    await expect(formFile(noLen, "file", 14)).rejects.toMatchObject({ status: 411 });
  });

  it("the Shippo webhook asks Shippo for the status: a faked DELIVERED changes nothing", async () => {
    const o = await checkout();
    await ops.markPaid(o.id, { paymentMethod: "Zelle", notify: false });
    await prisma.order.update({ where: { id: o.id }, data: { status: "shipped", trackingNumber: "9400TEST", trackingCarrier: "usps" } });
    vi.stubGlobal("fetch", async (url: string | URL | Request) => {
      if (String(url).includes("goshippo.com")) return new Response(JSON.stringify({ tracking_number: "9400TEST", tracking_status: { status: "TRANSIT", status_date: new Date().toISOString() }, tracking_history: [] }), { status: 200 });
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    });
    process.env.SHIPPO_API_KEY = "shippo_test_x";
    const hook = await import("../app/api/webhooks/shippo/route");
    const { webhookSecret } = await import("./shippo");
    const res = await hook.POST(new NextRequest(`${ORIGIN}/api/webhooks/shippo?key=${webhookSecret()}`, { method: "POST", body: JSON.stringify({ event: "track_updated", data: { tracking_number: "9400TEST", tracking_status: { status: "DELIVERED" } } }) }));
    expect(res.status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("shipped");
    const bad = await hook.POST(new NextRequest(`${ORIGIN}/api/webhooks/shippo?key=wrong`, { method: "POST", body: "{}" }));
    expect(bad.status).toBe(401);
  });

  it("rate limits use the address our proxy added, not one the client made up", async () => {
    const { clientIp } = await import("./ratelimit");
    expect(clientIp(new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.9" } }))).toBe("203.0.113.9");
    expect(clientIp(new Request("http://x/", { headers: { "x-forwarded-for": "203.0.113.9" } }))).toBe("203.0.113.9");
  });
});
