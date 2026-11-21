// Everything that changes a website order: place, mark paid, cancel, labels, shipping, delivery.
// Server only. The money itself is never written here: computeLedger() derives it from the records.
import { randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { HttpError } from "./api";
import { prisma } from "./db";
import {
  adminNewOrderEmail,
  adminScreenshotEmail,
  canceledEmail,
  deliveredEmail,
  orderReceivedEmail,
  outcomeText,
  paymentConfirmedEmail,
  paymentReminderEmail,
  sendEmail,
  shippedEmail,
  type EmailContent,
  type EmailOrder,
} from "./email";
import { computeLedger, orderTotals } from "./money";
import { LINE_SIZE, getSettingsRow, json, loadAll, toOrder } from "./serialize";
import { lineName } from "./size";
import { buyRate, parcelFor, pickRate, quoteRates, ratesByTier, registerTracking, trackPackage, trackingUrl, type RateOption, type TrackResult } from "./shippo";
import { pricedVariants } from "./store/catalog";
import { parseContent, parseStore, type ShippingTierId, type StoreSettings } from "./store/config";
import { checkoutMethods, payInstructions, payMethod } from "./store/payments";
import { orderLinesOf, priceCart, shippingOptions, type CartItemInput } from "./store/pricing";
import type { Address, AppData, OrderRec, PromoSnapshot } from "./types";
import { track } from "./analytics";
import { clampCredit } from "./credit";
import { creditAvailable, rememberReferrer, syncOrderCredit } from "./credit-ops";
import { customerByReferralCode } from "./referral-codes";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export const CANCEL_UNPAID_REASON = "Canceled: payment not received in time";

export async function getStore() {
  const row = await getSettingsRow();
  return { row, store: parseStore(row.storeJson), content: parseContent(row.contentJson) };
}

/** Public address of the site: Settings, then env, then the request. No trailing slash. */
export function siteUrl(store: Pick<StoreSettings, "siteUrl">, origin?: string): string {
  const env = process.env.PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "");
  return (store.siteUrl.trim() || env || origin || "http://localhost:3000").replace(/\/+$/, "");
}

