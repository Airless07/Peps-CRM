/**
 * Local testing only: adds 3 sample products with some stock.
 * Run manually with `npm run seed`. Never runs automatically (not in launch.bat, not on Railway).
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

if (process.env.NODE_ENV === "production" && process.env.ALLOW_SEED !== "yes") {
  console.error("Refusing to seed in production. This script is for local testing only.");
  process.exit(1);
}

const prisma = new PrismaClient();

const samples = [
  { name: "Sample Vial 5mg", price: 6000, qty: 10, cost: 25000, color: "indigo" },
  { name: "Sample Vial 10mg", price: 9000, qty: 8, cost: 32000, color: "teal" },
  { name: "Sample Vial Blend", price: 12000, qty: 5, cost: 30000, color: "pink" },
];

async function main() {
  await prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  const existing = await prisma.product.count();
  for (const [i, s] of samples.entries()) {
    const id = randomUUID();
    await prisma.product.create({
      data: { id, name: s.name, defaultPriceCents: s.price, color: s.color, sortOrder: existing + i },
    });
    await prisma.purchase.create({
      data: {
        id: randomUUID(),
        date: new Date(),
        productId: id,
        quantity: s.qty,
        totalCostCents: s.cost,
        note: "Seed data",
        fromInvestment: true,
      },
    });
  }
  console.log(`Seeded ${samples.length} sample products.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
