// What a customer may see about their own order (status page, account page). No cost or admin data.
import { prisma } from "../db";
import { orderTotals } from "../money";
import { addressLines } from "../order-ops";
import { LINE_SIZE, toOrder } from "../serialize";
import { lineName } from "../size";
import { trackingUrl } from "../tracking";
import type { OrderStatus } from "../types";
import type { StoreSettings } from "./config";
import { payInstructions, payMethod } from "./payments";

export interface PublicOrder {
  token: string;
  number: number;
  status: OrderStatus;
  placedAt: string;
  expiresAt: string | null;
  lines: { name: string; quantity: number; unitCents: number; totalCents: number }[];
  subtotalCents: number;
  discountCents: number;
  discountLabels: string[];
  /** Store credit used. */
  creditCents: number;
  shippingCents: number;
  shippingMethod: string;
  totalCents: number;
  shipTo: string[];
  email: string;
  payMethodName: string;
  pay: { name: string; sendTo: string; note: string } | null;
  hasScreenshot: boolean;
  cancelReason: string;
  tracking: { number: string; carrier: string; url: string | null } | null;
  steps: { key: string; label: string; at: string | null; done: boolean; current: boolean }[];
  canReview: boolean;
}

const include = { lines: LINE_SIZE, review: true };

export function toPublicOrder(row: NonNullable<Awaited<ReturnType<typeof findRow>>>, store: StoreSettings): PublicOrder {
  const o = toOrder(row);
  const w = o.web!;
  const t = orderTotals(o);
  const s = o.status;
  const rank: Record<string, number> = { awaiting_payment: 0, paid: 1, label_purchased: 2, shipped: 3, delivered: 4 };
  const at = rank[s] ?? -1;
  const steps = [
    { key: "placed", label: "Order placed", at: w.placedAt ?? o.date, n: 0 },
    { key: "paid", label: "Payment confirmed", at: w.paidAt, n: 1 },
    { key: "shipped", label: "Shipped", at: w.shippedAt, n: 3 },
    { key: "delivered", label: "Delivered", at: w.deliveredAt, n: 4 },
  ].map((x) => ({ key: x.key, label: x.label, at: x.at, done: x.n === 0 || at >= x.n, current: (x.n === 1 && at === 0) || (x.n === 3 && (at === 1 || at === 2)) || (x.n === 4 && at === 3) }));
  return {
    token: w.token ?? "",
    number: o.number ?? 0,
    status: s,
    placedAt: w.placedAt ?? o.date,
    expiresAt: w.expiresAt,
    lines: o.lines.map((l) => ({ name: lineName(l), quantity: l.quantity, unitCents: l.unitPriceCents, totalCents: l.quantity * l.unitPriceCents })),
    subtotalCents: t.subtotal,
    discountCents: t.discount,
    creditCents: t.credit,
    discountLabels: w.promo?.labels.filter((x) => !/free shipping/i.test(x)) ?? [],
    shippingCents: t.shipping,
    shippingMethod: w.shippingMethod,
    totalCents: t.total,
    shipTo: addressLines(w.shipTo),
    email: w.email,
    payMethodName: payMethod(w.payChoice)?.name ?? o.paymentMethod,
    pay: s === "awaiting_payment" ? payInstructions(store, w.payChoice) : null,
    hasScreenshot: w.hasScreenshot,
    cancelReason: w.cancelReason,
    tracking: w.trackingNumber ? { number: w.trackingNumber, carrier: w.trackingCarrier, url: trackingUrl(w.trackingCarrier, w.trackingNumber) } : null,
    steps,
    canReview: s === "delivered" && !row.review && !!row.reviewToken,
  };
}

async function findRow(token: string) {
  return prisma.order.findUnique({ where: { token }, include });
}

export async function publicOrderByToken(token: string, store: StoreSettings): Promise<(PublicOrder & { reviewToken: string | null }) | null> {
  if (!token || token.length < 16) return null;
  const row = await findRow(token);
  if (!row || row.source !== "online") return null;
  return { ...toPublicOrder(row, store), reviewToken: row.status === "delivered" && !row.review ? row.reviewToken : null };
}

export async function accountOrders(customerId: string, store: StoreSettings): Promise<PublicOrder[]> {
  const rows = await prisma.order.findMany({ where: { customerId, source: "online", token: { not: null } }, include, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((r) => toPublicOrder(r, store));
}

export const PUBLIC_STATUS: Record<OrderStatus, string> = {
  completed: "Completed",
  awaiting_payment: "Awaiting payment",
  paid: "Paid, preparing to ship",
  label_purchased: "Label created",
  shipped: "Shipped",
  delivered: "Delivered",
  canceled: "Canceled",
};