export function requestOrigin(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https");
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

/** Next sequential order number (1001, 1002, ...). Call inside the transaction that creates the order. */
export async function nextOrderNumber(tx: Db): Promise<number> {
  const top = await tx.order.aggregate({ _max: { number: true } });
  return Math.max(1000, top._max.number ?? 1000) + 1;
}

export const newToken = () => randomBytes(24).toString("base64url");

export async function logEvent(db: Db, orderId: string, kind: "status" | "email" | "note", message: string, detail = "") {
  await db.orderEvent.create({ data: { id: randomUUID(), orderId, kind, message, detail } });
}

const orderInclude = { lines: LINE_SIZE };

async function loadOrder(id: string) {
  const row = await prisma.order.findUnique({ where: { id }, include: orderInclude });
  if (!row) throw new HttpError(404, "That order was not found. It may have been removed. Reload the page.");
  return { row, order: toOrder(row) };
}

export const addressLines = (a: Address | null): string[] =>
  a ? [a.name, a.street1, a.street2, `${a.city}, ${a.state} ${a.zip}`].map((s) => s.trim()).filter(Boolean) : [];

export function emailOrder(o: OrderRec, base: string): EmailOrder {
  const t = orderTotals(o);
  return {
    number: o.number ?? 0,
    name: o.web?.shipTo?.name || o.customer || "Customer",
    email: o.web?.email ?? "",
    lines: o.lines.map((l) => ({ name: lineName(l), quantity: l.quantity, totalCents: l.quantity * l.unitPriceCents })),
    subtotalCents: t.subtotal,
    discountCents: t.discount,
    creditCents: t.credit,
    shippingCents: t.shipping,
    totalCents: t.total,
    shippingMethod: o.web?.shippingMethod ?? "",
    shipTo: addressLines(o.web?.shipTo ?? null),
    statusUrl: `${base}/order/${o.web?.token ?? ""}`,
  };
}

/** Send an email about an order and write the result to its timeline. Never throws. */
async function mailOrder(store: StoreSettings, orderId: string, to: string | string[], what: string, content: EmailContent) {
  try {
    const out = await sendEmail(store, to, content);
    await logEvent(prisma, orderId, "email", `${what}: ${outcomeText(out)}`, content.subject);
    return out;
  } catch (e) {
    console.error(e);
    return null;
  }
}

// ---------------------------------------------------------------- Place an order
export interface CheckoutInput {
  customerId: string;
  name: string;
  email: string;
  phone: string;
  shipTo: Address;
  items: CartItemInput[];
  code: string;
  tier: ShippingTierId;
  payChoice: string;
  /** Total the customer saw. The order is refused if the price changed meanwhile. */
  expectedTotalCents: number;
  origin: string;
  /** Store credit the customer chose to use (capped by what is available). Taken from the balance once paid. */
  storeCreditCents?: number;
  /** Optional referral code typed at checkout. Sets who referred the order (and the customer, if not set yet). */
  referralCode?: string;
}

/** Price a cart exactly like the order will be saved. Shared by the quote API and placeOrder. */
export async function quoteCheckout(data: AppData, input: { items: CartItemInput[]; code: string; email: string; shipTo?: Address | null }) {
  const variants = pricedVariants(data);
  const pricing = priceCart({ items: input.items, variants, promotions: data.promotions, code: input.code, email: input.email, shippingTiers: data.store.shippingTiers });
  let live: ReturnType<typeof ratesByTier> | undefined;
  let liveNote = "";
  const to = input.shipTo;
  if (data.store.shippingMode === "live" && to && to.street1 && to.city && to.state && to.zip && pricing.lines.length > 0) {
    const weights = new Map(data.products.map((p) => [p.id, p.weightOz]));
    const parcel = parcelFor(data.store, pricing.lines.map((l) => ({ quantity: l.quantity, weightOz: weights.get(l.variantId) ?? null })));
    const res = await quoteRates(data.store, to, parcel);
    if (res.ok) live = ratesByTier(res.data.rates);
    else liveNote = res.error;
  }
  const shipping = shippingOptions(data.store, pricing.freeTiers, live);
  return { pricing, shipping, liveNote, variants };
}

export async function placeOrder(input: CheckoutInput): Promise<{ id: string; token: string; number: number }> {
  const data = await loadAll();
  const { store } = data;
  if (!store.open) throw new HttpError(403, "The store is not open for orders yet.");
  const ledger = computeLedger(data);
  const { pricing, shipping } = await quoteCheckout(data, { items: input.items, code: input.code, email: input.email, shipTo: input.shipTo });
  if (pricing.lines.length === 0) throw new HttpError(400, "Your cart is empty. Add a product before checking out.");
  if (input.code.trim() && pricing.codeError) throw new HttpError(400, pricing.codeError);
  const soldOut = pricing.lines.filter((l) => (ledger.stock.get(l.variantId)?.stock ?? 0) <= 0);
  if (soldOut.length) throw new HttpError(409, `${soldOut.map((l) => l.name).join(", ")} just sold out. Remove ${soldOut.length === 1 ? "it" : "them"} from your cart to continue.`);
  const ship = shipping.find((s) => s.tier === input.tier);
  if (!ship) throw new HttpError(400, "That shipping option is no longer available. Pick another one.");
  const method = checkoutMethods(store.payments).find((m) => m.id === input.payChoice && m.available);
  if (!method) throw new HttpError(400, "That payment method is not available. Pick another one.");
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw new HttpError(401, "Sign in again to place your order.");

  // Referral code: who referred this order. A typed code wins; else the customer's own referrer.
  let referredById = customer.referredById;
  if (input.referralCode?.trim()) {
    const ref = await customerByReferralCode(prisma, input.referralCode);
    if (!ref) throw new HttpError(400, "That referral code wasn't found. Check it, or leave the field empty.");
    if (ref.id === customer.id) throw new HttpError(400, "That is your own referral code. Share it with friends instead.");
    referredById = ref.id;
  }

  // Store credit: never more than what is free to spend (other unpaid orders hold theirs) or the total after discounts.
  const wanted = Math.max(0, Math.round(input.storeCreditCents ?? 0));
  const { available } = wanted > 0 ? await creditAvailable(prisma, customer.id) : { available: 0 };
  if (wanted > available) throw new HttpError(409, `You have ${(available / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} store credit available. Lower the store credit and place the order again.`);
  const credit = clampCredit(wanted, available, pricing.subtotalCents - pricing.discountCents);

  const total = pricing.subtotalCents - pricing.discountCents - credit + ship.cents;
  if (total !== input.expectedTotalCents) throw new HttpError(409, "A price changed while you were checking out. Review the updated total and place the order again.");

  const now = new Date();
  const id = randomUUID();
  const token = newToken();
  const promo: PromoSnapshot = { code: pricing.code, promotionIds: pricing.applied.map((a) => a.id), labels: pricing.applied.map((a) => a.label), freeShipping: ship.free };

  const number = await prisma.$transaction(async (tx) => {
    const n = await nextOrderNumber(tx);
    await tx.order.create({
      data: {
        id,
        number: n,
        date: now,
        placedAt: now,
        expiresAt: new Date(now.getTime() + store.autoCancelHours * 3600_000),
        source: "online",
        status: "awaiting_payment",
        soldBy: "W",
        customer: customer.name,
        customerId: customer.id,
        paymentMethod: payMethod(input.payChoice)?.saleName ?? "Unknown",
        payChoice: input.payChoice,
        discountType: "$",
        discountValue: pricing.discountCents,
        // Held until the order is paid; only then does it come off the balance.
        storeCreditCents: credit,
        referredById,
        email: input.email.trim().toLowerCase(),
        phone: input.phone.trim(),
        shipToJson: JSON.stringify(input.shipTo),
        shippingCents: ship.cents,
        shippingTier: ship.tier,
        shippingMethod: ship.service ? `${ship.name} (${ship.service})` : ship.name,
        promoJson: JSON.stringify(promo),
        token,
        lines: {
          // BOGO units are their own lines at the lower price, so their cost still counts once paid.
          create: orderLinesOf(pricing).map((l, i) => ({
            id: randomUUID(),
            productId: l.variantId,
            productName: l.name,
            quantity: l.quantity,
            unitPriceCents: l.unitPriceCents,
            dealId: l.dealId,
            dealName: l.dealName,
            fullPriceCents: l.fullPriceCents,
            // Cost and cut are snapshotted when the order is marked paid (that is when it becomes a sale).
            unitCostCents: 0,
            cutPercent: data.settings.businessCutPercent,
            sortOrder: i,
          })),
        },
      },
    });
    for (const a of pricing.applied) {
      await tx.promotionUse.create({ data: { id: randomUUID(), promotionId: a.id, orderId: id, email: input.email.trim().toLowerCase() } });
    }
    await rememberReferrer(tx, customer.id, referredById);
    await logEvent(tx, id, "status", "Order placed. Waiting for payment.", `${method.name} · total $${(total / 100).toFixed(2)}`);
    return n;
  });

  // One more order placed (aggregate count only).
  await track("order").catch(() => {});

  // Emails after the order is safely saved. Failures are logged on the order, never thrown.
  const { order } = await loadOrder(id);
  const base = siteUrl(store, input.origin);
  const view = emailOrder(order, base);
  await mailOrder(store, id, view.email, "Order received email", orderReceivedEmail(store, view, payInstructions(store, input.payChoice), order.web?.expiresAt ? new Date(order.web.expiresAt) : null));
  if (store.alertEmails.length) await mailOrder(store, id, store.alertEmails, "New order alert", adminNewOrderEmail(store, view, `${base}/admin/orders/${id}`));
  return { id, token, number };
}

// ---------------------------------------------------------------- Mark paid
/** Lines that would take stock below zero if this order is marked paid now. */
export async function stockShortfalls(orderId: string): Promise<{ name: string; need: number; have: number }[]> {
  const data = await loadAll();
  const ledger = computeLedger(data);
  const order = data.pendingOrders.find((o) => o.id === orderId);
  if (!order) return [];
  return order.lines
    .filter((l) => l.productId)
    .map((l) => ({ name: l.productName, need: l.quantity, have: ledger.stock.get(l.productId!)?.stock ?? 0 }))
    .filter((x) => x.have < x.need);
}

/**
 * Turn an awaiting-payment order into a normal sale: dated now, sold by "Website", unit cost and
 * cut snapshotted like the Sell screen does, customer linked (or created) by email.
 * From this moment it is part of AppData.orders, so stock and money include it.
 */
export async function markPaid(orderId: string, opts: { paymentMethod: string; origin?: string; notify?: boolean }) {
  const data = await loadAll();
  const order = data.pendingOrders.find((o) => o.id === orderId);
  if (!order) {
    const counted = data.orders.find((o) => o.id === orderId);
    if (counted) throw new HttpError(409, `Order #${counted.number} is already marked paid.`);
    throw new HttpError(404, "That order was not found. Reload the page.");
  }
  if (order.status !== "awaiting_payment") throw new HttpError(409, `Order #${order.number} was canceled, so it can't be marked paid. Ask the customer to place a new order.`);
  const ledger = computeLedger(data);
  const now = new Date();
  const email = order.web?.email ?? "";

  await prisma.$transaction(async (tx) => {
    let customerId = order.customerId;
    let customerName = order.customer;
    if (!customerId && email) {
      const found = (await tx.customer.findMany({ where: { email: { not: "" } } })).find((c) => c.email.toLowerCase() === email.toLowerCase());
      if (found) {
        customerId = found.id;
        customerName = found.name;
      } else {
        customerId = randomUUID();
        customerName = order.web?.shipTo?.name || email;
        await tx.customer.create({ data: { id: customerId, name: customerName, email, phone: order.web?.phone ?? "" } });
      }
    }
    for (const l of order.lines) {
      await tx.orderLine.update({
        where: { id: l.id },
        data: { unitCostCents: l.productId ? ledger.stock.get(l.productId)?.unitCost ?? 0 : 0, cutPercent: data.settings.businessCutPercent },
      });
    }
    await tx.order.update({
      where: { id: orderId },
      data: { status: "paid", date: now, paidAt: now, soldBy: "W", paymentMethod: opts.paymentMethod.trim() || "Unknown", customerId, customer: customerName },
    });
    // Paid: the store credit it used comes off the balance now, and the referrer earns their reward.
    await syncOrderCredit(tx, orderId, { by: "Website order" });
    await logEvent(tx, orderId, "status", "Marked paid.", opts.paymentMethod);
  });

  if (opts.notify !== false && email) {
    const { order: fresh } = await loadOrder(orderId);
    await mailOrder(data.store, orderId, email, "Payment confirmed email", paymentConfirmedEmail(data.store, emailOrder(fresh, siteUrl(data.store, opts.origin))));
  }
}

// ---------------------------------------------------------------- Cancel
export async function cancelOrder(orderId: string, reason: string, opts: { origin?: string; notify?: boolean; by?: string } = {}) {
  const { order } = await loadOrder(orderId);
  if (order.source !== "online") throw new HttpError(400, "In-person sales are not canceled. Open the sale and delete it instead.");
  if (order.status === "canceled") throw new HttpError(409, `Order #${order.number} is already canceled.`);
  const text = reason.trim() || "Canceled";
  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { status: "canceled", canceledAt: new Date(), cancelReason: text } });
    // Free the promotion uses so limited codes and deals count this order out.
    await tx.promotionUse.deleteMany({ where: { orderId } });
    // Store credit used goes back to the customer; referral rewards are taken back (never below $0).
    await syncOrderCredit(tx, orderId, { by: opts.by ?? "Admin", why: "canceled" });
    await logEvent(tx, orderId, "status", text);
  });
  if (opts.notify !== false && order.web?.email) {
    const { store } = await getStore();
    await mailOrder(store, orderId, order.web.email, "Canceled email", canceledEmail(store, emailOrder(order, siteUrl(store, opts.origin)), text));
  }
}

