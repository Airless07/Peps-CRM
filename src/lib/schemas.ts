import { z } from "zod";
import { isWeakPassword } from "./weak-passwords";
import { MAX_SELL_BUTTONS, MIN_SELL_BUTTONS, sellButtonsError } from "./sell-buttons";

const cents = z.number().int().min(-1_000_000_000).max(1_000_000_000);
const posCents = cents.min(0);
const dateStr = z
  .string()
  .refine((s) => !Number.isNaN(new Date(s).getTime()), "Invalid date")
  .transform((s) => new Date(s));
const idStr = z.string().min(1).max(64);
const partner = z.enum(["A", "B"]);
const text = (max = 500) => z.string().max(max).trim();
const percent = z.number().min(0).max(100);

export const productCreate = z.object({
  id: idStr,
  name: text(120).min(1, "Name is required"),
  defaultPriceCents: posCents,
  costOverrideCents: posCents.nullable().default(null),
  lowStockThreshold: z.number().int().min(0).max(100000).nullable().default(null),
  color: text(20).default("slate"),
  sortOrder: z.number().int().default(0),
  archived: z.boolean().default(false),
  variantLabel: text(40).default(""),
  vialVolume: text(20).default(""),
  variantSort: z.number().int().default(0),
  weightOz: z.number().min(0).max(2000).nullable().default(null),
  testingStatus: z.enum(["coa_available", "supplier_tested", "pending", "coming_soon"]).default("coming_soon"),
});
export const productUpdate = productCreate.omit({ id: true }).partial();

export const purchaseCreate = z.object({
  id: idStr,
  date: dateStr,
  productId: idStr,
  quantity: z.number().int().min(1).max(1_000_000),
  totalCostCents: posCents,
  note: text().default(""),
  fromInvestment: z.boolean().default(false),
  /** Who paid (Ahmad, Mo or Bank). Left out = not recorded (the bank). */
  paidBy: z.enum(["A", "B", "bank"]).nullable().optional(),
});
export const purchaseUpdate = purchaseCreate.omit({ id: true }).partial();

const adjustmentFields = z.object({
  id: idStr,
  date: dateStr,
  productId: idStr,
  quantity: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((n) => n !== 0, "Quantity can't be 0"),
  reason: z.enum(["lab_testing", "breakage", "freebie", "correction", "recount"], { message: "Pick a reason." }),
  note: text().default(""),
  lab: text(80).default(""),
  sampleId: text(60).default(""),
  lot: text(60).default(""),
  expenseId: idStr.nullable().default(null),
});
export const adjustmentCreate = adjustmentFields.refine((a) => a.reason !== "lab_testing" || a.quantity < 0, { message: "Lab testing removes vials from stock.", path: ["quantity"] });
export const adjustmentUpdate = adjustmentFields.omit({ id: true }).partial();

/** "Send samples to lab": lab and lot once, then product + vials rows. */
export const labShipmentInput = z.object({
  id: idStr,
  date: dateStr,
  lab: text(80).default(""),
  lot: text(60).default(""),
  expenseId: idStr.nullable().default(null),
  note: text().default(""),
  rows: z
    .array(z.object({ productId: idStr, quantity: z.number().int().min(1, "Each row needs at least 1 vial").max(100_000), sampleId: text(60).default("") }))
    .min(1, "Add at least one product")
    .max(100),
});

export const payoutCreate = z.object({
  id: idStr,
  date: dateStr,
  person: partner,
  amountCents: cents.refine((n) => n !== 0, "Amount can't be 0"),
  note: text().default(""),
});
export const payoutUpdate = payoutCreate.omit({ id: true }).partial();

export const orderLineInput = z.object({
  id: idStr,
  productId: idStr.nullable(),
  productName: text(120).default(""),
  quantity: z.number().int().min(1).max(100000),
  unitPriceCents: posCents,
  unitCostCents: posCents,
  cutPercent: percent,
  /** BOGO deal line: the deal id and name, and the price each before the deal. */
  dealId: text(64).default(""),
  dealName: text(120).default(""),
  fullPriceCents: posCents.nullable().default(null),
});

const ownerField = partner.nullable().default(null);
/** Who received the money of an in-person sale. */
const moneyHolder = z.enum(["A", "B", "bank"]);
const holderField = moneyHolder.nullable().default(null);

