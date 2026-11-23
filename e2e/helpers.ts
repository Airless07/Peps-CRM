import { readFileSync } from "node:fs";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { computeLedger, type Ledger } from "../src/lib/money";
import type { AppData, OrderRec } from "../src/lib/types";
import { ADMIN_PASSWORD, BASE, MOCK_LOG } from "../playwright.config";

export interface MockCall {
  at: string;
  service: "resend" | "shippo";
  to?: string[];
  from?: string;
  subject?: string;
  text?: string;
  method?: string;
  path?: string;
  body?: Record<string, unknown>;
}

/** Everything the fake Resend and Shippo received so far. */
export const mockCalls = (): MockCall[] =>
  readFileSync(MOCK_LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as MockCall);
export const emails = () => mockCalls().filter((c) => c.service === "resend");
export const shippoCalls = () => mockCalls().filter((c) => c.service === "shippo");

export async function adminLogin(page: Page) {
  await page.goto("/admin/login");
  await page.getByPlaceholder("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
}

export interface AdminState {
  data: AppData;
  ledger: Ledger;
  all: OrderRec[];
  stock: (variantId: string) => number;
  money: { business: number; pendingA: number; pendingB: number; shipping: number; labels: number };
}

/** The admin's full data (the same /api/data the admin screens use) with the money engine run on it. */
export async function adminState(request: APIRequestContext): Promise<AdminState> {
  const res = await request.get("/api/data");
  expect(res.status(), "GET /api/data as admin").toBe(200);
  const data = (await res.json()) as AppData;
  const ledger = computeLedger(data);
  return {
    data,
    ledger,
    all: [...data.orders, ...data.pendingOrders],
    stock: (id) => ledger.stock.get(id)?.stock ?? 0,
    money: { business: ledger.businessCents, pendingA: ledger.pendingA, pendingB: ledger.pendingB, shipping: ledger.shippingCollected, labels: ledger.labelCosts },
  };
}

export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const ORIGIN = { origin: BASE };

/** The entry gate was answered on this browser earlier (the gate itself is tested in gate.spec.ts). */
export async function enteredSite(ctx: import("@playwright/test").BrowserContext) {
  const until = String(Date.now() + 30 * 86400000);
  await ctx.addCookies([{ name: "bl_entry", value: until, url: BASE }]);
  await ctx.addInitScript((v) => {
    try {
      localStorage.setItem("bp-age", v);
    } catch {}
  }, until);
}
