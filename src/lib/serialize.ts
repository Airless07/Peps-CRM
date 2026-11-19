import type { Prisma } from "@prisma/client";
import type {
  Address,
  AdjustmentRec,
  AppData,
  CoaRec,
  CustomerRec,
  GroupRec,
  LabelRec,
  ListingRec,
  MessageRec,
  OrderEventRec,
  OrderRec,
  PayoutRec,
  PhotoRec,
  ProductRec,
  PromoSnapshot,
  PromotionRec,
  PurchaseRec,
  QtyDeal,
  ReviewRec,
  SavedLineRec,
  SavedOrderRec,
  SettingsRec,
  SplitRec,
} from "./types";
import { countsInMoney } from "./types";
import { prisma } from "./db";
import { cleanPaymentMethods, type BackupData } from "./backup";
import { parseContent, parseStore } from "./store/config";
import { cleanSellButtons } from "./sell-buttons";

const iso = (d: Date) => d.toISOString();
const isoN = (d: Date | null) => (d ? d.toISOString() : null);

export function json<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    const v = JSON.parse(s);
    return v === null || v === undefined ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

export async function getSettingsRow() {
  return prisma.settings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}
export type SettingsRow = Awaited<ReturnType<typeof getSettingsRow>>;

export function toSettings(s: SettingsRow): SettingsRec {
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
    paymentMethods: cleanPaymentMethods(s.paymentMethods),
    sellButtons: cleanSellButtons(s.sellButtonsJson),
  };
}

type SavedOrderRow = Prisma.SavedOrderGetPayload<object>;
export function toSavedOrder(o: SavedOrderRow): SavedOrderRec {
  return {
    id: o.id,
    savedAt: iso(o.savedAt),
    customer: o.customer,
    customerId: o.customerId,
    paymentMethod: o.paymentMethod,
    note: o.note,
    soldBy: o.soldBy as SavedOrderRec["soldBy"],
    discountType: o.discountType as SavedOrderRec["discountType"],
    discountValue: o.discountValue,
    tipCents: o.tipCents,
    lines: json<SavedLineRec[]>(o.linesJson, []),
  };
}

type OrderWithLines = Prisma.OrderGetPayload<{ include: { lines: true } }>;
type LineRow = OrderWithLines["lines"][number] & { product?: { variantLabel: string } | null };
/** Include for order lines that also loads each product's current size (shown next to the name). */
export const LINE_SIZE = { orderBy: { sortOrder: "asc" as const }, include: { product: { select: { variantLabel: true } } } };
type SplitWithItems = Prisma.SplitGetPayload<{ include: { items: true } }>;
type ListingRow = Prisma.ListingGetPayload<object>;
type PromotionRow = Prisma.PromotionGetPayload<{ include: { uses: true } }>;

export function toOrder(o: OrderWithLines): OrderRec {
  const online = o.source === "online";
  return {
    id: o.id,
    date: iso(o.date),
    customer: o.customer,
    customerId: o.customerId,
    paymentMethod: o.paymentMethod,
    note: o.note,
    soldBy: o.soldBy as OrderRec["soldBy"],
    discountType: o.discountType as OrderRec["discountType"],
    discountValue: o.discountValue,
    tipCents: o.tipCents,
    createdAt: iso(o.createdAt),
    // When the query included the product's size (LINE_SIZE), each line carries it for display.
    lines: [...(o.lines as LineRow[])].sort((a, b) => a.sortOrder - b.sortOrder).map(({ product, ...l }) => (product?.variantLabel.trim() ? { ...l, size: product.variantLabel.trim() } : l)),
    number: o.number,
    source: online ? "online" : "inperson",
    status: o.status as OrderRec["status"],
    archived: o.archived,
    shippingCents: o.shippingCents,
    adminNote: o.adminNote,
    web: online
      ? {
          email: o.email,
          phone: o.phone,
          shipTo: json<Address | null>(o.shipToJson, null),
          shippingMethod: o.shippingMethod,
          shippingRate: json<{ carrier: string; service: string; cents: number } | null>(o.shippingRateJson, null),
          promo: json<PromoSnapshot | null>(o.promoJson, null),
          payChoice: o.payChoice,
          shippingTier: o.shippingTier,
          token: o.token,
          hasScreenshot: !!o.screenshotFile,
          cancelReason: o.cancelReason,
          placedAt: isoN(o.placedAt),
          expiresAt: isoN(o.expiresAt),
          paidAt: isoN(o.paidAt),
          shippedAt: isoN(o.shippedAt),
          deliveredAt: isoN(o.deliveredAt),
          canceledAt: isoN(o.canceledAt),
          reminderSentAt: isoN(o.reminderSentAt),
          trackingNumber: o.trackingNumber,
          trackingCarrier: o.trackingCarrier,
          trackingStatus: o.trackingStatus,
          labelUrl: o.labelUrl,
        }
      : null,
  };
}

