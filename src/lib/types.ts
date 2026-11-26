import { DEFAULT_CONTENT, DEFAULT_STORE, type PickupSpot, type SiteContent, type StoreSettings } from "./store/config";
import { defaultSellButtons, type SellButtons } from "./sell-buttons";
// Plain data records shared by server and client. Dates are ISO strings, money is integer cents.

export type Partner = "A" | "B";
/** Who sold an order: a partner, or "W" for the website. */
export type Seller = Partner | "W";
export type OrderSource = "inperson" | "online";
/** Local orders use "ready" (paid and ready for pickup / delivery) and "picked_up". */
export type OrderStatus = "completed" | "awaiting_payment" | "paid" | "label_purchased" | "shipped" | "ready" | "picked_up" | "delivered" | "canceled";
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
  /** Size label, e.g. "10mg" or "5mg / 5mg". Shown on the website, the Sell screen, orders and packing slips. */
  variantLabel: string;
  /** Optional vial volume, e.g. "3ml". */
  vialVolume: string;
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
  /** The product's current size label, for display next to the name (not stored on the line). */
  size?: string;
  /** BOGO deal that discounted this line (Promotion id), and its name when sold. Empty = none. */
  dealId?: string;
  dealName?: string;
  /** Price each before a BOGO deal or owner price. Null/absent = no special price. */
  fullPriceCents?: number | null;
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
  /** "none": no email, so no account. "invited": has an email, no password yet. "active": can sign in. */
  accountStatus?: AccountStatus;
  /** Last time they signed in on the website. */
  lastLoginAt?: string | null;
  /** True after "Set temporary password" until they choose their own. */
  mustChangePassword?: boolean;
  /** Code they share with friends (set for every customer), normalized uppercase. */
  referralCode?: string;
  /** The code as they typed it ("Sarah-K"). */
  referralCodeDisplay?: string;
  /** Who referred them. */
  referredById?: string | null;
  /** The invite link: open (with dates), expired, or claimed (when, with which email). The link itself is never stored. */
  invite?: InviteStatus;
}

export interface InviteStatus {
  state: "none" | "open" | "expired" | "claimed";
  createdAt: string | null;
  expiresAt: string | null;
  claimedAt: string | null;
  claimedEmail: string | null;
}

export type AccountStatus = "none" | "invited" | "active";
export const ACCOUNT_STATUS_LABEL: Record<AccountStatus, string> = { none: "No account", invited: "Invited", active: "Active" };

/** "manual": added or removed by the team. "order": used on an order (or refunded). "referral": reward for referring. "referral_new": reward for being referred. */
export type CreditKind = "manual" | "order" | "referral" | "referral_new";

/** One line of a customer's store credit history. The balance is the sum of amountCents. */
export interface CreditEntryRec {
  id: string;
  customerId: string;
  date: string;
  amountCents: number;
  kind: CreditKind;
  reason: string;
  orderId: string | null;
  orderNumber: number | null;
  by: string;
  /** Part of a reversal that could not be taken back under the old $0 floor (history only). */
  shortfallCents: number;
  /** Pending referral credit: visible, not spendable, not in the balance. */
  pending?: boolean;
  createdAt: string;
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
  /** Owner purchase at cost: which partner bought. Null/absent = a normal sale. */
  owner?: Partner | null;
  /** In-person sales: who received the money (Ahmad, Mo or the bank), any payment method. Null/absent = not recorded (counts as Bank). */
  cashTo?: CashHolder | null;
  /** Website orders: who received the payment (Settings > Payments, saved when marked paid). Null/absent = Bank. */
  paidTo?: Partner | null;
  /** Store credit used on this order. Works like a discount. Absent = 0. */
  storeCreditCents?: number;
  /** Customer who referred this sale (the referral code owner). */
  referredById?: string | null;
  /** Referral code used, as shown at the time of the order. */
  referralCode?: string;
  /** Referrer reward percent saved when the order was placed. Null = no referral. */
  referralRatePct?: number | null;
  /** Buyer referral discount percent and cents (already inside discountValue). */
  referralDiscountPct?: number;
  referralDiscountCents?: number;
  /** Money given back after the order counted (partial or full refund). */
  refundedCents?: number;
  /** When a review request was sent for this order (any order, in person too). Null = never. */
  reviewRequestSentAt?: string | null;
  /** "ship" (default) | "pickup" | "delivery". */
  fulfillment?: "ship" | "pickup" | "delivery";
  /** Local orders: preferred time window and notes from checkout. */
  localTime?: string;
  localNotes?: string;
  /** Local pickup: the pickup spot saved when the order was placed. */
  localSpot?: PickupSpot | null;
  /** Local orders paying at pickup / delivery (never auto-canceled). */
  payAtPickup?: boolean;
  /** Local orders: when marked ready. */
  readyAt?: string | null;
  /** Set when a shipped order was switched to local pickup / delivery from the admin. */
  localSwitch?: LocalSwitch | null;
  /** Website orders: the checkout consent the buyer ticked. Null = not given (older orders, in-person sales). */
  consent?: { at: string; text: string; ip: string } | null;
}

