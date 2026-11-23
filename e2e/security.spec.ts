// Security and behavior checks over real HTTP against the production build.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, request as playwrightRequest, test, type APIRequestContext } from "@playwright/test";
import { ADMIN_PASSWORD, BASE, SHOTS } from "../playwright.config";
import { adminLogin } from "./helpers";

const appDir = path.join(__dirname, "..", "src", "app");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : [path.join(dir, n)]));
const urlOf = (file: string) =>
  "/" +
  path
    .relative(appDir, path.dirname(file))
    .split(path.sep)
    .filter((p) => !/^\(.*\)$/.test(p))
    .map((p) => (/^\[\.\.\..+\]$/.test(p) ? "anything/else" : /^\[.+\]$/.test(p) ? "sample-id" : p))
    .join("/");
const PUBLIC_API = ["/api/store/", "/api/auth/login", "/api/webhooks/"];
const apiRoutes = walk(path.join(appDir, "api"))
  .filter((f) => /route\.tsx?$/.test(f))
  .map((f) => ({ url: urlOf(f), methods: [...readFileSync(f, "utf8").matchAll(/export (?:const (?:\{ ?([A-Z, ]+) ?\}|([A-Z]+)) =|async function ([A-Z]+)\()/g)].flatMap((m) => (m[1] ?? m[2] ?? m[3]).split(",").map((x) => x.trim())) }));
const adminApi = apiRoutes.filter((r) => !PUBLIC_API.some((p) => r.url.startsWith(p)));
const adminPages = walk(path.join(appDir, "admin")).filter((f) => /page\.tsx$/.test(f)).map(urlOf).filter((u) => u !== "/admin/login");

const sameOrigin = { origin: BASE };
const evidence = path.join(SHOTS, "evidence");
mkdirSync(evidence, { recursive: true });

let anon: APIRequestContext;
let admin: APIRequestContext;

test.beforeAll(async () => {
  anon = await playwrightRequest.newContext({ baseURL: BASE, maxRedirects: 0 });
  admin = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await admin.post("/api/auth/login", { data: { password: ADMIN_PASSWORD }, headers: { ...sameOrigin, "x-forwarded-for": "198.51.100.7" } });
  expect(res.status(), "admin login").toBe(200);
});
test.afterAll(async () => {
  await anon?.dispose();
  await admin?.dispose();
});

test("every admin API route rejects a request without a session (401)", async () => {
  expect(adminApi.length).toBeGreaterThanOrEqual(30);
  const lines: string[] = [];
  for (const r of adminApi) {
    for (const m of r.methods) {
      const res = await anon.fetch(r.url, { method: m, headers: sameOrigin, data: m === "GET" || m === "DELETE" ? undefined : {} });
      lines.push(`${res.status()}  ${m.padEnd(6)} ${r.url}`);
      expect(res.status(), `${m} ${r.url}`).toBe(401);
      expect(await res.json()).toEqual({ error: "Not logged in" });
    }
  }
  writeFileSync(path.join(evidence, "admin-api-unauthenticated.txt"), lines.join("\n") + "\n");
});

test("every admin page redirects to the login page without a session", async () => {
  expect(adminPages.length).toBeGreaterThanOrEqual(17);
  const lines: string[] = [];
  for (const url of [...adminPages, "/admin/does-not-exist"]) {
    const res = await anon.get(url);
    lines.push(`${res.status()}  ${url} -> ${res.headers()["location"] ?? ""}`);
    expect(res.status(), url).toBe(307);
    expect(new URL(res.headers()["location"], BASE).pathname, url).toBe("/admin/login");
    expect(await res.text()).not.toMatch(/Dashboard|Inventory/);
  }
  writeFileSync(path.join(evidence, "admin-pages-unauthenticated.txt"), lines.join("\n") + "\n");
});

test("state-changing admin calls from another site are refused even with a valid session (CSRF)", async () => {
  for (const [method, url] of [["PATCH", "/api/settings"], ["POST", "/api/orders"], ["POST", "/api/reset"], ["POST", "/api/import"]] as const) {
    const res = await admin.fetch(url, { method, headers: { origin: "https://evil.example" }, data: {} });
    expect(res.status(), `${method} ${url}`).toBe(403);
  }
});

test("public product and catalog APIs never return cost or profit", async () => {
  const cost = await admin.get("/api/data");
  const data = await cost.json();
  // What the admin knows and the public must not: unit costs and purchase totals.
  const secrets = new Set<string>();
  for (const p of data.purchases) secrets.add(String(p.totalCostCents));
  const banned = /cost|profit|margin|purchase|cutPercent|partner|payout|soldQty|threshold|adminNote|passwordHash/i;
  const walkKeys = (v: unknown, keys: Set<string>) => {
    if (Array.isArray(v)) v.forEach((x) => walkKeys(x, keys));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (keys.add(k), walkKeys(x, keys));
  };
  const res = await anon.get("/api/store/products");
  expect(res.status()).toBe(200);
  const body = await res.json();
  const keys = new Set<string>();
  walkKeys(body, keys);
  expect([...keys].filter((k) => banned.test(k))).toEqual([]);
  expect(JSON.stringify(body)).not.toMatch(/"stock":\s*\d/);
  writeFileSync(path.join(evidence, "public-products-api-keys.txt"), [...keys].sort().join("\n") + "\n");

  const quote = await anon.post("/api/store/quote", { headers: sameOrigin, data: { items: [{ variantId: body.products[0].variants[0].id, quantity: 1 }], code: "", shipTo: null } });
  expect(quote.status()).toBe(200);
  const qKeys = new Set<string>();
  walkKeys(await quote.json(), qKeys);
  expect([...qKeys].filter((k) => banned.test(k))).toEqual([]);

  // The pages themselves (HTML and embedded data) carry no cost fields either.
  for (const url of ["/", "/shop", `/product/${body.products[0].slug}`, "/testing"]) {
    const html = await (await anon.get(url)).text();
    expect(html, url).not.toMatch(/unitCost|costOverride|totalCostCents|avgCost|businessCut|purchasedCost/);
  }
  // The admin data endpoint is closed to the public.
  expect((await anon.get("/api/data")).status()).toBe(401);
  expect(cost.status()).toBe(200);
});

test("order status and review links cannot be guessed or enumerated", async () => {
  const data = await (await admin.get("/api/data")).json();
  const order = [...data.orders, ...data.pendingOrders].find((o: { source: string }) => o.source === "online");
  expect(order.web.token).toMatch(/^[A-Za-z0-9_-]{32}$/);
  expect((await anon.get(`/order/${order.web.token}`)).status()).toBe(200);
  const near = order.web.token.slice(0, -1) + (order.web.token.endsWith("A") ? "B" : "A");
  for (const guess of [String(order.number), order.id, order.web.token.slice(0, 16), near, "a".repeat(32), "1001", "..%2F..%2Fadmin"]) {
    const res = await anon.get(`/order/${guess}`);
    expect(res.status(), `/order/${guess}`).toBe(404);
    expect(await res.text()).not.toContain(order.web.email);
  }
  for (const guess of [String(order.number), order.id, order.web.token, "b".repeat(32)]) {
    // A wrong review link always gets the same answer and shows nothing about any order.
    const page = await (await anon.get(`/review/${guess}`)).text();
    expect(page, `/review/${guess}`).toContain("This review link is not valid");
    expect(page).not.toContain(`Order #${order.number}`);
    expect(page).not.toContain(order.web.email);
    const post = await anon.post(`/api/store/review/${guess}`, { headers: sameOrigin, data: { rating: 5, text: "x", displayName: "x" } });
    expect([400, 404, 409]).toContain(post.status());
  }
  // Order lookup needs the order number AND the matching email, answers the same for a wrong pair,
  // and stops a client that keeps trying.
  const ip = { ...sameOrigin, "x-forwarded-for": "203.0.113.77" };
  const wrong = await anon.post("/api/store/lookup", { headers: ip, data: { number: String(order.number), email: "someone-else@example.com" } });
  const none = await anon.post("/api/store/lookup", { headers: ip, data: { number: "999999", email: "someone-else@example.com" } });
  expect(wrong.status()).toBe(none.status());
  expect(await wrong.text()).toBe(await none.text());
  expect(await wrong.text()).not.toContain(order.web.token);
  let limited = false;
  for (let i = 0; i < 12 && !limited; i++) limited = (await anon.post("/api/store/lookup", { headers: ip, data: { number: String(1001 + i), email: "guess@example.com" } })).status() === 429;
  expect(limited, "order lookup is rate limited").toBe(true);
  // Screenshots and labels of an order are admin only.
  expect((await anon.get(`/api/orders/${order.id}/screenshot`)).status()).toBe(401);
});

test("admin login locks out after repeated wrong passwords", async () => {
  const ip = { ...sameOrigin, "x-forwarded-for": "203.0.113.50" };
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) statuses.push((await anon.post("/api/auth/login", { headers: ip, data: { password: `wrong-${i}` } })).status());
  expect(statuses).toEqual([401, 401, 401, 401, 401]);
  // Locked now: even the right password is refused from that address.
  const locked = await anon.post("/api/auth/login", { headers: ip, data: { password: ADMIN_PASSWORD } });
  expect(locked.status()).toBe(429);
  expect((await locked.json()).error).toMatch(/Too many wrong passwords\. Wait \d+ minutes?/);
  expect(locked.headers()["set-cookie"] ?? "").not.toContain("peps_session");
  // Someone else is not locked out.
  const fresh = await playwrightRequest.newContext({ baseURL: BASE });
  const other = await fresh.post("/api/auth/login", { headers: { ...sameOrigin, "x-forwarded-for": "203.0.113.51" }, data: { password: ADMIN_PASSWORD } });
  await fresh.dispose();
  expect(other.status()).toBe(200);
  writeFileSync(path.join(evidence, "login-lockout.txt"), `5 wrong passwords: ${statuses.join(", ")}\n6th try with the CORRECT password: ${locked.status()} ${JSON.stringify(await locked.json())}\nother client, correct password: ${other.status()}\n`);
});

