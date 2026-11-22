/**
 * Walkthrough proof for per-account carts, the referral "use it again" prompt, quick add and bulk shipping.
 * Runs on the e2e copy of the database with Shippo and Resend faked (no real label, no charge, no email).
 * Screenshots: e2e/screenshots/accounts/.   npx playwright test --project=accounts --no-deps
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import type { PublicProduct } from "../src/lib/store/catalog";
import { BASE, SHOTS } from "../playwright.config";
import { adminLogin, adminState, emails, ORIGIN, shippoCalls } from "./helpers";

test.describe.configure({ mode: "serial" });

const out = path.join(SHOTS, "accounts");
mkdirSync(out, { recursive: true });
const shot = (page: Page, name: string, full = false) => page.screenshot({ path: path.join(out, `${name}.png`), fullPage: full });
const DB = path.join(__dirname, ".tmp", "e2e.db");
const stamp = Date.now();
const A = { name: "Ann Owner", email: `ann-${stamp}@example.com`, password: "ann-password-123" };
const B = { name: "Ben Buyer", email: `ben-${stamp}@example.com`, password: "ben-password-123" };
const C = { name: "Cora Referrer", email: `cora-${stamp}@example.com`, password: "cora-password-123" };
let cCode = "";

let ctx: BrowserContext;
let shop: Page;
let catalog: PublicProduct[] = [];
let single: PublicProduct;
let reta: PublicProduct;

/** The age gate was answered on this device earlier (it is tested in pages.spec.ts). */
const ageOk = () => localStorage.setItem("bp-age", String(Date.now() + 30 * 86400000));
const passAgeGate = async (page: Page) => {
  const gate = page.getByRole("dialog", { name: "Please confirm before you enter" });
  if (!(await gate.isVisible({ timeout: 3000 }).catch(() => false))) return;
  for (const box of await gate.locator('input[type="checkbox"]').all()) await box.check();
  await gate.getByRole("button", { name: "Enter site" }).click();
  await expect(gate).toBeHidden();
};
async function signIn(page: Page, who: { email: string; password: string; name: string }) {
  await page.goto("/account");
  await passAgeGate(page);
  await page.locator("#au-email").fill(who.email);
  await page.locator("#au-pass").fill(who.password);
  await page.locator("form", { has: page.locator("#au-email") }).locator('button[type="submit"]').click();
  await expect(page.getByRole("heading", { name: `Hello, ${who.name.split(" ")[0]}` })).toBeVisible();
}
async function signOut(page: Page) {
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("#au-email")).toBeVisible();
}
const serverCart = async () => (await (await ctx.request.get("/api/store/cart")).json()) as { accountId: string | null; items: { variantId: string; quantity: number }[]; code: string };
const localCart = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("bp-cart")).map((k) => `${k}=${localStorage.getItem(k)}`));
async function openDrawer(page: Page) {
  await page.getByRole("button", { name: /^Cart, / }).first().click();
  return page.getByRole("dialog", { name: "Your cart" });
}

