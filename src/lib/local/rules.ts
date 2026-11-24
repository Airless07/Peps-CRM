// Local pickup / delivery rules. Pure: used by the quote API, placeOrder (same function, so the cart
// and the saved order can never disagree), the admin and tests. Never exposes the pickup address or
// the home ZIP: before an order is placed a customer only learns the pickup spot's town.
import type { LocalSettings, PickupSpot } from "../store/config";

export type Fulfillment = "ship" | "pickup" | "delivery";
export const LOCAL_METHODS = ["pickup", "delivery"] as const;
export const isLocalMethod = (f: string | null | undefined): f is "pickup" | "delivery" => f === "pickup" || f === "delivery";
export const FULFILLMENT_LABEL: Record<Fulfillment, string> = { ship: "Shipping", pickup: "Local pickup", delivery: "Local delivery" };

/** Payment choice id for "pay at pickup / delivery" (cash or Zelle, in person). Only valid on local orders. */
export const PAY_AT_PICKUP = "pickup";
export const PAY_AT_PICKUP_NAME = "Pay at pickup / delivery";

/** The delivery fee for an order whose items come to `merchandiseCents` after discounts. Integer cents. */
export function deliveryFeeCents(d: LocalSettings["delivery"], merchandiseCents: number): number {
  if (d.freeOverCents !== null && d.freeOverCents > 0 && merchandiseCents >= d.freeOverCents) return 0;
  return Math.max(0, Math.round(d.feeCents));
}

/** Pickup is only offered when the spot is filled in (it is shared after the order). */
export const pickupReady = (p: LocalSettings["pickup"]) => p.enabled && !!p.name.trim() && !!p.street1.trim() && !!p.city.trim();

/** What a local customer can pick. Safe to send to the browser: no address, no home ZIP. */
export interface LocalOffer {
  pickup: { town: string } | null;
  delivery: { cents: number; feeCents: number; freeOverCents: number | null } | null;
  windows: string[];
  payAtPickup: boolean;
}

/** Null when the address is not local or no local method is turned on. */
export function localOffer(local: LocalSettings, isLocal: boolean, merchandiseCents: number): LocalOffer | null {
  if (!isLocal) return null;
  const pickup = pickupReady(local.pickup) ? { town: local.pickup.city.trim() } : null;
  const delivery = local.delivery.enabled ? { cents: deliveryFeeCents(local.delivery, merchandiseCents), feeCents: local.delivery.feeCents, freeOverCents: local.delivery.freeOverCents } : null;
  if (!pickup && !delivery) return null;
  return { pickup, delivery, windows: local.windows, payAtPickup: local.payAtPickup };
}

/** The pickup spot saved on an order (shown only after it is placed). */
export const spotOf = (local: LocalSettings): PickupSpot => {
  const { enabled: _e, ...spot } = local.pickup;
  return spot;
};

/** Why an order can't be switched to local, or null when it can. Pure (shared by the Actions menu and the server). */
export function switchBlocker(o: {
  number: number | null;
  source: string;
  fulfillment?: string | null;
  status: string;
  labelUrl?: string;
  labelLockAt?: Date | string | null;
  labels?: number;
  refundedCents?: number;
}): string | null {
  const label = `Order #${o.number}`;
  if (o.source !== "online") return "Only website orders can be switched to local.";
  if (isLocalMethod(o.fulfillment)) return `${label} is already a local ${o.fulfillment} order.`;
  if (o.labelUrl || o.labelLockAt || (o.labels ?? 0) > 0) return `A shipping label was already bought for ${label.toLowerCase()}, so it can't be switched to local.`;
  if (o.status === "canceled") return `${label} is canceled.`;
  if ((o.refundedCents ?? 0) > 0) return `${label} has a refund recorded, so it can't be switched to local.`;
  if (!["awaiting_payment", "paid"].includes(o.status)) return `${label} can't be switched to local from "${o.status.replace("_", " ")}".`;
  return null;
}

/** The local fee and the difference for a switch (also shown in the confirm dialog). Integer cents. */
export function switchQuote(local: Pick<LocalSettings, "delivery">, o: { shippingCents: number; merchandiseCents: number }, to: "pickup" | "delivery") {
  const fee = to === "pickup" ? 0 : deliveryFeeCents(local.delivery, o.merchandiseCents);
  // Never more than the shipping already charged: switching never adds a charge to the order.
  const after = Math.min(fee, Math.max(0, o.shippingCents));
  return { feeCents: after, diffCents: Math.max(0, o.shippingCents - after) };
}
