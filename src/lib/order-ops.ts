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
  readyEmail,
  orderReceivedEmail,
  outcomeText,
  paymentConfirmedEmail,
  paymentReminderEmail,
  sendEmail,
  shippedEmail,
  type EmailContent,
  type EmailOrder,
  handedOverEmail,
  switchedToLocalEmail,
} from "./email";
import { computeLedger, orderTotals } from "./money";
import { LINE_SIZE, getSettingsRow, json, loadAll, toOrder } from "./serialize";
import { lineName } from "./size";
import { buyRate, parcelFor, pickRate, quoteRates, ratesByTier, registerTracking, trackPackage, trackingUrl, type RateOption, type TrackResult } from "./shippo";
import { pricedVariants } from "./store/catalog";
import { parseContent, parseStore, type ShippingTierId, type StoreSettings } from "./store/config";
import { checkoutMethods, payInstructions, payMethod, receiverOf } from "./store/payments";
import { orderLinesOf, priceCart, shippingOptions, type CartItemInput } from "./store/pricing";
import type { Address, AppData, LocalSwitch, OrderRec, PromoSnapshot, SwitchHandling } from "./types";
import { track } from "./analytics";
import { clampCredit, refundableOf } from "./credit";
import { creditAvailable, rememberReferrer, syncOrderCredit } from "./credit-ops";
import { fmtMoney } from "./format";
import { resolveReferral, STACKING_TEXT, type ReferralBuyer } from "./store/referral";
import { countsInMoney } from "./types";
import { FULFILLMENT_LABEL, isLocalMethod, localOffer, PAY_AT_PICKUP, PAY_AT_PICKUP_NAME, pickupReady, spotOf, switchBlocker, switchQuote, type Fulfillment } from "./local/rules";
import { isLocalZip } from "./local/zips";
import { envSiteUrl } from "./site";
import { consentText } from "./store/consent";
import { SUPPORT_EMAIL } from "./store/config";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export const CANCEL_UNPAID_REASON = "Canceled: payment not received in time";

export async function getStore() {
  const row = await getSettingsRow();
  return { row, store: parseStore(row.storeJson), content: parseContent(row.contentJson) };
}

/**
 * Public address of the site, used for every link (emails, canonical tags, sitemap, share links). No trailing slash.
 * SITE_URL in the environment wins, then "Website address" in Settings, then Railway's domain, then the request.
 */
export function siteUrl(store: Pick<StoreSettings, "siteUrl">, origin?: string): string {
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "";
  return (envSiteUrl() || store.siteUrl.trim() || railway || origin || "http://localhost:3000").replace(/\/+$/, "");
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
    local:
      o.fulfillment === "pickup" || o.fulfillment === "delivery"
        ? {
            method: o.fulfillment,
            spot:
              o.fulfillment === "pickup" && o.localSpot
                ? { name: o.localSpot.name, address: [o.localSpot.street1, `${o.localSpot.city}, ${o.localSpot.state} ${o.localSpot.zip}`.trim()].filter(Boolean).join(", "), instructions: o.localSpot.instructions }
                : null,
            time: o.localTime ?? "",
            payAtPickup: !!o.payAtPickup,
          }
        : undefined,
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
  /** Shipping option (shipped orders). Ignored for local pickup / delivery. */
  tier: ShippingTierId | "";
  payChoice: string;
  /** "ship" (default), "pickup" or "delivery". Local methods are re-checked here: ZIP in the radius and turned on. */
  fulfillment?: Fulfillment;
  /** Local orders: preferred time window (one of Settings' windows) and notes. */
  localTime?: string;
  localNotes?: string;
  /** Total the customer saw. The order is refused if the price changed meanwhile. */
  expectedTotalCents: number;
  origin: string;
  /** Store credit the customer chose to use (capped by what is available). Taken from the balance once paid. */
  storeCreditCents?: number;
  /** Optional referral code typed at checkout. Sets who referred the order (and the customer, if not set yet). */
  referralCode?: string;
  /** The checkout consent box, and the buyer's IP (saved with the order). */
  consent?: boolean;
  ip?: string;
}