/** Cancel every unpaid order whose time ran out. Returns how many were canceled. */
export async function autoCancelDue(now = new Date()): Promise<number> {
  const due = await prisma.order.findMany({ where: { status: "awaiting_payment", expiresAt: { lte: now } }, select: { id: true } });
  for (const o of due) {
    try {
      await cancelOrder(o.id, CANCEL_UNPAID_REASON, { by: "Automatic" });
    } catch (e) {
      console.error("auto-cancel failed", o.id, e);
    }
  }
  return due.length;
}

/** True when an unpaid order has reached the halfway point between being placed and being auto-canceled. */
export function reminderDue(o: { placedAt: Date | null; expiresAt: Date | null; reminderSentAt: Date | null; status: string }, now: Date): boolean {
  if (o.status !== "awaiting_payment" || o.reminderSentAt || !o.placedAt || !o.expiresAt) return false;
  const half = o.placedAt.getTime() + (o.expiresAt.getTime() - o.placedAt.getTime()) / 2;
  return now.getTime() >= half && now.getTime() < o.expiresAt.getTime();
}

/**
 * Email a payment reminder for every website order that is still unpaid halfway to auto-cancel.
 * Each order gets at most one reminder: it is marked as reminded before the email goes out, so a
 * crash or a second run can never send it twice. Returns how many reminders were sent.
 */
