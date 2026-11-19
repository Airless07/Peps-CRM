// Phones: product cards open on the FIRST tap, everywhere cards are shown. Runs on a real mobile
// device profile with touch (iPhone 14, WebKit, hasTouch), using real touch taps (touchscreen.tap),
// not mouse clicks. Also checks that nothing (hero vials, hover layers, badges) sits on top of a card.
//
//   npx playwright test --project=mobile --no-deps
import path from "node:path";
import { mkdirSync } from "node:fs";
import { chromium, devices, expect, test, type Page } from "@playwright/test";
import { SHOTS } from "../playwright.config";
import { adminLogin } from "./helpers";

test.use({ ...devices["iPhone 14"], hasTouch: true });

const evidence = path.join(SHOTS, "mobile");
mkdirSync(evidence, { recursive: true });
const agePassed = `localStorage.setItem("bp-age", String(Date.now() + 86400000 * 30));`;

/** What is really under a point on screen: the product card link it belongs to (or null) and the element. */
async function under(page: Page, x: number, y: number) {
  return page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    const card = el?.closest("a[data-product-card]");
    return { card: card?.getAttribute("data-product-card") ?? null, tag: el ? `${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(" ").slice(0, 3).join(".")}` : "nothing" };
  }, [x, y] as const);
}

/** Every card on the page has its image, name and price under the card's own link (nothing covers it). */
async function cardsAreTappable(page: Page) {
  const cards = page.locator("a[data-product-card]");
  const n = await cards.count();
  expect(n, "product cards on the page").toBeGreaterThan(0);
  for (let i = 0; i < Math.min(n, 8); i++) {
    const card = cards.nth(i);
    await card.scrollIntoViewIfNeeded();
    const slug = await card.getAttribute("data-product-card");
    for (const part of [card.locator("img, svg").first(), card.locator("h3"), card.locator("h3 + span")]) {
      const b = (await part.boundingBox())!;
      const hit = await under(page, b.x + b.width / 2, b.y + b.height / 2);
      expect(hit.card, `${slug}: what is on top at that spot is ${hit.tag}`).toBe(slug);
    }
  }
}

/** Tap a card with a real finger tap at `where`; the product page must open on that first tap. */
async function tapOpens(page: Page, from: string, where: "image" | "name" | "price", index = 0) {
  await page.goto(from);
  const card = page.locator("a[data-product-card]").nth(index);
  await card.scrollIntoViewIfNeeded();
  const slug = (await card.getAttribute("data-product-card"))!;
  const part = where === "image" ? card.locator("img, svg").first() : where === "name" ? card.locator("h3") : card.locator("h3 + span");
  const b = (await part.boundingBox())!;
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForURL(`**/product/${slug}`, { timeout: 10_000 });
  await expect(page.locator("h1")).toBeVisible();
  return slug;
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(agePassed);
});

test("the device really is a touch phone with no hover", async ({ page }) => {
  await page.goto("/");
  const env = await page.evaluate(() => ({ touch: navigator.maxTouchPoints > 0 || "ontouchstart" in window, width: innerWidth, hover: matchMedia("(hover: hover)").matches }));
  expect(env.touch).toBe(true);
  expect(env.width).toBe(390);
  // Hover styles are hover-capable devices only: none of them exist for this phone.
  expect(env.hover).toBe(false);
});

test("home page: tapping a product card opens the product on the first tap", async ({ page }) => {
  await page.goto("/");
  await cardsAreTappable(page);
  await page.screenshot({ path: path.join(evidence, "home-cards.png") });
  await tapOpens(page, "/", "image");
  await tapOpens(page, "/", "name", 1);
  await tapOpens(page, "/", "price", 2);
});

test("shop page: tapping a product card opens the product on the first tap", async ({ page }) => {
  await page.goto("/shop");
  await cardsAreTappable(page);
  await page.screenshot({ path: path.join(evidence, "shop-cards.png") });
  await tapOpens(page, "/shop", "image");
  await tapOpens(page, "/shop", "name", 1);
  await tapOpens(page, "/shop", "price", 3);
});

test("collection page: tapping a product card opens the product on the first tap", async ({ page }) => {
  await page.goto("/collections");
  const href = await page.locator('main a[href^="/collections/"]').first().getAttribute("href");
  expect(href).toBeTruthy();
  await page.goto(href!);
  await cardsAreTappable(page);
  await page.screenshot({ path: path.join(evidence, "collection-cards.png") });
  await tapOpens(page, href!, "image");
  await tapOpens(page, href!, "name");
});

test("product page: related product cards open on the first tap too", async ({ page }) => {
  await page.goto("/shop");
  const first = await page.locator("a[data-product-card]").first().getAttribute("href");
  await page.goto(first!);
  const related = page.locator("a[data-product-card]");
  if ((await related.count()) === 0) test.skip(true, "this product has no related products");
  await cardsAreTappable(page);
  await tapOpens(page, first!, "image");
});