/** Price a cart exactly like the order will be saved. Shared by the quote API and placeOrder. */
export async function quoteCheckout(
  data: AppData,
  input: { items: CartItemInput[]; code: string; email: string; shipTo?: Address | null; referralCode?: string; buyer?: ReferralBuyer },
) {
  const variants = pricedVariants(data);
  // Referral code: checked against the buyer (no self-referral by account, email or address).
  const ref = input.referralCode?.trim() ? resolveReferral(data, input.referralCode, { email: input.email, shipTo: input.shipTo, ...input.buyer }) : null;
  const okRef = ref?.ok ? ref : null;
  const price = (withRef: boolean) =>
    priceCart({
      items: input.items,
      variants,
      promotions: data.promotions,
      code: input.code,
      email: input.email,
      shippingTiers: data.store.shippingTiers,
      referral: withRef && okRef ? { display: okRef.display, percent: okRef.buyerDiscountPercent } : null,
    });
  let pricing = price(true);
  // Stacking off: a referral code and a discount code that both apply can't be used together. The
  // cart keeps the discount code priced and asks the customer which one to keep.
  const conflict = !!okRef && !!pricing.code && !data.store.referrals.allowStacking;
  if (conflict) pricing = price(false);
  const referral = okRef && !conflict ? okRef : null;
  const referralError = ref && !ref.ok ? ref.error : "";
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
  // Local pickup / delivery: only when the address ZIP is inside the radius and a method is on.
  // The delivery fee's free-over threshold uses the items after discounts (not store credit, not shipping).
  const local = localOffer(data.store.local, isLocalZip(data.store.local, to?.zip), pricing.subtotalCents - pricing.discountCents);
  return { pricing, shipping, liveNote, variants, referral, referralError, conflict, local };
}

/**
 * Checkouts run one at a time. Limited codes (max uses, once per email) and store credit are checked
 * against what is saved, so two checkouts at the same moment could both pass the same check and spend
 * one code use or one credit balance twice. In a queue, each one sees the orders placed before it.
 * One server process owns the SQLite file, so an in-process queue covers every checkout.
 */
const cq = globalThis as unknown as { __checkoutQueue?: Promise<unknown> };
export function placeOrder(input: CheckoutInput): Promise<{ id: string; token: string; number: number }> {
  const run = (cq.__checkoutQueue ?? Promise.resolve()).catch(() => {}).then(() => placeOrderNow(input));
  cq.__checkoutQueue = run.catch(() => {});
  return run;
}

