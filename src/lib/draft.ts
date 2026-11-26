import { customerKey } from "./customers";
import { uid } from "./format";
import type { CashHolder, CustomerRec, DiscountType, OrderRec, Partner, Seller } from "./types";
import { ORDER_DEFAULTS, UNKNOWN_PAYMENT } from "./types";

export interface DraftLine {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
  cutPercent: number;
  /** BOGO deal line: the deal and its name. */
  dealId?: string;
  dealName?: string;
  /** Price each before a BOGO deal or owner price (shown struck through). */
  fullPriceCents?: number | null;
}

export interface Draft {
  id: string;
  date: string;
  /** Typed or picked customer name. */
  customer: string;
  /** Linked customer. May be a new id not yet saved (created with the order). */
  customerId: string | null;
  paymentMethod: string;
  note: string;
  soldBy: Seller;
  discountType: DiscountType;
  discountValue: number;
  tipCents: number;
  lines: DraftLine[];
  /** Owner price: every line at cost for this partner. Null/absent = a normal sale. */
  owner?: Partner | null;
  /** Who received the money (Ahmad, Mo or the bank). Required to complete a sale: never defaulted. */
  cashTo?: CashHolder | null;
  /** Store credit to use. Capped by the customer's available credit and the total after discounts. */
  storeCreditCents?: number;
  /** Customer who referred this sale. */
  referredById?: string | null;
}

export function orderToDraft(o: OrderRec): Draft {
  return {
    id: o.id,
    date: o.date,
    customer: o.customer,
    customerId: o.customerId,
    paymentMethod: o.paymentMethod,
    note: o.note,
    soldBy: o.soldBy,
    discountType: o.discountType,
    discountValue: o.discountValue,
    tipCents: o.tipCents,
    owner: o.owner ?? null,
    cashTo: o.cashTo ?? null,
    storeCreditCents: o.storeCreditCents ?? 0,
    referredById: o.referredById ?? null,
    lines: [...o.lines]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((l) => ({
        id: l.id,
        productId: l.productId,
        productName: l.productName,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        unitCostCents: l.unitCostCents,
        cutPercent: l.cutPercent,
        ...(l.dealId ? { dealId: l.dealId, dealName: l.dealName ?? "" } : l.dealName ? { dealName: l.dealName } : {}),
        ...(l.fullPriceCents != null ? { fullPriceCents: l.fullPriceCents } : {}),
      })),
  };
}

/** `base` is the order being edited: its number, source, status and shipping are kept. */
export function draftToOrder(d: Draft, createdAt = new Date().toISOString(), base?: OrderRec): OrderRec {
  const keep = base
    ? { number: base.number, source: base.source, status: base.status, archived: base.archived, shippingCents: base.shippingCents, adminNote: base.adminNote, web: base.web }
    : ORDER_DEFAULTS;
  return {
    ...keep,
    ...d,
    customer: d.customer.trim(),
    owner: d.owner ?? null,
    cashTo: d.cashTo ?? null,
    storeCreditCents: d.storeCreditCents ?? 0,
    referredById: d.referredById ?? null,
    createdAt,
    lines: d.lines.map((l, i) => ({ ...l, orderId: d.id, sortOrder: i })),
  };
}

/** Body for POST /api/orders and PUT /api/orders/:id */
export function draftPayload(d: Draft) {
  return { ...d, lines: d.lines.map((l) => ({ ...l })) };
}

export const lineCount = (d: Pick<Draft, "lines">) => d.lines.reduce((s, l) => s + l.quantity, 0);

/** Fill fields that carts saved by an older version of the app don't have. */
export function upgradeDraft(d: Draft, fallbackPayment: string): Draft {
  return {
    ...d,
    customer: d.customer ?? "",
    customerId: d.customerId ?? null,
    paymentMethod: d.paymentMethod || fallbackPayment || UNKNOWN_PAYMENT,
    storeCreditCents: d.storeCreditCents ?? 0,
    referredById: d.referredById ?? null,
  };
}

/**
 * Link a typed customer name before saving: an existing customer with the same name
 * (trimmed, any case) is reused, otherwise a new customer is made with the order.
 * Returns the draft and the new customer (for the optimistic update), if any.
 */
export function resolveDraftCustomer(d: Draft, customers: CustomerRec[], now = new Date().toISOString()): { draft: Draft; created: CustomerRec | null } {
  const name = d.customer.trim();
  // No customer: no store credit (it belongs to a customer).
  if (!name) return { draft: { ...d, customer: "", customerId: null, storeCreditCents: 0 }, created: null };
  const linked = d.customerId ? customers.find((c) => c.id === d.customerId) : undefined;
  if (linked) return { draft: { ...d, customer: linked.name }, created: null };
  const match = customers.find((c) => customerKey(c.name) === customerKey(name));
  if (match) return { draft: { ...d, customer: match.name, customerId: match.id }, created: null };
  const created: CustomerRec = { id: d.customerId ?? uid(), name, phone: "", email: "", hasAccount: false, addresses: [], notes: "", createdAt: now, accountStatus: "none", referredById: d.referredById ?? null };
  // A brand new customer has no store credit yet.
  return { draft: { ...d, customer: name, customerId: created.id, storeCreditCents: 0 }, created };
}