test("the hero vials and every animated layer never take a tap", async ({ page }) => {
  await page.goto("/");
  const hero = page.locator(".hv");
  if ((await hero.count()) > 0) {
    const pe = await hero.evaluate((el) => [getComputedStyle(el).pointerEvents, ...[...el.querySelectorAll("*")].map((c) => getComputedStyle(c).pointerEvents)]);
    expect(new Set(pe), "hero vials and all their layers").toEqual(new Set(["none"]));
    // Taps right on the vials go to whatever is underneath, never to the decoration.
    await hero.scrollIntoViewIfNeeded();
    const b = (await hero.boundingBox())!;
    const hit = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return el ? (el.closest(".hv") ? "the hero vials" : "not the hero") : "nothing (off screen)";
    }, [b.x + b.width / 2, b.y + b.height / 2] as const);
    expect(hit).toBe("not the hero");
  }
  // Inside the cards: the hover GIF is not even shown on touch, and images/badges pass taps to the link.
  const layers = await page.locator("a[data-product-card] img, a[data-product-card] .absolute").evaluateAll((els) => els.map((e) => ({ pe: getComputedStyle(e).pointerEvents, shown: getComputedStyle(e).display !== "none" })));
  expect(layers.filter((l) => l.shown && l.pe !== "none")).toEqual([]);
});

test("product page shows the size as a label for one size and a picker for several", async ({ page }) => {
  await page.goto("/shop");
  const slugs = await page.locator("a[data-product-card]").evaluateAll((els) => els.map((e) => e.getAttribute("href")!));
  let single = false;
  let multi = false;
  for (const href of slugs) {
    await page.goto(href);
    if ((await page.locator("[data-single-size]").count()) > 0) {
      await expect(page.locator("[data-single-size]")).toContainText(/\d/);
      if (!single) await page.screenshot({ path: path.join(evidence, "product-one-size.png") });
      single = true;
    }
    if ((await page.locator("#size").count()) > 0) multi = true;
    if (single && multi) break;
  }
  expect(single, "a product with one size shows its size as a label").toBe(true);
  expect(multi, "a product with several sizes shows a picker").toBe(true);
});

test("admin on a phone: Restock and Adjust have 44px - / + buttons that update live", async () => {
  // Same iPhone 14 profile with touch, in Chromium: WebKit refuses the admin's Secure session cookie on
  // http://localhost, so signing in only works there over https (the live site).
  const { defaultBrowserType: _b, ...iphone } = devices["iPhone 14"];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...iphone, hasTouch: true, baseURL: test.info().project.use.baseURL });
  const page = await ctx.newPage();
  await adminLogin(page);
  await page.goto("/admin/inventory");
  await page.getByRole("button", { name: "Restock" }).first().click();
  const sheet = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Restock" }) });
  await expect(sheet).toBeVisible();
  const qty = sheet.getByRole("textbox").first();
  const plusQty = sheet.getByRole("button", { name: "Increase quantity" });
  const minusQty = sheet.getByRole("button", { name: "Decrease quantity" });
  const plusCost = sheet.getByRole("button", { name: "Increase total cost" });
  const minusCost = sheet.getByRole("button", { name: "Decrease total cost" });
  for (const b of [plusQty, minusQty, plusCost, minusCost]) {
    const box = (await b.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  // Quantity never goes below 1; cost never below $0.
  await qty.fill("1");
  await expect(minusQty).toBeDisabled();
  await expect(minusCost).toBeDisabled(); // a new restock starts at $0.00
  await plusQty.tap();
  await plusQty.tap();
  await expect(qty).toHaveValue("3");
  for (let i = 0; i < 30; i++) await plusCost.tap();
  // $30 / 3 = $10.00 per unit, shown live.
  await expect(sheet.getByText("$10.00")).toBeVisible();
  // Typing still works.
  await qty.fill("6");
  await expect(sheet.getByText("$5.00")).toBeVisible();
  await page.screenshot({ path: path.join(evidence, "admin-restock.png") });
  await sheet.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Adjust" }).first().click();
  const adj = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Stock adjustment" }) });
  await expect(adj).toBeVisible();
  const pills = adj.getByRole("radiogroup").first().getByRole("radio");
  const [a, r] = [(await pills.nth(0).boundingBox())!, (await pills.nth(1).boundingBox())!];
  expect(Math.abs(a.width - r.width), "Add and Remove are the same width").toBeLessThan(1);
  expect(Math.abs(a.height - r.height), "and the same height").toBeLessThan(1);
  // The selected pill fully wraps its text (nothing spills out).
  const fits = await pills.evaluateAll((els) => els.every((e) => e.scrollWidth <= e.clientWidth));
  expect(fits).toBe(true);
  await pills.nth(1).tap();
  await expect(pills.nth(1)).toHaveAttribute("aria-checked", "true");
  const plusAdj = adj.getByRole("button", { name: "Increase quantity" });
  expect((await plusAdj.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await plusAdj.tap();
  await expect(adj.getByRole("textbox").first()).toHaveValue("2");
  await expect(adj.locator("[data-stock-after]")).toContainText("→");
  await page.screenshot({ path: path.join(evidence, "admin-adjust.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await browser.close();
});