export function toListing(l: ListingRow): ListingRec {
  return {
    id: l.id,
    name: l.name,
    slug: l.slug,
    summary: l.summary,
    description: l.description,
    casNumber: l.casNumber,
    formula: l.formula,
    molecularWeight: l.molecularWeight,
    purity: l.purity,
    form: l.form,
    storage: l.storage,
    showOnWebsite: l.showOnWebsite,
    photos: json<PhotoRec[]>(l.photosJson, []),
    hoverGif: l.hoverGif,
    groupIds: json<string[]>(l.groupsJson, []),
    badges: json<string[]>(l.badgesJson, []),
    bestSeller: l.bestSeller,
    qtyDeals: l.qtyDealsJson ? json<QtyDeal[] | null>(l.qtyDealsJson, null) : null,
    sortOrder: l.sortOrder,
    seoTitle: l.seoTitle,
    seoDescription: l.seoDescription,
    createdAt: iso(l.createdAt),
  };
}

export function toPromotion(p: PromotionRow): PromotionRec {
  return {
    id: p.id,
    kind: p.kind as PromotionRec["kind"],
    name: p.name,
    code: p.code,
    discountType: p.discountType as PromotionRec["discountType"],
    discountValue: p.discountValue,
    minSubtotalCents: p.minSubtotalCents,
    startsAt: isoN(p.startsAt),
    endsAt: isoN(p.endsAt),
    maxUses: p.maxUses,
    oncePerEmail: p.oncePerEmail,
    listingIds: json<string[]>(p.listingIdsJson, []),
    groupIds: json<string[]>(p.groupIdsJson, []),
    shippingTiers: json<PromotionRec["shippingTiers"]>(p.shippingTiersJson, []).filter((t) => t === "standard" || t === "priority" || t === "express"),
    active: p.active,
    createdAt: iso(p.createdAt),
    uses: p.uses.map((u) => ({ id: u.id, promotionId: u.promotionId, orderId: u.orderId, email: u.email, createdAt: iso(u.createdAt) })),
  };
}

type CustomerRow = Prisma.CustomerGetPayload<object>;
/** Never includes the password hash or reset token. */
export function toCustomer(c: CustomerRow): CustomerRec {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    notes: c.notes,
    createdAt: iso(c.createdAt),
    hasAccount: !!c.passwordHash,
    addresses: json<Address[]>(c.addressesJson, []),
  };
}

