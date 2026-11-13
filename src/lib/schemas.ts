import { z } from "zod";

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
});
export const purchaseUpdate = purchaseCreate.omit({ id: true }).partial();

export const adjustmentCreate = z.object({
  id: idStr,
  date: dateStr,
  productId: idStr,
  quantity: z
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((n) => n !== 0, "Quantity can't be 0"),
  reason: z.enum(["breakage", "freebie", "correction"]),
  note: text().default(""),
});
export const adjustmentUpdate = adjustmentCreate.omit({ id: true }).partial();

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
});

export const orderInput = z.object({
  id: idStr,
  date: dateStr,
  customer: text(120).default(""),
  note: text().default(""),
  soldBy: partner,
  discountType: z.enum(["$", "%"]).default("$"),
  discountValue: z.number().min(0).max(1_000_000_000).default(0),
  tipCents: posCents.default(0),
  lines: z.array(orderLineInput).min(1, "Add at least one item").max(200),
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
  })
  .partial();

export const passwordChange = z.object({
  current: z.string().min(1, "Enter your current password"),
  next: z.string().min(6, "New password must be at least 6 characters").max(200),
});

export const splitConfirm = z.object({
  id: idStr,
  date: dateStr.optional(),
  note: text().default(""),
  /** Pending amounts the user saw; the server refuses if numbers changed meanwhile. */
  expectedA: cents,
  expectedB: cents,
});