export const orderInput = z.object({
  id: idStr,
  date: dateStr,
  customer: text(120).default(""),
  /** Existing customer id, or a new id to create the customer named in `customer`. */
  customerId: idStr.nullable().default(null),
  paymentMethod: text(40).min(1).default("Unknown"),
  note: text().default(""),
  soldBy: z.enum(["A", "B", "W"]),
  discountType: z.enum(["$", "%"]).default("$"),
  discountValue: z.number().min(0).max(1_000_000_000).default(0),
  tipCents: posCents.default(0),
  lines: z.array(orderLineInput).min(1, "Add at least one item").max(200),
  /** Owner purchase at cost for this partner. */
  owner: ownerField,
  /** Who received the money (Ahmad, Mo or the bank). Required for a new sale (checked in recordSale). */
  cashTo: holderField,
  /** Store credit used. Capped by the balance and the total after discounts. */
  storeCreditCents: posCents.default(0),
  /** Customer who referred this sale. */
  referredById: idStr.nullable().default(null),
});

/** POST /api/orders: a sale, optionally completing a saved order (removed in the same transaction). */
export const saleInput = orderInput.extend({ fromSavedId: idStr.nullable().optional() });

export const savedOrderInput = z.object({
  id: idStr,
  savedAt: dateStr.optional(),
  customer: text(120).default(""),
  customerId: idStr.nullable().default(null),
  paymentMethod: text(40).default(""),
  note: text().default(""),
  soldBy: z.enum(["A", "B", "W"]),
  discountType: z.enum(["$", "%"]).default("$"),
  discountValue: z.number().min(0).max(1_000_000_000).default(0),
  tipCents: posCents.default(0),
  lines: z
    .array(orderLineInput.extend({ listPriceCents: posCents.nullable().default(null) }))
    .min(1, "Add at least one item")
    .max(200),
  owner: ownerField,
  cashTo: holderField,
  storeCreditCents: posCents.default(0),
  referredById: idStr.nullable().default(null),
});

const holder = z.enum(["A", "B", "bank"]);
export const cashHandoffCreate = z
  .object({
    id: idStr,
    date: dateStr,
    from: holder,
    to: holder,
    amountCents: posCents.refine((n) => n > 0, "Enter how much cash moved"),
    note: text().default(""),
  })
  .refine((h) => h.from !== h.to, "Pick two different places");

// Expenses. "Paid by" has NO default: it must be picked (Ahmad, Mo or Bank).
const EXPENSE_CATEGORY_VALUES = ["lab_testing", "shipping_supplies", "labels", "packaging", "software", "other"] as const;
export const expenseInput = z.object({
  date: dateStr,
  category: z.enum(EXPENSE_CATEGORY_VALUES).default("lab_testing"),
  vendor: text(120).default(""),
  amountCents: z.number().int().min(1, "Enter the amount").max(1_000_000_000),
  paidBy: z.enum(["A", "B", "bank"], { message: "Pick who paid (Ahmad, Mo or Bank)." }),
  productIds: z.array(idStr).max(100).default([]),
  lots: text(300).default(""),
  notes: text(2000).default(""),
  /** Private upload from POST /api/expenses/file ("" = none). */
  file: z.string().regex(/^([a-f0-9]{16}.(webp|pdf))?$/, "Upload the file again.").default(""),
  fileName: text(120).default(""),
  mime: z.enum(["", "application/pdf", "image/webp"]).default(""),
});
// Restock orders. "Paid by" has NO default. Lines: vials and what the supplier charged (0 when free).
export const restockInput = z.object({
  name: text(120).min(1, "Give the order a name"),
  date: dateStr,
  supplier: text(120).default(""),
  lot: text(60).default(""),
  notes: text(2000).default(""),
  paidBy: z.enum(["A", "B", "bank"], { message: "Pick who paid (Ahmad, Mo or Bank)." }),
  shippingCents: z.number().int().min(0).max(100_000_000).default(0),
  shippingDiscountCents: z.number().int().min(0).max(100_000_000).default(0),
  discountCents: z.number().int().min(0).max(100_000_000).default(0),
  feeMode: z.enum(["amount", "percent"]).default("amount"),
  feeValue: z.number().int().min(0).max(100_000_000).default(0),
  file: z.string().regex(/^([a-f0-9]{16}.(webp|pdf))?$/, "Upload the file again.").default(""),
  fileName: text(120).default(""),
  mime: z.enum(["", "application/pdf", "image/webp"]).default(""),
  lines: z
    .array(z.object({ productId: idStr, quantity: z.number().int().min(1, "Every line needs at least 1 vial").max(1_000_000), lineCents: z.number().int().min(0).max(1_000_000_000), free: z.boolean().default(false) }))
    .min(1, "Add at least one product")
    .max(200),
});
export const restockCreate = restockInput.extend({ id: idStr });

