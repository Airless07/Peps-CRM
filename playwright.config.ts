import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a production build on a COPY of the database (see e2e/prepare.ts),
 * with the store open and Resend + Shippo replaced by local fakes (e2e/mock-fetch.mjs).
 *
 *   npm run e2e
 */
const dir = path.join(__dirname, "e2e", ".tmp");
export const PORT = Number(process.env.E2E_PORT ?? 3210);
export const BASE = `http://localhost:${PORT}`;
export const ADMIN_PASSWORD = "e2e-admin-pass-7421";
export const MOCK_LOG = path.join(dir, "mock.log");
export const SHOTS = path.join(__dirname, "e2e", "screenshots");

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: path.join(dir, "results"),
  use: {
    baseURL: BASE,
    // A normal browser user agent, so the built-in analytics count these visits (crawlers are ignored).
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "flow", testMatch: /flow\.spec\.ts/ },
    { name: "security", testMatch: /security\.spec\.ts/, dependencies: ["flow"] },
    { name: "pages", testMatch: /pages\.spec\.ts/, dependencies: ["security"] },
    // Saved in-person orders and the Sell cart quick buttons. Stands on its own: npx playwright test --project=sell --no-deps
    { name: "sell", testMatch: /sell\.spec\.ts/, dependencies: ["pages"] },
    // Phones: product cards open on the first touch tap (iPhone 14, WebKit, touch). Stands on its own: npx playwright test --project=mobile --no-deps
    { name: "mobile", testMatch: /mobile\.spec\.ts/, use: { ...devices["iPhone 14"], hasTouch: true }, dependencies: ["sell"] },
    // Owner price, receipts, Today, cash held. Stands on its own: npx playwright test --project=owner --no-deps
    { name: "owner", testMatch: /owner\.spec\.ts/, dependencies: ["mobile"] },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `${BASE}/robots.txt`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      DATABASE_URL: `file:${path.join(dir, "e2e.db").split(path.sep).join("/")}`,
      DATA_DIR: dir,
      APP_PASSWORD: ADMIN_PASSWORD,
      SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e-secret",
      RESEND_API_KEY: "re_e2e_mock",
      SHIPPO_API_KEY: "shippo_test_e2e_mock",
      PUBLIC_URL: BASE,
      E2E_MOCK_LOG: MOCK_LOG,
      // Relative on purpose: NODE_OPTIONS cannot hold a path with a space in it.
      NODE_OPTIONS: "--import ./e2e/mock-fetch.mjs",
    },
  },
});
