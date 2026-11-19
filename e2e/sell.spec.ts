// Saved (open) in-person orders and the editable quick buttons of the Sell cart, clicked through
// in a real browser on the production build. Stock and money are checked after every step.
import path from "node:path";
import { mkdirSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { SHOTS } from "../playwright.config";
import { ORIGIN, adminLogin, adminState, type AdminState } from "./helpers";

test.describe.configure({ mode: "serial" });

const evidence = path.join(SHOTS, "sell");
mkdirSync(evidence, { recursive: true });

let admin: BrowserContext;
let adm: Page;
let start: AdminState;
let v20 = "";
let price20 = 0;
let savedId = "";

/** Stock with `held` units taken out of one variant (saved orders hold their items out of stock). */
const heldOut = (s: AdminState, variantId: string, held: number) => {
  const n = numbers(s);
  return { ...n, stock: { ...n.stock, [variantId]: n.stock[variantId] - held } };
};
/** Stock and money as one comparable value. */
const numbers = (s: AdminState) => ({
  money: s.money,
  stock: Object.fromEntries([...s.ledger.stock].map(([id, v]) => [id, v.stock])),
  orders: s.all.length,
});
const shot = (name: string) => adm.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true });
const texts = (sel: string) => adm.locator(sel).evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()));
/** Nothing sticks out sideways, and every button in `scope` is at least 44px tall. */
async function checkPhoneLayout(scope: string) {
  expect(await adm.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), "no sideways scroll").toBeLessThanOrEqual(0);
  const small = await adm.locator(`${scope} button:visible`).evaluateAll((els) =>
    els
      .map((e) => ({ t: (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 30), h: e.getBoundingClientRect().height, right: e.getBoundingClientRect().right }))
      .filter((b) => b.h < 43.5 || b.right > window.innerWidth + 0.5),
  );
  expect(small, "buttons at least 44px tall and inside the screen").toEqual([]);
}

test.beforeAll(async ({ browser }) => {
  admin = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  adm = await admin.newPage();
  await adminLogin(adm);
  // A clean slate for this file, whatever ran before it.
  const s = await adminState(admin.request);
  for (const o of s.data.savedOrders) await admin.request.delete(`/api/saved-orders/${o.id}`, { headers: ORIGIN });
  await admin.request.patch("/api/settings", { headers: ORIGIN, data: { sellButtons: { discounts: [{ type: "$", value: 500 }, { type: "$", value: 1000 }, { type: "$", value: 2000 }, { type: "%", value: 10 }], tips: [500, 1000, 2000] } } });
  start = await adminState(admin.request);
  const reta20 = start.data.products.find((p) => p.name === "Reta 20mg")!;
  v20 = reta20.id;
  price20 = reta20.defaultPriceCents;
});
test.afterAll(async () => {
  // Put the regular price and the default buttons back for anything that runs after this file.
  await admin.request.patch(`/api/products/${v20}`, { headers: ORIGIN, data: { defaultPriceCents: price20 } });
  await admin.request.patch("/api/settings", { headers: ORIGIN, data: { sellButtons: { discounts: [{ type: "$", value: 500 }, { type: "$", value: 1000 }, { type: "$", value: 2000 }, { type: "%", value: 10 }], tips: [500, 1000, 2000] } } });
  await admin?.close();
});

