"use client";

// Built-in analytics, client side. Sends an event name (and a product id for product events) to
// this site's own API. No cookie, no visitor id, no third party. A "visit" is counted once per
// browser per day using a date kept in localStorage on the visitor's own device.
import { useEffect } from "react";

export type TrackEvent = "visit" | "product_view" | "add_to_cart" | "checkout_start";
const VISIT_KEY = "bl-visit-day";

export function trackEvent(e: TrackEvent, id?: string) {
  try {
    fetch("/api/store/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ e, id }), keepalive: true }).catch(() => {});
  } catch {}
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

/** In the store layout: counts today's visit once. */
export function TrackVisit() {
  useEffect(() => {
    try {
      if (localStorage.getItem(VISIT_KEY) === today()) return;
      localStorage.setItem(VISIT_KEY, today());
    } catch {
      // Storage blocked (private mode): count once per page load group using a window flag instead.
      const w = window as unknown as { __blVisit?: boolean };
      if (w.__blVisit) return;
      w.__blVisit = true;
    }
    trackEvent("visit");
  }, []);
  return null;
}

/** On a product page: one product view per page load. */
export function TrackProductView({ id }: { id: string }) {
  useEffect(() => {
    trackEvent("product_view", id);
  }, [id]);
  return null;
}

/** On the checkout page: counted once per browser tab session, when there is something in the cart. */
export function trackCheckoutStart() {
  try {
    if (sessionStorage.getItem("bl-checkout") === "1") return;
    sessionStorage.setItem("bl-checkout", "1");
  } catch {}
  trackEvent("checkout_start");
}

/** A finished order starts a fresh checkout count. */
export function resetCheckoutStart() {
  try {
    sessionStorage.removeItem("bl-checkout");
  } catch {}
}
