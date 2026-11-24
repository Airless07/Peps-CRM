/**
 * Proves migration 20261125120000_customer_carts keeps every customer, order, code and credit row.
 *
 *   npx tsx scripts/prove-cart-migration.ts            (a database built at the previous migration, filled with sample rows)
 *   PROOF_DB=path/to/copy.db npx tsx scripts/prove-cart-migration.ts   (a COPY of a real database, e.g. a Railway backup)
 *
 * 1. Builds (or copies) a database at the migration BEFORE this one. The original file is never touched.
 * 2. Reads every row of every table.
 * 3. Runs `prisma migrate deploy` (applies only the new migration).
 * 4. Reads again and checks: same tables, same row counts, every row identical (new nullable column aside),
 *    the new CustomerCart table is empty, and the SQL triggers on codes still exist.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(import.meta.dirname, "..");
/** The migration to prove: MIGRATION=<folder name> (default: the newest one). */
const NEW = process.env.MIGRATION ?? readdirSync(path.join(root, "prisma", "migrations")).filter((n) => /^\d{14}_/.test(n)).sort().at(-1)!;
const work = path.join(tmpdir(), `cart-proof-${Date.now()}`);
mkdirSync(work, { recursive: true });
const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
const db = path.join(work, "proof.db");
const url = `file:${db.split(path.sep).join("/")}`;

function deploy(prismaDir: string) {
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", path.join(prismaDir, "schema.prisma")], { cwd: root, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}

// The schema folder as it was before this migration.
const before = path.join(work, "prisma-before");
cpSync(path.join(root, "prisma"), before, { recursive: true });
for (const n of readdirSync(path.join(before, "migrations"))) if (n >= NEW && /^\d{14}_/.test(n)) rmSync(path.join(before, "migrations", n), { recursive: true, force: true });

if (process.env.PROOF_DB) {
  copyFileSync(process.env.PROOF_DB, db);
  deploy(before); // brings an older copy up to the previous migration (no-op when already there)
} else {
  deploy(before);
  const s = new DatabaseSync(db);
  const now = Date.now();
  /** Insert a row; any other NOT NULL column without a default gets a plain value ('' / 0 / now). */
  const put = (table: string, row: Record<string, string | number | null>) => {
    const info = s.prepare(`pragma table_info("${table}")`).all() as { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[];
    const full = { ...row };
    for (const c of info) if (!(c.name in full) && c.notnull && c.dflt_value === null) full[c.name] = /DATE/i.test(c.type) ? now : /INT|REAL|BOOL/i.test(c.type) ? 0 : "";
    const keys = Object.keys(full);
    s.prepare(`insert into "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) values (${keys.map(() => "?").join(", ")})`).run(...keys.map((k) => full[k]));
  };
  put("Settings", { id: 1, startingBalanceCents: -50000 });
  put("Listing", { id: "l1", name: "Retatrutide", slug: "retatrutide", showOnWebsite: 1 });
  put("Product", { id: "p1", name: "Retatrutide", variantLabel: "10mg", defaultPriceCents: 9000, listingId: "l1" });
  for (let i = 0; i < 25; i++) {
    put("Customer", { id: `c${i}`, name: `Customer ${i}`, email: `c${i}@example.com`, passwordHash: i % 2 ? "$2a$11$hash" : null, referralCode: `CODE${String(i).padStart(4, "0")}`, createdAt: now });
    put("CreditEntry", { id: `ce${i}`, customerId: `c${i}`, amountCents: 500 + i, kind: "manual", reason: "proof", date: now });
  }
  put("Promotion", { id: "pr1", kind: "code", code: "WELCOME10", name: "10% off", discountType: "%", discountValue: 10 });
  for (let i = 0; i < 40; i++) {
    put("Order", { id: `o${i}`, date: now - i * 86400000, number: 1001 + i, source: "online", status: ["paid", "label_purchased", "shipped", "delivered", "awaiting_payment"][i % 5], customer: `Customer ${i % 25}`, customerId: `c${i % 25}`, email: `c${i % 25}@example.com`, referralCode: i % 3 ? "" : "CODE0001", storeCreditCents: i % 4 ? 0 : 300, labelUrl: i % 5 === 1 ? "https://x/label.pdf" : "", createdAt: now });
    put("OrderLine", { id: `ol${i}`, orderId: `o${i}`, productId: "p1", productName: "Retatrutide 10mg", quantity: 1 + (i % 3), unitPriceCents: 9000, unitCostCents: 3000, cutPercent: 10 });
  }
  s.close();
}

type Snap = Map<string, string[]>;
/** Columns of each table before the migration: rows are compared on these only (new columns are added). */
let keep: Map<string, Set<string>> | null = null;
function snapshot(file: string): Snap {
  const s = new DatabaseSync(file, { readOnly: true });
  const tables = (s.prepare(`select name from sqlite_master where type = 'table' and name not like '\\_%' escape '\\' and name not like 'sqlite_%'`).all() as { name: string }[]).map((t) => t.name).sort();
  const out: Snap = new Map();
  for (const t of tables) {
    const rows = s.prepare(`select * from "${t}"`).all() as Record<string, unknown>[];
    const cols = keep?.get(t);
    out.set(t, rows.map((r) => JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => !cols || cols.has(k))), (_k, v) => (typeof v === "bigint" ? String(v) : v))).sort());
  }
  s.close();
  return out;
}

