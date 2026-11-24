import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import type { AppData, OrderRec } from "./types";
import { normalizeBackup } from "./backup";
import { DEFAULT_SETTINGS } from "./types";

type Tx = Prisma.TransactionClient;

export async function wipe(tx: Tx) {
  await tx.creditEntry.deleteMany();
  await tx.payout.deleteMany();
  await tx.splitItem.deleteMany();
  await tx.split.deleteMany();
  await tx.reviewPhoto.deleteMany();
  await tx.review.deleteMany();
  await tx.promotionUse.deleteMany();
  await tx.promotion.deleteMany();
  await tx.orderEvent.deleteMany();
  await tx.labelPurchase.deleteMany();
  await tx.orderLine.deleteMany();
  await tx.order.deleteMany();
  await tx.customer.deleteMany();
  await tx.coa.deleteMany();
  await tx.stockAdjustment.deleteMany();
  await tx.purchase.deleteMany();
  await tx.product.deleteMany();
  await tx.listing.deleteMany();
  await tx.productGroup.deleteMany();
  await tx.contactMessage.deleteMany();
  await tx.savedOrder.deleteMany();
  await tx.cashHandoff.deleteMany();
}

const d = (s: string) => new Date(s);
const dn = (s: string | null | undefined) => (s ? new Date(s) : null);
const j = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v));

function orderRow(o: OrderRec, files: Map<string, { screenshotFile: string; reviewToken: string | null }>) {
  const { lines: _l, web, localSpot, readyAt, consent, localSwitch, ...rest } = o;
  const f = files.get(o.id);
  return {
    ...rest,
    date: d(o.date),
    createdAt: d(o.createdAt),
    email: web?.email ?? "",
    phone: web?.phone ?? "",
    shipToJson: j(web?.shipTo),
    shippingMethod: web?.shippingMethod ?? "",
    shippingRateJson: j(web?.shippingRate),
    promoJson: j(web?.promo),
    payChoice: web?.payChoice ?? "",
    shippingTier: web?.shippingTier ?? "",
    token: web?.token ?? null,
    reviewToken: f?.reviewToken ?? null,
    screenshotFile: f?.screenshotFile ?? "",
    cancelReason: web?.cancelReason ?? "",
    placedAt: dn(web?.placedAt),
    expiresAt: dn(web?.expiresAt),
    paidAt: dn(web?.paidAt),
    shippedAt: dn(web?.shippedAt),
    deliveredAt: dn(web?.deliveredAt),
    canceledAt: dn(web?.canceledAt),
    reminderSentAt: dn(web?.reminderSentAt),
    reviewRequestSentAt: dn(web?.reviewRequestSentAt ?? null),
    localJson: localSpot ? JSON.stringify(localSpot) : "",
    readyAt: dn(readyAt ?? null),
    localSwitchJson: localSwitch ? JSON.stringify(localSwitch) : "",
    consentAt: dn(consent?.at ?? null),
    consentText: consent?.text ?? "",
    consentIp: consent?.ip ?? "",
    trackingNumber: web?.trackingNumber ?? "",
    trackingCarrier: web?.trackingCarrier ?? "",
    trackingStatus: web?.trackingStatus ?? "",
    labelUrl: web?.labelUrl ?? "",
  };
}

/**
 * Replace everything with a backup. The login password is kept as-is.
 * Accepts old backups too (see normalizeBackup). Uploaded files (photos, COAs, screenshots)
 * live on disk and are not part of the JSON file.
 */