test("robots.txt follows the open/closed switch automatically", async () => {
  const open = await (await anon.get("/robots.txt")).text();
  expect(open).toContain("Allow: /");
  for (const p of ["/admin", "/account", "/checkout", "/order/", "/review/", "/api/"]) expect(open).toContain(`Disallow: ${p}`);
  expect(open).toContain(`Sitemap: ${BASE}/sitemap.xml`);
  expect(open).not.toMatch(/^Disallow: \/$/m);
  expect(await (await anon.get("/sitemap.xml")).text()).toContain("/product/");

  const data = await (await admin.get("/api/data")).json();
  const set = async (isOpen: boolean) => {
    const res = await admin.patch("/api/settings", { headers: sameOrigin, data: { store: { ...data.store, open: isOpen } } });
    expect(res.status()).toBe(200);
    await new Promise((r) => setTimeout(r, 2600)); // the store reads settings through a 2 second cache
  };
  await set(false);
  const closed = await (await anon.get("/robots.txt")).text();
  expect(closed.trim().split(/\r?\n/).filter(Boolean)).toEqual(["User-Agent: *", "Disallow: /"]);
  expect(await (await anon.get("/sitemap.xml")).text()).not.toContain("/product/");
  expect(await (await anon.get("/")).text()).toMatch(/noindex/);
  await set(true);
  expect(await (await anon.get("/robots.txt")).text()).toBe(open);
  writeFileSync(path.join(evidence, "robots.txt"), `=== STORE CLOSED ===\n${closed}\n=== STORE OPEN ===\n${open}`);
});