async function placeOrderNow(input: CheckoutInput): Promise<{ id: string; token: string; number: number }> {
  const data = await loadAll();
  const { store } = data;
  if (!store.open) throw new HttpError(403, "The store is not open for orders yet.");
  const ledger = computeLedger(data);
  const { pricing, shipping, referral, referralError, conflict, local } = await quoteCheckout(data, {
    items: input.items,
    code: input.code,
    email: input.email,
    shipTo: input.shipTo,
    referralCode: input.referralCode,
    buyer: { customerId: input.customerId, email: input.email, shipTo: input.shipTo },
  });
  if (pricing.lines.length === 0) throw new HttpError(400, "Your cart is empty. Add a product before checking out.");
  if (input.code.trim() && pricing.codeError) throw new HttpError(400, pricing.codeError);
  if (referralError) throw new HttpError(400, referralError);
  if (conflict) throw new HttpError(409, STACKING_TEXT);
  const soldOut = pricing.lines.filter((l) => (ledger.stock.get(l.variantId)?.stock ?? 0) <= 0);
  if (soldOut.length) throw new HttpError(409, `${soldOut.map((l) => l.name).join(", ")} just sold out. Remove ${soldOut.length === 1 ? "it" : "them"} from your cart to continue.`);
  // More than is in stock: refused with how many there are (the cart caps signed-in carts already).
  const wantBy = new Map<string, { name: string; qty: number }>();
  for (const l of pricing.lines) wantBy.set(l.variantId, { name: l.name, qty: (wantBy.get(l.variantId)?.qty ?? 0) + l.quantity });
  const short = [...wantBy].filter(([id, w]) => w.qty > (ledger.stock.get(id)?.stock ?? 0));
  if (short.length) throw new HttpError(409, short.map(([id, w]) => `Only ${ledger.stock.get(id)?.stock ?? 0} ${w.name} left.`).join(" ") + " Lower the quantity in your cart to continue.");
  // How it gets to the customer. Local methods are checked again here (never trust the browser):
  // the ZIP must be inside the radius and the method turned on in Settings.
  const fulfillment: Fulfillment = input.fulfillment ?? "ship";
  let ship: { cents: number; tier: string; method: string; free: boolean };
  if (isLocalMethod(fulfillment)) {
    if (!local) throw new HttpError(400, "Local pickup and delivery are only for addresses near us. Pick a shipping option instead.");
    if (fulfillment === "pickup" && !local.pickup) throw new HttpError(400, "Local pickup is not available right now. Pick another option.");
    if (fulfillment === "delivery" && !local.delivery) throw new HttpError(400, "Local delivery is not available right now. Pick another option.");
    if (input.phone.replace(/\D/g, "").length < 10) throw new HttpError(400, "Enter a phone number so we can text you about the pickup or delivery time.");
    if (local.windows.length && !local.windows.includes((input.localTime ?? "").trim())) throw new HttpError(400, "Pick a preferred time.");
    const cents = fulfillment === "delivery" ? local.delivery!.cents : 0;
    ship = { cents, tier: "", method: FULFILLMENT_LABEL[fulfillment], free: cents === 0 };
  } else {
    const s = shipping.find((x) => x.tier === input.tier);
    if (!s) throw new HttpError(400, "That shipping option is no longer available. Pick another one.");
    ship = { cents: s.cents, tier: s.tier, method: s.service ? `${s.name} (${s.service})` : s.name, free: s.free };
  }
  // "Pay at pickup / delivery" exists only for local orders, and only when it is turned on.
  const payAtPickup = input.payChoice === PAY_AT_PICKUP;
  if (payAtPickup && !(isLocalMethod(fulfillment) && local?.payAtPickup)) throw new HttpError(400, "Pay at pickup is only for local pickup or delivery orders. Pick another payment method.");
  const method = payAtPickup ? { id: PAY_AT_PICKUP, name: PAY_AT_PICKUP_NAME } : checkoutMethods(store.payments).find((m) => m.id === input.payChoice && m.available);
  if (!method) throw new HttpError(400, "That payment method is not available. Pick another one.");
  // Free shipping rules only apply to shipped orders: a local order never uses one up.
  const applied = isLocalMethod(fulfillment) ? pricing.applied.filter((a) => a.kind !== "free_shipping") : pricing.applied;
  const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
  if (!customer) throw new HttpError(401, "Sign in again to place your order.");

  // Referral: only a code typed on THIS order counts. A buyer is never tied to an earlier referrer.
  const referredById = referral?.ownerId ?? null;

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
  const promo: PromoSnapshot = { code: pricing.code, promotionIds: applied.map((a) => a.id), labels: applied.map((a) => a.label), freeShipping: ship.free && !isLocalMethod(fulfillment) };

  const number = await prisma.$transaction(async (tx) => {
    const n = await nextOrderNumber(tx);
    await tx.order.create({
      data: {
        id,
        number: n,
        date: now,
        placedAt: now,
        // Pay at pickup: no deadline (the money comes at the handover), so it is never auto-canceled.
        expiresAt: payAtPickup ? null : new Date(now.getTime() + store.autoCancelHours * 3600_000),
        source: "online",
        status: "awaiting_payment",
        soldBy: "W",
        customer: customer.name,
        customerId: customer.id,
        paymentMethod: payAtPickup ? "Unknown" : payMethod(input.payChoice)?.saleName ?? "Unknown",
        fulfillment,
        localTime: isLocalMethod(fulfillment) ? (input.localTime ?? "").trim().slice(0, 60) : "",
        localNotes: isLocalMethod(fulfillment) ? (input.localNotes ?? "").trim().slice(0, 500) : "",
        // The pickup spot as it is now (shared on the confirmation; later Settings edits don't change this order).
        localJson: fulfillment === "pickup" ? JSON.stringify(spotOf(store.local)) : "",
        payAtPickup,
        payChoice: input.payChoice,
        discountType: "$",
        discountValue: pricing.discountCents,
        // Held until the order is paid; only then does it come off the balance.
        storeCreditCents: credit,
        referredById,
        // The code as shown and today's percents: later code or Settings changes never touch this order.
        referralCode: referral?.display ?? "",
        referralRatePct: referral ? referral.ratePercent : null,
        referralDiscountPct: referral ? referral.buyerDiscountPercent : 0,
        referralDiscountCents: pricing.referralCents,
        // The consent box as the buyer saw it, when, and from where.
        ...(input.consent === true ? { consentAt: now, consentText: consentText(store.entryGate.minAge), consentIp: (input.ip ?? "").slice(0, 64) } : {}),
        email: input.email.trim().toLowerCase(),
        phone: input.phone.trim(),
        shipToJson: JSON.stringify(input.shipTo),
        // Local delivery fee is charged like shipping (no label is ever bought for it).
        shippingCents: ship.cents,
        shippingTier: ship.tier,
        shippingMethod: ship.method,
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
    for (const a of applied) {
      await tx.promotionUse.create({ data: { id: randomUUID(), promotionId: a.id, orderId: id, email: input.email.trim().toLowerCase() } });
    }
    await rememberReferrer(tx, customer.id, referredById);
    // Placed with a referral code: the code owner gets PENDING credit (spendable once the order is paid).
    await syncOrderCredit(tx, id, { by: "Website order" });
    await logEvent(tx, id, "status", payAtPickup ? "Order placed. Pays at the handover." : "Order placed. Waiting for payment.", `${isLocalMethod(fulfillment) ? `${FULFILLMENT_LABEL[fulfillment]} · ` : ""}${method.name} · total $${(total / 100).toFixed(2)}${referral ? ` · referral code ${referral.display}` : ""}`);
    return n;
  });

  // One more order placed (aggregate count only).
  await track("order").catch(() => {});

  // Emails after the order is safely saved. Failures are logged on the order, never thrown.
  const { order } = await loadOrder(id);
  const base = siteUrl(store, input.origin);
  const view = emailOrder(order, base);
  await mailOrder(store, id, view.email, "Order received email", orderReceivedEmail(store, view, payAtPickup ? null : payInstructions(store, input.payChoice), order.web?.expiresAt ? new Date(order.web.expiresAt) : null));
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
  const paidTo = receiverOf(data.store.payments, opts.paymentMethod);

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
      // A local order already marked ready (pay at pickup) goes straight to "ready" once paid.
      // paidTo: who receives this payment method (Settings > Payments) as it is now. Later Settings changes never touch it.
      data: { status: order.readyAt ? "ready" : "paid", date: now, paidAt: now, soldBy: "W", paymentMethod: opts.paymentMethod.trim() || "Unknown", paidTo, customerId, customer: customerName },
    });
    // Paid: the store credit it used comes off the balance now, and the referrer earns their reward.
    await syncOrderCredit(tx, orderId, { by: "Website order" });
    await logEvent(tx, orderId, "status", "Marked paid.", `${opts.paymentMethod} · held by ${paidTo === "A" ? data.settings.partnerAName : paidTo === "B" ? data.settings.partnerBName : "Bank"}`);
  });

  if (opts.notify !== false && email) {
    const { order: fresh } = await loadOrder(orderId);
    await mailOrder(data.store, orderId, email, "Payment confirmed email", paymentConfirmedEmail(data.store, emailOrder(fresh, siteUrl(data.store, opts.origin))));
  }
}

