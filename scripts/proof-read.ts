// Helper for prove-migration.ts: reads the migrated copy through the real app code and prints a summary as JSON.
import { prisma } from "../src/lib/db";
import { computeLedger } from "../src/lib/money";
import { loadAll } from "../src/lib/serialize";

async function main() {
  const data = await loadAll();
  const ledger = computeLedger(data);
  const stock: Record<string, number> = {};
  for (const [id, st] of [...ledger.stock.entries()].sort()) stock[id] = st.stock;
  const perOrder: Record<string, string> = {};
  for (const [id, r] of [...ledger.orders.entries()].sort()) perOrder[id] = `${r.total}|${r.a}|${r.b}|${r.business}`;
  const numbers = (await prisma.order.findMany({ select: { number: true, date: true }, orderBy: { date: "asc" } })).map((o) => o.number);
  const inOrder = numbers.every((n, i) => n !== null && (i === 0 || n > (numbers[i - 1] ?? 0)));
  if (!inOrder) throw new Error("Order numbers are not in date order");
  console.log(
    JSON.stringify({
      counts: {
        products: await prisma.product.count(),
        orders: await prisma.order.count(),
        orderLines: await prisma.orderLine.count(),
        listings: await prisma.listing.count(),
        numbered: numbers.filter((n) => n !== null).length,
        firstNumber: numbers[0] ?? null,
        lastNumber: numbers[numbers.length - 1] ?? null,
      },
      summary: {
        businessMoney: ledger.businessCents,
        pendingA: ledger.pendingA,
        pendingB: ledger.pendingB,
        earnedA: ledger.earnedA,
        earnedB: ledger.earnedB,
        paidA: ledger.paidA,
        paidB: ledger.paidB,
        stock,
        perOrder,
      },
    }),
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