test.beforeAll(async ({ browser, playwright }) => {
  // Accounts are made with a separate client so the test browser starts signed out.
  const api = await playwright.request.newContext({ baseURL: BASE });
  for (const who of [A, B, C]) {
    const r = await api.post("/api/store/account", { headers: ORIGIN, data: { action: "signup", ...who } });
    expect(r.status(), `sign up ${who.email}`).toBe(200);
    await api.post("/api/store/account", { headers: ORIGIN, data: { action: "signout" } });
  }
  await api.dispose();
  catalog = ((await (await (await playwright.request.newContext({ baseURL: BASE })).get("/api/store/products")).json()) as { products: PublicProduct[] }).products;
  single = catalog.find((p) => p.variants.length === 1 && p.stock !== "out")!;
  reta = catalog.find((p) => p.name === "Retatrutide")!;
  expect(single, "a single-size product").toBeTruthy();
  expect(reta?.variants.map((v) => v.label)).toEqual(["10mg", "20mg"]);
  // Ben used Cora's referral code on an earlier order.
  const db = new DatabaseSync(DB);
  cCode = (db.prepare(`select coalesce("referralCodeDisplay", "referralCode") c from "Customer" where email = ?`).get(C.email) as { c: string }).c;
  const ben = db.prepare(`select id from "Customer" where email = ?`).get(B.email) as { id: string };
  const now = Date.now() - 86400000 * 3;
  db.prepare(`insert into "Order" (id, date, number, source, status, "soldBy", customer, "customerId", email, "referralCode", "createdAt", "placedAt", "deliveredAt", token) values (?, ?, ?, 'online', 'delivered', 'W', ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    `e2e-past-${stamp}`, now, 90000 + (stamp % 9000), B.name, ben.id, B.email, cCode, now, now, now, `e2e-past-token-${stamp}-abcdefghijkl`,
  );
  db.close();
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(ageOk);
  shop = await ctx.newPage();
});
test.afterAll(async () => {
  await ctx?.close();
});

test("1. A adds items and a code; sign out empties the cart; B sees only B's cart; A gets A's cart back", async () => {
  await signIn(shop, A);
  await shop.goto(`/product/${single.slug}`);
  await shop.getByRole("button", { name: /^Add to cart ·/ }).click();
  const drawer = shop.getByRole("dialog", { name: "Your cart" });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Add a discount or referral code" }).click();
  await drawer.getByLabel("Discount or referral code").fill("welcome10");
  await drawer.getByRole("button", { name: "Apply" }).click();
  await expect(drawer.locator("[data-applied-discount]")).toHaveText(/WELCOME10/);
  await expect.poll(async () => (await serverCart()).items.length).toBe(1);
  await expect.poll(async () => (await serverCart()).code).toBe("WELCOME10");
  expect(await localCart(shop), "a signed-in cart is never kept in the browser").toEqual([]);
  await shot(shop, "01-A-cart-and-code");

  await signOut(shop);
  const empty = await openDrawer(shop);
  await expect(empty.getByText("Your cart is empty")).toBeVisible();
  expect(await localCart(shop)).toEqual([]);
  await shot(shop, "02-after-sign-out-empty");
  await empty.getByRole("button", { name: "Close cart" }).click();

  await signIn(shop, B);
  const bDrawer = await openDrawer(shop);
  await expect(bDrawer.getByText("Your cart is empty")).toBeVisible();
  await expect(bDrawer.locator("[data-applied-discount]")).toHaveCount(0);
  expect((await serverCart()).items).toEqual([]);
  await shot(shop, "03-B-own-empty-cart");
  await bDrawer.getByRole("button", { name: "Close cart" }).click();

  await signOut(shop);
  await signIn(shop, A);
  const back = await openDrawer(shop);
  await expect(back.locator("li")).toHaveCount(1);
  await expect(back.getByText(single.name).first()).toBeVisible();
  await shot(shop, "04-A-cart-back");
  await back.getByRole("button", { name: "Close cart" }).click();
});

test("2. a guest cart merges into the account at sign in, and codes are not carried over", async () => {
  await signOut(shop);
  await shop.goto(`/product/${reta.slug}`);
  await shop.getByRole("radio", { name: /^10mg/ }).click();
  await shop.getByRole("button", { name: /^Add to cart ·/ }).click();
  const drawer = shop.getByRole("dialog", { name: "Your cart" });
  await drawer.getByRole("button", { name: "Add a discount or referral code" }).click();
  await drawer.getByLabel("Discount or referral code").fill("welcome10");
  await drawer.getByRole("button", { name: "Apply" }).click();
  await expect(drawer.locator("[data-applied-discount]")).toBeVisible();
  expect((await localCart(shop)).join()).toContain("bp-cart:guest");
  await drawer.getByRole("button", { name: "Close cart" }).click();
  await signIn(shop, A);
  await expect.poll(async () => (await serverCart()).items.map((i) => i.variantId).sort()).toEqual([single.variants[0].id, reta.variants[0].id].sort());
  expect((await serverCart()).code).toBe("");
  expect(await localCart(shop), "guest cart removed after the merge").toEqual([]);
  const merged = await openDrawer(shop);
  await expect(merged.locator("li")).toHaveCount(2);
  await expect(merged.locator("[data-applied-discount]")).toHaveCount(0);
  await shot(shop, "05-guest-cart-merged-codes-dropped");
  await merged.getByRole("button", { name: "Close cart" }).click();
});

test("3. another tab signing in as B switches this tab's cart right away", async () => {
  const other = await ctx.newPage();
  // Same browser, second tab: sign out of A and in as B. This tab is never reloaded.
  await signOut(other);
  await signIn(other, B);
  // Tab 1 is told by the other tab (BroadcastChannel): A's cart disappears without a reload.
  const drawer = await openDrawer(shop);
  await expect(drawer.getByText("Your cart is empty")).toBeVisible({ timeout: 5000 });
  await shot(shop, "06-other-tab-switch");
  await drawer.getByRole("button", { name: "Close cart" }).click();
  await other.close();
});

test("4. referral prompt: shown for a code used before; No hides it; Yes applies it; deleting stays deleted", async () => {
  // Signed in as B (tab 3). Add something and go to checkout.
  await shop.goto(`/product/${single.slug}`);
  await shop.getByRole("button", { name: /^Add to cart ·/ }).click();
  await shop.goto("/checkout");
  const prompt = shop.locator("[data-last-referral]");
  await expect(prompt).toContainText(`You used code ${cCode} last time. Use it again?`);
  // Nothing was typed into the box for the customer.
  await expect(shop.locator("[data-applied-referral]")).toHaveCount(0);
  await shot(shop, "07-referral-prompt", true);

  await prompt.getByRole("button", { name: "No" }).click();
  await expect(prompt).toHaveCount(0);
  await shop.getByRole("button", { name: "Add a discount or referral code" }).click();
  const box = shop.locator("#promo-code");
  await expect(box).toHaveValue("");
  await box.fill("SOMETHING");
  await box.fill("");
  await shop.waitForTimeout(1200);
  await expect(box).toHaveValue("");
  await expect(prompt).toHaveCount(0);
  await shot(shop, "08-referral-no-hides", true);

  await shop.reload(); // a new checkout: the offer comes back once
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Yes" }).click();
  await expect(shop.locator("[data-applied-referral]")).toContainText(cCode);
  await expect(prompt).toHaveCount(0);
  await shot(shop, "09-referral-yes-applies", true);

  await shop.locator("[data-applied-referral]").getByRole("button", { name: "Remove" }).click();
  await expect(shop.locator("[data-applied-referral]")).toHaveCount(0);
  await shop.getByRole("button", { name: "Add a discount or referral code" }).click();
  await expect(shop.locator("#promo-code")).toHaveValue("");
  await shop.waitForTimeout(1500);
  await expect(shop.locator("#promo-code"), "deleted stays deleted").toHaveValue("");
  await expect(shop.locator("[data-applied-referral]")).toHaveCount(0);
  await expect(prompt, "not offered again after removing it").toHaveCount(0);
  await shot(shop, "10-referral-removed-stays-removed", true);

  // Typing the code and deleting it letter by letter: nothing types it back.
  await box.pressSequentially(cCode);
  for (let i = 0; i < cCode.length; i++) await box.press("Backspace");
  await shop.waitForTimeout(800);
  await expect(box).toHaveValue("");
});

test("5. quick add on desktop: single size and Retatrutide 10mg / 20mg", async () => {
  await shop.goto("/shop");
  const card = shop.locator(`[data-quick-add="${single.slug}"]`).locator("..");
  await card.hover();
  const bar = shop.locator(`[data-quick-add="${single.slug}"] .qa-bar`);
  await expect(bar).toBeVisible();
  await expect(bar.locator("[data-quick-size]")).toHaveCount(0);
  await card.scrollIntoViewIfNeeded();
  await shop.waitForTimeout(500);
  await shot(shop, "11-quick-add-single-size");

  const rcard = shop.locator(`[data-quick-add="${reta.slug}"]`).locator("..");
  await rcard.scrollIntoViewIfNeeded();
  await rcard.hover();
  const rbar = shop.locator(`[data-quick-add="${reta.slug}"] .qa-bar`);
  await expect(rbar.locator("[data-quick-size]")).toHaveText(["10mg", "20mg"]);
  await rbar.locator('[data-quick-size="20mg"]').click();
  await rbar.getByRole("button", { name: "Increase quantity" }).click();
  await expect(rbar.locator("[data-quick-qty]")).toHaveText("2");
  await shop.waitForTimeout(500);
  await shot(shop, "12-quick-add-retatrutide");
  const before = (await serverCart()).items.find((i) => i.variantId === reta.variants[1].id)?.quantity ?? 0;
  await rbar.locator("[data-quick-add-button]").click();
  await expect(shop.getByRole("dialog", { name: "Your cart" })).toBeVisible();
  await expect.poll(async () => (await serverCart()).items.find((i) => i.variantId === reta.variants[1].id)?.quantity).toBe(before + 2);
  await shot(shop, "13-quick-add-added-drawer");
  await shop.getByRole("button", { name: "Close cart" }).click();
  // Clicking the photo outside the bar still opens the product page.
  await rcard.hover();
  await shop.locator(`[data-product-card="${reta.slug}"]`).click({ position: { x: 40, y: 40 } });
  await shop.waitForURL(new RegExp(`/product/${reta.slug}$`));
});

test("6. no quick add on a 390px phone", async ({ browser }) => {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await phone.addInitScript(ageOk);
  const p = await phone.newPage();
  await p.goto("/shop");
  await passAgeGate(p);
  await expect(p.locator("[data-quick-add]").first()).toBeAttached();
  for (const el of await p.locator("[data-quick-add]").all()) await expect(el).toBeHidden();
  await shot(p, "14-phone-390-no-quick-add");
  // A tap on the card still opens the product.
  await p.locator(`[data-product-card="${single.slug}"]`).tap();
  await p.waitForURL(new RegExp(`/product/${single.slug}$`));
  await phone.close();
});

test("7. bulk shipping (Shippo TEST mode): buy 3 labels, combined label and slip PDFs, mark shipped", async ({ browser }) => {
  // Three paid orders from Ben.
  const shipTo = { name: "Ben Buyer", street1: "500 Oak Avenue", street2: "", city: "Denver", state: "CO", zip: "80202", country: "US" };
  const numbers: number[] = [];
  for (let i = 0; i < 3; i++) {
    const items = [{ variantId: single.variants[0].id, quantity: 1 + i }];
    const q = await (await ctx.request.post("/api/store/quote", { headers: ORIGIN, data: { items, code: "", referralCode: "", shipTo } })).json();
    const std = q.shipping.find((s: { tier: string }) => s.tier === "standard");
    const r = await ctx.request.post("/api/store/checkout", {
      headers: ORIGIN,
      data: { accountId: q.accountId, phone: "", shipTo, items, code: "", tier: "standard", payChoice: "zelle", expectedTotalCents: q.subtotalCents - q.discountCents + std.cents, ackResearch: true, ackPolicies: true },
    });
    expect(r.status(), await r.text()).toBe(200);
    numbers.push((await r.json()).number);
  }
  const admin = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await admin.addInitScript(ageOk);
  const adm = await admin.newPage();
  await adminLogin(adm);
  let st = await adminState(admin.request);
  const ids = numbers.map((n) => st.all.find((o) => o.number === n)!.id);
  for (const id of ids) expect((await admin.request.post(`/api/orders/${id}/action`, { headers: ORIGIN, data: { action: "mark-paid", paymentMethod: "Zelle", notify: false } })).status()).toBe(200);
  const before = await adminState(admin.request);
  const txBefore = shippoCalls().filter((c) => c.path === "/transactions/").length;

  await adm.goto("/admin/ship");
  for (const n of numbers) await adm.locator(`[data-ship-row="${n}"] input[type="checkbox"]`).check();
  await expect(adm.locator("[data-bulk-bar]")).toContainText("3 orders selected");
  await shot(adm, "15-bulk-selected");
  await adm.locator('[data-bulk="buy"]').click();
  const confirm = adm.locator("[data-bulk-confirm]");
  await expect(confirm).toContainText("Buy 3 labels");
  await shot(adm, "16-bulk-confirm");
  await adm.locator("[data-bulk-confirm-buy]").click();
  const results = adm.locator("[data-bulk-results]");
  await expect(results).toContainText("Done: 3 worked, 0 didn’t.", { timeout: 30_000 });
  await shot(adm, "17-bulk-results");
  expect(shippoCalls().filter((c) => c.path === "/transactions/").length - txBefore).toBe(3);
  st = await adminState(admin.request);
  const labelCost = st.data.labels.filter((l) => ids.includes(l.orderId ?? "")).reduce((s, l) => s + l.costCents, 0);
  expect(st.data.labels.filter((l) => ids.includes(l.orderId ?? ""))).toHaveLength(3);
  expect(before.money.business - st.money.business).toBe(labelCost);
  expect(st.money.labels - before.money.labels).toBe(labelCost);
  await results.getByRole("button", { name: /^Close/ }).click();

  // Combined PDFs.
  const labels = await admin.request.get(`/api/ship/labels?ids=${ids.join(",")}`);
  expect(labels.status()).toBe(200);
  const lb = await labels.body();
  writeFileSync(path.join(out, "18-combined-labels.pdf"), lb);
  const lpdf = await PDFDocument.load(lb);
  expect(lpdf.getPageCount()).toBe(3);
  expect(lpdf.getPage(0).getSize()).toEqual({ width: 288, height: 432 });
  const slips = await admin.request.get(`/api/ship/slips?ids=${ids.join(",")}`);
  const sb = await slips.body();
  writeFileSync(path.join(out, "19-packing-slips.pdf"), sb);
  expect((await PDFDocument.load(sb)).getPageCount()).toBe(3);
  // Show both PDFs as images (the browser's own PDF viewer is not available headless, so draw page 1 with pdf.js).
  for (const [file, name] of [["18-combined-labels.pdf", "18-combined-labels"], ["19-packing-slips.pdf", "19-packing-slips"]] as const) {
    const bytes = (file === "18-combined-labels.pdf" ? lb : sb).toString("base64");
    const view = await admin.newPage();
    await view.setContent(`<html><body style="margin:0;background:#ddd;display:flex;gap:12px;padding:12px" id="b"></body></html>`);
    await view.addScriptTag({ url: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js" }).catch(() => {});
    const drawn = await view.evaluate(async (b64) => {
      const lib = (window as unknown as { pdfjsLib?: { GlobalWorkerOptions: { workerSrc: string }; getDocument: (o: unknown) => { promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getViewport: (o: unknown) => { width: number; height: number }; render: (o: unknown) => { promise: Promise<void> } }> }> } } }).pdfjsLib;
      if (!lib) return false;
      lib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const doc = await lib.getDocument({ data: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) }).promise;
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 1.2 });
        const c = document.createElement("canvas");
        c.width = vp.width;
        c.height = vp.height;
        c.style.background = "#fff";
        document.getElementById("b")!.appendChild(c);
        await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      }
      return true;
    }, bytes);
    if (drawn) await view.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
    await view.close();
  }

  // Mark shipped.
  await adm.goto("/admin/ship");
  for (const n of numbers) await adm.locator(`[data-ship-row="${n}"] input[type="checkbox"]`).check();
  await adm.locator('[data-bulk="ship"]').click();
  await adm.locator("[data-bulk-confirm-ship]").click();
  await expect(adm.locator("[data-bulk-results]")).toContainText("Done: 3 worked, 0 didn’t.", { timeout: 30_000 });
  await shot(adm, "20-bulk-shipped");
  st = await adminState(admin.request);
  for (const id of ids) expect(st.all.find((o) => o.id === id)!.status).toBe("shipped");
  // Each customer got their tracking email (sent when the label was bought, like single orders).
  for (const n of numbers) expect(emails().some((e) => e.subject === `Order #${n} has shipped`)).toBe(true);
  await admin.close();
});