// ---------------------------------------------------------------- Refund
/**
 * Record money given back on an order that counts (paid / completed / shipped...). Partial or full.
 * Revenue goes down by the refund (items first, then shipping), and the referral credit the order earned
 * goes down in proportion, with a ledger entry. `expectedRefundedCents` is what the screen showed as
 * already refunded: a double click or a second device can never record the same refund twice.
 */
export async function refundOrder(orderId: string, input: { amountCents: number; reason?: string; expectedRefundedCents: number; by?: string }) {
  const amount = Math.round(input.amountCents);
  if (!(amount > 0)) throw new HttpError(400, "Enter the amount you refunded.");
  await prisma.$transaction(async (tx) => {
    const o = await tx.order.findUnique({ where: { id: orderId }, include: { lines: true } });
    if (!o) throw new HttpError(404, "That order was not found. Reload the page.");
    const label = o.number ? `Order #${o.number}` : "This order";
    if (!countsInMoney(o.status as OrderRec["status"])) {
      throw new HttpError(409, o.status === "canceled" ? `${label} is canceled, so there is nothing to refund.` : `${label} is not paid yet. Cancel it instead of refunding.`);
    }
    if (o.refundedCents !== input.expectedRefundedCents) throw new HttpError(409, `${label} already has ${fmtMoney(o.refundedCents)} refunded. Reload the page to see the latest.`);
    // Shipping difference already given back as store credit (switched to local) is not refundable again.
    const switched = json<LocalSwitch | null>(o.localSwitchJson, null);
    const cap = Math.max(0, refundableOf({ ...o, discountType: o.discountType as "$" | "%" }) - (switched?.creditCents ?? 0));
    const left = cap - o.refundedCents;
    if (left <= 0) throw new HttpError(409, `${label} is already fully refunded.`);
    if (amount > left) throw new HttpError(400, `At most ${fmtMoney(left)} can be refunded on ${label.toLowerCase()} (what the customer paid, without tips, minus earlier refunds).`);
    const next = o.refundedCents + amount;
    const updated = await tx.order.updateMany({ where: { id: orderId, refundedCents: o.refundedCents }, data: { refundedCents: next } });
    if (updated.count !== 1) throw new HttpError(409, `${label} was just changed. Reload the page and try again.`);
    await syncOrderCredit(tx, orderId, { by: input.by ?? "Admin", why: next >= cap ? "refunded" : "partly refunded" });
    await logEvent(tx, orderId, "status", next >= cap ? `Refunded in full (${fmtMoney(next)}).` : `Refunded ${fmtMoney(amount)} (${fmtMoney(next)} of ${fmtMoney(cap)} in total).`, input.reason?.trim() ?? "");
  });
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
/** A label lock older than this is from a crashed request and can be taken again. */
const LABEL_LOCK_MS = 10 * 60_000;

/** Rates a label can be bought at for this order's own address, cheapest first, with the suggested one. */
export async function labelRates(orderId: string) {
  const data = await loadAll();
  const order = data.orders.find((o) => o.id === orderId);
  if (!order || order.source !== "online") throw new HttpError(404, "That order was not found, or it is not a paid website order.");
  if (isLocalMethod(order.fulfillment)) throw new HttpError(400, `Order #${order.number} is a local ${order.fulfillment} order. Local orders never need a shipping label.`);
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
  if (isLocalMethod(order.fulfillment)) throw new HttpError(400, `Order #${order.number} is a local ${order.fulfillment} order. Local orders never need a shipping label.`);
  if (order.status === "awaiting_payment") throw new HttpError(409, `Order #${order.number} is not paid yet. Mark it paid first.`);
  if (order.status === "canceled") throw new HttpError(409, `Order #${order.number} is canceled.`);
  if (order.web?.labelUrl) throw new HttpError(409, `A label was already bought for order #${order.number}. Use "Open label".`);
  if (buying.has(orderId)) throw new HttpError(409, "A label purchase for this order is already in progress. Wait a moment.");
  buying.add(orderId);
  // Database lock, taken before Shippo is called: only one request can hold it, and only while the order
  // has no label. A double click, a second tab or a refresh mid-purchase can never buy a second label.
  const lock = await prisma.order.updateMany({
    where: { id: orderId, labelUrl: "", OR: [{ labelLockAt: null }, { labelLockAt: { lt: new Date(Date.now() - LABEL_LOCK_MS) } }] },
    data: { labelLockAt: new Date() },
  });
  if (lock.count !== 1) {
    buying.delete(orderId);
    throw new HttpError(409, `A label for order #${order.number} was already bought or is being bought right now. Reload the page.`);
  }
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
    await prisma.order.updateMany({ where: { id: orderId }, data: { labelLockAt: null } }).catch(() => {});
  }
}

