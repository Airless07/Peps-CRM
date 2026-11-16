import type { AppData, OrderRec } from "../types";

export interface AdminCounts {
  awaitingPayment: number;
  /** Awaiting-payment orders where the customer uploaded a payment screenshot. */
  screenshots: number;
  /** Paid website orders that have not shipped yet. */
  readyToShip: number;
  reviews: number;
  messages: number;
  total: number;
}

export const isAwaiting = (o: OrderRec) => o.status === "awaiting_payment" && !o.archived;
export const isReadyToShip = (o: OrderRec) => o.source === "online" && (o.status === "paid" || o.status === "label_purchased") && !o.archived;

export function adminCounts(data: AppData | null): AdminCounts {
  if (!data) return { awaitingPayment: 0, screenshots: 0, readyToShip: 0, reviews: 0, messages: 0, total: 0 };
  const awaiting = data.pendingOrders.filter(isAwaiting);
  const c = {
    awaitingPayment: awaiting.length,
    screenshots: awaiting.filter((o) => o.web?.hasScreenshot).length,
    readyToShip: data.orders.filter(isReadyToShip).length,
    reviews: data.reviews.filter((r) => r.status === "pending").length,
    messages: data.messages.filter((m) => !m.handled).length,
  };
  return { ...c, total: c.awaitingPayment + c.readyToShip + c.reviews + c.messages };
}