export async function loadAll(): Promise<AppData> {
  const [settings, products, customers, purchases, adjustments, orders, splits, payouts, labels, listings, groups, coas, promotions, reviews, messages, savedOrders] =
    await Promise.all([
      getSettingsRow(),
      prisma.product.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
      prisma.customer.findMany({ orderBy: { name: "asc" } }),
      prisma.purchase.findMany({ orderBy: { date: "desc" } }),
      prisma.stockAdjustment.findMany({ orderBy: { date: "desc" } }),
      prisma.order.findMany({ orderBy: { date: "desc" }, include: { lines: LINE_SIZE } }),
      prisma.split.findMany({ orderBy: { date: "desc" }, include: { items: true } }),
      prisma.payout.findMany({ orderBy: { date: "desc" } }),
      prisma.labelPurchase.findMany({ orderBy: { date: "desc" } }),
      prisma.listing.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
      prisma.productGroup.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
      prisma.coa.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.promotion.findMany({ orderBy: { createdAt: "desc" }, include: { uses: true } }),
      prisma.review.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.contactMessage.findMany({ orderBy: { createdAt: "desc" } }),
      prisma.savedOrder.findMany({ orderBy: { savedAt: "desc" } }),
    ]);
  const allOrders = orders.map(toOrder);
  const backfill = await prisma.dataMigration.findUnique({ where: { id: "sizes-from-names" } }).catch(() => null);
  return {
    settings: toSettings(settings),
    products: products.map((p): ProductRec => ({ ...p, testingStatus: p.testingStatus as ProductRec["testingStatus"], createdAt: iso(p.createdAt) })),
    customers: customers.map(toCustomer),
    purchases: purchases.map((p): PurchaseRec => ({ ...p, date: iso(p.date), createdAt: iso(p.createdAt) })),
    adjustments: adjustments.map(
      (a): AdjustmentRec => ({
        ...a,
        reason: a.reason as AdjustmentRec["reason"],
        date: iso(a.date),
        createdAt: iso(a.createdAt),
      }),
    ),
    orders: allOrders.filter((o) => countsInMoney(o.status)),
    pendingOrders: allOrders.filter((o) => !countsInMoney(o.status)),
    splits: splits.map((s: SplitWithItems): SplitRec => ({ ...s, date: iso(s.date), createdAt: iso(s.createdAt) })),
    payouts: payouts.map(
      (p): PayoutRec => ({
        ...p,
        person: p.person as PayoutRec["person"],
        date: iso(p.date),
        createdAt: iso(p.createdAt),
      }),
    ),
    labels: labels.map((l): LabelRec => ({ ...l, date: iso(l.date), createdAt: iso(l.createdAt) })),
    listings: listings.map(toListing),
    groups: groups.map((g): GroupRec => ({ ...g, createdAt: iso(g.createdAt) })),
    coas: coas.map((c): CoaRec => ({ ...c, testDate: isoN(c.testDate), createdAt: iso(c.createdAt) })),
    promotions: promotions.map(toPromotion),
    reviews: reviews.map((r): ReviewRec => ({ ...r, status: r.status as ReviewRec["status"], createdAt: iso(r.createdAt) })),
    messages: messages.map((m): MessageRec => ({ ...m, createdAt: iso(m.createdAt) })),
    savedOrders: savedOrders.map(toSavedOrder),
    store: parseStore(settings.storeJson),
    content: parseContent(settings.contentJson),
    sizeBackfill: backfill ? { ranAt: iso(backfill.ranAt), items: json<{ productId: string; product: string; size: string }[]>(backfill.detail, []) } : null,
  };
}

/** Everything, for the JSON backup. Adds what the screens don't need: order timelines and private file names. */
export async function loadBackup(): Promise<
  BackupData & { orderFiles: { id: string; screenshotFile: string; reviewToken: string | null }[]; accounts: { id: string; passwordHash: string | null }[] }
> {
  const [data, events, files, accounts] = await Promise.all([
    loadAll(),
    prisma.orderEvent.findMany({ orderBy: { at: "asc" } }),
    prisma.order.findMany({ where: { OR: [{ screenshotFile: { not: "" } }, { reviewToken: { not: null } }] }, select: { id: true, screenshotFile: true, reviewToken: true } }),
    prisma.customer.findMany({ where: { passwordHash: { not: null } }, select: { id: true, passwordHash: true } }),
  ]);
  return {
    ...data,
    events: events.map((e): OrderEventRec => ({ ...e, kind: e.kind as OrderEventRec["kind"], at: iso(e.at) })),
    orderFiles: files,
    accounts,
  };
}