export const expenseCreate = expenseInput.extend({ id: idStr });

const sellButtonList = <T extends z.ZodType>(item: T, what: string) =>
  z.array(item).min(MIN_SELL_BUTTONS, `Keep at least ${MIN_SELL_BUTTONS} ${what} button`).max(MAX_SELL_BUTTONS, `No more than ${MAX_SELL_BUTTONS} ${what} buttons`);
export const sellButtonsInput = z
  .object({
    discounts: sellButtonList(z.object({ type: z.enum(["$", "%"]), value: z.number() }), "discount"),
    tips: sellButtonList(z.number(), "tip"),
  })
  .superRefine((v, ctx) => {
    const error = sellButtonsError(v);
    if (error) ctx.addIssue({ code: "custom", message: error });
  });

export const settingsUpdate = z
  .object({
    startingBalanceCents: cents,
    startDate: dateStr,
    businessCutPercent: percent,
    partnerAName: text(40).min(1),
    partnerBName: text(40).min(1),
    partnerARatio: percent,
    tipHandling: z.enum(["profit", "seller", "business"]),
    defaultSoldBy: partner,
    lowStockThreshold: z.number().int().min(0).max(100000),
    sellButtons: sellButtonsInput,
    /** Store settings and site content: whole objects, merged over the defaults when read. */
    store: z.record(z.string(), z.unknown()).transform((v) => JSON.stringify(v)),
    content: z.record(z.string(), z.unknown()).transform((v) => JSON.stringify(v)),
    paymentMethods: z
      .array(text(40).min(1, "Payment method names can't be empty"))
      .min(1, "Keep at least one payment method")
      .max(30)
      .refine((l) => new Set(l.map((x) => x.toLowerCase())).size === l.length, "Payment methods must be unique")
      .transform((l) => JSON.stringify(l)),
  })
  .partial();

const customerEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .refine((s) => s === "" || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s), "Enter a valid email address, like name@example.com");

export const customerCreate = z.object({
  id: idStr,
  name: text(120).min(1, "Name is required"),
  phone: text(40).default(""),
  email: customerEmail.default(""),
  notes: text(2000).default(""),
  referredById: idStr.nullable().default(null),
});
export const customerUpdate = customerCreate.omit({ id: true }).partial();

export const customerAccountAction = z.discriminatedUnion("action", [
  /** New single-use link (the old one stops working). Returned so it can be copied. */
  z.object({ action: z.literal("invite-link") }),
  z.object({ action: z.literal("invite-email") }),
  z.object({ action: z.literal("reset-email") }),
  /** The customer must change it at next sign in. Never stored or returned in plain text. */
  z.object({ action: z.literal("temp-password"), password: z.string().min(8, "Use at least 8 characters").max(200) }),
]);

export const creditAdjust = z.object({
  /** Positive adds, negative removes. */
  amountCents: z.number().int().min(-100_000_000).max(100_000_000).refine((n) => n !== 0, "Enter an amount"),
  reason: text(200).min(1, "Write a reason, for example Giveaway, Apology or Correction"),
  by: text(60).default(""),
});

export const customerMerge = z.object({
  /** The duplicate: its orders move to intoId, then it is deleted. */
  fromId: idStr,
  intoId: idStr,
});

export const passwordChange = z.object({
  current: z.string().min(1, "Enter your current password"),
  next: z
    .string()
    .min(12, "Use at least 12 characters for the admin password")
    .max(200)
    .refine((v) => !isWeakPassword(v), "That password is too common. Pick a longer, unusual one (a few random words work well)."),
});

export const splitConfirm = z.object({
  id: idStr,
  date: dateStr.optional(),
  note: text().default(""),
  /** Pending amounts the user saw; the server refuses if numbers changed meanwhile. */
  expectedA: cents,
  expectedB: cents,
});