export async function sendUnpaidReminders(now = new Date(), origin?: string): Promise<number> {
  const { store } = await getStore();
  if (!store.unpaidReminder) return 0;
  const waiting = await prisma.order.findMany({ where: { status: "awaiting_payment", reminderSentAt: null, expiresAt: { gt: now } }, include: orderInclude });
  let sent = 0;
  for (const row of waiting) {
    if (!reminderDue(row, now) || !row.email || !row.expiresAt) continue;
    try {
      const claimed = await prisma.order.updateMany({ where: { id: row.id, status: "awaiting_payment", reminderSentAt: null }, data: { reminderSentAt: now } });
      if (claimed.count !== 1) continue;
      const view = emailOrder(toOrder(row), siteUrl(store, origin));
      await mailOrder(store, row.id, row.email, "Payment reminder email", paymentReminderEmail(store, view, payInstructions(store, row.payChoice), row.expiresAt, now));
      sent++;
    } catch (e) {
      console.error("payment reminder failed", row.id, e);
    }
  }
  return sent;
}

// ---------------------------------------------------------------- Labels
const g = globalThis as unknown as { __labelOffers?: Map<string, { at: number; rates: RateOption[] }>; __labelBuying?: Set<string> };
const offers = (g.__labelOffers ??= new Map());
const buying = (g.__labelBuying ??= new Set());
const OFFER_TTL_MS = 30 * 60_000;