test("FAQ names only the payment methods that are on", async () => {
  const html = await (await anon.get("/faq")).text();
  expect(html).toContain("payment instructions for Zelle,");
  expect(html).not.toContain("Cash App");
  expect(html).not.toContain("{payment_methods}");
  const home = await (await anon.get("/")).text();
  expect(home).not.toContain("Cash App");
});

test("analytics endpoint: accepts page events, ignores crawlers, never lets a browser count an order", async () => {
  const ua = { ...sameOrigin, "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36", "x-forwarded-for": "203.0.113.90" };
  const before = (await (await admin.get("/api/analytics?days=7")).json()).totals;
  expect((await anon.post("/api/store/track", { headers: ua, data: { e: "visit" } })).status()).toBe(204);
  expect((await anon.post("/api/store/track", { headers: { ...ua, "user-agent": "Googlebot/2.1" }, data: { e: "visit" } })).status()).toBe(204);
  expect((await anon.post("/api/store/track", { headers: ua, data: { e: "product_view", id: "not-a-real-product" } })).status()).toBe(204);
  expect((await anon.post("/api/store/track", { headers: ua, data: { e: "order" } })).status()).toBe(400);
  expect((await anon.post("/api/store/track", { headers: { ...ua, origin: "https://evil.example" }, data: { e: "visit" } })).status()).toBe(403);
  const after = (await (await admin.get("/api/analytics?days=7")).json()).totals;
  expect(after.visit).toBe(before.visit + 1); // the real one only: not the crawler, not the cross-site call
  expect(after.product_view).toBe(before.product_view);
  expect(after.order).toBe(before.order);
  expect((await anon.get("/api/analytics")).status()).toBe(401);
});