export async function restore(input: AppData | Parameters<typeof normalizeBackup>[0]) {
  const raw = input as Parameters<typeof normalizeBackup>[0] & {
    orderFiles?: { id: string; screenshotFile: string; reviewToken: string | null }[];
    accounts?: { id: string; passwordHash: string | null }[];
  };
  const hashes = new Map((Array.isArray(raw.accounts) ? raw.accounts : []).map((a) => [a.id, a.passwordHash]));
  const data = normalizeBackup(raw);
  const files = new Map((Array.isArray(raw.orderFiles) ? raw.orderFiles : []).map((f) => [f.id, f]));
  const orders = [...data.orders, ...data.pendingOrders];
  const orderIds = new Set(orders.map((o) => o.id));
  const productIds = new Set(data.products.map((p) => p.id));
  await prisma.$transaction(
    async (tx) => {
      await wipe(tx);
      const { sellButtons, ...s } = { ...DEFAULT_SETTINGS, ...data.settings };
      const row = {
        ...s,
        sellButtonsJson: JSON.stringify(sellButtons),
        startDate: d(s.startDate),
        paymentMethods: JSON.stringify(s.paymentMethods),
        storeJson: JSON.stringify(data.store),
        contentJson: JSON.stringify(data.content),
      };
      await tx.settings.upsert({ where: { id: 1 }, update: row, create: { id: 1, ...row } });
      await tx.productGroup.createMany({ data: data.groups.map((g) => ({ ...g, createdAt: d(g.createdAt) })) });
      await tx.listing.createMany({
        data: data.listings.map(({ photos, groupIds, badges, qtyDeals, ...l }) => ({
          ...l,
          photosJson: JSON.stringify(photos ?? []),
          groupsJson: JSON.stringify(groupIds ?? []),
          badgesJson: JSON.stringify(badges ?? []),
          qtyDealsJson: qtyDeals ? JSON.stringify(qtyDeals) : "",
          createdAt: d(l.createdAt),
        })),
      });
      await tx.product.createMany({ data: data.products.map((p) => ({ ...p, createdAt: d(p.createdAt) })) });
      await tx.coa.createMany({
        data: data.coas.filter((c) => productIds.has(c.productId)).map((c) => ({ ...c, testDate: dn(c.testDate), createdAt: d(c.createdAt) })),
      });
      await tx.customer.createMany({
        data: data.customers.map(({ hasAccount: _h, accountStatus: _s, invite: _i, addresses, lastLoginAt, referralCode, ...c }) => ({
          ...c,
          lastLoginAt: dn(lastLoginAt),
          // Empty = none yet (a new one is given on the next load). Codes are unique, so never store "".
          referralCode: referralCode || null,
          createdAt: d(c.createdAt),
          addressesJson: JSON.stringify(addresses ?? []),
          passwordHash: hashes.get(c.id) ?? null,
        })),
      });
      await tx.purchase.createMany({
        data: data.purchases.map((p) => ({ ...p, date: d(p.date), createdAt: d(p.createdAt) })),
      });
      await tx.stockAdjustment.createMany({
        data: data.adjustments.map((a) => ({ ...a, date: d(a.date), createdAt: d(a.createdAt) })),
      });
      await tx.order.createMany({ data: orders.map((o) => orderRow(o, files)) });
      // `size` is display-only (the product's current size), not a column.
      await tx.orderLine.createMany({ data: orders.flatMap((o) => o.lines.map(({ size: _s, ...l }) => l)) });
      await tx.orderEvent.createMany({ data: data.events.filter((e) => orderIds.has(e.orderId)).map((e) => ({ ...e, at: d(e.at) })) });
      await tx.labelPurchase.createMany({
        data: data.labels.map((l) => ({ ...l, orderId: l.orderId && orderIds.has(l.orderId) ? l.orderId : null, date: d(l.date), createdAt: d(l.createdAt) })),
      });
      await tx.promotion.createMany({
        data: data.promotions.map(({ uses: _u, listingIds, groupIds, shippingTiers, bogo, ...p }) => ({
          ...p,
          bogoJson: p.kind === "bogo" && bogo ? JSON.stringify(bogo) : "",
          listingIdsJson: JSON.stringify(listingIds ?? []),
          groupIdsJson: JSON.stringify(groupIds ?? []),
          // Backups from before shipping options per rule: the rule covered Standard.
          shippingTiersJson: JSON.stringify(shippingTiers ?? (p.kind === "free_shipping" ? ["standard"] : [])),
          startsAt: dn(p.startsAt),
          endsAt: dn(p.endsAt),
          createdAt: d(p.createdAt),
        })),
      });
      await tx.promotionUse.createMany({ data: data.promotions.flatMap((p) => p.uses.map((u) => ({ ...u, createdAt: d(u.createdAt) }))) });
      await tx.review.createMany({
        // Older backups have no "verified": every review then came from the order email link.
        data: data.reviews.map(({ photos: _p, ...r }) => ({ ...r, verified: r.verified ?? !!r.orderId, orderId: r.orderId && orderIds.has(r.orderId) ? r.orderId : null, createdAt: d(r.createdAt) })),
      });
      // Backups from before review photos have none. The photo files themselves are not part of a backup.
      await tx.reviewPhoto.createMany({
        data: data.reviews.flatMap((r) => (r.photos ?? []).map((p) => ({ ...p, reviewId: r.id, createdAt: d(p.createdAt) }))),
      });
      await tx.contactMessage.createMany({ data: data.messages.map((m) => ({ ...m, createdAt: d(m.createdAt) })) });
      await tx.savedOrder.createMany({
        data: data.savedOrders.map(({ lines, ...s }) => ({ ...s, savedAt: d(s.savedAt), linesJson: JSON.stringify(lines) })),
      });
      await tx.cashHandoff.createMany({
        data: (data.cashHandoffs ?? []).map(({ from, to, ...h }) => ({ ...h, fromHolder: from, toHolder: to, date: d(h.date), createdAt: d(h.createdAt) })),
      });
      await tx.creditEntry.createMany({
        data: (data.creditEntries ?? []).map((e) => ({ ...e, date: d(e.date), createdAt: d(e.createdAt) })),
      });
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

/** Danger zone: wipes sales data. Store settings and site content are kept. */
export async function resetAll() {
  await prisma.$transaction(async (tx) => {
    await wipe(tx);
    const { startDate: _s, paymentMethods, sellButtons, ...rest } = DEFAULT_SETTINGS;
    const defaults = { ...rest, paymentMethods: JSON.stringify(paymentMethods), sellButtonsJson: JSON.stringify(sellButtons) };
    await tx.settings.upsert({
      where: { id: 1 },
      update: { ...defaults, startDate: new Date() },
      create: { id: 1, ...defaults, startDate: new Date() },
    });
  });
}