// ---------------------------------------------------------------- Shipped / delivered
export async function markShipped(orderId: string, opts: { trackingNumber?: string; carrier?: string; at?: Date; origin?: string; auto?: boolean } = {}) {
  const { order } = await loadOrder(orderId);
  if (isLocalMethod(order.fulfillment)) throw new HttpError(400, `Order #${order.number} is a local order. Use Mark ready, then ${order.fulfillment === "pickup" ? "Mark picked up" : "Mark delivered"}.`);
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
  if (isLocalMethod(order.fulfillment)) return markHandedOver(orderId, opts);
  if (order.source !== "online" || !["paid", "label_purchased", "shipped"].includes(order.status)) {
    throw new HttpError(409, `Order #${order.number} can't be marked delivered from "${order.status.replace("_", " ")}".`);
  }
  const reviewToken = row.reviewToken ?? newToken();
  const at = opts.at ?? new Date();
  // Only the request that changes the status emails (no double review request on a double click).
  const changed = await prisma.$transaction(async (tx) => {
    const done = await tx.order.updateMany({ where: { id: orderId, status: order.status }, data: { status: "delivered", deliveredAt: at, shippedAt: row.shippedAt ?? at, reviewToken } });
    if (done.count !== 1) return false;
    await logEvent(tx, orderId, "status", opts.auto ? "Carrier reports delivered." : "Marked delivered.");
    return true;
  });
  if (changed && order.web?.email) {
    const { store } = await getStore();
    const base = siteUrl(store, opts.origin);
    await mailOrder(store, orderId, order.web.email, "Review request email", deliveredEmail(store, emailOrder(order, base), `${base}/review/${reviewToken}`));
  }
}

