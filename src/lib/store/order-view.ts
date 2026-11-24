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
  /** Local pickup / delivery details (after the order is placed, the pickup spot is shared). Null = shipped order. */
  local: {
    method: "pickup" | "delivery";
    spot: { name: string; address: string; instructions: string } | null;
    time: string;
    notes: string;
    payAtPickup: boolean;
    ready: boolean;
  } | null;
}

const include = { lines: LINE_SIZE, review: true };

export function toPublicOrder(row: NonNullable<Awaited<ReturnType<typeof findRow>>>, store: StoreSettings): PublicOrder {
  const o = toOrder(row);
  const w = o.web!;
  const t = orderTotals(o);
  const s = o.status;
  const rank: Record<string, number> = { awaiting_payment: 0, paid: 1, label_purchased: 2, shipped: 3, delivered: 4 };
  const at = rank[s] ?? -1;
  const local = o.fulfillment === "pickup" || o.fulfillment === "delivery" ? o.fulfillment : null;
  const steps = local
    ? localSteps(o, local)
    : [
    { key: "placed", label: "Order placed", at: w.placedAt ?? o.date, n: 0 },
    { key: "paid", label: "Payment confirmed", at: w.paidAt, n: 1 },
    { key: "shipped", label: "Shipped", at: w.shippedAt, n: 3 },
    { key: "delivered", label: "Delivered", at: w.deliveredAt, n: 4 },
  ].map((x) => ({ key: x.key, label: x.label, at: x.at, done: x.n === 0 || at >= x.n, current: (x.n === 1 && at === 0) || (x.n === 3 && (at === 1 || at === 2)) || (x.n === 4 && at === 3) }));
  const spot = o.localSpot;
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
    pay: s === "awaiting_payment" && !o.payAtPickup ? payInstructions(store, w.payChoice) : null,
    hasScreenshot: w.hasScreenshot,
    cancelReason: w.cancelReason,
    tracking: w.trackingNumber ? { number: w.trackingNumber, carrier: w.trackingCarrier, url: trackingUrl(w.trackingCarrier, w.trackingNumber) } : null,
    steps,
    canReview: (s === "delivered" || s === "picked_up") && !row.review,
    local: local
      ? {
          method: local,
          spot: local === "pickup" && spot ? { name: spot.name, address: [spot.street1, [spot.city, [spot.state, spot.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")].filter(Boolean).join(", "), instructions: spot.instructions } : null,
          time: o.localTime ?? "",
          notes: o.localNotes ?? "",
          payAtPickup: !!o.payAtPickup,
          ready: !!o.readyAt || s === "ready",
        }
      : null,
  };
}

/** Placed -> Paid -> Ready -> Picked up / Delivered. Pay-at-pickup orders can be ready before they are paid. */
function localSteps(o: ReturnType<typeof toOrder>, method: "pickup" | "delivery") {
  const w = o.web!;
  const s = o.status;
  const paid = !["awaiting_payment", "canceled"].includes(s);
  const ready = !!o.readyAt || s === "ready" || s === "picked_up" || s === "delivered";
  const done = s === "picked_up" || s === "delivered";
  const list = [
    { key: "placed", label: "Order placed", at: w.placedAt ?? o.date, done: true },
    { key: "paid", label: o.payAtPickup ? "Paid at handover" : "Payment confirmed", at: w.paidAt, done: paid },
    { key: "ready", label: method === "pickup" ? "Ready for pickup" : "Ready for delivery", at: o.readyAt ?? null, done: ready },
    { key: "handed", label: method === "pickup" ? "Picked up" : "Delivered", at: w.deliveredAt, done },
  ];
  // Pay at pickup: the payment happens at the handover, so it is shown last before "Picked up".
  if (o.payAtPickup) [list[1], list[2]] = [list[2], list[1]];
  const firstOpen = s === "canceled" ? -1 : list.findIndex((x) => !x.done);
  return list.map((x, i) => ({ ...x, current: i === firstOpen }));
}

async function findRow(token: string) {
  return prisma.order.findUnique({ where: { token }, include });
}

export async function publicOrderByToken(token: string, store: StoreSettings): Promise<(PublicOrder & { reviewToken: string | null }) | null> {
  if (!token || token.length < 16) return null;
  const row = await findRow(token);
  if (!row || row.source !== "online") return null;
  return { ...toPublicOrder(row, store), reviewToken: (row.status === "delivered" || row.status === "picked_up") && !row.review ? row.reviewToken : null };
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
  ready: "Ready",
  picked_up: "Picked up",
  delivered: "Delivered",
  canceled: "Canceled",
};

/** Status line for a local order where the shipping wording would be wrong. Null = use PUBLIC_STATUS. */
export function localStatusText(o: Pick<PublicOrder, "status" | "local">): string | null {
  if (!o.local) return null;
  const what = o.local.method === "pickup" ? "pickup" : "delivery";
  if (o.status === "awaiting_payment") return o.local.ready ? `Ready for ${what}` : o.local.payAtPickup ? `Order received · pay at ${what}` : null;
  if (o.status === "paid") return `Paid, preparing your order`;
  if (o.status === "ready") return `Ready for ${what}`;
  return null;
}
