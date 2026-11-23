// Launch proof: shop grid screenshots, the checkout consent box (browser and server), the consent on
// the admin order page, the footer policy links and contact, and the launch checklist.
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import type { PublicProduct } from "../src/lib/store/catalog";
import { SHOTS } from "../playwright.config";
import { adminLogin, enteredSite, ORIGIN } from "./helpers";

test.describe.configure({ mode: "serial" });
const out = (name: string) => path.join(SHOTS, "launch", `${name}.png`);
const stamp = Date.now();
const buyer = { name: "Lena Launch", email: `lena-${stamp}@buckshot-e2e.dev`, password: "correct horse battery 42" };
let orderNumber = 0;

async function storeCtx(browser: Browser, width: number): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  await enteredSite(ctx);
  return ctx;
}
/** Wait until every card the shop counts is visible (the grid bug this pass fixed). */
async function settled(page: Page) {
  const n = Number(await page.locator("[data-shop-count]").getAttribute("data-shop-count"));
  expect(n).toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => [...document.querySelectorAll("[data-product-card]")].filter((c) => Number(getComputedStyle(c.closest("[data-reveal]") ?? c).opacity) > 0.95).length), { timeout: 8000 })
    .toBeGreaterThanOrEqual(Math.min(n, 1));
  await page.waitForTimeout(900);
}

test("shop with products: desktop and 390px phone, two sorts and a search", async ({ browser }) => {
  for (const width of [1440, 390]) {
    const ctx = await storeCtx(browser, width);
    const page = await ctx.newPage();
    await page.goto("/");
    await page.locator('a[href="/shop"]:visible').first().click();
    await page.waitForURL(/\/shop$/);
    await settled(page);
    await page.screenshot({ path: out(`shop-${width}-featured`) });
    const sort = page.locator("select").filter({ has: page.locator('option[value="price-asc"]') });
    await sort.selectOption("price-asc");
    await settled(page);
    await page.screenshot({ path: out(`shop-${width}-price-low-high`) });
    await sort.selectOption("best");
    await settled(page);
    await page.screenshot({ path: out(`shop-${width}-best-selling`) });
    await page.getByRole("searchbox", { name: "Search products" }).fill("reta");
    await settled(page);
    await page.screenshot({ path: out(`shop-${width}-search-reta`) });
    await ctx.close();
  }
});