test("1. the cart shows the default quick buttons and Save for later next to Complete order", async () => {
  await adm.goto("/admin/sell");
  await expect(adm.locator("[data-saved-orders-button]")).toHaveText(/Saved orders \(0\)/);
  // On a phone the header (title, Saved orders, New order) fits on one row without squeezing.
  await adm.setViewportSize({ width: 390, height: 844 });
  await checkPhoneLayout("main");
  expect(await adm.getByRole("heading", { name: "Sell", exact: true }).evaluate((h) => h.getBoundingClientRect().height)).toBeLessThan(40);
  await shot("01-sell-header-390");
  await adm.setViewportSize({ width: 1280, height: 900 });
  const row = adm.locator('[data-sell-product="Reta"] [data-sell-variant]').nth(1);
  await row.getByRole("button", { name: /^Sell 1 Reta 20mg/ }).click();
  await row.getByRole("button", { name: /^Sell 1 Reta 20mg/ }).click();
  await adm.getByRole("button", { name: /Current order/ }).click();
  const dialog = adm.getByRole("dialog");
  // Wait for the cart sheet to be open before reading its buttons.
  await expect(dialog.locator("[data-quick-discount]").first()).toBeVisible();
  expect(await texts("[data-quick-discount]")).toEqual(["-$5", "-$10", "-$20", "-10%"]);
  expect(await texts("[data-quick-tip]")).toEqual(["$5", "$10", "$20"]);
  await dialog.locator("[data-quick-discount]", { hasText: "-10%" }).click();
  await dialog.locator("[data-quick-tip]", { hasText: "$5" }).first().click();
  await dialog.getByPlaceholder("Anything to remember").fill("Pick up Friday");
  const total = 2 * price20 - Math.round(2 * price20 * 0.1) + 500;
  await expect(dialog.getByRole("button", { name: /Complete order/ })).toContainText(`$${(total / 100).toFixed(2)}`);
  await expect(dialog.getByRole("button", { name: "Save for later" })).toBeVisible();
  await shot("01-cart-save-for-later-1440");
  await adm.setViewportSize({ width: 390, height: 844 });
  await checkPhoneLayout('[role="dialog"]');
  await shot("01-cart-save-for-later-390");
  await adm.setViewportSize({ width: 1280, height: 900 });
});

test("2. Save for later stores the order, holds its items out of stock and changes no money", async () => {
  await Promise.all([adm.waitForResponse((r) => r.url().endsWith("/api/saved-orders") && r.request().method() === "POST"), adm.getByRole("dialog").getByRole("button", { name: "Save for later" }).click()]);
  await expect(adm.getByText(/Saved for later/).first()).toBeVisible();
  await expect(adm.locator("[data-saved-orders-button]")).toHaveText(/Saved orders \(1\)/);
  // The cart is empty again.
  await expect(adm.getByRole("button", { name: /Current order/ })).toHaveCount(0);

  const s = await adminState(admin.request);
  // The 2 saved vials are out of stock while the order waits; money is untouched.
  expect(numbers(s)).toEqual(heldOut(start, v20, 2));
  expect(s.ledger.stock.get(v20)!.heldQty).toBe(2);
  expect(s.data.savedOrders).toHaveLength(1);
  const o = s.data.savedOrders[0];
  savedId = o.id;
  expect(o).toMatchObject({ note: "Pick up Friday", discountType: "%", discountValue: 10, tipCents: 500 });
  expect(o.lines.map((l) => [l.productId, l.quantity, l.unitPriceCents])).toEqual([[v20, 2, price20]]);
});

test("3. the Dashboard to-do and the In-person orders Saved tab show it", async () => {
  await adm.goto("/admin");
  const todo = adm.locator("li", { hasText: "1 saved order waiting to be completed" });
  await expect(todo).toBeVisible();
  await shot("03-dashboard-todo");
  await adm.goto("/admin/in-person");
  await adm.getByRole("radio", { name: "Saved (1)" }).click();
  await expect(adm.locator(`[data-saved-order="${savedId}"]`)).toContainText("2× Reta 20mg");
  await shot("03-in-person-saved-tab");
  await adm.setViewportSize({ width: 390, height: 844 });
  await checkPhoneLayout("main");
  await shot("03-in-person-saved-tab-390");
  await adm.setViewportSize({ width: 1280, height: 900 });
  // The to-do button opens the saved list on the Sell screen.
  await adm.goto("/admin");
  await adm.locator("li", { hasText: "1 saved order waiting to be completed" }).getByRole("link").click();
  await adm.waitForURL(/\/admin\/sell/);
  await expect(adm.getByRole("dialog").getByRole("heading", { name: "Saved orders (1)" })).toBeVisible();
});

test("4. a later price change is noted, and the saved price stays", async () => {
  const res = await admin.request.patch(`/api/products/${v20}`, { headers: ORIGIN, data: { defaultPriceCents: price20 + 1500 } });
  expect(res.status()).toBe(200);
  await adm.goto("/admin/sell?saved=1");
  const card = adm.locator(`[data-saved-order="${savedId}"]`);
  await expect(card.locator("[data-price-note]")).toContainText(`the regular price is now $${((price20 + 1500) / 100).toFixed(2)}`);
  await expect(card.locator("[data-price-note]")).toContainText(`This order keeps $${(price20 / 100).toFixed(2)}`);
  const total = 2 * price20 - Math.round(2 * price20 * 0.1) + 500;
  await expect(card).toContainText(`$${(total / 100).toFixed(2)}`);
  await shot("04-saved-list-price-note");
  await adm.setViewportSize({ width: 390, height: 844 });
  await checkPhoneLayout('[role="dialog"]');
  await shot("04-saved-list-390");
  await adm.setViewportSize({ width: 1280, height: 900 });
});

