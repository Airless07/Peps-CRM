// The entry gate: first visit only, 30-day cookie, never on admin, email links, policies or for crawlers.
import { expect, test, type Browser, type Page } from "@playwright/test";
import path from "node:path";
import { BASE, SHOTS } from "../playwright.config";
import { adminLogin, ORIGIN } from "./helpers";

test.describe.configure({ mode: "serial" });
const shot = (p: Page, name: string) => p.screenshot({ path: path.join(SHOTS, "launch", `${name}.png`) });
const gateOf = (p: Page) => p.getByRole("dialog", { name: /Are you \d+ or older, and purchasing for laboratory research use only\?/ });

async function fresh(browser: Browser, width = 1440, ua?: string) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}), ...(ua ? { userAgent: ua } : {}) });
  // "No, leave" goes to Google: answer it locally so the test never leaves the machine.
  await ctx.route("https://www.google.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>Google</title>google" }));
  return ctx;
}

test("first visit: the gate is drawn by the server, with the logo, the question, the line and both policy links", async ({ browser }) => {
  for (const width of [1440, 390]) {
    const ctx = await fresh(browser, width);
    // Server-rendered: in the HTML itself, so there is no flash of the store first.
    const html = await (await ctx.request.get("/shop")).text();
    expect(html).toContain("data-entry-gate");
    const page = await ctx.newPage();
    await page.goto("/shop");
    const gate = gateOf(page);
    await expect(gate).toBeVisible();
    await expect(gate).toContainText("Buckshot Labs".toUpperCase(), { ignoreCase: true });
    await expect(gate).toContainText("All products are sold for laboratory research use only. Not for human consumption.");
    await expect(gate.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    await expect(gate.getByRole("link", { name: "Research Use Policy" })).toHaveAttribute("href", "/research-use");
    await expect(gate.getByRole("button", { name: "Yes, enter" })).toBeFocused();
    await shot(page, `gate-${width}`);

    // Escape and a click outside do nothing; Tab stays inside the gate.
    await page.keyboard.press("Escape");
    await page.mouse.click(5, 5);
    await expect(gate).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("[data-entry-gate]"))).toBe(true);
    }
    await ctx.close();
  }
});

test("Yes, enter: remembered for 30 days with a cookie; an expired cookie shows it again", async ({ browser }) => {
  const ctx = await fresh(browser);
  const page = await ctx.newPage();
  await page.goto("/");
  await gateOf(page).getByRole("button", { name: "Yes, enter" }).press("Enter");
  await expect(gateOf(page)).toBeHidden();
  const c = (await ctx.cookies()).find((x) => x.name === "bl_entry")!;
  expect(c, "bl_entry cookie set").toBeTruthy();
  const days = (c.expires * 1000 - Date.now()) / 86400000;
  expect(days).toBeGreaterThan(29.9);
  expect(days).toBeLessThan(30.1);
  await page.goto("/shop");
  await page.reload();
  await expect(page.locator("[data-entry-gate]")).toHaveCount(0);
  expect(await (await ctx.request.get("/shop")).text()).not.toContain("data-entry-gate");

  // Cookie cleared or run out: asked again.
  await ctx.clearCookies();
  await ctx.addCookies([{ name: "bl_entry", value: String(Date.now() - 1000), url: BASE }]);
  await page.goto("/");
  await expect(gateOf(page)).toBeVisible();
  await ctx.close();
});

test("No, leave: sends the visitor to google.com", async ({ browser }) => {
  const ctx = await fresh(browser, 390);
  const page = await ctx.newPage();
  await page.goto("/");
  await gateOf(page).getByRole("button", { name: "No, leave" }).click();
  await page.waitForURL(/^https:\/\/www\.google\.com\//);
  await ctx.close();
});

test("never on admin, email links, policy pages, or for search engine crawlers", async ({ browser }) => {
  const ctx = await fresh(browser);
  const page = await ctx.newPage();
  for (const p of ["/admin/login", "/order/some-email-token-abcdefghijkl", "/order-lookup", "/account/reset?token=abc", "/account/invite?token=abc", "/review/some-token-abcdefghijkl", "/terms", "/research-use", "/privacy", "/shipping", "/refunds"]) {
    await page.goto(p);
    await expect(page.locator("[data-entry-gate]"), `no gate on ${p}`).toHaveCount(0);
  }
  await ctx.close();
  const bot = await fresh(browser, 1440, "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)");
  expect(await (await bot.request.get("/")).text(), "crawler sees the page, no gate").not.toContain("data-entry-gate");
  await bot.close();
});

test("admin setting: minimum age shows in the question; gate off means no gate", async ({ browser }) => {
  const actx = await browser.newContext();
  const admin = await actx.newPage();
  await adminLogin(admin);
  const store = (await (await admin.request.get("/api/data")).json()).store;
  const save = async (s: object) => {
    const r = await admin.request.patch("/api/settings", { headers: ORIGIN, data: { store: s } });
    expect(r.status(), `save settings: ${await r.text()}`).toBe(200);
  };
  /** The store reads settings through a short cache: reload until the change shows. */
  const until = async (page: Page, check: () => Promise<boolean>) => {
    await expect.poll(async () => (await page.reload(), await check()), { timeout: 10000, intervals: [500] }).toBe(true);
  };
  try {
    await save({ ...store, entryGate: { enabled: true, minAge: 18 } });
    let ctx = await fresh(browser);
    let page = await ctx.newPage();
    await page.goto("/");
    await until(page, () => page.getByRole("dialog", { name: /Are you 18 or older/ }).isVisible());
    await ctx.close();

    await save({ ...store, entryGate: { enabled: false, minAge: 21 } });
    ctx = await fresh(browser);
    page = await ctx.newPage();
    await page.goto("/");
    await until(page, async () => (await page.locator("[data-entry-gate]").count()) === 0);
    await ctx.close();

    await admin.goto("/admin/settings?tab=store");
    await expect(admin.locator("[data-compliance-settings]")).toBeVisible();
    await admin.locator("[data-compliance-settings]").scrollIntoViewIfNeeded();
    await admin.screenshot({ path: path.join(SHOTS, "launch", "settings-gate.png") });
  } finally {
    await save({ ...store, entryGate: { enabled: true, minAge: 21 } });
    await actx.close();
  }
});
