// The whole life of an order, clicked through like a customer and the owner would, on a production
// build with the store OPEN. Resend and Shippo are local fakes. After every step the test checks
// stock, the money math and the combined Orders list.
import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import sharp from "sharp";
import type { PublicProduct } from "../src/lib/store/catalog";
import { SHOTS } from "../playwright.config";
import { adminLogin, adminState, emails, shippoCalls, usd, type AdminState } from "./helpers";

test.describe.configure({ mode: "serial" });

const EMAIL = `e2e-${Date.now()}@example.com`;
const evidence = path.join(SHOTS, "flow");
mkdirSync(evidence, { recursive: true });

let shopper: BrowserContext;
let admin: BrowserContext;
let shop: Page;
let adm: Page;

// Filled in as the flow goes.
let reta: PublicProduct;
let v10 = "";
let v20 = "";
let expected = { unit10: 0, unit20: 0, list: 0, qtySavings: 0, subtotal: 0, code: 0, shipping: 1195, total: 0 };
let orderNumber = 0;
let orderId = "";
let orderUrl = "";
let start: AdminState;
let afterPaid: AdminState;

test.beforeAll(async ({ browser }) => {
  shopper = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  admin = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  shop = await shopper.newPage();
  adm = await admin.newPage();
  await adminLogin(adm);
  start = await adminState(admin.request);
});
test.afterAll(async () => {
  await shopper?.close();
  await admin?.close();
});

/** The age gate, answered like a real visitor: tick both boxes, then Enter site. */
const passAgeGate = async (page: Page) => {
  const gate = page.getByRole("dialog", { name: "Please confirm before you enter" });
  if (!(await gate.isVisible({ timeout: 3000 }).catch(() => false))) return;
  for (const box of await gate.locator('input[type="checkbox"]').all()) await box.check();
  await gate.getByRole("button", { name: "Enter site" }).click();
  await expect(gate).toBeHidden();
};

test("1. the store is open and shows the new brand with honest testing copy", async () => {
  await shop.goto("/");
  await passAgeGate(shop);
  await expect(shop).toHaveTitle(/Buckshot Labs/);
  const body = await shop.locator("body").innerText();
  expect(body.toLowerCase()).not.toContain(["buckshot", "peps"].join(" "));
  expect(body).not.toMatch(/every lot|independent lab|verified batch/i);
  await expect(shop.getByRole("heading", { name: "Testing, shown honestly" })).toBeVisible();
  await expect(shop.locator("dt", { hasText: "Status on every product" })).toHaveCount(1);
  // Best sellers: a full row of exactly 4.
  const best = shop.locator("section", { has: shop.getByRole("heading", { name: "Best sellers" }) });
  await expect(best.locator("article")).toHaveCount(4);
  await shop.screenshot({ path: path.join(evidence, "01-home.png") });
});

test("2. add two sizes of one product: buy more, save more applies", async () => {
  const catalog = (await (await shopper.request.get("/api/store/products")).json()) as { products: PublicProduct[] };
  reta = catalog.products.find((p) => p.name === "Retatrutide")!;
  expect(reta, "Reta is on the website with two sizes").toBeTruthy();
  expect(reta.variants.map((v) => v.label)).toEqual(["10mg", "20mg"]);
  [v10, v20] = reta.variants.map((v) => v.id);
  const [p10, p20] = reta.variants.map((v) => v.priceCents);
  // Two vials of the same product = 5% off each (store default tiers).
  const unit10 = Math.round(p10 * 0.95);
  const unit20 = Math.round(p20 * 0.95);
  const subtotal = unit10 + unit20;
  const code = Math.round(subtotal * 0.1); // WELCOME10
  expected = { unit10, unit20, list: p10 + p20, qtySavings: p10 + p20 - subtotal, subtotal, code, shipping: 1195, total: subtotal - code + 1195 };

  await shop.goto(`/product/${reta.slug}`);
  await passAgeGate(shop);
  await shop.getByRole("radio", { name: /^10mg/ }).click();
  await shop.getByRole("button", { name: /^Add to cart ·/ }).click();
  await expect(shop.getByRole("dialog", { name: "Your cart" })).toBeVisible();
  await shop.getByRole("button", { name: "Close cart" }).click();
  await shop.getByRole("radio", { name: /^20mg/ }).click();
  await shop.getByRole("button", { name: /^Add to cart ·/ }).click();

  const drawer = shop.getByRole("dialog", { name: "Your cart" });
  await expect(drawer.getByText("Buy more, save more")).toBeVisible();
  await expect(drawer.getByText(`-${usd(expected.qtySavings)}`)).toBeVisible();
  // One Subtotal line only (the bold one), preceded by the regular price.
  await expect(drawer.getByText("Items at regular price")).toBeVisible();
  await expect(drawer.locator("dt", { hasText: /^Subtotal$/ })).toHaveCount(1);
  await expect(drawer.locator("dt", { hasText: /Subtotal/ })).toHaveCount(1);
  await expect(drawer.locator("[data-cart-total]")).toContainText(usd(expected.subtotal));
});

