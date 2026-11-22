// Screenshots of every store page and every admin page at 390px (phone) and 1440px (desktop),
// with a layout audit on each one: sideways overflow, cut-off text, and tap targets under 44px.
// Screenshots land in e2e/screenshots/{390,1440}/ and the audit in e2e/screenshots/layout-report.json.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { SHOTS } from "../playwright.config";
import { adminLogin } from "./helpers";

const DB = path.join(__dirname, ".tmp", "e2e.db");
const WIDTHS = [
  { name: "390", viewport: { width: 390, height: 844 }, mobile: true },
  { name: "1440", viewport: { width: 1440, height: 900 }, mobile: false },
] as const;

interface Finding {
  page: string;
  width: string;
  overflowPx: number;
  clipped: string[];
  smallTargets: string[];
}
const report: Finding[] = [];

/** Runs inside the page: measures what a person would trip over. */
function audit(mobile: boolean) {
  const vis = (el: Element) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || s.visibility === "hidden" || s.display === "none" || Number(s.opacity) === 0) return false;
    // Skip things parked off screen or inside a closed/hidden ancestor.
    for (let p: Element | null = el; p; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.display === "none" || ps.visibility === "hidden" || p.getAttribute("aria-hidden") === "true") return false;
      if (p.classList.contains("sr-only")) return false;
    }
    return true;
  };
  const label = (el: Element) => {
    const t = (el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.getAttribute("placeholder") || el.getAttribute("name") || el.tagName).replace(/\s+/g, " ").trim().slice(0, 40);
    const r = el.getBoundingClientRect();
    return `${el.tagName.toLowerCase()} "${t}" ${Math.round(r.width)}x${Math.round(r.height)}`;
  };

  const doc = document.documentElement;
  const overflowPx = Math.max(0, doc.scrollWidth - window.innerWidth);

  // Text that is cut off with no ellipsis and no way to scroll to it.
  const clipped: string[] = [];
  for (const el of document.querySelectorAll("h1,h2,h3,h4,p,span,a,button,label,dt,dd,th,td,li,div")) {
    if (!vis(el) || el.children.length > 0) continue;
    const text = (el as HTMLElement).innerText?.trim();
    if (!text) continue;
    const s = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 1 && (s.overflowX === "hidden" || s.overflowX === "clip") && s.textOverflow !== "ellipsis" && s.whiteSpace === "nowrap") clipped.push(label(el));
  }

  // Tap targets (phone only): anything you tap must be at least 44px tall and wide.
  const smallTargets: string[] = [];
  if (mobile) {
    const seen = new Set<Element>();
    for (const el of document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="radio"], [role="tab"], [role="option"]')) {
      if (!vis(el) || (el as HTMLButtonElement).disabled) continue;
      let target: Element = el;
      // A checkbox, radio or file input is tapped through its label.
      const input = el as HTMLInputElement;
      if (el.tagName === "INPUT" && ["checkbox", "radio", "file"].includes(input.type)) {
        const lab = el.closest("label") ?? (input.id ? document.querySelector(`label[for="${input.id}"]`) : null);
        if (!lab) continue;
        target = lab;
      }
      if (seen.has(target)) continue;
      seen.add(target);
      const s = getComputedStyle(target);
      // A link inside a sentence is text, not a button (WCAG 2.5.8 inline exception).
      if (target.tagName === "A" && s.display === "inline" && target.parentElement && (target.parentElement as HTMLElement).innerText.trim().length > (target as HTMLElement).innerText.trim().length + 8) continue;
      const r = target.getBoundingClientRect();
      // The touch area can be larger than the visible box: a stretched link (::after covering its card)
      // or the ".tap" helper. Count the larger of the two.
      let width = r.width;
      let height = r.height;
      const after = getComputedStyle(target, "::after");
      if (after.content !== "none" && after.position === "absolute") {
        width = Math.max(width, parseFloat(after.width) || 0);
        height = Math.max(height, parseFloat(after.height) || 0);
      }
      if (height < 43.5 || width < 43.5) smallTargets.push(label(target));
    }
  }
  return { overflowPx, clipped: [...new Set(clipped)], smallTargets: [...new Set(smallTargets)] };
}

