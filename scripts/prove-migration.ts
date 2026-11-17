/**
 * Proves the store migration keeps every record and every money number.
 *
 *   npm run prove-migration
 *
 * 1. Copies the local database (never touches the original).
 * 2. Reads the copy with the OLD money engine (src/lib/money.ts as of the last commit before the store).
 * 3. Runs `prisma migrate deploy` on the copy.
 * 4. Reads it again through the NEW code path (loadAll + computeLedger) and compares.
 *
 * It runs twice: once on the exact copy, and once on a copy with sample sales, a split and payouts
 * added first, so the comparison also covers orders in payback mode, discounts, tips and splits.
 */
import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const OLD_COMMIT = "3b183d0"; // last commit before the store
const root = path.resolve(import.meta.dirname, "..");
// Use PROOF_DB, else the snapshot taken just before the store migration (if it is still there), else the live local file.
const snapshot = path.join(root, "data", "peps.before-store-migration.db");
const source = process.env.PROOF_DB ?? (existsSync(snapshot) ? snapshot : path.join(root, "data", "peps.db"));
const work = path.join(tmpdir(), `labs-proof-${Date.now()}`);
mkdirSync(work, { recursive: true });

const isoOf = (v: unknown) => new Date(v as string | number).toISOString();

/** Read a database with raw SQL into the shape the old money engine expects. */
function readOld(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  const all = (t: string) => db.prepare(`select * from "${t}"`).all() as Record<string, unknown>[];
  const cols = (t: string) => new Set((db.prepare(`pragma table_info("${t}")`).all() as { name: string }[]).map((c) => c.name));
  const s = all("Settings")[0] ?? {};
  const lines = all("OrderLine");
  const items = all("SplitItem");
  const hasStatus = cols("Order").has("status");
  const data = {
    settings: {
      startingBalanceCents: (s.startingBalanceCents as number) ?? -130000,
      startDate: isoOf(s.startDate ?? 0),
      businessCutPercent: (s.businessCutPercent as number) ?? 10,
      partnerAName: (s.partnerAName as string) ?? "A",
      partnerBName: (s.partnerBName as string) ?? "B",
      partnerARatio: (s.partnerARatio as number) ?? 50,
      tipHandling: (s.tipHandling as string) ?? "profit",
      defaultSoldBy: (s.defaultSoldBy as string) ?? "A",
      lowStockThreshold: (s.lowStockThreshold as number) ?? 3,
      paymentMethods: [],
    },
    products: all("Product").map((p) => ({ ...p, archived: !!p.archived, createdAt: isoOf(p.createdAt) })),
    customers: [],
    purchases: all("Purchase").map((p) => ({ ...p, fromInvestment: !!p.fromInvestment, date: isoOf(p.date), createdAt: isoOf(p.createdAt) })),
    adjustments: all("StockAdjustment").map((a) => ({ ...a, date: isoOf(a.date), createdAt: isoOf(a.createdAt) })),
    orders: all("Order")
      .filter((o) => !hasStatus || (o.status !== "awaiting_payment" && o.status !== "canceled"))
      .map((o) => ({
        ...o,
        date: isoOf(o.date),
        createdAt: isoOf(o.createdAt),
        lines: lines.filter((l) => l.orderId === o.id).sort((a, b) => (a.sortOrder as number) - (b.sortOrder as number)),
      })),
    splits: all("Split").map((sp) => ({ ...sp, date: isoOf(sp.date), createdAt: isoOf(sp.createdAt), items: items.filter((i) => i.splitId === sp.id) })),
    payouts: all("Payout").map((p) => ({ ...p, date: isoOf(p.date), createdAt: isoOf(p.createdAt) })),
  };
  const counts = { products: data.products.length, orders: all("Order").length, orderLines: lines.length };
  db.close();
  return { data, counts };
}