/** Rates a label can be bought at for this order's own address, cheapest first, with the suggested one. */
export async function labelRates(orderId: string) {
  const data = await loadAll();
  const order = data.orders.find((o) => o.id === orderId);
  if (!order || order.source !== "online") throw new HttpError(404, "That order was not found, or it is not a paid website order.");
  const to = order.web?.shipTo;
  if (!to) throw new HttpError(409, `Order #${order.number} has no shipping address. Edit the order and add one.`);
  if (!data.store.shipFrom.email.trim()) throw new HttpError(409, "The ship-from address has no email, and Shippo will not sell a label without one. Add it in Settings, under Shipping.");
  const weights = new Map(data.products.map((p) => [p.id, p.weightOz]));
  const parcel = parcelFor(data.store, order.lines.map((l) => ({ quantity: l.quantity, weightOz: l.productId ? weights.get(l.productId) ?? null : null })));
  const res = await quoteRates(data.store, to, parcel, { email: order.web?.email, phone: order.web?.phone });
  if (!res.ok) throw new HttpError(502, res.error);
  if (res.data.rates.length === 0) throw new HttpError(502, `Shippo returned no rates for this address. ${res.data.messages.join(" ")}`.trim());
  offers.set(orderId, { at: Date.now(), rates: res.data.rates });
  const suggested = pickRate(res.data.rates, order.web?.shippingTier ?? "");
  return { rates: res.data.rates, suggestedRateId: suggested?.rateId ?? null, parcel, paidShippingCents: order.shippingCents, shippingMethod: order.web?.shippingMethod ?? "" };
}

/**
 * Buy the label. With no rateId it buys the service the customer picked (or the cheapest when that
 * service is not offered). The label cost becomes a business expense, tracking is saved and the
 * customer is emailed right away.
 */
