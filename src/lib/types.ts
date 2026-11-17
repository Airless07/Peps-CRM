import { DEFAULT_CONTENT, DEFAULT_STORE, type SiteContent, type StoreSettings } from "./store/config";
import { defaultSellButtons, type SellButtons } from "./sell-buttons";
// Plain data records shared by server and client. Dates are ISO strings, money is integer cents.

export type Partner = "A" | "B";
/** Who sold an order: a partner, or "W" for the website. */
export type Seller = Partner | "W";
export type OrderSource = "inperson" | "online";
export type OrderStatus = "completed" | "awaiting_payment" | "paid" | "label_purchased" | "shipped" | "delivered" | "canceled";
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
  /** Payment methods offered at checkout, in display order. */
  paymentMethods: string[];
  /** Quick discount and tip buttons in the Sell cart, in display order. */
  sellButtons: SellButtons;
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
  /** Parent product (Listing). */
  listingId: string | null;
  /** Size label shown on the website, e.g. "10mg". */
  variantLabel: string;
  variantSort: number;
  /** Shipping weight in ounces. Null = default parcel weight. */
  weightOz: number | null;
  testingStatus: TestingStatus;
}

export type TestingStatus = "coa_available" | "supplier_tested" | "pending" | "coming_soon";
export const TESTING_LABEL: Record<TestingStatus, string> = {
  coa_available: "COA available",
  supplier_tested: "Tested by supplier",
  pending: "Third-party testing pending",
  coming_soon: "COA coming soon",
};

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

export interface CustomerRec {
  id: string;
  name: string;
  phone: string;
  email: string;
  notes: string;
  createdAt: string;
  /** True when the customer has a website account (can sign in). */
  hasAccount: boolean;
  /** Saved shipping addresses (website account). */
  addresses: Address[];
}

export interface OrderRec {
  id: string;
  date: string;
  /** Customer name snapshot (kept in sync with the linked customer). */
  customer: string;
  customerId: string | null;
  /** Payment method name as saved with the order. Old orders are "Unknown". */
  paymentMethod: string;
  note: string;
  soldBy: Seller;
  discountType: DiscountType;
  /** Cents when discountType is "$", percent when "%". */
  discountValue: number;
  tipCents: number;
  createdAt: string;
  lines: OrderLineRec[];
  /** Sequential order number (1001, 1002, ...). */
  number: number | null;
  source: OrderSource;
  status: OrderStatus;
  archived: boolean;
  /** Shipping charged to the customer. 100% business money, never split. */
  shippingCents: number;
  /** Internal note for the team. Never sent to or shown to the customer. */
  adminNote: string;
  /** Website order details. Null for in-person sales. */
  web: WebOrderRec | null;
}

/** A line of a saved order: an order line plus the product's regular price when it was saved. */
export interface SavedLineRec {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents: number;
  cutPercent: number;
  /** Regular price of the product when the line was first saved. Null when unknown. */
  listPriceCents: number | null;
}

/** An in-person order saved for later on the Sell screen. Not an order: no stock or money effect. */
export interface SavedOrderRec {
  id: string;
  savedAt: string;
  customer: string;
  customerId: string | null;
  paymentMethod: string;
  note: string;
  soldBy: Seller;
  discountType: DiscountType;
  discountValue: number;
  tipCents: number;
  lines: SavedLineRec[];
}