/** What to do with the shipping charged minus the local fee when an order is switched to local. */
export type SwitchHandling = "credit" | "refund_owed" | "keep" | "lower";

/** Record of a shipped order switched to local pickup / delivery (Order.localSwitchJson). */
export interface LocalSwitch {
  at: string;
  by: string;
  from: { method: string; shippingCents: number; tier: string };
  to: "pickup" | "delivery";
  /** Shipping charged before, the local fee, and charged after (kept or lowered). Cents. */
  feeCents: number;
  shippingAfterCents: number;
  /** Shipping charged minus the local fee (never below 0). */
  diffCents: number;
  /**
   * credit: added to the customer's store credit (the order keeps what was paid; the money stays in business money until spent).
   * refund_owed: the order's charge drops to the local fee; the store pays the difference back by hand.
   * keep: the order keeps what was charged. lower: an unpaid order's total simply drops.
   */
  handling: SwitchHandling;
  creditCents: number;
  refundOwedCents: number;
  refundPaidAt: string | null;
  note: string;
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
  dealId?: string;
  dealName?: string;
  /** Price each before a BOGO deal or owner price. */
  fullPriceCents?: number | null;
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
  /** Owner purchase at cost (prices are the saved costs). */
  owner?: Partner | null;
  /** Who received the money, when already picked. */
  cashTo?: CashHolder | null;
  /** Store credit picked. Taken from the balance only when the order is completed. */
  storeCreditCents?: number;
  referredById?: string | null;
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
  /** When the "How was your order?" review request was last sent (automatic or manual). */
  reviewRequestSentAt?: string | null;
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

export type PromotionKind = "code" | "auto" | "free_shipping" | "bogo";

/** Which products a BOGO deal side covers: whole products (every size) and/or single sizes. */
export interface DealItems {
  listingIds: string[];
  variantIds: string[];
}

/** A BOGO deal: buy `buy.qty` of the buy items, get `get.qty` of the get items at `percentOff` off. */
export interface BogoRule {
  buy: DealItems & { qty: number };
  /** `same`: the free item is the same item bought (its items are the buy items). */
  get: DealItems & { same: boolean; qty: number; percentOff: number };
  online: boolean;
  inPerson: boolean;
  /** Discount codes can't be used with this deal. */
  noCodes: boolean;
}

/** Cash can sit with a partner or in the bank. */
export type CashHolder = Partner | "bank";

export interface CashHandoffRec {
  id: string;
  date: string;
  from: CashHolder;
  to: CashHolder;
  amountCents: number;
  note: string;
  createdAt: string;
}

export const EXPENSE_CATEGORIES = [
  { value: "lab_testing", label: "Lab testing" },
  { value: "shipping_supplies", label: "Shipping supplies" },
  { value: "labels", label: "Labels" },
  { value: "packaging", label: "Packaging" },
  { value: "software", label: "Software/website" },
  { value: "other", label: "Other" },
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["value"];
export const expenseCategoryLabel = (c: string) => EXPENSE_CATEGORIES.find((x) => x.value === c)?.label ?? "Other";

/** A business expense. Lowers business money on its date (like a restock) and the cash of whoever paid. */
export interface ExpenseRec {
  id: string;
  date: string;
  category: ExpenseCategory;
  vendor: string;
  amountCents: number;
  paidBy: CashHolder;
  productIds: string[];
  lots: string;
  notes: string;
  /** Private invoice upload ("" = none). Opened through /api/expenses/file/{file}. */
  file: string;
  fileName: string;
  mime: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseEventRec {
  id: string;
  expenseId: string;
  at: string;
  action: "created" | "edited" | "deleted";
  message: string;
}

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
  /** Free shipping rules only: the shipping options it makes free. */
  shippingTiers: ("standard" | "priority" | "express")[];
  /** BOGO deals only. */
  bogo?: BogoRule | null;
  /** Automatic deals: show the sale price on products when the deal qualifies (percent off, no minimum, no cap). Default on. */
  showSalePrice?: boolean;
  active: boolean;
  createdAt: string;
  uses: PromotionUseRec[];
}

/** "approved" = live on the site, "pending" = needs review (flagged text), "hidden". */
export type ReviewStatus = "pending" | "approved" | "hidden";
export type ReviewPhotoStatus = "pending" | "approved" | "rejected";
export type ReviewSource = "email_link" | "account" | "guest";

export interface ReviewPhotoRec {
  id: string;
  file: string;
  width: number;
  height: number;
  status: ReviewPhotoStatus;
  sort: number;
  createdAt: string;
}

export interface ReviewRec {
  id: string;
  orderId: string | null;
  rating: number;
  title: string;
  text: string;
  displayName: string;
  /** Never shown publicly. */
  email: string;
  status: ReviewStatus;
  /** Why the text is waiting for a check. Empty = clean. */
  flagReason: string;
  verified: boolean;
  source: ReviewSource;
  edited: boolean;
  createdAt: string;
  photos: ReviewPhotoRec[];
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
  /** Cash moved between partners and the bank. Never changes business money. */
  cashHandoffs?: CashHandoffRec[];
  /** Store credit history of every customer. */
  creditEntries?: CreditEntryRec[];
  /** Business expenses (lab testing, supplies...). Each lowers business money on its date. */
  expenses?: ExpenseRec[];
  /** Every expense change, newest first (kept after an expense is deleted). */
  expenseEvents?: ExpenseEventRec[];
  store: StoreSettings;
  content: SiteContent;
  /** The one-time "sizes from product names" fill-in: when it ran and what it filled. Null before it ran. */
  sizeBackfill?: { ranAt: string; items: { productId: string; product: string; size: string }[] } | null;
}

/** True when an order counts in stock and money. */
export const countsInMoney = (status: OrderStatus) => status !== "awaiting_payment" && status !== "canceled";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  completed: "Completed",
  awaiting_payment: "Awaiting payment",
  paid: "Paid, no label",
  label_purchased: "Label purchased",
  shipped: "Shipped",
  ready: "Ready",
  picked_up: "Picked up",
  delivered: "Delivered",
  canceled: "Canceled",
};

/** Defaults for the fields added with the store, for code that builds records by hand (tests, old backups). */
export const ORDER_DEFAULTS = { number: null, source: "inperson", status: "completed", archived: false, shippingCents: 0, adminNote: "", web: null, owner: null, cashTo: null, storeCreditCents: 0, referredById: null } as const satisfies Partial<OrderRec>;
export const PRODUCT_DEFAULTS = { listingId: null, variantLabel: "", vialVolume: "", variantSort: 0, weightOz: null, testingStatus: "coming_soon" } as const satisfies Partial<ProductRec>;
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
  cashHandoffs: [] as CashHandoffRec[],
  creditEntries: [] as CreditEntryRec[],
  expenses: [] as ExpenseRec[],
  expenseEvents: [] as ExpenseEventRec[],
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
