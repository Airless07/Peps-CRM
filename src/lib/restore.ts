import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { AppData } from "./types";
import { normalizeBackup } from "./backup";
import { DEFAULT_SETTINGS } from "./types";

type Tx = Prisma.TransactionClient;

export async function wipe(tx: Tx) {
  await tx.payout.deleteMany();
  await tx.splitItem.deleteMany();
  await tx.split.deleteMany();
  await tx.orderLine.deleteMany();
  await tx.order.deleteMany();
  await tx.customer.deleteMany();
  await tx.stockAdjustment.deleteMany();
  await tx.purchase.deleteMany();
  await tx.product.deleteMany();
}

const d = (s: string) => new Date(s);

/**
 * Replace everything with a backup. The login password is kept as-is.
 * Accepts old backups too (see normalizeBackup).
 */
export async function restore(input: AppData | Parameters<typeof normalizeBackup>[0]) {
  const data = normalizeBackup(input as Parameters<typeof normalizeBackup>[0]);
  await prisma.$transaction(
    async (tx) => {
      await wipe(tx);
      const s = { ...DEFAULT_SETTINGS, ...data.settings };
      const row = { ...s, startDate: d(s.startDate), paymentMethods: JSON.stringify(s.paymentMethods) };
      await tx.settings.upsert({ where: { id: 1 }, update: row, create: { id: 1, ...row } });
      await tx.product.createMany({ data: data.products.map((p) => ({ ...p, createdAt: d(p.createdAt) })) });
      await tx.customer.createMany({ data: data.customers.map((c) => ({ ...c, createdAt: d(c.createdAt) })) });
      await tx.purchase.createMany({
        data: data.purchases.map((p) => ({ ...p, date: d(p.date), createdAt: d(p.createdAt) })),
      });
      await tx.stockAdjustment.createMany({
        data: data.adjustments.map((a) => ({ ...a, date: d(a.date), createdAt: d(a.createdAt) })),
      });
      await tx.order.createMany({
        data: data.orders.map(({ lines: _l, ...o }) => ({ ...o, date: d(o.date), createdAt: d(o.createdAt) })),
      });
      await tx.orderLine.createMany({ data: data.orders.flatMap((o) => o.lines) });
      await tx.split.createMany({
        data: data.splits.map(({ items: _i, ...s }) => ({ ...s, date: d(s.date), createdAt: d(s.createdAt) })),
      });
      await tx.splitItem.createMany({ data: data.splits.flatMap((s) => s.items) });
      await tx.payout.createMany({
        data: data.payouts.map((p) => ({ ...p, date: d(p.date), createdAt: d(p.createdAt) })),
      });
    },
    { timeout: 60_000 },
  );
}

export async function resetAll() {
  await prisma.$transaction(async (tx) => {
    await wipe(tx);
    const { startDate: _s, paymentMethods, ...rest } = DEFAULT_SETTINGS;
    const defaults = { ...rest, paymentMethods: JSON.stringify(paymentMethods) };
    await tx.settings.upsert({
      where: { id: 1 },
      update: { ...defaults, startDate: new Date() },
      create: { id: 1, ...defaults, startDate: new Date() },
    });
  });
}