const a = snapshot(db);
{
  const s0 = new DatabaseSync(db, { readOnly: true });
  keep = new Map([...a.keys()].map((t) => [t, new Set((s0.prepare(`pragma table_info("${t}")`).all() as { name: string }[]).map((c) => c.name))]));
  s0.close();
}
deploy(path.join(root, "prisma"));
const b = snapshot(db);

let ok = true;
const fail = (m: string) => ((ok = false), console.log(`FAIL ${m}`));
for (const [t, rows] of a) {
  const after = b.get(t);
  if (!after) fail(`table ${t} is gone`);
  else if (after.length !== rows.length) fail(`${t}: ${rows.length} rows before, ${after.length} after`);
  else if (after.some((r, i) => r !== rows[i])) fail(`${t}: a row changed`);
  else console.log(`ok   ${t.padEnd(22)} ${rows.length} rows identical`);
}
const added = [...b.keys()].filter((t) => !a.has(t));
console.log(`new tables: ${added.join(", ")}`);
const EXPECT: Record<string, { tables: string[]; orderCols: string[] }> = {
  "20261125120000_customer_carts": { tables: ["CustomerCart"], orderCols: ["labelLockAt"] },
  "20261126120000_order_consent": { tables: [], orderCols: ["consentAt", "consentText", "consentIp"] },
  "20261128120000_revoked_sessions": { tables: ["RevokedSession"], orderCols: [] },
  "20261129120000_local_switch": { tables: [], orderCols: ["localSwitchJson"] },
};
const want = EXPECT[NEW] ?? { tables: [], orderCols: [] };
if (added.join() !== want.tables.join()) fail(`unexpected new tables: ${added.join()}`);
for (const t of added) if ((b.get(t) ?? []).length !== 0) fail(`${t} is not empty`);
const s = new DatabaseSync(db, { readOnly: true });
const cols = (s.prepare(`pragma table_info("Order")`).all() as { name: string }[]).map((c) => c.name);
for (const c of want.orderCols) if (!cols.includes(c)) fail(`Order.${c} missing`);
console.log(`migration proved: ${NEW}`);
const triggers = (s.prepare(`select name from sqlite_master where type = 'trigger'`).all() as { name: string }[]).length;
console.log(`code triggers still in place: ${triggers}`);
const applied = (s.prepare(`select migration_name from _prisma_migrations where finished_at is not null order by migration_name`).all() as { migration_name: string }[]).map((m) => m.migration_name);
console.log(`last migration applied: ${applied.at(-1)}`);
if (applied.at(-1) !== NEW) fail("new migration not recorded");
s.close();
rmSync(work, { recursive: true, force: true });
console.log(ok ? "\nPROOF PASSED: every existing row kept exactly." : "\nPROOF FAILED");
process.exit(ok ? 0 : 1);
