import type { Prisma } from "@prisma/client";
import type {
  AdjustmentRec,
  AppData,
  OrderRec,
  PayoutRec,
  ProductRec,
  PurchaseRec,
  SettingsRec,
  SplitRec,
} from "./types";
import { prisma } from "./db";

const iso = (d: Date) => d.toISOString();

export async function getSettingsRow() {
  return prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export function toSettings(s: Awaited<ReturnType<typeof getSettingsRow>>): SettingsRec {
  return {
    startingBalanceCents: s.startingBalanceCents,
    startDate: iso(s.startDate),
    businessCutPercent: s.businessCutPercent,
    partnerAName: s.partnerAName,
    partnerBName: s.partnerBName,
    partnerARatio: s.partnerARatio,
    tipHandling: s.tipHandling as SettingsRec["tipHandling"],
    defaultSoldBy: s.defaultSoldBy as SettingsRec["defaultSoldBy"],
    lowStockThreshold: s.lowStockThreshold,
  };
}

type OrderWithLines = Prisma.OrderGetPayload<{ include: { lines: true } }>;
type SplitWithItems = Prisma.SplitGetPayload<{ include: { items: true } }>;

export async function loadAll(): Promise<AppData> {
  const [settings, products, purchases, adjustments, orders, splits, payouts] = await Promise.all([
    getSettingsRow(),
    prisma.product.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.purchase.findMany({ orderBy: { date: "desc" } }),
    prisma.stockAdjustment.findMany({ orderBy: { date: "desc" } }),
    prisma.order.findMany({ orderBy: { date: "desc" }, include: { lines: { orderBy: { sortOrder: "asc" } } } }),
    prisma.split.findMany({ orderBy: { date: "desc" }, include: { items: true } }),
    prisma.payout.findMany({ orderBy: { date: "desc" } }),
  ]);
  return {
    settings: toSettings(settings),
    products: products.map(
      (p): ProductRec => ({ ...p, createdAt: iso(p.createdAt) }),
    ),
    purchases: purchases.map((p): PurchaseRec => ({ ...p, date: iso(p.date), createdAt: iso(p.createdAt) })),
    adjustments: adjustments.map(
      (a): AdjustmentRec => ({
        ...a,
        reason: a.reason as AdjustmentRec["reason"],
        date: iso(a.date),
        createdAt: iso(a.createdAt),
      }),
    ),
    orders: orders.map(
      (o: OrderWithLines): OrderRec => ({
        ...o,
        soldBy: o.soldBy as OrderRec["soldBy"],
        discountType: o.discountType as OrderRec["discountType"],
        date: iso(o.date),
        createdAt: iso(o.createdAt),
      }),
    ),
    splits: splits.map(
      (s: SplitWithItems): SplitRec => ({ ...s, date: iso(s.date), createdAt: iso(s.createdAt) }),
    ),
    payouts: payouts.map(
      (p): PayoutRec => ({
        ...p,
        person: p.person as PayoutRec["person"],
        date: iso(p.date),
        createdAt: iso(p.createdAt),
      }),
    ),
  };
}
