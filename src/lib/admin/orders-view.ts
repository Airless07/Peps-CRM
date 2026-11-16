// Pure helpers for showing orders in the admin.
import type { Ledger } from "../money";
import { orderTotals } from "../money";
import type { AppData, OrderRec, OrderStatus } from "../types";
import { STATUS_LABEL } from "../types";

export type NextStep = "mark-paid" | "buy-label" | "open-label" | "mark-shipped" | "mark-delivered" | null;

export const STEP_LABEL: Record<Exclude<NextStep, null>, string> = {
  "mark-paid": "Mark paid",
  "buy-label": "Buy label",
  "open-label": "Open label",
  "mark-shipped": "Mark shipped",
  "mark-delivered": "Mark delivered",
};

/** The one main button for an order. `labelOpened` = the label PDF was already opened on this device. */
export function nextStep(o: OrderRec, labelOpened = false): NextStep {
  if (o.source !== "online" || o.archived) return null;
  switch (o.status) {
    case "awaiting_payment":
      return "mark-paid";
    case "paid":
      return "buy-label";
    case "label_purchased":
      return o.web?.labelUrl && !labelOpened ? "open-label" : "mark-shipped";
    case "shipped":
      return "mark-delivered";
    default:
      return null;
  }
}

export const STATUS_TONE: Record<OrderStatus, "neutral" | "warn" | "neg" | "pos" | "accent"> = {
  completed: "neutral",
  awaiting_payment: "warn",
  paid: "accent",
  label_purchased: "accent",
  shipped: "neutral",
  delivered: "pos",
  canceled: "neg",
};

export const statusLabel = (o: OrderRec) => (o.source === "inperson" ? "Completed" : STATUS_LABEL[o.status]);

export const allOrders = (data: AppData): OrderRec[] =>
  [...data.orders, ...data.pendingOrders].sort((a, b) => orderTime(b) - orderTime(a) || (b.number ?? 0) - (a.number ?? 0));

/** When the order was placed (website) or made (in person). */
export const orderPlaced = (o: OrderRec) => o.web?.placedAt ?? o.date;
const orderTime = (o: OrderRec) => new Date(orderPlaced(o)).getTime();

/** Order total: from the ledger for counted orders, computed directly for pending ones. */
export const orderTotal = (o: OrderRec, ledger: Ledger) => ledger.orders.get(o.id)?.total ?? orderTotals(o).total;

export const customerName = (o: OrderRec) => o.customer || o.web?.shipTo?.name || (o.source === "online" ? "Customer" : "Walk-in");

export function shipToLines(o: OrderRec): string[] {
  const a = o.web?.shipTo;
  if (!a) return [];
  return [a.name, [a.street1, a.street2].filter(Boolean).join(", "), `${a.city}, ${a.state} ${a.zip}`].filter(Boolean);
}

export const itemsSummary = (o: OrderRec) => o.lines.map((l) => `${l.quantity > 1 ? `${l.quantity}× ` : ""}${l.productName}`).join(", ");

const LABEL_OPENED_KEY = "peps-labels-opened";
export function labelsOpened(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(LABEL_OPENED_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}
export function rememberLabelOpened(orderId: string) {
  try {
    localStorage.setItem(LABEL_OPENED_KEY, JSON.stringify([...labelsOpened(), orderId].slice(-300)));
  } catch {}
}