export async function buyLabel(orderId: string, rateId?: string, origin?: string) {
  const { order } = await loadOrder(orderId);
  if (order.source !== "online") throw new HttpError(400, "Labels can only be bought for website orders.");
  if (order.status === "awaiting_payment") throw new HttpError(409, `Order #${order.number} is not paid yet. Mark it paid first.`);
  if (order.status === "canceled") throw new HttpError(409, `Order #${order.number} is canceled.`);
  if (order.web?.labelUrl) throw new HttpError(409, `A label was already bought for order #${order.number}. Use "Open label".`);
  if (buying.has(orderId)) throw new HttpError(409, "A label purchase for this order is already in progress. Wait a moment.");
  buying.add(orderId);
  try {
    let offer = offers.get(orderId);
    if (!offer || Date.now() - offer.at > OFFER_TTL_MS) {
      await labelRates(orderId);
      offer = offers.get(orderId)!;
    }
    const rate = rateId ? offer.rates.find((r: RateOption) => r.rateId === rateId) : pickRate(offer.rates, order.web?.shippingTier ?? "");
    if (!rate) throw new HttpError(409, "That rate is no longer offered. Load the rates again and pick one. Nothing was bought.");
    const res = await buyRate(rate);
    if (!res.ok) throw new HttpError(502, res.error);
    const label = res.data;
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.labelPurchase.create({
        data: { id: randomUUID(), orderId, date: now, costCents: label.cents, carrier: label.carrier, service: label.service, trackingNumber: label.trackingNumber, labelUrl: label.labelUrl, shippoTransactionId: label.transactionId },
      });
      await tx.order.update({
        where: { id: orderId },
        data: { status: order.status === "paid" ? "label_purchased" : order.status, trackingNumber: label.trackingNumber, trackingCarrier: label.carrier, labelUrl: label.labelUrl, trackingStatus: "PRE_TRANSIT" },
      });
      await logEvent(tx, orderId, "status", "Shipping label purchased.", `${label.carrier} ${label.service} · $${(label.cents / 100).toFixed(2)} · ${label.trackingNumber}`);
    });
    offers.delete(orderId);
    if (label.trackingNumber) registerTracking(label.carrier, label.trackingNumber, `order:${orderId}`).catch(() => {});
    if (order.web?.email) {
      const { store } = await getStore();
      const { order: fresh } = await loadOrder(orderId);
      await mailOrder(store, orderId, order.web.email, "Tracking email", shippedEmail(store, emailOrder(fresh, siteUrl(store, origin)), { number: label.trackingNumber, carrier: label.carrier, url: trackingUrl(label.carrier, label.trackingNumber) }));
    }
    return label;
  } finally {
    buying.delete(orderId);
  }
}

// ---------------------------------------------------------------- Shipped / delivered
export async function markShipped(orderId: string, opts: { trackingNumber?: string; carrier?: string; at?: Date; origin?: string; auto?: boolean } = {}) {
  const { order } = await loadOrder(orderId);
  if (order.source !== "online" || !["paid", "label_purchased"].includes(order.status)) {
    if (order.status === "shipped") return;
    throw new HttpError(409, `Order #${order.number} can't be marked shipped from "${order.status.replace("_", " ")}".`);
  }
  const tracking = opts.trackingNumber?.trim() || order.web?.trackingNumber || "";
  const carrier = opts.carrier?.trim() || order.web?.trackingCarrier || "";
  const hadTracking = !!order.web?.trackingNumber;
  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { status: "shipped", shippedAt: opts.at ?? new Date(), trackingNumber: tracking, trackingCarrier: carrier } });
    await logEvent(tx, orderId, "status", opts.auto ? "Carrier picked it up. Marked shipped." : "Marked shipped.", tracking ? `${carrier} ${tracking}`.trim() : "No tracking number");
  });
  // The customer already got tracking when the label was bought. Email only when this is new information.
  if (!hadTracking && order.web?.email) {
    const { store } = await getStore();
    const { order: fresh } = await loadOrder(orderId);
    await mailOrder(store, orderId, order.web.email, "Shipped email", shippedEmail(store, emailOrder(fresh, siteUrl(store, opts.origin)), { number: tracking, carrier, url: trackingUrl(carrier, tracking) }));
  }
}

