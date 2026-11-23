// The shop grid must never be empty while it says it has products (the "11 products, no cards" bug).
// Cards fade in on scroll; cards drawn after that script ran (client page change, search, sort,
// collection) used to stay at opacity 0 forever. Store open, and the admin preview while closed.
import { expect, test, type Browser, type Page } from "@playwright/test";
import { adminLogin, enteredSite, ORIGIN } from "./helpers";

test.describe.configure({ mode: "serial" });

const SORTS = ["featured", "best", "price-asc", "price-desc", "newest"];

/** Cards in the grid that a person can actually see: on screen size, not hidden, not faded out (all ancestors). */
const visibleCards = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-product-card]")].filter((c) => {
      const r = c.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) return false;
      let op = 1;
      for (let el: Element | null = c; el; el = el.parentElement) {
        const s = getComputedStyle(el);
        if (s.visibility === "hidden" || s.display === "none") return false;
        op *= Number(s.opacity);
      }
      return op > 0.9;
    }).length,
  );

/** The stated count (above the grid) and the cards you can see agree, and the count is above 0. */
async function gridMatchesCount(page: Page, label: string, min = 1) {
  const count = page.locator("[data-shop-count]");
  await expect(count, `${label}: count shown`).toBeVisible();
  const n = Number(await count.getAttribute("data-shop-count"));
  expect(n, `${label}: products found`).toBeGreaterThanOrEqual(min);
  // Every card in view must be visible; cards below the fold must appear once scrolled to.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => visibleCards(page), { message: `${label}: ${n} visible cards`, timeout: 6000 }).toBe(n);
  return n;
}

async function runAll(browser: Browser, opts: { admin?: boolean; width: number }) {
  const ctx = await browser.newContext({ viewport: { width: opts.width, height: 900 } });
  await enteredSite(ctx);
  const page = await ctx.newPage();
  if (opts.admin) await adminLogin(page);
  const tag = `${opts.admin ? "admin preview" : "shopper"} @${opts.width}`;

  // Arrive on /shop with a client-side page change (the way people get there), not a fresh load.
  await page.goto("/about");
  // Header link on desktop; on a phone the header menu is closed, so the first visible /shop link (footer).
  await page.locator('a[href="/shop"]:visible').first().click();
  await page.waitForURL(/\/shop$/);
  const all = await gridMatchesCount(page, `${tag} /shop (client nav)`);

  for (const s of SORTS) {
    await page.locator("select").filter({ has: page.locator('option[value="price-asc"]') }).selectOption(s);
    expect(await gridMatchesCount(page, `${tag} sort ${s}`)).toBe(all);
  }

  const search = page.getByRole("searchbox", { name: "Search products" });
  await search.fill("reta");
  await gridMatchesCount(page, `${tag} search "reta"`);
  await search.fill("");
  expect(await gridMatchesCount(page, `${tag} search cleared`)).toBe(all);

  // Fresh loads too: ?sort= and ?q= from a link.
  await page.goto("/shop?sort=price-desc");
  await gridMatchesCount(page, `${tag} /shop?sort=price-desc`);
  await page.goto("/shop?q=reta");
  await gridMatchesCount(page, `${tag} /shop?q=reta`);

  // A collection page (client nav from the collections list).
  await page.goto("/collections");
  const first = page.locator('a[href^="/collections/"]').first();
  await first.click();
  await page.waitForURL(/\/collections\/.+/);
  await gridMatchesCount(page, `${tag} collection`);

  // Home page best sellers / product grids.
  await page.goto("/");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(async () => (await page.locator("[data-product-card]").count()) > 0 && (await visibleCards(page)) > 0, { timeout: 6000 }).toBe(true);
  await ctx.close();
}

test("shop grid shows every product it counts: desktop, all sorts, search, collection", async ({ browser }) => {
  await runAll(browser, { width: 1440 });
});

test("shop grid at 390px phone width", async ({ browser }) => {
  await runAll(browser, { width: 390 });
});

test("closed store: signed-in admin preview shows every product; the public gets nothing", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await enteredSite(ctx);
  const page = await ctx.newPage();
  await adminLogin(page);
  const data = await (await page.request.get("/api/data")).json();
  const store = data.store;
  await page.request.patch("/api/settings", { headers: ORIGIN, data: { store: { ...store, open: false } } });
  try {
    const anon = await browser.newContext();
    expect((await anon.request.get("/api/store/products")).status(), "closed store hides products from the public").toBe(403);
    await anon.close();
    expect((await page.request.get("/api/store/products")).status(), "admin preview gets the products").toBe(200);
    await page.goto("/shop");
    await gridMatchesCount(page, "admin preview /shop (fresh load)");
    await page.locator("select").filter({ has: page.locator('option[value="price-asc"]') }).selectOption("price-asc");
    await gridMatchesCount(page, "admin preview sort");
    await page.getByRole("searchbox", { name: "Search products" }).fill("reta");
    await gridMatchesCount(page, "admin preview search");
  } finally {
    await page.request.patch("/api/settings", { headers: ORIGIN, data: { store: { ...store, open: true } } });
    await ctx.close();
  }
});