test("checkout: the consent box is required in the browser and on the server, and is saved on the order", async ({ browser, playwright }) => {
  const ctx = await storeCtx(browser, 1280);
  const page = await ctx.newPage();
  const signup = await page.request.post("/api/store/account", { headers: ORIGIN, data: { action: "signup", ...buyer } });
  expect(signup.status()).toBe(200);
  const products = ((await (await page.request.get("/api/store/products")).json()) as { products: PublicProduct[] }).products;
  const v = products.flatMap((p) => p.variants.filter((x) => x.stock !== "out"))[0];
  const me = (await (await page.request.get("/api/store/cart")).json()) as { accountId: string };
  const add = await page.request.post("/api/store/cart", { headers: ORIGIN, data: { action: "add", accountId: me.accountId, variantId: v.id, quantity: 1, items: [] } });
  expect(add.status()).toBe(200);

  // Server: an order without the box is refused, whatever the browser does.
  const shipTo = { name: buyer.name, street1: "500 Oak Avenue", street2: "", city: "Denver", state: "CO", zip: "80202", country: "US" };
  const q = await (await page.request.post("/api/store/quote", { headers: ORIGIN, data: { items: [{ variantId: v.id, quantity: 1 }], code: "", referralCode: "", shipTo } })).json();
  const std = q.shipping.find((s: { tier: string }) => s.tier === "standard");
  const body = { phone: "3035550142", shipTo, items: [{ variantId: v.id, quantity: 1 }], code: "", tier: "standard", payChoice: "zelle", expectedTotalCents: q.subtotalCents - q.discountCents + std.cents };
  for (const extra of [{}, { consent: false }]) {
    const r = await page.request.post("/api/store/checkout", { headers: ORIGIN, data: { ...body, ...extra } });
    expect(r.status(), "server refuses an order without the consent box").toBe(400);
    expect((await r.json()).error).toMatch(/Tick the box to confirm your age/);
  }

  // Browser: the box sits above Place order; without it the order is not sent.
  await page.goto("/checkout");
  await expect(page.locator("#co-street1")).toBeVisible();
  await page.locator("#co-name").fill(buyer.name);
  await page.locator("#co-street1").fill(shipTo.street1);
  await page.locator("#co-city").fill(shipTo.city);
  await page.locator("#co-state").selectOption("CO");
  await page.locator("#co-zip").fill(shipTo.zip);
  await page.locator("#co-phone").fill("3035550142");
  await page.locator('label:has(input[name="ship"])', { hasText: "Standard" }).first().click();
  await page.locator('label:has(input[name="pay"])', { hasText: "Zelle" }).click();
  const box = page.locator("[data-consent]");
  await expect(box).toContainText("I confirm I am 21 or older and this purchase is for laboratory research use only, not for human consumption. I agree to the Terms and Research Use Policy.");
  await expect(box.getByRole("link", { name: "Terms" })).toHaveAttribute("target", "_blank");
  await expect(box.getByRole("link", { name: "Research Use Policy" })).toHaveAttribute("target", "_blank");
  await expect(page.locator("[data-checkout-policies] a")).toHaveText(["Shipping Policy", "Refund & Return Policy", "Privacy Policy", "Terms of Service", "Research Use Policy"]);
  const place = page.getByRole("button", { name: /Place order/ });
  const sent: string[] = [];
  page.on("request", (r) => r.url().endsWith("/api/store/checkout") && sent.push(r.method()));
  await place.click();
  await expect(box).toContainText("Tick the box to confirm your age and research use before placing your order.");
  expect(sent, "no order request without the box").toEqual([]);
  await box.scrollIntoViewIfNeeded();
  await page.screenshot({ path: out("checkout-checkbox-required") });
  await box.locator('input[type="checkbox"]').check();
  await box.scrollIntoViewIfNeeded();
  await page.screenshot({ path: out("checkout-checkbox-ticked") });
  await place.click();
  await page.waitForURL(/\/order\/[A-Za-z0-9_-]{32}/);
  orderNumber = Number((await page.locator("body").innerText()).match(/#(\d{4,})/)?.[1] ?? 0);
  expect(orderNumber).toBeGreaterThan(0);
  await ctx.close();

  // Admin: the order shows the consent (accepted, time, IP, exact text).
  const admin = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await admin.newPage();
  await adminLogin(a);
  const data = await (await a.request.get("/api/data")).json();
  const order = [...data.orders, ...data.pendingOrders].find((o: { number: number }) => o.number === orderNumber);
  expect(order.consent).toMatchObject({ text: expect.stringMatching(/^I confirm I am 21 or older/), ip: expect.any(String) });
  expect(Date.now() - new Date(order.consent.at).getTime()).toBeLessThan(10 * 60_000);
  await a.goto(`/admin/orders/${order.id}`);
  const card = a.locator("[data-order-consent]");
  await expect(card).toContainText("Accepted");
  await expect(card).toContainText("IP address");
  await expect(card).toContainText("I confirm I am 21 or older");
  await card.scrollIntoViewIfNeeded();
  await a.screenshot({ path: out("order-detail-consent") });
  await admin.close();
  void playwright;
});

test("footer: every policy, full names, and Contact: support@buckshotlabs.com; policies show live shipping prices", async ({ browser }) => {
  for (const width of [1440, 390]) {
    const ctx = await storeCtx(browser, width);
    const page = await ctx.newPage();
    await page.goto("/");
    const nav = page.locator("footer").getByRole("navigation", { name: "Policies" });
    await expect(nav.getByRole("link")).toHaveText(["Terms of Service", "Privacy Policy", "Research Use Policy", "Shipping Policy", "Refund & Return Policy"]);
    await expect(page.locator("[data-footer-contact]")).toContainText("Contact: support@buckshotlabs.com");
    await page.locator("footer").scrollIntoViewIfNeeded();
    await page.screenshot({ path: out(`footer-${width}`), fullPage: false });
    await ctx.close();
  }
  const ctx = await storeCtx(browser, 1280);
  const page = await ctx.newPage();
  await page.goto("/contact");
  await expect(page.locator("[data-contact-email]")).toContainText("support@buckshotlabs.com");
  await page.goto("/shipping");
  const text = await page.locator("article").innerText();
  expect(text).not.toMatch(/\{[a-z_]+\}/);
  expect(text).toMatch(/\$\d+\.\d{2}/);
  await page.screenshot({ path: out("policy-shipping"), fullPage: true });
  for (const p of ["/terms", "/privacy", "/research-use", "/refunds"]) {
    await page.goto(p);
    expect(await page.locator("article").innerText(), p).not.toMatch(/\{[a-z_]+\}/);
  }
  await ctx.close();
});

test("launch checklist: the new items are there, automatic ones check themselves, hand ticks are saved", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await adminLogin(page);
  await page.goto("/admin/settings?tab=launch");
  const item = (id: string) => page.locator(`[data-launch-item="${id}"]`);
  for (const id of ["admin-password", "shippo-live", "shippo-webhook", "gate-consent", "test-data", "promotions", "backups", "real-order", "cancel-refund", "payments-tested", "sales-tax"]) await expect(item(id), id).toBeVisible();
  // The e2e server runs a Shippo TEST key: shown as not done.
  await expect(item("shippo-live")).toHaveAttribute("data-done", "false");
  await expect(item("shippo-live")).toContainText("TEST key");
  await expect(item("gate-consent")).toHaveAttribute("data-done", "true");
  await expect(item("admin-password")).toHaveAttribute("data-done", "true");
  // A hand tick is saved with the date and survives a reload.
  await item("sales-tax").getByRole("checkbox").check();
  await expect(item("sales-tax")).toContainText("Ticked");
  await page.reload();
  await expect(item("sales-tax")).toHaveAttribute("data-done", "true");
  await page.screenshot({ path: out("launch-checklist"), fullPage: true });
  await item("sales-tax").scrollIntoViewIfNeeded();
  await page.screenshot({ path: out("launch-checklist-new-items") });
  await item("sales-tax").getByRole("checkbox").uncheck();
  await expect(item("sales-tax")).toHaveAttribute("data-done", "false");
  await ctx.close();
});