test("5. Open loads it into the cart to edit, and saving again updates the same order", async () => {
  await adm.locator(`[data-saved-order="${savedId}"]`).getByRole("button", { name: /^Open saved order/ }).click();
  // The saved list closes and the cart opens with the order in it.
  const dialog = adm.getByRole("dialog").filter({ has: adm.getByRole("heading", { name: "Saved order", exact: true }) });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(`$${(price20 / 100).toFixed(2)} each`)).toBeVisible(); // the saved price, not the new one
  await dialog.getByRole("button", { name: "Increase", exact: true }).click();
  await shot("05-opened-in-cart");
  // Wait for the save to reach the server before reading the numbers.
  await Promise.all([adm.waitForResponse((r) => r.url().endsWith("/api/saved-orders") && r.request().method() === "POST"), dialog.getByRole("button", { name: "Save for later" }).click()]);
  await expect(adm.locator("[data-saved-orders-button]")).toHaveText(/Saved orders \(1\)/);
  const s = await adminState(admin.request);
  // Now 3 held (not 2 + 3): saving again replaces the hold.
  expect(numbers(s)).toEqual(heldOut(start, v20, 3));
  expect(s.data.savedOrders).toHaveLength(1);
  expect(s.data.savedOrders[0].id).toBe(savedId);
  expect(s.data.savedOrders[0].lines.map((l) => [l.quantity, l.unitPriceCents, l.listPriceCents])).toEqual([[3, price20, price20]]);
});

test("6. Complete asks for the payment method, warns about stock, then completes like a normal sale", async () => {
  // Take stock down so that 3 no longer fit: 1 vial on the shelf. The 3 held by the saved order are
  // already out of stock, so stock shows 1 - 3 = -2.
  const before0 = await adminState(admin.request);
  const adj = await admin.request.post("/api/adjustments", { headers: ORIGIN, data: { id: `e2e-adj-${Date.now()}`, date: new Date().toISOString(), productId: v20, quantity: -(before0.stock(v20) + 3 - 1), reason: "correction", note: "e2e" } });
  expect(adj.status()).toBe(200);
  const before = await adminState(admin.request);
  expect(before.stock(v20)).toBe(-2);
  expect(before.data.savedOrders).toHaveLength(1);

  await adm.goto("/admin/sell?saved=1");
  await adm.locator(`[data-saved-order="${savedId}"]`).getByRole("button", { name: /^Complete saved order/ }).click();
  const sheet = adm.getByRole("dialog").filter({ hasText: "How did they pay?" });
  await sheet.getByRole("radio", { name: "Zelle" }).click();
  const total = 3 * price20 - Math.round(3 * price20 * 0.1) + 500;
  await shot("06-complete-payment-method");
  await sheet.getByRole("button", { name: /^Complete order/ }).click();
  // Stock warning before anything is recorded.
  const warn = adm.getByRole("dialog").filter({ hasText: "Not enough stock" });
  await expect(warn).toContainText("Reta 20mg will go below zero");
  await shot("06-stock-warning");
  expect((await adminState(admin.request)).all.length).toBe(before.all.length);
  await warn.getByRole("button", { name: "Complete anyway" }).click();
  await expect(adm.getByText(/Order saved/).first()).toBeVisible();
  await adm.waitForTimeout(6000); // let the Undo toast pass

  const s = await adminState(admin.request);
  expect(s.data.savedOrders).toHaveLength(0);
  const sale = s.data.orders.find((o) => o.id === savedId)!;
  expect(sale, "the saved order became an order").toBeTruthy();
  expect(sale).toMatchObject({ source: "inperson", status: "completed", paymentMethod: "Zelle", note: "Pick up Friday", discountType: "%", discountValue: 10, tipCents: 500 });
  expect(sale.lines.map((l) => [l.productId, l.quantity, l.unitPriceCents])).toEqual([[v20, 3, price20]]);
  expect(sale.number).toBe(Math.max(1000, ...before.all.map((o) => o.number ?? 0)) + 1);
  // The hold became the sale: stock does not drop a second time.
  expect(s.stock(v20)).toBe(before.stock(v20));
  expect(s.ledger.stock.get(v20)!.heldQty).toBe(0);
  const r = s.ledger.orders.get(sale.id)!;
  expect(r.total).toBe(total);
  const moved = s.money.business - before.money.business + (s.money.pendingA - before.money.pendingA) + (s.money.pendingB - before.money.pendingB);
  expect(moved).toBe(r.a + r.b + r.business);

  await adm.goto("/admin/orders");
  await expect(adm.getByText(`#${sale.number}`).first()).toBeVisible();
  await adm.goto("/admin/in-person");
  await expect(adm.getByRole("radio", { name: "Saved (0)" })).toBeVisible();
  await expect(adm.locator("main")).toContainText("Pick up Friday");
});