test("admin: unknown /admin address shows the admin 404; the search box is not a sign-in field", async ({ page }) => {
  await adminLogin(page);
  const res = await page.goto("/admin/this-page-does-not-exist");
  expect(res!.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.locator("[data-admin-404]")).toBeVisible();
  // Still inside the admin shell, not the store's 404.
  await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible();
  await expect(page.getByText("That page is not in the catalog")).toHaveCount(0);
  await page.screenshot({ path: path.join(SHOTS, "flow", "admin-404.png") });
  await page.getByRole("link", { name: "Back to the Dashboard" }).click();
  await page.waitForURL(/\/admin$/);
  // The store keeps its own 404 for store addresses.
  const store = await page.request.get("/no-such-store-page");
  expect(store.status()).toBe(404);
  expect(await store.text()).toContain("That page is not in the catalog");

  const search = page.getByRole("combobox", { name: "Search orders, customers and products" });
  await expect(search).toHaveAttribute("autocomplete", "off");
  await expect(search).toHaveAttribute("name", "admin-find");
  await expect(search).toHaveAttribute("id", "admin-find");
  await expect(search).toHaveAttribute("type", "search");
  for (const attr of ["name", "id"]) expect(await search.getAttribute(attr)).not.toMatch(/user|email|login|name$/i);

  await page.goto("/admin/settings");
  const tab = page.getByRole("radio", { name: /Business|General|Money/ }).first();
  if (await tab.isVisible().catch(() => false)) await tab.click();
  const pw = page.locator('input[type="password"]');
  if ((await pw.count()) === 0) await page.goto("/admin/settings?tab=business");
  await expect(pw).toHaveCount(3);
  expect(await pw.evaluateAll((els) => els.map((e) => e.getAttribute("autocomplete")))).toEqual(["current-password", "new-password", "new-password"]);
  await page.goto("/admin/login");
});

test("store password fields use the right autocomplete values", async ({ page }) => {
  await page.goto("/account");
  const gate = page.getByRole("dialog", { name: /Are you \d+ or older/ });
  if (await gate.isVisible({ timeout: 3000 }).catch(() => false)) {
    await gate.getByRole("button", { name: "Yes, enter" }).click();
  }
  const pass = page.locator("#au-pass");
  await expect(pass).toBeVisible();
  const first = await pass.getAttribute("autocomplete");
  const tabs = page.getByRole("tab");
  const seen = new Set([first]);
  for (const t of await tabs.all()) {
    await t.click();
    if (await pass.isVisible().catch(() => false)) seen.add(await pass.getAttribute("autocomplete"));
  }
  expect([...seen].sort()).toEqual(["current-password", "new-password"]);
});

test("dashboard to-do lists the setup gaps: alert email, from-address, ship-from, compound info", async ({ page }) => {
  const data = await (await admin.get("/api/data")).json();
  const save = async (store: unknown) => expect((await admin.patch("/api/settings", { headers: sameOrigin, data: { store } })).status()).toBe(200);
  await adminLogin(page);
  const gaps = ["No alert email is set", "No email from-address is set", "The ship-from address is missing"];
  for (const g of gaps) await expect(page.getByText(g)).toHaveCount(0);
  await expect(page.getByText(/website products? (is|are) missing compound info/)).toBeVisible();
  try {
    await save({ ...data.store, alertEmails: [], emailFromAddress: "", shipFrom: { ...data.store.shipFrom, street1: "", city: "" } });
    await page.reload();
    for (const g of gaps) await expect(page.getByText(g)).toBeVisible();
    await page.screenshot({ path: path.join(SHOTS, "flow", "dashboard-todo-setup-gaps.png"), fullPage: true });
  } finally {
    await save(data.store);
  }
  await page.reload();
  for (const g of gaps) await expect(page.getByText(g)).toHaveCount(0);
});