// ---------------------------------------------------------------- Local pickup / delivery
/**
 * Mark a local order ready for pickup / delivery and email the customer. Paid orders become "ready";
 * a pay-at-pickup order can be ready before it is paid (it stays unpaid until marked paid at the handover).
 */
export async function markReady(orderId: string, opts: { origin?: string; notify?: boolean } = {}) {
  const { order } = await loadOrder(orderId);
  if (order.source !== "online" || !isLocalMethod(order.fulfillment)) throw new HttpError(400, "Only local pickup and delivery orders are marked ready.");
  if (order.readyAt || order.status === "ready") throw new HttpError(409, `Order #${order.number} is already marked ready.`);
  const unpaidOk = order.status === "awaiting_payment" && order.payAtPickup;
  if (order.status !== "paid" && !unpaidOk) {
    throw new HttpError(409, order.status === "awaiting_payment" ? `Order #${order.number} is not paid yet. Mark it paid first.` : `Order #${order.number} can't be marked ready from "${order.status.replace("_", " ")}".`);
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const done = await tx.order.updateMany({ where: { id: orderId, readyAt: null, status: order.status }, data: { readyAt: now, ...(order.status === "paid" ? { status: "ready" } : {}) } });
    if (done.count !== 1) throw new HttpError(409, `Order #${order.number} was just changed. Reload the page.`);
    await logEvent(tx, orderId, "status", `Marked ready for ${order.fulfillment}.`);
  });
  // Only the request that set readyAt gets here (a second click is refused above), so this sends once.
  if (opts.notify === false || !order.web?.email) return;
  const { store, content } = await getStore();
  const delivery = order.fulfillment === "delivery";
  const what = delivery ? "Out for delivery email" : "Ready for pickup email";
  if (!(delivery ? store.handoverEmails.readyDelivery : store.handoverEmails.readyPickup)) {
    await logEvent(prisma, orderId, "email", `${what}: Not sent: turned off in Settings, Email.`);
    return;
  }
  const { order: fresh } = await loadOrder(orderId);
  await mailOrder(store, orderId, order.web.email, what, readyEmail(store, emailOrder(fresh, siteUrl(store, opts.origin)), content.contact.email.trim() || SUPPORT_EMAIL));
}

/**
 * Mark a local order picked up (pickup) or delivered (delivery). It must be paid first.
 * Emails the customer once: only the request that actually changes the status sends (a second click,
 * or two at once, finds the status already changed). The timeline shows sent, skipped or failed.
 */
export async function markHandedOver(orderId: string, opts: { at?: Date; origin?: string } = {}) {
  const { order, row } = await loadOrder(orderId);
  if (order.source !== "online" || !isLocalMethod(order.fulfillment)) throw new HttpError(400, "Only local pickup and delivery orders are handed over.");
  const final = order.fulfillment === "pickup" ? "picked_up" : "delivered";
  if (order.status === final) return;
  if (order.status === "awaiting_payment") throw new HttpError(409, `Order #${order.number} is not paid yet. Mark it paid first${order.payAtPickup ? " (when you receive the money)" : ""}.`);
  if (!["paid", "ready"].includes(order.status)) throw new HttpError(409, `Order #${order.number} can't be handed over from "${order.status.replace("_", " ")}".`);
  const at = opts.at ?? new Date();
  const reviewToken = row.reviewToken ?? newToken();
  const changed = await prisma.$transaction(async (tx) => {
    const done = await tx.order.updateMany({ where: { id: orderId, status: order.status }, data: { status: final, deliveredAt: at, readyAt: row.readyAt ?? at, reviewToken } });
    if (done.count !== 1) return false;
    await logEvent(tx, orderId, "status", order.fulfillment === "pickup" ? "Marked picked up." : "Marked delivered.");
    return true;
  });
  if (!changed || !order.web?.email) return;
  const { store, content } = await getStore();
  const kind = final === "picked_up" ? "picked_up" : "delivered";
  const what = kind === "picked_up" ? "Picked up email" : "Delivered email";
  if (!(kind === "picked_up" ? store.handoverEmails.pickedUp : store.handoverEmails.delivered)) {
    await logEvent(prisma, orderId, "email", `${what}: Not sent: turned off in Settings, Email.`);
    return;
  }
  const base = siteUrl(store, opts.origin);
  const { order: fresh } = await loadOrder(orderId);
  await mailOrder(store, orderId, order.web.email, what, handedOverEmail(store, emailOrder(fresh, base), kind, content.contact.email.trim() || SUPPORT_EMAIL, `${base}/review/${reviewToken}`));
}