type Summary = {
  businessMoney: number;
  pendingA: number;
  pendingB: number;
  earnedA: number;
  earnedB: number;
  paidA: number;
  paidB: number;
  stock: Record<string, number>;
  perOrder: Record<string, string>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summarize(ledger: any): Summary {
  const stock: Record<string, number> = {};
  for (const [id, st] of [...ledger.stock.entries()].sort()) stock[id] = st.stock;
  const perOrder: Record<string, string> = {};
  for (const [id, r] of [...ledger.orders.entries()].sort()) perOrder[id] = `${r.total}|${r.a}|${r.b}|${r.business}`;
  return {
    businessMoney: ledger.businessCents,
    pendingA: ledger.pendingA,
    pendingB: ledger.pendingB,
    earnedA: ledger.earnedA,
    earnedB: ledger.earnedB,
    paidA: ledger.paidA,
    paidB: ledger.paidB,
    stock,
    perOrder,
  };
}

const money = (c: number) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toFixed(2)}`;

/** Sample sales on the OLD schema, so the proof covers real money paths. */
function seedLegacySales(file: string) {
  const db = new DatabaseSync(file);
  const products = db.prepare(`select id, name, defaultPriceCents from "Product" order by sortOrder limit 4`).all() as { id: string; name: string; defaultPriceCents: number }[];
  if (products.length === 0) {
    db.close();
    return 0;
  }
  const hasCustomer = (db.prepare(`pragma table_info("Order")`).all() as { name: string }[]).some((c) => c.name === "customerId");
  const t0 = Date.UTC(2026, 9, 1, 15);
  const day = 86400000;
  const insOrder = db.prepare(
    `insert into "Order" (id, date, customer, note, soldBy, discountType, discountValue, tipCents, createdAt) values (?,?,?,?,?,?,?,?,?)`,
  );
  const insLine = db.prepare(
    `insert into "OrderLine" (id, orderId, productId, productName, quantity, unitPriceCents, unitCostCents, cutPercent, sortOrder) values (?,?,?,?,?,?,?,?,?)`,
  );
  const names = ["Mike", "mike ", "Sara", "", "Dana", "Sara"];
  let n = 0;
  for (let i = 0; i < 14; i++) {
    const id = `proof-o${i}`;
    const date = t0 + i * day;
    insOrder.run(id, date, names[i % names.length], i % 5 === 0 ? "proof" : "", i % 2 ? "A" : "B", i % 3 === 0 ? "%" : "$", i % 3 === 0 ? 10 : i % 4 === 0 ? 500 : 0, i % 4 === 1 ? 700 : 0, date);
    const k = 1 + (i % 3);
    for (let l = 0; l < k; l++) {
      const p = products[(i + l) % products.length];
      const price = p.defaultPriceCents || 5000 + l * 1000;
      insLine.run(`${id}-l${l}`, id, p.id, p.name, 1 + ((i + l) % 3), price, Math.round(price * 0.35), 10, l);
    }
    n++;
  }
  // A manual payout before any split
  db.prepare(`insert into "Payout" (id, date, person, amountCents, note, splitId, createdAt) values (?,?,?,?,?,?,?)`).run("proof-pay1", t0 + 6 * day, "A", 2500, "proof", null, t0 + 6 * day);
  db.close();
  void hasCustomer;
  return n;
}

/** Confirm a split on the old schema using the old engine's own plan (what the app does). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function seedLegacySplit(file: string, oldMoney: any) {
  const { data } = readOld(file);
  // Only the first 9 orders are split, the rest stay pending.
  const cut = { ...data, orders: data.orders.filter((o) => Number(String((o as { id?: unknown }).id).replace("proof-o", "")) < 9) };
  const plan = oldMoney.planSplit(cut, oldMoney.computeLedger(cut));
  if (plan.items.length === 0) return;
  const db = new DatabaseSync(file);
  const at = Date.UTC(2026, 9, 10, 20);
  db.prepare(`insert into "Split" (id, date, note, partnerACents, partnerBCents, businessCents, createdAt) values (?,?,?,?,?,?,?)`).run("proof-s1", at, "proof", plan.partnerACents, plan.partnerBCents, plan.businessCents, at);
  const ins = db.prepare(`insert into "SplitItem" (id, splitId, orderId, partnerACents, partnerBCents, businessCents) values (?,?,?,?,?,?)`);
  plan.items.forEach((it: { orderId: string | null; partnerACents: number; partnerBCents: number; businessCents: number }, i: number) =>
    ins.run(`proof-si${i}`, "proof-s1", it.orderId, it.partnerACents, it.partnerBCents, it.businessCents),
  );
  const pay = db.prepare(`insert into "Payout" (id, date, person, amountCents, note, splitId, createdAt) values (?,?,?,?,?,?,?)`);
  if (plan.partnerACents) pay.run("proof-pa", at, "A", plan.partnerACents, "From split", "proof-s1", at);
  if (plan.partnerBCents) pay.run("proof-pb", at, "B", plan.partnerBCents, "From split", "proof-s1", at);
  db.close();
}

async function main() {
  if (!existsSync(source)) {
    console.error(`No local database at ${source}. Nothing to prove.`);
    process.exit(1);
  }
  // The old money engine, straight from git.
  const oldFile = path.join(work, "money-old.ts");
  writeFileSync(oldFile, execSync(`git show ${OLD_COMMIT}:src/lib/money.ts`, { cwd: root }));
  const oldMoney = await import(pathToFileURL(oldFile).href);

  let failed = false;
  const runs: { label: string; file: string; seed: boolean }[] = [
    { label: `A. Exact copy of ${path.relative(root, source)}`, file: path.join(work, "copy-a.db"), seed: false },
    { label: `B. Copy of ${path.relative(root, source)} + sample sales, a split and payouts added before migrating`, file: path.join(work, "copy-b.db"), seed: true },
  ];

  for (const run of runs) {
    copyFileSync(source, run.file);
    if (run.seed) {
      seedLegacySales(run.file);
      seedLegacySplit(run.file, oldMoney);
    }
    const before = readOld(run.file);
    const b = summarize(oldMoney.computeLedger(before.data));

    const url = `file:${run.file.replace(/\\/g, "/")}`;
    execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
    });

    // New code path, in a child process so each run gets its own Prisma client.
    const out = execFileSync(process.execPath, ["--import", "tsx", path.join(root, "scripts", "proof-read.ts")], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: url },
      encoding: "utf8",
    });
    const after = JSON.parse(out) as { counts: typeof before.counts & { listings: number; numbered: number; firstNumber: number | null; lastNumber: number | null }; summary: Summary };
    const a = after.summary;

    console.log(`\n=== ${run.label}`);
    console.log("                       before      after");
    const row = (name: string, x: number | string, y: number | string) => {
      const ok = x === y;
      if (!ok) failed = true;
      console.log(`${name.padEnd(20)} ${String(x).padStart(10)} ${String(y).padStart(10)}   ${ok ? "identical" : "DIFFERENT"}`);
    };
    row("Products", before.counts.products, after.counts.products);
    row("Orders", before.counts.orders, after.counts.orders);
    row("Order lines", before.counts.orderLines, after.counts.orderLines);
    row("Business money", money(b.businessMoney), money(a.businessMoney));
    row("Pending split A", money(b.pendingA), money(a.pendingA));
    row("Pending split B", money(b.pendingB), money(a.pendingB));
    row("Partner A earned", money(b.earnedA), money(a.earnedA));
    row("Partner B earned", money(b.earnedB), money(a.earnedB));
    row("Partner A paid", money(b.paidA), money(a.paidA));
    row("Partner B paid", money(b.paidB), money(a.paidB));
    row("Stock per product", JSON.stringify(b.stock) === JSON.stringify(a.stock) ? "same" : "x", "same");
    row("Every order (total/A/B/business)", JSON.stringify(b.perOrder) === JSON.stringify(a.perOrder) ? "same" : "x", "same");
    console.log(
      `New data: ${after.counts.listings} parent products (one per existing product), ${after.counts.numbered} orders numbered` +
        (after.counts.firstNumber ? ` ${after.counts.firstNumber} to ${after.counts.lastNumber} in date order.` : "."),
    );
  }

  rmSync(work, { recursive: true, force: true });
  console.log(failed ? "\nFAILED: something changed." : "\nPASSED: counts and every money number are identical before and after.");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