test("3. a discount code stacks on top, in the drawer and on the cart page", async () => {
  const drawer = shop.getByRole("dialog", { name: "Your cart" });
  await drawer.getByRole("button", { name: "Add a discount or referral code" }).click();
  await drawer.getByLabel("Discount or referral code").fill("welcome10");
  await drawer.getByRole("button", { name: "Apply" }).click();
  await expect(drawer.getByText(/Code\s+WELCOME10\s+applied/)).toBeVisible();
  await expect(drawer.getByText(`-${usd(expected.code)}`)).toBeVisible();
  await expect(drawer.locator("[data-cart-total]")).toContainText(usd(expected.subtotal - expected.code));
  await shop.screenshot({ path: path.join(evidence, "03-cart-drawer.png") });

  await drawer.getByRole("link", { name: "View cart" }).click();
  await shop.waitForURL(/\/cart$/);
  const summary = shop.locator("aside");
  await expect(summary.getByText("Items at regular price")).toBeVisible();
  await expect(summary.locator("dt", { hasText: /Subtotal/ })).toHaveCount(1);
  const rows = (await summary.locator("dl > div").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  expect(rows.slice(0, 4)).toEqual([
    `Items at regular price ${usd(expected.list)}`,
    `Buy more, save more -${usd(expected.qtySavings)}`,
    expect.stringMatching(new RegExp(`WELCOME10.* -\\${usd(expected.code)}$`)),
    `Subtotal ${usd(expected.subtotal - expected.code)}`,
  ]);
  await shop.screenshot({ path: path.join(evidence, "03-cart-page.png"), fullPage: true });
});

test("4. sign up inside checkout, Priority shipping, place the order", async () => {
  await shop.locator("#main").getByRole("link", { name: "Checkout" }).click();
  await shop.waitForURL(/\/checkout/);
  // Create an account without losing the cart.
  const tab = shop.getByRole("tab", { name: /Create account|Sign up/i });
  if (await tab.isVisible().catch(() => false)) await tab.click();
  await shop.locator("#au-name").fill("Dana E2E Reed");
  await shop.locator("#au-email").fill(EMAIL);
  await shop.locator("#au-pass").fill("correct horse battery 42");
  await shop.locator("form", { has: shop.locator("#au-email") }).locator('button[type="submit"]').click();

  await expect(shop.locator("#co-street1")).toBeVisible();
  // Codes are never carried from the guest cart into an account: the customer applies it again (re-checked for this account).
  await expect(shop.locator("[data-applied-discount]")).toHaveCount(0);
  await shop.getByRole("button", { name: "Add a discount or referral code" }).click();
  await shop.getByLabel("Discount or referral code").fill("welcome10");
  await shop.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(shop.locator("[data-applied-discount]")).toHaveText(/WELCOME10/);
  await shop.locator("#co-name").fill("Dana E2E Reed");
  await shop.locator("#co-street1").fill("500 Oak Avenue");
  await shop.locator("#co-city").fill("Denver");
  await shop.locator("#co-state").selectOption("CO");
  await shop.locator("#co-zip").fill("80202");
  await shop.locator("#co-phone").fill("3035550142");

  await shop.locator('label:has(input[name="ship"])', { hasText: "Priority" }).first().click();
  await shop.locator('label:has(input[name="pay"])', { hasText: "Zelle" }).click();
  // Cash App is off, so checkout does not offer it.
  await expect(shop.locator('label:has(input[name="pay"])', { hasText: "Cash App" })).toHaveCount(0);
  for (const box of await shop.locator('input[type="checkbox"]').all()) await box.check();

  const place = shop.getByRole("button", { name: /Place order/ });
  await expect(place).toHaveText(new RegExp(`Place order · \\${usd(expected.total)}`));
  await shop.screenshot({ path: path.join(evidence, "04-checkout.png"), fullPage: true });
  await place.click();
  await shop.waitForURL(/\/order\/[A-Za-z0-9_-]{32}/);
  orderUrl = shop.url();
});

test("5. the payment page shows the instructions and the exact amount", async () => {
  await expect(shop.getByText(usd(expected.total)).first()).toBeVisible();
  await expect(shop.getByText("pay@buckshotlabs.test").first()).toBeVisible();
  await expect(shop.getByText(/Zelle/).first()).toBeVisible();
  const text = await shop.locator("main").innerText();
  orderNumber = Number(text.match(/#\s?(\d{4,})/)![1]);
  expect(orderNumber).toBeGreaterThan(1000);
  await shop.screenshot({ path: path.join(evidence, "05-payment-page.png"), fullPage: true });

  // The order exists, awaiting payment, and has NOT touched stock or money.
  const s = await adminState(admin.request);
  const o = s.data.pendingOrders.find((x) => x.number === orderNumber)!;
  expect(o, "order is in the admin data as pending").toBeTruthy();
  orderId = o.id;
  expect(o).toMatchObject({ status: "awaiting_payment", source: "online", shippingCents: 1195, discountType: "$", discountValue: expected.code });
  expect(o.lines.map((l) => [l.productId, l.quantity, l.unitPriceCents])).toEqual([[v10, 1, expected.unit10], [v20, 1, expected.unit20]]);
  expect(o.web).toMatchObject({ email: EMAIL, shippingTier: "priority", payChoice: "zelle" });
  expect(o.web!.promo!.code).toBe("WELCOME10");
  expect(s.money).toEqual(start.money);
  expect(s.stock(v10)).toBe(start.stock(v10));
  expect(s.stock(v20)).toBe(start.stock(v20));

  // Emails: the customer got instructions, the owner got an alert.
  const mine = emails().filter((e) => e.subject?.includes(`#${orderNumber}`));
  expect(mine.map((e) => [e.to, e.subject])).toEqual([
    [[EMAIL], `Order #${orderNumber} received: payment instructions`],
    [["owner@buckshotlabs.test"], expect.stringContaining(`New order #${orderNumber}: ${usd(expected.total)}`)],
  ]);
  expect(mine[0].from).toBe("Buckshot Labs <orders@buckshotlabs.test>");
  expect(mine[0].text).toContain(`Send exactly ${usd(expected.total)} to: pay@buckshotlabs.test`);
});

test("6. the customer uploads a payment screenshot", async () => {
  const png = path.join(evidence, "payment-proof.png");
  writeFileSync(png, await sharp({ create: { width: 600, height: 900, channels: 3, background: "#22a45d" } }).png().toBuffer());
  await shop.locator('input[type="file"]').setInputFiles(png);
  await expect(shop.getByText("Payment screenshot received")).toBeVisible();
  const s = await adminState(admin.request);
  expect(s.data.pendingOrders.find((x) => x.id === orderId)!.web!.hasScreenshot).toBe(true);
  expect(s.money).toEqual(start.money);
  expect(emails().some((e) => e.subject === `Payment screenshot uploaded for order #${orderNumber}` && e.to?.[0] === "owner@buckshotlabs.test")).toBe(true);
});

test("7. admin: the order is in the combined list, waiting for payment, with the screenshot", async () => {
  await adm.goto("/admin/orders");
  const row = adm.locator("tr, li, a, div").filter({ hasText: `#${orderNumber}` }).filter({ hasText: /Awaiting payment/ }).first();
  await expect(row).toBeVisible();
  await adm.goto(`/admin/orders/${orderId}`);
  await expect(adm.getByRole("heading", { name: new RegExp(`#${orderNumber}`) }).first()).toBeVisible();
  await expect(adm.getByAltText(`Payment screenshot for order ${orderNumber}`)).toBeVisible();
  await expect(adm.getByText(usd(expected.total)).first()).toBeVisible();
});

test("8. admin: an internal note is saved and the customer never sees it", async () => {
  const note = "E2E-INTERNAL paid from a different name, double check";
  await adm.locator("#internal-note").fill(note);
  await adm.getByRole("button", { name: "Save note" }).click();
  await expect(adm.getByText("Internal note saved.")).toBeVisible();
  expect((await adminState(admin.request)).all.find((o) => o.id === orderId)!.adminNote).toBe(note);
  await shop.goto(orderUrl);
  expect(await shop.content()).not.toContain("E2E-INTERNAL");
  await shop.goto("/account");
  expect(await shop.content()).not.toContain("E2E-INTERNAL");
});

test("9. admin: Mark paid turns it into a sale: stock and money move", async () => {
  await adm.goto(`/admin/orders/${orderId}`);
  await adm.getByRole("button", { name: "Mark paid" }).first().click();
  const sheet = adm.getByRole("dialog").filter({ hasText: "Payment received" });
  await expect(sheet.getByText(`#${orderNumber}`)).toBeVisible();
  await sheet.getByRole("button", { name: "Payment received" }).click();
  await expect(adm.getByText("Marked paid. The customer was emailed.")).toBeVisible();

  afterPaid = await adminState(admin.request);
  const o = afterPaid.data.orders.find((x) => x.id === orderId)!;
  expect(o, "the order now counts as a sale").toBeTruthy();
  expect(o).toMatchObject({ status: "paid", soldBy: "W", paymentMethod: "Zelle" });
  // Stock: one of each size left the shelf.
  expect(afterPaid.stock(v10)).toBe(start.stock(v10) - 1);
  expect(afterPaid.stock(v20)).toBe(start.stock(v20) - 1);
  // Money: the order's numbers are exactly what the customer was shown.
  const r = afterPaid.ledger.orders.get(orderId)!;
  expect({ subtotal: r.subtotal, discount: r.discount, shipping: r.shipping, total: r.total }).toEqual({ subtotal: expected.subtotal, discount: expected.code, shipping: 1195, total: expected.total });
  expect(r.revenue).toBe(expected.subtotal - expected.code);
  // Cost was snapshotted at this moment from the stock on hand.
  expect(o.lines.every((l) => l.unitCostCents > 0)).toBe(true);
  expect(r.cost).toBe(o.lines.reduce((s, l) => s + l.quantity * l.unitCostCents, 0));
  // Every cent of the order landed in one of the three buckets, and shipping went to the business.
  const moved = afterPaid.money.business - start.money.business + (afterPaid.money.pendingA - start.money.pendingA) + (afterPaid.money.pendingB - start.money.pendingB);
  expect(moved).toBe(r.a + r.b + r.business);
  expect(afterPaid.money.shipping - start.money.shipping).toBe(1195);
  expect(emails().some((e) => e.subject === `Payment confirmed for order #${orderNumber}` && e.to?.[0] === EMAIL)).toBe(true);
});

test("10. admin: buy the shipping label (Shippo is a fake): its cost comes out of business money", async () => {
  await adm.getByRole("button", { name: "Buy label" }).first().click();
  const sheet = adm.getByRole("dialog").filter({ hasText: "Buy shipping label" });
  // The customer paid for Priority, so Priority Mail is the suggested rate.
  const buy = sheet.getByRole("button", { name: /Buy label · \$9\.10/ });
  await expect(buy).toBeVisible();
  await adm.screenshot({ path: path.join(evidence, "10-buy-label.png") });
  await buy.click();
  await expect(sheet.getByRole("button", { name: /Open label to print/ })).toBeVisible();
  await sheet.getByRole("button", { name: "Done" }).click();

  const s = await adminState(admin.request);
  const o = s.data.orders.find((x) => x.id === orderId)!;
  expect(o.status).toBe("label_purchased");
  expect(o.web?.trackingNumber).toMatch(/^94001118995600000\d{5}$/);
  expect(o.web?.labelUrl).toBe(`https://deliver.goshippo.com/mock-label-${o.web?.trackingNumber}.pdf`);
  expect(s.data.labels.filter((l) => l.orderId === orderId).map((l) => l.costCents)).toEqual([910]);
  expect(s.money.business).toBe(afterPaid.money.business - 910);
  expect(s.money.labels - afterPaid.money.labels).toBe(910);
  expect(s.money.pendingA).toBe(afterPaid.money.pendingA);
  expect(s.money.pendingB).toBe(afterPaid.money.pendingB);
  expect(s.stock(v10)).toBe(afterPaid.stock(v10));
  // Shippo was asked for rates to the customer's address and then for exactly one label.
  const calls = shippoCalls();
  expect(calls.filter((c) => c.path === "/transactions/")).toHaveLength(1);
  expect(calls.find((c) => c.path === "/transactions/")!.body).toMatchObject({ rate: "rate_priority" });
  expect(JSON.stringify(calls.find((c) => c.path === "/shipments/")!.body)).toContain("500 Oak Avenue");
  // The customer got the tracking number.
  const mail = emails().find((e) => e.subject === `Order #${orderNumber} has shipped`)!;
  expect(mail.to).toEqual([EMAIL]);
  expect(mail.text).toMatch(/94001118995600000\d{5}/);
});

test("11. admin: mark shipped, then delivered: the review email goes out", async () => {
  const act = async (action: string) => {
    const res = await admin.request.post(`/api/orders/${orderId}/action`, { data: { action }, headers: { origin: new URL(adm.url()).origin } });
    expect(res.status(), action).toBe(200);
  };
  // Shipped through the screen when the button is offered, otherwise the same action the button sends.
  await adm.goto(`/admin/orders/${orderId}`);
  const openLabel = adm.getByRole("button", { name: "Open label" }).first();
  if (await openLabel.isVisible().catch(() => false)) {
    const popup = adm.waitForEvent("popup").catch(() => null);
    await openLabel.click();
    await (await popup)?.close().catch(() => {});
  }
  const shipBtn = adm.getByRole("button", { name: "Mark shipped" }).first();
  if (await shipBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await shipBtn.click();
    await adm.getByRole("dialog").getByRole("button", { name: "Mark shipped" }).click();
    await expect(adm.getByText("Marked shipped.").last()).toBeVisible();
  } else await act("mark-shipped");
  let s = await adminState(admin.request);
  expect(s.data.orders.find((x) => x.id === orderId)!.status).toBe("shipped");

  await adm.goto(`/admin/orders/${orderId}`);
  await adm.getByRole("button", { name: "Mark delivered" }).first().click();
  await adm.getByRole("dialog").getByRole("button", { name: "Mark delivered" }).click();
  await expect(adm.getByText(/Marked delivered. The customer/)).toBeVisible();

  s = await adminState(admin.request);
  const o = s.data.orders.find((x) => x.id === orderId)!;
  expect(o.status).toBe("delivered");
  expect(o.adminNote).toContain("E2E-INTERNAL");
  // Shipping and delivery change no money and no stock.
  expect(s.money.business).toBe(afterPaid.money.business - 910);
  expect(s.stock(v10)).toBe(start.stock(v10) - 1);
  expect(s.stock(v20)).toBe(start.stock(v20) - 1);

  const review = emails().find((e) => e.subject === `How was your order #${orderNumber}?`)!;
  expect(review, "review request email").toBeTruthy();
  expect(review.to).toEqual([EMAIL]);
  const link = review.text!.match(/https?:\/\/\S+\/review\/([A-Za-z0-9_-]{32})/)!;
  expect(link, "the email carries the secret review link").toBeTruthy();
  // No email to the customer ever contained the internal note.
  for (const e of emails().filter((x) => x.to?.includes(EMAIL))) expect(e.text).not.toContain("E2E-INTERNAL");

  // The customer sees "Delivered" and can open the review form from the link in the email.
  await shop.goto(orderUrl);
  await expect(shop.getByText("Delivered").first()).toBeVisible();
  await shop.goto(new URL(link[0]).pathname);
  await expect(shop.locator("form")).toBeVisible();
  await shop.screenshot({ path: path.join(evidence, "11-review-form.png"), fullPage: true });
});

test("12. admin: an in-person sale from the Sell screen", async () => {
  const before = await adminState(admin.request);
  await adm.goto("/admin/sell");
  // Sizes are grouped under their product, in store order, with a photo on the card.
  const retaCard = adm.locator('[data-sell-product="Retatrutide"]');
  await expect(retaCard.locator("[data-sell-variant]")).toHaveCount(2);
  await expect(retaCard.locator("[data-sell-variant]").nth(0)).toContainText("10mg");
  await expect(retaCard.locator("[data-sell-variant]").nth(1)).toContainText("20mg");
  // Every card has a small picture: the product photo when there is one, a colored tile otherwise.
  const cards = adm.locator("[data-sell-product]");
  expect(await cards.locator("img").count()).toBeGreaterThanOrEqual(1);
  for (const card of await cards.all()) expect(await card.locator("img, span[aria-hidden]").count()).toBeGreaterThanOrEqual(1);
  // The size labels are fully readable (not cut off).
  for (const row of await retaCard.locator("[data-sell-variant]").all()) {
    const fits = await row.evaluate((el) => [...el.querySelectorAll("span, div, button")].every((x) => x.scrollWidth <= x.clientWidth + 1));
    expect(fits).toBe(true);
  }
  const order = await adm.locator("[data-sell-product]").evaluateAll((els) => els.map((e) => e.getAttribute("data-sell-product")));
  const storeOrder = [...before.data.listings].sort((a, b) => a.sortOrder - b.sortOrder).map((l) => l.name);
  expect(order).toEqual(storeOrder.filter((n) => order.includes(n)));
  await adm.screenshot({ path: path.join(evidence, "12-sell.png"), fullPage: true });

  const price = before.data.products.find((p) => p.id === v20)!.defaultPriceCents;
  await retaCard.locator("[data-sell-variant]").nth(1).getByRole("button", { name: /^Sell 1 Retatrutide 20mg/ }).click();
  await adm.getByRole("button", { name: /Current order/ }).click();
  await adm.getByRole("button", { name: new RegExp(`Complete order · \\${usd(price).replace(".00", "(\\.00)?")}`) }).click();
  await expect(adm.getByText(/Order saved/).first()).toBeVisible();
  // Let the Undo toast pass so the sale is final.
  await adm.waitForTimeout(6000);

  const s = await adminState(admin.request);
  const sale = s.data.orders.find((o) => o.source === "inperson" && !before.data.orders.some((x) => x.id === o.id))!;
  expect(sale, "the in-person sale was saved").toBeTruthy();
  expect(sale).toMatchObject({ status: "completed", source: "inperson", shippingCents: 0 });
  expect(sale.number).toBe(orderNumber + 1);
  expect(sale.lines.map((l) => [l.productId, l.quantity, l.unitPriceCents])).toEqual([[v20, 1, price]]);
  expect(s.stock(v20)).toBe(before.stock(v20) - 1);
  expect(s.stock(v10)).toBe(before.stock(v10));
  const r = s.ledger.orders.get(sale.id)!;
  expect(r.total).toBe(price);
  const moved = s.money.business - before.money.business + (s.money.pendingA - before.money.pendingA) + (s.money.pendingB - before.money.pendingB);
  expect(moved).toBe(r.a + r.b + r.business);
  expect(s.money.shipping).toBe(before.money.shipping);

  // The combined Orders list shows the website order and the in-person sale together.
  await adm.goto("/admin/orders");
  await expect(adm.getByText(`#${orderNumber}`).first()).toBeVisible();
  await expect(adm.getByText(`#${sale.number}`).first()).toBeVisible();
  const text = await adm.locator("main").innerText();
  expect(text).toMatch(/Delivered/);
  expect(text).toMatch(/In person/i);
  await adm.screenshot({ path: path.join(evidence, "12-orders-combined.png"), fullPage: true });
});

test("13. analytics counted the shopper (and not the admin)", async () => {
  await adm.goto("/admin/analytics");
  const metric = (label: string) => adm.locator(`[data-metric="${label}"]`);
  await expect(metric("Store visits")).toHaveText("1");
  await expect(metric("Orders placed")).toHaveText("1");
  await expect(metric("Checkouts started")).toHaveText("1");
  await expect(metric("Add to carts")).toHaveText("2");
  expect(Number(await metric("Product page views").innerText())).toBeGreaterThanOrEqual(1);
  await expect(metric("Conversion rate")).toHaveText("100%");
  await adm.getByRole("radio", { name: "Last 30 days" }).click();
  await expect(adm.locator("table").first().locator("tbody tr")).toHaveCount(30);
  await adm.screenshot({ path: path.join(evidence, "13-analytics.png"), fullPage: true });
});
