// Input validation for the store (public) and the new admin routes.
import { z } from "zod";

const text = (max = 500) => z.string().max(max).trim();
const idStr = z.string().min(1).max(64);
const cents = z.number().int().min(0).max(100_000_000);
const optDate = z
  .string()
  .nullable()
  .optional()
  .refine((s) => !s || !Number.isNaN(new Date(s).getTime()), "That date is not valid")
  .transform((s) => (s ? new Date(s) : null));

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, "Enter a valid email address, like name@example.com");

const US_STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(" ");
export const STATES = US_STATES;

export const address = z.object({
  name: text(100).min(2, "Enter the full name for the shipping label"),
  street1: text(120).min(3, "Enter the street address"),
  street2: text(120).default(""),
  city: text(80).min(2, "Enter the city"),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .refine((s) => US_STATES.includes(s), "Pick a US state"),
  zip: z
    .string()
    .trim()
    .regex(/^\d{5}(-\d{4})?$/, "Enter a 5 digit ZIP code"),
  country: z.literal("US").default("US"),
});

export const cartItems = z
  .array(z.object({ variantId: idStr, quantity: z.number().int().min(1).max(99) }))
  .max(60);

export const quoteInput = z.object({
  items: cartItems,
  code: text(40).default(""),
  /** Referral code (separate slot: one referral code and one discount code per order at most). */
  referralCode: text(40).default(""),
  shipTo: address.partial().nullable().optional(),
});

const tier = z.enum(["standard", "priority", "express"]);

export const checkoutInput = z.object({
  phone: text(30).default(""),
  shipTo: address,
  items: cartItems.min(1, "Your cart is empty"),
  code: text(40).default(""),
  /** Shipping option; empty for local pickup / delivery. */
  tier: z.union([tier, z.literal("")]).default(""),
  /** "ship" | "pickup" | "delivery" (local methods are re-checked on the server). */
  fulfillment: z.enum(["ship", "pickup", "delivery"]).default("ship"),
  localTime: text(60).default(""),
  localNotes: text(500).default(""),
  payChoice: text(20).min(1, "Pick a payment method"),
  expectedTotalCents: cents,
  /** The required "21+ and research use only" box. Checked again on the server (Settings can turn it off). */
  consent: z.boolean().default(false),
  saveAddress: z.boolean().default(true),
  /** Store credit to use (capped by the balance and the total). */
  storeCreditCents: cents.default(0),
  /** Optional referral code from a friend. */
  referralCode: text(40).default(""),
  /** The account the browser built this cart for. Refused when the session is a different account. */
  accountId: z.string().max(64).nullable().optional(),
});

const password = z.string().min(8, "Use at least 8 characters for your password").max(200);

export const accountAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("signup"), name: text(100).min(2, "Enter your name"), email, password }),
  z.object({ action: z.literal("signin"), email, password: z.string().min(1, "Enter your password").max(200) }),
  z.object({ action: z.literal("signout") }),
  z.object({ action: z.literal("reset-request"), email }),
  z.object({ action: z.literal("reset"), token: z.string().min(10).max(200), password }),
  z.object({ action: z.literal("addresses"), addresses: z.array(address).max(5) }),
  z.object({ action: z.literal("profile"), name: text(100).min(2, "Enter your name"), phone: text(30).default("") }),
  /** Use an invite / claim link: choose a password and sign in. */
  z
    .object({ action: z.literal("claim"), token: z.string().min(20).max(200), password, email: email.optional(), confirm: z.string().max(200).optional() })
    .refine((v) => v.confirm === undefined || v.confirm === v.password, { message: "The two passwords don't match", path: ["confirm"] }),
  /** Choose a new password while signed in (required after a temporary password). */
  z.object({ action: z.literal("change-password"), password, current: z.string().max(200).optional() }),
  /** Referral code: check if a code is free (live message), or change to it. */
  z.object({ action: z.literal("check-code"), code: z.string().max(40) }),
  z.object({ action: z.literal("referral-code"), code: z.string().max(40) }),
]);

export const lookupInput = z.object({ number: z.coerce.number().int().min(1001).max(99_999_999), email });

export const contactInput = z.object({
  name: text(100).min(2, "Enter your name"),
  email,
  orderNumber: text(20).default(""),
  message: text(4000).min(10, "Write a few more words so we can help"),
  /** Honeypot: real people leave it empty. */
  website: z.string().max(0).optional(),
});


