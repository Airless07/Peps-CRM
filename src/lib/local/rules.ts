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
