// Owner price, the receipt, Today, cash held and hand-offs, clicked through in a real browser on the
// production build. Money and stock are checked from the server after each step.
//
//   npx playwright test --project=owner --no-deps
import path from "node:path";
import { mkdirSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { SHOTS } from "../playwright.config";
import { ORIGIN, adminLogin, adminState, type AdminState } from "./helpers";

test.describe.configure({ mode: "serial" });

const evidence = path.join(SHOTS, "owner");
mkdirSync(evidence, { recursive: true });

let admin: BrowserContext;
let adm: Page;
let start: AdminState;
let v20 = "";
let ownerId = "";
const shot = (name: string) => adm.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true });

test.beforeAll(async ({ browser }) => {
  admin = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["clipboard-read", "clipboard-write"] });
  adm = await admin.newPage();
  await adminLogin(adm);
  start = await adminState(admin.request);
  for (const o of start.data.savedOrders) await admin.request.delete(`/api/saved-orders/${o.id}`, { headers: ORIGIN });
  start = await adminState(admin.request);
  v20 = start.data.products.find((p) => p.name === "Reta 20mg")!.id;
});
test.afterAll(async () => {
  await admin?.close();
});

test("1. owner price charges cost, hides discounts and tips, and completes with $0 profit", async () => {
  const A = start.data.settings.partnerAName;
  await adm.goto("/admin/sell");
  // Start from an empty cart whatever an earlier test left.
  await adm.evaluate(() => localStorage.removeItem("peps-cart"));
  await adm.reload();
  const row = adm.locator('[data-sell-product="Reta"] [data-sell-variant]').nth(1);
  await row.getByRole("button", { name: /^Sell 1 Reta 20mg/ }).click();
  await adm.getByRole("button", { name: /Current order/ }).click();
  const cart = adm.getByRole("dialog").filter({ has: adm.getByRole("heading", { name: "Current order" }) });
  await expect(cart.locator("[data-owner-price]")).toBeVisible();
  await cart.getByRole("radiogroup", { name: "Payment method" }).getByText("Cash", { exact: true }).click();
  await cart.locator("[data-owner-price]").click();
  const pick = adm.getByRole("dialog").filter({ has: adm.getByRole("heading", { name: "Who is this for?" }) });
  await pick.getByRole("button", { name: A, exact: true }).click();
  // A variant without a cost asks first.
  const noCost = adm.getByRole("button", { name: "Use owner price anyway" });
  if (await noCost.isVisible().catch(() => false)) await noCost.click();

  const sheet = adm.getByRole("dialog").filter({ has: adm.getByRole("heading", { name: /Owner purchase/ }) });
  await expect(sheet.locator("[data-owner-tag]")).toContainText(`Owner price: ${A}`);
  await expect(sheet.locator("[data-quick-discount]")).toHaveCount(0);
  await expect(sheet.locator("[data-quick-tip]")).toHaveCount(0);
  const cost = start.ledger.stock.get(v20)!.unitCost;
  const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
  await expect(sheet.locator("[data-owner-line] s")).toHaveText(usd(start.data.products.find((p) => p.id === v20)!.defaultPriceCents));
  await shot("01-owner-cart");
  await sheet.getByRole("button", { name: /Complete at cost/ }).click();
  // Earlier tests may have sold the last one: the stock warning asks first, like any sale.
  const anyway = adm.getByRole("button", { name: "Complete anyway" });
  await anyway.waitFor({ timeout: 1500 }).then(() => anyway.click()).catch(() => {});
  await expect(adm.locator("[data-last-sale]")).toBeVisible();

  const after = await adminState(admin.request);
  const o = after.data.orders.find((x) => x.owner === "A" && !start.data.orders.some((y) => y.id === x.id))!;
  expect(o).toBeTruthy();
  ownerId = o.id;
  // Cash is held by whoever sold it unless someone else is picked.
  expect(o).toMatchObject({ owner: "A", cashTo: o.soldBy, paymentMethod: "Cash", discountValue: 0, tipCents: 0 });
  expect(after.ledger.orders.get(o.id)).toMatchObject({ revenue: cost, cost, profit: 0, a: 0, b: 0 });
  expect(after.money.business - start.money.business).toBe(cost);
  expect([after.money.pendingA, after.money.pendingB]).toEqual([start.money.pendingA, start.money.pendingB]);
  expect(after.ledger.stock.get(v20)!.stock).toBe(start.ledger.stock.get(v20)!.stock - 1);
});

test("2. Copy receipt puts a plain text receipt on the clipboard, and Today shows the day", async () => {
  await adm.locator("[data-copy-receipt]").click();
  await expect(adm.getByText("Receipt copied")).toBeVisible();
  const text = await adm.evaluate(() => navigator.clipboard.readText());
  const o = (await adminState(admin.request)).data.orders.find((x) => x.id === ownerId)!;
  expect(text).toContain(`Order #${o.number}`);
  expect(text).toContain("1× Reta 20mg");
  expect(text).toMatch(/Owner price .*charged at cost/);
  expect(text).toMatch(/Total {2}\$\d+\.\d\d/);
  const today = adm.locator("[data-today]");
  await expect(today).toBeVisible();
  await today.getByRole("button").first().click();
  await expect(today).toContainText("owner purchase");
  await expect(today.locator("[data-today-cash]")).toBeVisible();
  await shot("02-receipt-today");
});

test("3. Money keeps owner purchases apart, shows cash held, and a hand-off moves cash without changing business money", async () => {
  const before = await adminState(admin.request);
  await adm.goto("/admin/money");
  await adm.getByRole("radio", { name: "All", exact: true }).click();
  await expect(adm.locator("[data-owner-count]")).toHaveText(String(before.data.orders.filter((o) => o.owner).length));
  await expect(adm.locator('[data-cash-holder="A"]')).toBeVisible();
  await adm.locator("[data-handoff-button]").click();
  const sheet = adm.getByRole("dialog").filter({ has: adm.getByRole("heading", { name: "Hand off cash" }) });
  await sheet.getByLabel("From").selectOption("A");
  await sheet.getByLabel("To").selectOption("bank");
  await sheet.getByRole("textbox").first().fill("1.00");
  await sheet.getByRole("button", { name: "Save hand-off" }).click();
  await expect(adm.getByText(/handed \$1\.00 to Bank/)).toBeVisible();
  const after = await adminState(admin.request);
  expect(after.money).toEqual(before.money);
  expect(after.data.cashHandoffs?.[0]).toMatchObject({ from: "A", to: "bank", amountCents: 100 });
  await shot("03-money-cash");
  await admin.request.delete("/api/cash-handoffs", { headers: ORIGIN, data: { id: after.data.cashHandoffs![0].id } });
});

test("4. Orders and In-person orders show an Owner badge and filter owner purchases", async () => {
  await adm.goto("/admin/orders");
  await adm.getByRole("radio", { name: "Owner purchases" }).click();
  await expect(adm.getByText(/^\d+ orders?$/)).toBeVisible();
  const o = (await adminState(admin.request)).data.orders.find((x) => x.id === ownerId)!;
  await expect(adm.getByRole("link", { name: `#${o.number}` }).first()).toBeVisible();
  await expect(adm.getByText("Owner", { exact: true }).first()).toBeVisible();
  // Clean up: the owner purchase was only for this test.
  await admin.request.delete(`/api/orders/${ownerId}`, { headers: ORIGIN });
  const end = await adminState(admin.request);
  expect(end.money).toEqual(start.money);
});
