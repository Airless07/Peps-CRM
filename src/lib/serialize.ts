import type { Prisma } from "@prisma/client";
import type {
  AccountStatus,
  Address,
  AdjustmentRec,
  AppData,
  BogoRule,
  CashHandoffRec,
  CoaRec,
  CreditEntryRec,
  CustomerRec,
  InviteStatus,
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
import { assignMissingReferralCodes } from "./referral-codes";

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

const partnerOrNull = (v: string | null | undefined) => (v === "A" || v === "B" ? v : null);

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
    owner: partnerOrNull(o.owner),
    cashTo: partnerOrNull(o.cashTo),
    storeCreditCents: o.storeCreditCents,
    referredById: o.referredById,
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
    owner: partnerOrNull(o.owner),
    cashTo: partnerOrNull(o.cashTo),
    storeCreditCents: o.storeCreditCents,
    referredById: o.referredById,
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
    bogo: p.kind === "bogo" ? cleanBogo(json<Partial<BogoRule> | null>(p.bogoJson, null)) : null,
    active: p.active,
    createdAt: iso(p.createdAt),
    uses: p.uses.map((u) => ({ id: u.id, promotionId: u.promotionId, orderId: u.orderId, email: u.email, createdAt: iso(u.createdAt) })),
  };
}

/** A BOGO rule from JSON, with every field present. */
export function cleanBogo(v: Partial<BogoRule> | null | undefined): BogoRule {
  const ids = (x: unknown) => (Array.isArray(x) ? x.filter((i): i is string => typeof i === "string") : []);
  const n = (x: unknown, d: number, lo: number, hi: number) => (typeof x === "number" && Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d);
  const buy = (v?.buy ?? {}) as Partial<BogoRule["buy"]>;
  const get = (v?.get ?? {}) as Partial<BogoRule["get"]>;
  return {
    buy: { listingIds: ids(buy.listingIds), variantIds: ids(buy.variantIds), qty: n(buy.qty, 1, 1, 99) },
    get: { same: get.same !== false, listingIds: ids(get.listingIds), variantIds: ids(get.variantIds), qty: n(get.qty, 1, 1, 99), percentOff: n(get.percentOff, 100, 1, 100) },
    online: v?.online !== false,
    inPerson: v?.inPerson !== false,
    noCodes: !!v?.noCodes,
  };
}

type CustomerRow = Prisma.CustomerGetPayload<object>;

/** Active = can sign in. Invited = has an email (a store account with no password yet). */
export const accountStatusOf = (c: Pick<CustomerRow, "passwordHash" | "email">): AccountStatus => (c.passwordHash ? "active" : c.email.trim() ? "invited" : "none");

/** Never includes the password hash, the reset token or the invite token. Every API that returns a customer goes through here. */
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
    accountStatus: accountStatusOf(c),
    lastLoginAt: isoN(c.lastLoginAt),
    mustChangePassword: c.mustChangePassword,
    referralCode: c.referralCode ?? "",
    referredById: c.referredById,
    invite: inviteStatusOf(c),
  };
}

/** Where the invite link stands. A link that is open now wins over an older claim (a new link was made). */
export function inviteStatusOf(c: Pick<CustomerRow, "inviteTokenHash" | "inviteExpiresAt" | "inviteCreatedAt" | "inviteClaimedAt" | "inviteClaimedEmail">, now = Date.now()): InviteStatus {
  const base = { createdAt: isoN(c.inviteCreatedAt), expiresAt: isoN(c.inviteExpiresAt), claimedAt: isoN(c.inviteClaimedAt), claimedEmail: c.inviteClaimedEmail };
  if (c.inviteTokenHash && c.inviteExpiresAt) return { ...base, state: c.inviteExpiresAt.getTime() < now ? "expired" : "open" };
  if (c.inviteClaimedAt) return { ...base, state: "claimed" };
  return { ...base, state: "none" };
}

export const toCreditEntry = (e: Prisma.CreditEntryGetPayload<object>): CreditEntryRec => ({
  id: e.id,
  customerId: e.customerId,
  date: iso(e.date),
  amountCents: e.amountCents,
  kind: e.kind as CreditEntryRec["kind"],
  reason: e.reason,
  orderId: e.orderId,
  orderNumber: e.orderNumber,
  by: e.by,
  shortfallCents: e.shortfallCents,
  createdAt: iso(e.createdAt),
});

const holder = (v: string): CashHandoffRec["from"] => (v === "A" || v === "B" ? v : "bank");
export const toHandoff = (h: Prisma.CashHandoffGetPayload<object>): CashHandoffRec => ({
  id: h.id,
  date: iso(h.date),
  from: holder(h.fromHolder),
  to: holder(h.toHolder),
  amountCents: h.amountCents,
  note: h.note,
  createdAt: iso(h.createdAt),
});

export async function loadAll(): Promise<AppData> {
  // Every customer has a referral code (older rows get theirs here, once).
  await assignMissingReferralCodes().catch((e) => console.error("[referral codes]", e));
  const [settings, products, customers, purchases, adjustments, orders, splits, payouts, labels, listings, groups, coas, promotions, reviews, messages, savedOrders, handoffs, credits] =
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
      prisma.cashHandoff.findMany({ orderBy: { date: "desc" } }),
      prisma.creditEntry.findMany({ orderBy: [{ date: "desc" }, { createdAt: "desc" }] }),
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
    cashHandoffs: handoffs.map(toHandoff),
    creditEntries: credits.map(toCreditEntry),
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