async function settle(page: Page): Promise<number> {
  await page.waitForLoadState("networkidle").catch(() => {});
  // Sideways overflow is measured on the page exactly as a visitor gets it, before anything below is injected.
  const overflowPx = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  // Reveal-on-scroll content: show it all so full-page screenshots are complete.
  await page.addStyleTag({ content: "[data-reveal]{opacity:1!important;transform:none!important} *:not(.marquee-track){animation-duration:0s!important;transition-duration:0s!important}" }).catch(() => {});
  await page.waitForTimeout(350);
  return overflowPx;
}

async function shoot(page: Page, name: string, w: (typeof WIDTHS)[number]) {
  const overflowPx = await settle(page);
  const dir = path.join(SHOTS, w.name);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
  const a = await page.evaluate(audit, w.mobile);
  report.push({ page: name, width: w.name, ...a, overflowPx });
}

function seedData() {
  const db = new DatabaseSync(DB, { readOnly: true });
  const delivered = db.prepare(`select id, token, "reviewToken" from "Order" where source = 'online' and status = 'delivered' limit 1`).get() as { id: string; token: string; reviewToken: string } | undefined;
  const any = db.prepare(`select id, token from "Order" where source = 'online' order by "createdAt" desc limit 1`).get() as { id: string; token: string };
  const awaiting = db.prepare(`select id, token from "Order" where source = 'online' and status = 'awaiting_payment' limit 1`).get() as { id: string; token: string } | undefined;
  const listing = db.prepare(`select slug from "Listing" where "showOnWebsite" = 1 and name = 'Retatrutide'`).get() as { slug: string };
  const plain = db.prepare(`select slug from "Listing" where "showOnWebsite" = 1 and "casNumber" = '' and formula = '' and "molecularWeight" = '' and purity = '' and form = '' and storage = '' limit 1`).get() as { slug: string };
  const withCas = db.prepare(`select slug from "Listing" where "showOnWebsite" = 1 and "casNumber" != '' limit 1`).get() as { slug: string } | undefined;
  const group = db.prepare(`select slug from "ProductGroup" limit 1`).get() as { slug: string };
  const variant = db.prepare(`select p.id from "Product" p join "Listing" l on l.id = p."listingId" where l.name = 'Retatrutide' limit 1`).get() as { id: string };
  db.close();
  return { delivered, any, awaiting, listing, plain, withCas, group, variant };
}

const agePassed = `localStorage.setItem("bp-age", String(Date.now() + 86400000 * 30));`;

async function storeContext(browser: Browser, w: (typeof WIDTHS)[number], cart: string | null): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: w.viewport, deviceScaleFactor: 1, isMobile: w.mobile, hasTouch: w.mobile });
  await ctx.addInitScript(`${agePassed}${cart ? `localStorage.setItem("bp-cart", ${JSON.stringify(cart)});` : ""}`);
  return ctx;
}

