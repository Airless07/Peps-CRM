/**
 * Builds the database for the end-to-end tests: a COPY of the local database with every migration
 * applied, demo store data (scripts/qa-seed.ts), the store OPEN and test settings (Zelle filled in,
 * Cash App off like on the live site, an alert email, a from-address). The real data/peps.db is never touched.
 */
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(import.meta.dirname, "..");
export const dir = path.join(root, "e2e", ".tmp");
export const db = path.join(dir, "e2e.db");
const source = path.join(root, "data", "peps.db");

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "mock.log"), "");
if (existsSync(source)) copyFileSync(source, db);

const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: `file:${db.split(path.sep).join("/")}`, DATA_DIR: dir, NODE_ENV: "development" };
const run = (cmd: string) => execSync(cmd, { cwd: root, env, stdio: "inherit" });
run("npx prisma migrate deploy");
if (!existsSync(source)) run("npx tsx prisma/seed.ts");
run("npx tsx scripts/qa-seed.ts");

// Test settings on top of the demo data.
const sql = new DatabaseSync(db);
const row = sql.prepare(`select "storeJson" from "Settings" where id = 1`).get() as { storeJson: string };
const store = JSON.parse(row.storeJson);
store.open = true;
store.payments.zelle = { enabled: true, details: "pay@buckshotlabs.test" };
store.payments.cashapp = { enabled: false, details: "" };
store.payments.card = { enabled: false, comingSoon: "hide" };
store.alertEmails = ["owner@buckshotlabs.test"];
store.emailFromAddress = "orders@buckshotlabs.test";
store.siteUrl = "";
sql.prepare(`update "Settings" set "storeJson" = ?, "passwordHash" = null where id = 1`).run(JSON.stringify(store));
// One website product with no compound info at all, to check that its product page hides the section.
sql.prepare(`update "Listing" set "casNumber" = '', formula = '', "molecularWeight" = '', purity = '', form = '', storage = '' where name = 'KLOW'`).run();
// Plenty of stock for the sizes the tests buy, and nothing sold out by accident.
for (const p of sql.prepare(`select id, name from "Product"`).all() as { id: string; name: string }[]) {
  sql.prepare(`insert into "Purchase" (id, date, "productId", quantity, "totalCostCents", note, "fromInvestment", "createdAt") values (?, ?, ?, 20, 40000, 'e2e stock', 1, ?)`).run(`e2e-${p.id}`, Date.now() - 86400000, p.id, Date.now());
}
sql.close();
console.log(`E2E database ready: ${db}`);