// ---------------------------------------------------------------- Switch a shipped order to local
export interface SwitchInput {
  to: "pickup" | "delivery";
  /** Delivery: where to deliver (prefilled from the order in the admin, editable). */
  address?: Address;
  localTime?: string;
  note?: string;
  /** Paid orders: credit | refund_owed | keep. Unpaid orders: lower | keep. */
  handling: SwitchHandling;
  notify: boolean;
  by: string;
  /** What the screen showed as the shipping charged: refuses a stale dialog or a double click. */
  expectedShippingCents: number;
}

export const HANDLING_TEXT: Record<SwitchHandling, string> = {
  credit: "refunded as store credit",
  refund_owed: "refund owed (to be paid back by hand)",
  keep: "kept",
  lower: "taken off the unpaid total",
};

/**
 * Switch a shipped-type order with no label to local pickup or local delivery. It leaves the ship queue,
 * never offers Buy label and shows in the Local tab. The shipping charged minus the local fee is:
 *  - credit: added to the customer's store credit (manual ledger entry tied to the order). The order keeps the
 *    shipping it was paid, so business money still holds that cash; it comes off when the credit is spent.
 *  - refund_owed: the order's shipping drops to the local fee (business money goes down by the difference)
 *    and the order shows "refund owed" until it is marked paid back.
 *  - keep: nothing changes in money.   - lower (unpaid orders only): the total to pay drops.
 * Items, discounts, store credit used and referral rewards never change (none of them depend on shipping).
 */
