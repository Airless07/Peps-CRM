import type { DiscountType, OrderRec, Partner } from "./types";

export interface DraftLine {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
  cutPercent: number;
}

export interface Draft {
  id: string;
  date: string;
  customer: string;
  note: string;
  soldBy: Partner;
  discountType: DiscountType;
  discountValue: number;
  tipCents: number;
  lines: DraftLine[];
}

export function orderToDraft(o: OrderRec): Draft {
  return {
    id: o.id,
    date: o.date,
    customer: o.customer,
    note: o.note,
    soldBy: o.soldBy,
    discountType: o.discountType,
    discountValue: o.discountValue,
    tipCents: o.tipCents,
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
      })),
  };
}

export function draftToOrder(d: Draft, createdAt = new Date().toISOString()): OrderRec {
  return {
    ...d,
    createdAt,
    lines: d.lines.map((l, i) => ({ ...l, orderId: d.id, sortOrder: i })),
  };
}

/** Body for POST /api/orders and PUT /api/orders/:id */
export function draftPayload(d: Draft) {
  return { ...d, lines: d.lines.map((l) => ({ ...l })) };
}

export const lineCount = (d: Pick<Draft, "lines">) => d.lines.reduce((s, l) => s + l.quantity, 0);