export interface Address {
  name: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface PromoSnapshot {
  /** Discount code typed by the customer, if any. */
  code: string;
  promotionIds: string[];
  /** Plain descriptions of what was applied, e.g. "SAVE10: 10% off". */
  labels: string[];
  freeShipping: boolean;
}

export interface WebOrderRec {
  email: string;
  phone: string;
  shipTo: Address | null;
  shippingMethod: string;
  shippingRate: { carrier: string; service: string; cents: number } | null;
  promo: PromoSnapshot | null;
  /** Payment method id picked at checkout. */
  payChoice: string;
  /** Shipping tier id picked at checkout. */
  shippingTier: string;
  token: string | null;
  hasScreenshot: boolean;
  cancelReason: string;
  placedAt: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  canceledAt: string | null;
  /** When the unpaid-order reminder email went out. Null = not sent. */
  reminderSentAt: string | null;
  trackingNumber: string;
  trackingCarrier: string;
  trackingStatus: string;
  labelUrl: string;
}

export interface PhotoRec {
  /** Upload id. Files are /media/{id}-{width}.webp */
  id: string;
  alt: string;
}

export interface QtyDeal {
  minQty: number;
  percentOff: number;
}

/** Parent product: what the website shows. Its variants are ProductRec rows. */
export interface ListingRec {
  id: string;
  name: string;
  slug: string;
  summary: string;
  description: string;
  casNumber: string;
  formula: string;
  molecularWeight: string;
  purity: string;
  form: string;
  storage: string;
  showOnWebsite: boolean;
  photos: PhotoRec[];
  hoverGif: string;
  groupIds: string[];
  badges: string[];
  bestSeller: boolean;
  /** Buy more, save more tiers. Null = use the store default. */
  qtyDeals: QtyDeal[] | null;
  sortOrder: number;
  seoTitle: string;
  seoDescription: string;
  createdAt: string;
}

export interface GroupRec {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  createdAt: string;
}

export interface CoaRec {
  id: string;
  productId: string;
  file: string;
  fileName: string;
  mime: string;
  lot: string;
  testDate: string | null;
  purity: string;
  isCurrent: boolean;
  createdAt: string;
}

export interface LabelRec {
  id: string;
  orderId: string | null;
  date: string;
  costCents: number;
  carrier: string;
  service: string;
  trackingNumber: string;
  labelUrl: string;
  shippoTransactionId: string;
  voided: boolean;
  createdAt: string;
}

export type PromotionKind = "code" | "auto" | "free_shipping";

export interface PromotionUseRec {
  id: string;
  promotionId: string;
  orderId: string | null;
  email: string;
  createdAt: string;
}

export interface PromotionRec {
  id: string;
  kind: PromotionKind;
  name: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
  minSubtotalCents: number;
  startsAt: string | null;
  endsAt: string | null;
  maxUses: number | null;
  oncePerEmail: boolean;
  listingIds: string[];
  groupIds: string[];
  active: boolean;
  createdAt: string;
  uses: PromotionUseRec[];
}

export type ReviewStatus = "pending" | "approved" | "hidden";

export interface ReviewRec {
  id: string;
  orderId: string | null;
  rating: number;
  text: string;
  displayName: string;
  status: ReviewStatus;
  edited: boolean;
  createdAt: string;
}

export interface MessageRec {
  id: string;
  name: string;
  email: string;
  orderNumber: string;
  message: string;
  handled: boolean;
  createdAt: string;
}

export interface OrderEventRec {
  id: string;
  orderId: string;
  at: string;
  kind: "status" | "email" | "note";
  message: string;
  detail: string;
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
  customers: CustomerRec[];
  purchases: PurchaseRec[];
  adjustments: AdjustmentRec[];
  /** Sales that count in the money math (in-person, and website orders once paid). */
  orders: OrderRec[];
  splits: SplitRec[];
  payouts: PayoutRec[];
  /** Website orders that do NOT count: awaiting payment or canceled. Never touch stock or money. */
  pendingOrders: OrderRec[];
  /** Shipping labels bought. Each one is a business expense on its date. */
  labels: LabelRec[];
  listings: ListingRec[];
  groups: GroupRec[];
  coas: CoaRec[];
  promotions: PromotionRec[];
  reviews: ReviewRec[];
  messages: MessageRec[];
  /** Sell carts saved for later. NOT orders: the money and stock math never reads this list. */
  savedOrders: SavedOrderRec[];
  store: StoreSettings;
  content: SiteContent;
}

/** True when an order counts in stock and money. */
export const countsInMoney = (status: OrderStatus) => status !== "awaiting_payment" && status !== "canceled";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  completed: "Completed",
  awaiting_payment: "Awaiting payment",
  paid: "Paid, no label",
  label_purchased: "Label purchased",
  shipped: "Shipped",
  delivered: "Delivered",
  canceled: "Canceled",
};

/** Defaults for the fields added with the store, for code that builds records by hand (tests, old backups). */
export const ORDER_DEFAULTS = { number: null, source: "inperson", status: "completed", archived: false, shippingCents: 0, adminNote: "", web: null } as const satisfies Partial<OrderRec>;
export const PRODUCT_DEFAULTS = { listingId: null, variantLabel: "", variantSort: 0, weightOz: null, testingStatus: "coming_soon" } as const satisfies Partial<ProductRec>;
export const CUSTOMER_DEFAULTS = { email: "", hasAccount: false, addresses: [] as Address[] } satisfies Partial<CustomerRec>;
export const emptyStoreData = () => ({
  pendingOrders: [] as OrderRec[],
  labels: [] as LabelRec[],
  listings: [] as ListingRec[],
  groups: [] as GroupRec[],
  coas: [] as CoaRec[],
  promotions: [] as PromotionRec[],
  reviews: [] as ReviewRec[],
  messages: [] as MessageRec[],
  savedOrders: [] as SavedOrderRec[],
  store: structuredClone(DEFAULT_STORE),
  content: structuredClone(DEFAULT_CONTENT),
});

export const DEFAULT_PAYMENT_METHODS = ["Cash", "Zelle", "Cash App", "Venmo", "Apple Pay", "Other"] as const;
export const UNKNOWN_PAYMENT = "Unknown";

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
  paymentMethods: [...DEFAULT_PAYMENT_METHODS],
  sellButtons: defaultSellButtons(),
};