export async function markDelivered(orderId: string, opts: { at?: Date; origin?: string; auto?: boolean } = {}) {
  const { order, row } = await loadOrder(orderId);
  if (order.status === "delivered") return;
  if (order.source !== "online" || !["paid", "label_purchased", "shipped"].includes(order.status)) {
    throw new HttpError(409, `Order #${order.number} can't be marked delivered from "${order.status.replace("_", " ")}".`);
  }
  const reviewToken = row.reviewToken ?? newToken();
  const at = opts.at ?? new Date();
  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { status: "delivered", deliveredAt: at, shippedAt: row.shippedAt ?? at, reviewToken } });
    await logEvent(tx, orderId, "status", opts.auto ? "Carrier reports delivered." : "Marked delivered.");
  });
  if (order.web?.email) {
    const { store } = await getStore();
    const base = siteUrl(store, opts.origin);
    await mailOrder(store, orderId, order.web.email, "Review request email", deliveredEmail(store, emailOrder(order, base), `${base}/review/${reviewToken}`));
  }
}

/** Apply what the carrier says to the order. Returns a plain sentence about what happened. */
export async function applyTrack(orderId: string, t: TrackResult, origin?: string): Promise<{ changed: boolean; note: string }> {
  const { order } = await loadOrder(orderId);
  await prisma.order.update({ where: { id: orderId }, data: { trackingStatus: t.status } });
  if (t.status === "DELIVERED" && order.status !== "delivered" && order.status !== "canceled") {
    if (order.status !== "shipped") await markShipped(orderId, { at: t.shippedAt ? new Date(t.shippedAt) : undefined, origin, auto: true }).catch(() => {});
    await markDelivered(orderId, { at: t.deliveredAt ? new Date(t.deliveredAt) : undefined, origin, auto: true });
    return { changed: true, note: "The carrier reports this order as delivered. It was marked delivered." };
  }
  if (t.status === "TRANSIT" && ["paid", "label_purchased"].includes(order.status)) {
    await markShipped(orderId, { at: t.shippedAt ? new Date(t.shippedAt) : undefined, origin, auto: true });
    return { changed: true, note: "The carrier has the package. It was marked shipped." };
  }
  if (t.status === "RETURNED") return { changed: false, note: `Needs your attention: the carrier says this package is being returned. ${t.detail}`.trim() };
  if (t.status === "FAILURE") return { changed: false, note: `Needs your attention: the carrier reports a delivery problem. ${t.detail}`.trim() };
  const words: Record<string, string> = { PRE_TRANSIT: "Label created, not scanned by the carrier yet.", TRANSIT: "In transit.", DELIVERED: "Delivered.", UNKNOWN: "The carrier has no tracking information yet." };
  return { changed: false, note: `${words[t.status] ?? t.status} ${t.detail}`.trim() };
}

export async function checkTracking(orderId: string, origin?: string) {
  const { order } = await loadOrder(orderId);
  const n = order.web?.trackingNumber;
  if (!n) throw new HttpError(409, `Order #${order.number} has no tracking number yet. Buy a label or use "Mark shipped" to add one.`);
  const res = await trackPackage(order.web?.trackingCarrier || "usps", n);
  if (!res.ok) throw new HttpError(502, `Could not check tracking. ${res.error}`);
  return applyTrack(orderId, res.data, origin);
}

// ---------------------------------------------------------------- Payment screenshot
export async function attachScreenshot(token: string, file: string, origin: string) {
  const row = await prisma.order.findUnique({ where: { token }, include: orderInclude });
  if (!row) throw new HttpError(404, "That order link is not valid.");
  if (row.status !== "awaiting_payment") throw new HttpError(409, "This order is no longer waiting for payment, so a screenshot is not needed.");
  const old = row.screenshotFile;
  await prisma.order.update({ where: { id: row.id }, data: { screenshotFile: file } });
  await logEvent(prisma, row.id, "note", "Customer uploaded a payment screenshot.");
  const { store } = await getStore();
  if (store.alertEmails.length) {
    const base = siteUrl(store, origin);
    await mailOrder(store, row.id, store.alertEmails, "Screenshot alert", adminScreenshotEmail(store, emailOrder(toOrder(row), base), `${base}/admin/orders/${row.id}`));
  }
  return old;
}

export { json };