// ---------------------------------------------------------------- Admin
export const orderAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("mark-paid"), paymentMethod: text(40).min(1), notify: z.boolean().default(true) }),
  z.object({ action: z.literal("cancel"), reason: text(200).default(""), notify: z.boolean().default(true) }),
  z.object({ action: z.literal("buy-label"), rateId: z.string().max(100).optional() }),
  z.object({ action: z.literal("mark-shipped"), trackingNumber: text(60).default(""), carrier: text(30).default("") }),
  z.object({ action: z.literal("mark-delivered") }),
  z.object({ action: z.literal("send-review-request"), resend: z.boolean().default(false) }),
  z.object({ action: z.literal("check-tracking") }),
  z.object({ action: z.literal("archive") }),
  z.object({ action: z.literal("unarchive") }),
  z.object({ action: z.literal("contact"), email, phone: text(30).default(""), shipTo: address }),
  z.object({ action: z.literal("note"), note: text(500).min(1) }),
  // Internal note for the team (may be empty to clear it). Never shown to the customer.
  z.object({ action: z.literal("admin-note"), note: text(2000) }),
  // Local pickup / delivery.
  z.object({ action: z.literal("mark-ready"), notify: z.boolean().default(true) }),
  z.object({ action: z.literal("mark-handed-over") }),
  // Switch a shipped order (no label yet) to local pickup / delivery.
  z.object({
    action: z.literal("switch-local"),
    to: z.enum(["pickup", "delivery"]),
    address: address.optional(),
    localTime: text(60).default(""),
    note: text(500).default(""),
    handling: z.enum(["credit", "refund_owed", "keep", "lower"]).default("credit"),
    notify: z.boolean().default(true),
    by: text(40).default("Admin"),
    expectedShippingCents: cents,
  }),
  z.object({ action: z.literal("switch-refund-paid"), by: text(40).default("Admin") }),
  // Money given back (partial or full). expectedRefundedCents guards against recording the same refund twice.
  z.object({ action: z.literal("refund"), amountCents: cents.min(1, "Enter the amount you refunded"), expectedRefundedCents: cents, reason: text(200).default("") }),
]);

const qtyDeals = z.array(z.object({ minQty: z.number().int().min(2).max(1000), percentOff: z.number().gt(0).lt(100) })).max(8);
const photo = z.object({ id: z.string().regex(/^[a-f0-9]{16}$/), alt: text(160).default("") });

export const listingUpdate = z
  .object({
    name: text(120).min(1, "The product needs a name"),
    slug: text(80),
    summary: text(300),
    description: text(6000),
    casNumber: text(60),
    formula: text(120),
    molecularWeight: text(60),
    purity: text(40),
    form: text(80),
    storage: text(200),
    showOnWebsite: z.boolean(),
    photos: z.array(photo).max(12),
    hoverGif: z.string().max(40),
    groupIds: z.array(idStr).max(30),
    badges: z.array(text(24).min(1)).max(6),
    bestSeller: z.boolean(),
    qtyDeals: qtyDeals.nullable(),
    sortOrder: z.number().int(),
    seoTitle: text(120),
    seoDescription: text(300),
  })
  .partial();

const variantFields = {
  name: text(120).min(1, "Name is required"),
  variantLabel: text(40).default(""),
  vialVolume: text(20).default(""),
  defaultPriceCents: cents,
  costOverrideCents: cents.nullable().default(null),
  lowStockThreshold: z.number().int().min(0).max(100000).nullable().default(null),
  weightOz: z.number().min(0).max(2000).nullable().default(null),
  testingStatus: z.enum(["coa_available", "supplier_tested", "pending", "coming_soon"]).default("coming_soon"),
  color: text(20).default("slate"),
};

/** New product = a parent plus its first size. */
export const listingCreate = z.object({ id: idStr, name: text(120).min(1, "The product needs a name"), variant: z.object({ id: idStr, ...variantFields }) });
/** Add a size to an existing product. */
export const variantCreate = z.object({ id: idStr, listingId: idStr, ...variantFields });

export const combineInput = z.object({ name: text(120).min(1), items: z.array(z.object({ productId: idStr, label: text(40).min(1) })).min(2).max(20) });
export const groupInput = z.object({ id: idStr, name: text(60).min(1, "The group needs a name") });

export const promotionInput = z.object({
  id: idStr,
  kind: z.enum(["code", "auto", "free_shipping", "bogo"]),
  name: text(80).default(""),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .max(30)
    .regex(/^[A-Z0-9_-]*$/, "A code can only use letters, numbers, dashes and underscores")
    .default(""),
  discountType: z.enum(["$", "%"]).default("$"),
  discountValue: z.number().min(0).max(1_000_000).default(0),
  minSubtotalCents: cents.default(0),
  startsAt: optDate,
  endsAt: optDate,
  maxUses: z.number().int().min(1).max(1_000_000).nullable().default(null),
  oncePerEmail: z.boolean().default(false),
  listingIds: z.array(idStr).max(200).default([]),
  groupIds: z.array(idStr).max(50).default([]),
  /** Free shipping rules: which shipping options it makes free (at least one, checked in the route). */
  shippingTiers: z.array(z.enum(["standard", "priority", "express"])).max(3).default([]),
  /** BOGO deals: the buy / get rule (checked in the route). */
  bogo: z
    .object({
      buy: z.object({ listingIds: z.array(idStr).max(200).default([]), variantIds: z.array(idStr).max(500).default([]), qty: z.number().int().min(1).max(99).default(1) }),
      get: z.object({
        same: z.boolean().default(true),
        listingIds: z.array(idStr).max(200).default([]),
        variantIds: z.array(idStr).max(500).default([]),
        qty: z.number().int().min(1).max(99).default(1),
        percentOff: z.number().int().min(1).max(100).default(100),
      }),
      online: z.boolean().default(true),
      inPerson: z.boolean().default(true),
      noCodes: z.boolean().default(false),
    })
    .nullable()
    .optional(),
  active: z.boolean().default(true),
});

export const reviewUpdate = z.object({ status: z.enum(["pending", "approved", "hidden"]).optional(), title: text(80).optional(), text: text(1500).optional(), displayName: text(60).min(1).optional(), verified: z.boolean().optional() });
export const coaUpdate = z.object({ lot: text(60).optional(), testDate: optDate, purity: text(40).optional(), isCurrent: z.boolean().optional() });
