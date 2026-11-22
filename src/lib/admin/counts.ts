import type { AppData, OrderRec } from "../types";

export interface AdminCounts {
  awaitingPayment: number;
  /** Awaiting-payment orders where the customer uploaded a payment screenshot. */
  screenshots: number;
  /** Paid website orders that have not shipped yet. */
  readyToShip: number;
  /** Local orders still to hand over. */
  local: number;
  reviews: number;
  messages: number;
  total: number;
}

export const isAwaiting = (o: OrderRec) => o.status === "awaiting_payment" && !o.archived;
/** Paid website orders waiting for a label / shipping. Local pickup and delivery orders never go here. */
export const isReadyToShip = (o: OrderRec) => o.source === "online" && (o.fulfillment ?? "ship") === "ship" && (o.status === "paid" || o.status === "label_purchased") && !o.archived;
/** Local pickup / delivery orders still to hand over (placed, paid or ready). */
export const isOpenLocal = (o: OrderRec) => o.source === "online" && (o.fulfillment === "pickup" || o.fulfillment === "delivery") && ["awaiting_payment", "paid", "ready"].includes(o.status) && !o.archived;

export function adminCounts(data: AppData | null): AdminCounts {
  if (!data) return { awaitingPayment: 0, screenshots: 0, readyToShip: 0, local: 0, reviews: 0, messages: 0, total: 0 };
  const awaiting = data.pendingOrders.filter(isAwaiting);
  const c = {
    awaitingPayment: awaiting.length,
    screenshots: awaiting.filter((o) => o.web?.hasScreenshot).length,
    readyToShip: data.orders.filter(isReadyToShip).length,
    local: [...data.orders, ...data.pendingOrders].filter(isOpenLocal).length,
    reviews: data.reviews.filter((r) => r.status === "pending").length,
    messages: data.messages.filter((m) => !m.handled).length,
  };
  return { ...c, total: c.awaitingPayment + c.readyToShip + c.reviews + c.messages };
}