test("7. Delete asks first, and puts the held stock back", async () => {
  const before = await adminState(admin.request);
  await adm.goto("/admin/sell");
  await adm.locator('[data-sell-product="Reta"] [data-sell-variant]').nth(0).getByRole("button", { name: /^Sell 1 Reta 10mg/ }).click();
  await adm.getByRole("button", { name: /Current order/ }).click();
  await Promise.all([adm.waitForResponse((r) => r.url().endsWith("/api/saved-orders") && r.request().method() === "POST"), adm.getByRole("dialog").getByRole("button", { name: "Save for later" }).click()]);
  await expect(adm.locator("[data-saved-orders-button]")).toHaveText(/Saved orders \(1\)/);
  const v10 = before.data.products.find((p) => p.name === "Reta 10mg")!.id;
  expect(numbers(await adminState(admin.request))).toEqual(heldOut(before, v10, 1));
  await adm.locator("[data-saved-orders-button]").click();
  await adm.getByRole("button", { name: /^Delete saved order/ }).click();
  const ask = adm.getByRole("dialog").filter({ hasText: "Delete this saved order?" });
  await expect(ask).toBeVisible();
  // Cancel keeps it.
  await ask.getByRole("button", { name: "Cancel" }).click();
  expect((await adminState(admin.request)).data.savedOrders).toHaveLength(1);
  await adm.getByRole("button", { name: /^Delete saved order/ }).click();
  await adm.getByRole("dialog").filter({ hasText: "Delete this saved order?" }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(adm.getByText("No saved orders")).toBeVisible();
  const s = await adminState(admin.request);
  expect(s.data.savedOrders).toHaveLength(0);
  expect(numbers(s)).toEqual(numbers(before));
});

test("8. Settings: add, edit, remove and reorder the quick buttons with a live preview", async () => {
  const before = await adminState(admin.request);
  await adm.goto("/admin/settings?tab=business");
  await expect(adm.getByRole("heading", { name: "Sell screen quick buttons" })).toBeVisible();
  const discounts = adm.locator('[data-sell-buttons="discounts"]');
  const tips = adm.locator('[data-sell-buttons="tips"]');
  expect(await texts("[data-preview-discount]")).toEqual(["-$5", "-$10", "-$20", "-10%"]);
  expect(await texts("[data-preview-tip]")).toEqual(["$5", "$10", "$20"]);

  // Add a discount button, make it a percent, edit the amount to 15%.
  await discounts.getByRole("button", { name: "Add discount button" }).click();
  expect(await texts("[data-preview-discount]")).toEqual(["-$5", "-$10", "-$20", "-10%", "-$15"]);
  const added = discounts.locator("li").nth(4);
  await added.getByRole("radio", { name: "%" }).click();
  await added.locator("input").fill("25");
  expect(await texts("[data-preview-discount]")).toEqual(["-$5", "-$10", "-$20", "-10%", "-25%"]);
  // Remove -$20.
  await discounts.getByRole("button", { name: "Remove discount button -$20" }).click();
  expect(await texts("[data-preview-discount]")).toEqual(["-$5", "-$10", "-10%", "-25%"]);
  // Drag -25% to the top with the mouse.
  const handle = discounts.locator("li").nth(3).locator("[data-drag-handle]");
  const from = (await handle.boundingBox())!;
  const to = (await discounts.locator("li").nth(0).boundingBox())!;
  await adm.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await adm.mouse.down();
  await adm.mouse.move(from.x + from.width / 2, to.y + to.height / 2, { steps: 12 });
  await adm.mouse.up();
  expect(await texts("[data-preview-discount]")).toEqual(["-25%", "-$5", "-$10", "-10%"]);
  // Reorder a tip with the keyboard: $20 up to first. Then edit $10 to $7.50.
  await tips.locator("li").nth(2).locator("[data-drag-handle]").focus();
  await adm.keyboard.press("ArrowUp");
  await adm.keyboard.press("ArrowUp");
  expect(await texts("[data-preview-tip]")).toEqual(["$20", "$5", "$10"]);
  await tips.locator("li").nth(2).locator("input").fill("7.50");
  expect(await texts("[data-preview-tip]")).toEqual(["$20", "$5", "$7.50"]);
  await shot("08-settings-quick-buttons-1440");

  // The limits: the last one can't be removed, and 8 is the most.
  for (let i = 0; i < 4; i++) await tips.getByRole("button", { name: "Add tip button" }).click();
  await tips.getByRole("button", { name: "Add tip button" }).click();
  await expect(tips.locator("li")).toHaveCount(8);
  await expect(tips.getByRole("button", { name: "Add tip button" })).toBeDisabled();
  for (let i = 0; i < 5; i++) await tips.locator("li").last().getByRole("button", { name: /^Remove tip button/ }).click();
  expect(await texts("[data-preview-tip]")).toEqual(["$20", "$5", "$7.50"]);

  await adm.setViewportSize({ width: 390, height: 844 });
  await discounts.scrollIntoViewIfNeeded();
  await checkPhoneLayout("[data-sell-buttons]");
  await shot("08-settings-quick-buttons-390");
  await adm.setViewportSize({ width: 1280, height: 900 });

  await adm.getByRole("button", { name: "Save", exact: true }).click();
  await expect(adm.getByText("Settings saved")).toBeVisible();
  const s = await adminState(admin.request);
  expect(s.data.settings.sellButtons).toEqual({ discounts: [{ type: "%", value: 25 }, { type: "$", value: 500 }, { type: "$", value: 1000 }, { type: "%", value: 10 }], tips: [2000, 500, 750] });
  // Past orders and money are untouched by the new buttons.
  expect(numbers(s)).toEqual(numbers(before));
  expect(JSON.stringify(s.data.orders)).toBe(JSON.stringify(before.data.orders));
});

test("9. the Sell cart shows exactly these buttons in this order, and they apply correctly", async () => {
  await adm.goto("/admin/sell");
  const row = adm.locator('[data-sell-product="Reta"] [data-sell-variant]').nth(0);
  await row.getByRole("button", { name: /^Sell 1 Reta 10mg/ }).click();
  await row.getByRole("button", { name: /^Sell 1 Reta 10mg/ }).click();
  await adm.getByRole("button", { name: /Current order/ }).click();
  const dialog = adm.getByRole("dialog");
  // Wait for the cart sheet to be open before reading its buttons.
  await expect(dialog.locator("[data-quick-discount]").first()).toBeVisible();
  expect(await texts("[data-quick-discount]")).toEqual(["-25%", "-$5", "-$10", "-10%"]);
  expect(await texts("[data-quick-tip]")).toEqual(["$20", "$5", "$7.50"]);
  // The custom amount options are still there.
  await expect(dialog.getByRole("button", { name: "Custom" })).toBeVisible();
  await expect(dialog.getByRole("radio", { name: "%" })).toBeVisible();

  const price = (await adminState(admin.request)).data.products.find((p) => p.name === "Reta 10mg")!.defaultPriceCents;
  const sub = 2 * price;
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const totalBtn = dialog.getByRole("button", { name: /^Complete order/ });
  await dialog.locator("[data-quick-discount]", { hasText: "-25%" }).click();
  await expect(totalBtn).toContainText(money(sub - Math.round(sub * 0.25)));
  await dialog.locator("[data-quick-discount]", { hasText: "-$5" }).click();
  await expect(totalBtn).toContainText(money(sub - 500));
  await dialog.locator("[data-quick-tip]", { hasText: "$7.50" }).click();
  await expect(totalBtn).toContainText(money(sub - 500 + 750));
  await shot("09-cart-custom-buttons");
  await adm.setViewportSize({ width: 390, height: 844 });
  await checkPhoneLayout('[role="dialog"]');
  await shot("09-cart-custom-buttons-390");
  await adm.setViewportSize({ width: 1280, height: 900 });
  // Leave nothing behind: empty the cart.
  await adm.keyboard.press("Escape");
  await adm.getByRole("button", { name: "New order" }).click();
  await adm.getByRole("dialog").getByRole("button", { name: "Discard" }).click();
});
