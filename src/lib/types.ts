// Plain data records shared by server and client. Dates are ISO strings, money is integer cents.

export type Partner = "A" | "B";
export type TipHandling = "profit" | "seller" | "business";
export type DiscountType = "$" | "%";
export type AdjustmentReason = "breakage" | "freebie" | "correction";

export interface SettingsRec {
  startingBalanceCents: number;
  startDate: string;
  businessCutPercent: number;
  partnerAName: string;
  partnerBName: string;
  /** Partner A's share of splittable money, in percent. Partner B gets the rest. */
  partnerARatio: number;
  tipHandling: TipHandling;
  defaultSoldBy: Partner;
  lowStockThreshold: number;
}

export interface ProductRec {
  id: string;
  name: string;
  defaultPriceCents: number;
  costOverrideCents: number | null;
  lowStockThreshold: number | null;
  color: string;
  sortOrder: number;
  archived: boolean;
  createdAt: string;
}

export interface PurchaseRec {
  id: string;
  date: string;
  productId: string;
  quantity: number;
  totalCostCents: number;
  note: string;
  fromInvestment: boolean;
  createdAt: string;
}

export interface AdjustmentRec {
  id: string;
  date: string;
  productId: string;
  quantity: number;
  reason: AdjustmentReason;
  note: string;
  createdAt: string;
}

export interface OrderLineRec {
  id: string;
  orderId: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
  cutPercent: number;
  sortOrder: number;
}

export interface OrderRec {
  id: string;
  date: string;
  customer: string;
  note: string;
  soldBy: Partner;
  discountType: DiscountType;
  /** Cents when discountType is "$", percent when "%". */
  discountValue: number;
  tipCents: number;
  createdAt: string;
  lines: OrderLineRec[];
}

export interface SplitItemRec {
  id: string;
  splitId: string;
  orderId: string | null;
  partnerACents: number;
  partnerBCents: number;
  businessCents: number;
}

export interface SplitRec {
  id: string;
  date: string;
  note: string;
  partnerACents: number;
  partnerBCents: number;
  businessCents: number;
  createdAt: string;
  items: SplitItemRec[];
}

export interface PayoutRec {
  id: string;
  date: string;
  person: Partner;
  amountCents: number;
  note: string;
  splitId: string | null;
  createdAt: string;
}

export interface AppData {
  settings: SettingsRec;
  products: ProductRec[];
  purchases: PurchaseRec[];
  adjustments: AdjustmentRec[];
  orders: OrderRec[];
  splits: SplitRec[];
  payouts: PayoutRec[];
}

export const DEFAULT_SETTINGS: SettingsRec = {
  startingBalanceCents: -130000,
  startDate: new Date(0).toISOString(),
  businessCutPercent: 10,
  partnerAName: "Ahmad",
  partnerBName: "Mo",
  partnerARatio: 50,
  tipHandling: "profit",
  defaultSoldBy: "A",
  lowStockThreshold: 3,
};
