// Starts the production build on the end-to-end test database (the same setup Playwright uses),
// for looking at pages by hand or running Lighthouse:   node e2e/serve.mjs   (after: npm run build && npx tsx e2e/prepare.ts)
import { spawn } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, "e2e", ".tmp");
const port = process.env.E2E_PORT ?? "3210";
const child = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", port], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: `file:${path.join(dir, "e2e.db").split(path.sep).join("/")}`,
    DATA_DIR: dir,
    APP_PASSWORD: "e2e-admin-pass-7421",
    SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e-secret",
    RESEND_API_KEY: "re_e2e_mock",
    SHIPPO_API_KEY: "shippo_test_e2e_mock",
    PUBLIC_URL: `http://localhost:${port}`,
    E2E_MOCK_LOG: path.join(dir, "mock.log"),
    NODE_OPTIONS: "--import ./e2e/mock-fetch.mjs",
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