for (const w of WIDTHS) {
  test.describe(`${w.name}px`, () => {
    test(`store pages at ${w.name}px`, async ({ browser }) => {
      test.setTimeout(300_000);
      const d = seedData();
      const cart = JSON.stringify({ items: [{ variantId: d.variant.id, quantity: 2 }], code: "WELCOME10" });

      // The age gate itself, as a first-time visitor sees it.
      const first = await browser.newContext({ viewport: w.viewport, isMobile: w.mobile, hasTouch: w.mobile });
      const gate = await first.newPage();
      await gate.goto("/");
      await expect(gate.getByRole("dialog", { name: "Please confirm before you enter" })).toBeVisible();
      await shoot(gate, "store-00-age-gate", w);
      await first.close();

      const ctx = await storeContext(browser, w, null);
      const page = await ctx.newPage();
      const pages: [string, string][] = [
        ["store-01-home", "/"],
        ["store-02-shop", "/shop"],
        ["store-03-collections", "/collections"],
        ["store-04-collection", `/collections/${d.group.slug}`],
        ["store-05-product-two-sizes", `/product/${d.listing.slug}`],
        ["store-06-product-no-compound-info", `/product/${d.plain.slug}`],
        ...(d.withCas ? ([["store-07-product-with-compound-info", `/product/${d.withCas.slug}`]] as [string, string][]) : []),
        ["store-08-testing", "/testing"],
        ["store-09-about", "/about"],
        ["store-10-faq", "/faq"],
        ["store-11-contact", "/contact"],
        ["store-12-cart-empty", "/cart"],
        ["store-13-account-sign-in", "/account"],
        ["store-14-account-reset", "/account/reset"],
        ["store-15-order-lookup", "/order-lookup"],
        ["store-16-order-status", `/order/${(d.delivered ?? d.any).token}`],
        ...(d.awaiting ? ([["store-17-order-awaiting-payment", `/order/${d.awaiting.token}`]] as [string, string][]) : []),
        ...(d.delivered?.reviewToken ? ([["store-18-review", `/review/${d.delivered.reviewToken}`]] as [string, string][]) : []),
        ["store-19-policy-terms", "/terms"],
        ["store-20-policy-privacy", "/privacy"],
        ["store-21-policy-shipping", "/shipping"],
        ["store-22-policy-refunds", "/refunds"],
        ["store-23-policy-research-use", "/research-use"],
        ["store-24-exit", "/exit"],
        ["store-25-not-found", "/this-page-does-not-exist"],
      ];
      for (const [name, url] of pages) {
        await page.goto(url);
        await shoot(page, name, w);
      }
      // Product page details: compound info is a table when filled in and absent when empty.
      await page.goto(`/product/${d.plain.slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Compound information" })).toHaveCount(0);
      if (d.withCas) {
        await page.goto(`/product/${d.withCas.slug}`);
        const specs = page.locator("section", { has: page.getByRole("heading", { name: "Compound information" }) });
        await expect(specs.locator("table tr")).not.toHaveCount(0);
        await expect(specs.locator("table")).toContainText("CAS number");
        // Only filled fields are listed: no empty value cells.
        for (const cell of await specs.locator("td").allInnerTexts()) expect(cell.trim()).not.toBe("");
      }
      await ctx.close();

      // With something in the cart: cart page, drawer, checkout.
      const withCart = await storeContext(browser, w, cart);
      const cp = await withCart.newPage();
      await cp.goto("/cart");
      await expect(cp.locator("[data-cart-total]")).toBeVisible();
      await shoot(cp, "store-26-cart", w);
      await cp.goto("/shop");
      await cp.getByRole("button", { name: /^Cart,/ }).click();
      await expect(cp.getByRole("dialog", { name: "Your cart" })).toBeVisible();
      await expect(cp.getByRole("dialog", { name: "Your cart" }).locator("[data-cart-total]")).toBeVisible();
      await shoot(cp, "store-27-cart-drawer", w);
      await cp.goto("/checkout");
      await shoot(cp, "store-28-checkout-sign-in", w);
      await withCart.close();
    });

    test(`admin pages at ${w.name}px`, async ({ browser }) => {
      test.setTimeout(300_000);
      const d = seedData();
      const ctx = await browser.newContext({ viewport: w.viewport, deviceScaleFactor: 1, isMobile: w.mobile, hasTouch: w.mobile });
      const login = await ctx.newPage();
      await login.goto("/admin/login");
      await shoot(login, "admin-00-login", w);
      await adminLogin(login);
      const page = login;
      const pages: [string, string][] = [
        ["admin-01-dashboard", "/admin"],
        ["admin-02-orders", "/admin/orders"],
        ["admin-03-order-detail", `/admin/orders/${(d.delivered ?? d.any).id}`],
        ["admin-04-ship-queue", "/admin/ship"],
        ["admin-05-sell", "/admin/sell"],
        ["admin-06-in-person", "/admin/in-person"],
        ["admin-07-inventory", "/admin/inventory"],
        ["admin-08-customers", "/admin/customers"],
        ["admin-09-money", "/admin/money"],
        ["admin-10-pay", "/admin/pay"],
        ["admin-11-promotions", "/admin/promotions"],
        ["admin-12-reviews", "/admin/reviews"],
        ["admin-13-content-home", "/admin/content?tab=home"],
        ["admin-14-content-pages", "/admin/content?tab=pages"],
        ["admin-15-content-policies", "/admin/content?tab=policies"],
        ["admin-16-content-seo", "/admin/content?tab=seo"],
        ["admin-17-content-messages", "/admin/content?tab=messages"],
        ["admin-18-analytics", "/admin/analytics"],
        ["admin-19-settings-launch", "/admin/settings?tab=launch"],
        ["admin-20-settings-store", "/admin/settings?tab=store"],
        ["admin-21-settings-payments", "/admin/settings?tab=payments"],
        ["admin-22-settings-shipping", "/admin/settings?tab=shipping"],
        ["admin-23-settings-email", "/admin/settings?tab=email"],
        ["admin-24-settings-backups", "/admin/settings?tab=backups"],
        ["admin-25-settings-business", "/admin/settings?tab=business"],
        ["admin-26-help", "/admin/help"],
        ["admin-27-packing-slip", `/admin/print/${(d.delivered ?? d.any).id}`],
        ["admin-28-not-found", "/admin/nothing-here"],
      ];
      for (const [name, url] of pages) {
        await page.goto(url);
        await expect(page.locator(".animate-shimmer")).toHaveCount(0, { timeout: 20_000 }).catch(() => {});
        await shoot(page, name, w);
      }

      // Inventory: the website filter and the completeness indicator.
      await page.goto("/admin/inventory");
      await expect(page.getByText(/Website info \d\/6/).first()).toBeVisible();
      await page.getByRole("radio", { name: /^Not on website/ }).click();
      await expect(page.getByText("Not on website", { exact: true }).first()).toBeVisible();
      await expect(page.locator("main").getByText("On website", { exact: true })).toHaveCount(0);
      await shoot(page, "admin-29-inventory-not-on-website", w);
      await page.getByRole("radio", { name: /^On website/ }).click();
      await expect(page.locator("main").getByText("Not on website", { exact: true })).toHaveCount(0);
      // Product editor: size-in-name warning and the Website tab with Recommended fields.
      await page.getByRole("radio", { name: /^All/ }).click();
      const card = page.locator("div.rounded-2xl", { hasText: "GHK-Cu 100mg" }).first();
      await expect(card.getByText("Size in name")).toBeVisible();
      // At 390px the sticky header can sit over the button after scrolling: center it first.
      await card.getByRole("button", { name: "Edit" }).evaluate((el) => el.scrollIntoView({ block: "center" }));
      await card.getByRole("button", { name: "Edit" }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByRole("alert")).toContainText("The name includes a size (“100mg”)");
      await shoot(page, "admin-30-product-editor-size-warning", w);
      await sheet.getByRole("radio", { name: "Website" }).click();
      await expect(sheet.getByText("Recommended").first()).toBeVisible();
      await expect(sheet.getByText(/Website info \d\/6/)).toBeVisible();
      await sheet.getByText("Compound info", { exact: true }).scrollIntoViewIfNeeded();
      await shoot(page, "admin-31-product-editor-website-tab", w);
      await page.keyboard.press("Escape");

      // Dashboard to-do and launch checklist items of this pass.
      await page.goto("/admin/settings?tab=launch");
      await expect(page.getByText("Products with no website info")).toBeVisible();
      await page.goto("/admin");
      await expect(page.getByText(/website products? (is|are) missing compound info/)).toBeVisible();
      await ctx.close();
    });
  });
}

test.afterAll(() => {
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(path.join(SHOTS, "layout-report.json"), JSON.stringify(report, null, 2));
  const bad = report.filter((r) => r.overflowPx > 0 || r.clipped.length || r.smallTargets.length);
  const lines = bad.flatMap((r) => [
    `${r.width}px ${r.page}`,
    ...(r.overflowPx ? [`   sideways overflow: ${r.overflowPx}px`] : []),
    ...r.clipped.map((c) => `   cut off: ${c}`),
    ...r.smallTargets.map((c) => `   tap target under 44px: ${c}`),
  ]);
  writeFileSync(path.join(SHOTS, "layout-report.txt"), `${report.length} page screenshots audited. ${bad.length} with findings.\n\n${lines.join("\n")}\n`);
});

test("layout audit: no sideways overflow, no cut-off text, no tap target under 44px", async () => {
  expect(report.length, "pages audited").toBeGreaterThanOrEqual(110);
  const problems = report.filter((r) => r.overflowPx > 0 || r.clipped.length || r.smallTargets.length).map((r) => `${r.width}px ${r.page}: ${[r.overflowPx ? `overflow ${r.overflowPx}px` : "", ...r.clipped.map((c) => `cut off ${c}`), ...r.smallTargets.map((c) => `small ${c}`)].filter(Boolean).join("; ")}`);
  expect(problems).toEqual([]);
});