export async function switchToLocal(orderId: string, input: SwitchInput, opts: { origin?: string } = {}) {
  const row = await prisma.order.findUnique({ where: { id: orderId }, include: { ...orderInclude, labels: { select: { id: true } } } });
  if (!row) throw new HttpError(404, "That order was not found. It may have been removed. Reload the page.");
  const blocked = switchBlocker({ ...row, labels: row.labels.length });
  if (blocked) throw new HttpError(409, blocked);
  if (row.shippingCents !== input.expectedShippingCents) throw new HttpError(409, `Order #${row.number} was just changed. Reload the page and try again.`);
  const { store, content } = await getStore();
  const to = input.to;
  if (to === "pickup" && !pickupReady({ ...store.local.pickup, enabled: true })) {
    throw new HttpError(409, "Add the pickup spot (name, street and city) in Settings, Local orders first.");
  }
  const order = toOrder(row);
  const t = orderTotals(order);
  const { feeCents, diffCents } = switchQuote(store.local, { shippingCents: row.shippingCents, merchandiseCents: t.subtotal - t.discount }, to);
  const paid = row.status !== "awaiting_payment";
  let handling: SwitchHandling = diffCents === 0 ? "keep" : input.handling;
  if (paid && handling === "lower") throw new HttpError(400, "This order is paid. Pick store credit, refund owed or keep it.");
  if (!paid && (handling === "credit" || handling === "refund_owed")) handling = "lower";
  if (handling === "credit" && !row.customerId) throw new HttpError(409, `Order #${row.number} has no customer linked, so store credit can't be added. Pick refund owed or keep it.`);
  const shippingAfter = handling === "refund_owed" || handling === "lower" ? feeCents : row.shippingCents;
  let shipTo = json<Address | null>(row.shipToJson, null);
  if (to === "delivery") {
    if (input.address) shipTo = { ...input.address, country: input.address.country || "US" };
    if (!shipTo?.street1?.trim() || !shipTo.city?.trim()) throw new HttpError(400, "Enter the delivery address.");
  }
  const now = new Date();
  const fromMethod = row.shippingMethod || "Shipping";
  const rec: LocalSwitch = {
    at: now.toISOString(),
    by: input.by.trim().slice(0, 40) || "Admin",
    from: { method: fromMethod, shippingCents: row.shippingCents, tier: row.shippingTier },
    to,
    feeCents,
    shippingAfterCents: shippingAfter,
    diffCents,
    handling,
    creditCents: handling === "credit" ? diffCents : 0,
    refundOwedCents: handling === "refund_owed" ? diffCents : 0,
    refundPaidAt: null,
    note: (input.note ?? "").trim().slice(0, 500),
  };
  const totalAfter = t.total - row.shippingCents + shippingAfter;
  await prisma.$transaction(async (tx) => {
    // Guarded: a label bought, a status change or a second click in the meantime finds nothing to update.
    const done = await tx.order.updateMany({
      where: { id: orderId, fulfillment: "ship", status: row.status, labelUrl: "", labelLockAt: null, shippingCents: row.shippingCents, refundedCents: 0 },
      data: {
        fulfillment: to,
        shippingCents: shippingAfter,
        shippingMethod: FULFILLMENT_LABEL[to],
        shippingTier: "",
        shippingRateJson: "",
        shipToJson: shipTo ? JSON.stringify(shipTo) : row.shipToJson,
        localJson: to === "pickup" ? JSON.stringify(spotOf(store.local)) : "",
        localTime: (input.localTime ?? "").trim().slice(0, 60),
        localSwitchJson: JSON.stringify(rec),
      },
    });
    if (done.count !== 1) throw new HttpError(409, `Order #${row.number} was just changed. Reload the page and try again.`);
    if ((await tx.labelPurchase.count({ where: { orderId } })) > 0) throw new HttpError(409, `A shipping label was just bought for order #${row.number}, so it can't be switched to local.`);
    if (rec.creditCents > 0) {
      await tx.creditEntry.create({
        data: {
          id: randomUUID(),
          customerId: row.customerId!,
          amountCents: rec.creditCents,
          kind: "manual",
          reason: `Shipping difference: order #${row.number} switched to ${FULFILLMENT_LABEL[to].toLowerCase()}`,
          orderId,
          orderNumber: row.number,
          by: rec.by,
        },
      });
    }
    const detail = [
      `Was: ${fromMethod}, ${fmtMoney(row.shippingCents)}.`,
      `Now: ${FULFILLMENT_LABEL[to]}, local fee ${fmtMoney(feeCents)}${shippingAfter !== feeCents ? ` (order keeps ${fmtMoney(shippingAfter)} charged)` : ""}.`,
      diffCents > 0 ? `Difference ${fmtMoney(diffCents)}: ${HANDLING_TEXT[handling]}.` : "No difference.",
      `Order total ${fmtMoney(t.total)} -> ${fmtMoney(totalAfter)}.`,
      rec.note ? `Note: ${rec.note}` : "",
    ];
    await logEvent(tx, orderId, "status", `Switched from shipping to ${FULFILLMENT_LABEL[to].toLowerCase()} by ${rec.by}.`, detail.filter(Boolean).join(" "));
  });

  if (!input.notify || !row.email) return rec;
  if (!store.handoverEmails.switched) {
    await logEvent(prisma, orderId, "email", "Switched to local email: Not sent: turned off in Settings, Email.");
    return rec;
  }
  const { order: fresh } = await loadOrder(orderId);
  const view = emailOrder(fresh, siteUrl(store, opts.origin));
  // Store credit: the customer sees the local fee, and the difference as store credit added.
  const shown = rec.creditCents > 0 ? { ...view, shippingCents: feeCents, totalCents: view.totalCents - view.shippingCents + feeCents } : view;
  const mail = switchedToLocalEmail(shown, { creditCents: rec.creditCents, refundCents: rec.refundOwedCents, note: rec.note, support: content.contact.email.trim() || SUPPORT_EMAIL });
  await mailOrder(store, orderId, row.email, "Switched to local email", mail);
  return rec;
}

/** A "refund owed" from a switch to local was paid back to the customer by hand. Once. */
export async function markSwitchRefundPaid(orderId: string, by: string) {
  await prisma.$transaction(async (tx) => {
    const o = await tx.order.findUnique({ where: { id: orderId }, select: { number: true, localSwitchJson: true } });
    if (!o) throw new HttpError(404, "That order was not found. Reload the page.");
    const rec = json<LocalSwitch | null>(o.localSwitchJson, null);
    if (!rec || rec.refundOwedCents <= 0) throw new HttpError(409, `Order #${o.number} has no refund owed.`);
    if (rec.refundPaidAt) throw new HttpError(409, `The refund on order #${o.number} is already marked paid back.`);
    const next = JSON.stringify({ ...rec, refundPaidAt: new Date().toISOString() });
    const done = await tx.order.updateMany({ where: { id: orderId, localSwitchJson: o.localSwitchJson }, data: { localSwitchJson: next } });
    if (done.count !== 1) throw new HttpError(409, `Order #${o.number} was just changed. Reload the page.`);
    await logEvent(tx, orderId, "status", `Refund owed of ${fmtMoney(rec.refundOwedCents)} marked paid back by ${by.trim() || "Admin"}.`);
  });
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
