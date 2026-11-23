// Prints the Money page headline numbers, cash held and stock counts for the database in DATABASE_URL.
// Usage: DATABASE_URL=file:/abs/path.db npx tsx scripts/money-report.ts [--remove-test-order]
import { loadAll } from "../src/lib/serialize";
import { computeLedger } from "../src/lib/money";
import { cashPosition } from "../src/lib/cash";
import { prisma } from "../src/lib/db";

async function report() {
  const data = await loadAll();
  const l = computeLedger(data);
  const cash = cashPosition(data, l);
  let revenue = 0, profit = 0, counted = 0;
  for (const r of l.orders.values()) {
    counted++;
    revenue += r.revenue ?? 0;
    profit += r.profit ?? 0;
  }
  const outstanding = (data.creditEntries ?? []).reduce((x, e) => x + e.amountCents, 0);
  const stock = Object.fromEntries(data.products.map((p) => [p.name, l.stock.get(p.id)?.stock ?? 0]));
  return {
    orders: data.orders.length + ((data as { pendingOrders?: unknown[] }).pendingOrders?.length ?? 0),
    countedOrders: counted,
    businessCents: l.businessCents,
    leftToBreakEven: l.leftToBreakEven,
    pendingA: l.pendingA, pendingB: l.pendingB, earnedA: l.earnedA, earnedB: l.earnedB, paidA: l.paidA, paidB: l.paidB,
    shippingCollected: l.shippingCollected,
    labelCosts: l.labelCosts,
    revenue, profit,
    cashA: cash.A, cashB: cash.B, cashBank: cash.bank,
    storeCreditOutstanding: outstanding,
    stock,
  };
}

async function main() {
const before = await report();
console.log("BEFORE", JSON.stringify(before, null, 1));
if (process.argv.includes("--remove-test-order")) {
  const { removeTestOrder } = await import("../src/lib/data-migrations");
  console.log("removeTestOrder:", await removeTestOrder());
  const after = await report();
  console.log("AFTER", JSON.stringify(after, null, 1));
  const diff: Record<string, unknown> = {};
  for (const k of Object.keys(before) as (keyof typeof before)[]) {
    if (k === "stock") {
      for (const [p, v] of Object.entries(before.stock)) if (after.stock[p] !== v) diff[`stock:${p}`] = [v, after.stock[p]];
    } else if (before[k] !== after[k]) diff[k] = [before[k], after[k]];
  }
  console.log("CHANGED", JSON.stringify(diff));
}
await prisma.$disconnect();
}
main();
