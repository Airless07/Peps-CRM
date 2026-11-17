// Store settings and site content. Both are stored as JSON on the Settings row and merged
// over these defaults, so adding a field later never needs a database migration.
// Pure: safe to import from server and client.

export interface ShipFrom {
  name: string;
  street1: string;
  street2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
  email: string;
}

export interface StoreSettings {
  /** Store open to the public. Closed shows "Coming soon" (admins can still preview). */
  open: boolean;
  storeName: string;
  /** Upload ids (see uploads). Empty = text wordmark / default icon. */
  logo: string;
  favicon: string;
  accentColor: string;
  payments: PaymentSettings;
  /** Extra line shown with the payment instructions. */
  paymentNote: string;
  autoCancelHours: number;
  /** "live" = Shippo rates by address, "flat" = the flat price of each tier. */
  shippingMode: "flat" | "live";
  shippingTiers: ShippingTier[];
  /** Tier ids that free shipping rules apply to. */
  freeShippingTiers: ShippingTierId[];
  /** Store-wide "buy more, save more" tiers. A product can override them. */
  qtyDeals: { minQty: number; percentOff: number }[];
  shipFrom: ShipFrom;
  parcel: { lengthIn: number; widthIn: number; heightIn: number; weightOz: number };
  alertEmails: string[];
  emailFromName: string;
  emailFromAddress: string;
  bestSellerMode: "auto" | "manual";
  /** Public address of the site, used in emails and the sitemap. Empty = taken from the request. */
  siteUrl: string;
  /** Email the customer a payment reminder when an unpaid order is halfway to auto-cancel. */
  unpaidReminder: boolean;
  /** Email the alert list when a variant drops to its low stock threshold. */
  lowStockAlerts: boolean;
}

export type ShippingTierId = "standard" | "priority" | "express";
export interface ShippingTier {
  id: ShippingTierId;
  name: string;
  enabled: boolean;
  flatCents: number;
}
/** The USPS service each tier buys through Shippo. */
export const TIER_SERVICE: Record<ShippingTierId, { token: string; label: string }> = {
  standard: { token: "usps_ground_advantage", label: "USPS Ground Advantage" },
  priority: { token: "usps_priority", label: "USPS Priority Mail" },
  express: { token: "usps_priority_express", label: "USPS Priority Mail Express" },
};

export type PayMethodId = "zelle" | "cashapp" | "venmo" | "bank" | "card";
export interface PaymentSettings {
  zelle: { enabled: boolean; details: string };
  cashapp: { enabled: boolean; details: string };
  venmo: { enabled: boolean; details: string };
  /** Not available yet. "show" lists it greyed out with a Coming soon tag. */
  bank: { enabled: boolean; comingSoon: "show" | "hide" };
  card: { enabled: boolean; comingSoon: "show" | "hide" };
}

export const DEFAULT_ACCENT = "#9f1d22";

export const DEFAULT_STORE: StoreSettings = {
  open: false,
  storeName: "Buckshot Labs",
  logo: "",
  favicon: "",
  accentColor: DEFAULT_ACCENT,
  payments: {
    zelle: { enabled: true, details: "" },
    cashapp: { enabled: false, details: "" },
    venmo: { enabled: false, details: "" },
    bank: { enabled: false, comingSoon: "hide" },
    card: { enabled: false, comingSoon: "hide" },
  },
  paymentNote: "",
  autoCancelHours: 24,
  shippingMode: "flat",
  shippingTiers: [
    { id: "standard", name: "Standard", enabled: true, flatCents: 695 },
    { id: "priority", name: "Priority", enabled: true, flatCents: 1195 },
    { id: "express", name: "Express", enabled: true, flatCents: 3495 },
  ],
  freeShippingTiers: ["standard"],
  qtyDeals: [
    { minQty: 2, percentOff: 5 },
    { minQty: 3, percentOff: 10 },
  ],
  shipFrom: { name: "", street1: "", street2: "", city: "", state: "", zip: "", country: "US", phone: "", email: "" },
  parcel: { lengthIn: 6, widthIn: 4, heightIn: 2, weightOz: 4 },
  alertEmails: [],
  emailFromName: "Buckshot Labs",
  emailFromAddress: "",
  bestSellerMode: "auto",
  siteUrl: "",
  unpaidReminder: true,
  lowStockAlerts: true,
};

export type SectionId = "bestsellers" | "groups" | "products" | "quality" | "reviews" | "faq";
export type PolicyId = "terms" | "privacy" | "shipping" | "refunds" | "research-use";

export interface PolicyDoc {
  title: string;
  body: string;
  /** Owner ticked "reviewed". Until then admin shows the draft warning. */
  reviewed: boolean;
}

export interface SiteContent {
  hero: {
    layout: "full" | "split";
    image: string;
    video: string;
    /** 0-90, darkness of the overlay on the hero photo. */
    overlay: number;
    eyebrow: string;
    headline: string;
    subtext: string;
    buttonText: string;
    buttonLink: string;
    /** Upload ids of transparent vial images for the hero pyramid. Empty = bundled default. */
    vials: { left: string; center: string; right: string };
  };
  /** Home page sections in display order. */
  sections: { id: SectionId; title: string; show: boolean }[];
  quality: { body: string; points: { title: string; text: string }[] };
  faq: { q: string; a: string }[];
  about: { title: string; body: string };
  contact: { email: string; phone: string; hours: string; note: string };
  footerText: string;
  policies: Record<PolicyId, PolicyDoc>;
  announcement: {
    mode: "auto" | "custom" | "off";
    text: string;
    /** Optional code shown with a copy button. */
    code: string;
    startsAt: string | null;
    endsAt: string | null;
  };
  seo: { title: string; description: string; image: string };
  /** The two boxes a customer must tick to place an order. */
  acknowledgments: { research: string; policies: string };
  testing: { title: string; body: string };
}

/** Short honest line used where there is no editable text: footer fallback, Coming soon page, link preview image. */
export const TAGLINE = "Research materials with testing status shown on every product.";
/** In a FAQ answer this is replaced with the payment methods that are switched on (see faqForDisplay). */
export const PAY_METHODS_TOKEN = "{payment_methods}";

export const RESEARCH_LINE = "All products are sold for laboratory research use only. Not for human consumption. Not evaluated by the FDA.";

const policy = (title: string, body: string): PolicyDoc => ({ title, body: body.trim(), reviewed: false });

export const DEFAULT_CONTENT: SiteContent = {
  hero: {
    layout: "full",
    image: "",
    video: "",
    overlay: 45,
    eyebrow: "Research compounds",
    headline: "Research peptides for the lab.",
    subtext: "Research materials with testing status shown on every product. Certificates of analysis are published per batch as they're completed.",
    buttonText: "Shop all products",
    buttonLink: "/shop",
    vials: { left: "", center: "", right: "" },
  },
  sections: [
    { id: "bestsellers", title: "Best sellers", show: true },
    { id: "groups", title: "Shop by category", show: true },
    { id: "products", title: "All products", show: true },
    { id: "quality", title: "Testing, shown honestly", show: true },
    { id: "reviews", title: "Order experience", show: true },
    { id: "faq", title: "Common questions", show: true },
  ],
  quality: {
    body: "Every product shows where it stands: certificate on file, tested by the supplier, testing pending, or certificate coming soon. When a certificate of analysis is completed for a batch, it is posted on the product page.",
    points: [
      { title: "Status on every product", text: "Each product and size shows its current testing status, so you know what is on file before you order." },
      { title: "COAs by batch", text: "Certificates of analysis are published per batch as they are completed. Earlier batches stay on file." },
      { title: "Lot traceability", text: "When a certificate is on file, it lists the lot number it covers." },
    ],
  },
  faq: [
    { q: "How do I pay?", a: `After you place an order you get payment instructions for ${PAY_METHODS_TOKEN}, with your order number and the exact amount. Put the order number in the memo so we can match your payment.` },
    { q: "When does my order ship?", a: "Orders ship after payment is confirmed. You get an email with tracking as soon as the label is created." },
    { q: "Where can I find the certificate of analysis?", a: "When a certificate is on file, it is on the product page under the size you select, and on the Testing page. Products that are still waiting on a certificate say so." },
    { q: "What are these products for?", a: "All products are sold for laboratory research use only. They are not for human consumption." },
  ],
  about: {
    title: "About Buckshot Labs",
    body: "Buckshot Labs supplies research compounds and shows the testing status of every product. Certificates of analysis are published per batch as they are completed. We keep the catalog small and ship quickly.",
  },
  contact: { email: "", phone: "", hours: "", note: "We usually reply within one business day." },
  footerText: "",
  announcement: { mode: "auto", text: "", code: "", startsAt: null, endsAt: null },
  acknowledgments: {
    research: "I understand these products are sold strictly for laboratory research use and are not for human or veterinary use or consumption.",
    policies: "I agree to the Terms, Privacy, Shipping and Returns policies.",
  },
  testing: {
    title: "Testing and certificates",
    body: "We publish what we know about every batch. When a certificate of analysis is on file you can open it from the table below or from the product page. When testing is still in progress, we say so.",
  },
  seo: {
    title: "Buckshot Labs | Research peptides with testing status on every product",
    description: "Research materials with testing status shown on every product. Certificates of analysis are published per batch as they are completed. For laboratory research use only.",
    image: "",
  },
  policies: {
    terms: policy(
      "Terms of Service",
      `
These terms apply to every order placed on this website. By placing an order you agree to them.

## Research use only
All products are sold strictly for laboratory research use. They are not drugs, foods, cosmetics, or dietary supplements, and they are not for human or animal consumption. Nothing on this site is medical advice.

## Who can order
You must be at least 21 years old. By ordering, you confirm that you are a qualified researcher or are buying on behalf of one, and that you will handle the products according to all laws that apply to you.

## Orders and payment
An order is confirmed only once we receive your payment. Unpaid orders are canceled automatically after the time shown on your order page. We may refuse or cancel any order.

## Pricing and availability
Prices and stock can change without notice. If an item is unavailable after you pay, we will refund it.

## Your responsibilities
You are responsible for the safe storage, handling, and use of the products, and for following the laws of your jurisdiction. You agree not to resell products for human consumption.

## Limitation of liability
Products are provided as is. To the fullest extent allowed by law, our liability is limited to the amount you paid for the order.

## Changes
We may update these terms. The version posted when you place an order applies to that order.
`,
    ),
    privacy: policy(
      "Privacy Policy",
      `
This policy explains what we collect and how we use it.

## What we collect
When you order or contact us we collect your name, email address, shipping address, and phone number if you give it. If you upload a payment screenshot, we keep it with your order.

## How we use it
We use this information to process and ship your order, send order updates by email, answer your questions, and keep business records. We do not sell your personal information.

## Who we share it with
We share only what is needed with the services that help us operate: our shipping carrier and label provider (to deliver your order) and our email provider (to send order emails).

## Cookies
We use a small number of cookies and local storage entries to remember your cart and your age confirmation. We do not use advertising trackers.

## Keeping your data
We keep order records for as long as needed for accounting and legal purposes. You can ask us to correct or delete your information by contacting us.

## Contact
Questions about privacy can be sent through the contact page.
`,
    ),
    shipping: policy(
      "Shipping Policy",
      `
## Processing time
Orders ship after payment is confirmed, usually within 1 to 2 business days.

## Carriers and tracking
We ship within the United States. You receive an email with a tracking number as soon as your label is created.

## Shipping cost
The shipping cost is shown at checkout before you place your order. Free shipping offers, when available, are applied automatically.

## Address accuracy
Please check your address carefully. We are not responsible for packages sent to an incorrect address provided at checkout.

## Lost or damaged packages
If your package arrives damaged or tracking shows a problem, contact us within 7 days of delivery and we will help resolve it.
`,
    ),
    refunds: policy(
      "Refund Policy",
      `
## Cancellations
You can cancel an order any time before it ships by contacting us. Unpaid orders are canceled automatically.

## Returns
Because of the nature of research materials, we cannot accept returns of opened products.

## Damaged or incorrect items
If an item arrives damaged or you received the wrong item, contact us within 7 days of delivery with your order number and a photo. We will replace the item or refund it.

## How refunds are sent
Approved refunds are returned through the payment method you used, usually within 3 business days.
`,
    ),
    "research-use": policy(
      "Research Use Only",
      `
${RESEARCH_LINE}

## What this means
The products on this website are chemical compounds intended for in-vitro laboratory research only. They are not medicines, supplements, or cosmetics. They are not intended to diagnose, treat, cure, or prevent any disease.

## No guidance on use
We do not provide instructions, dosing information, or advice about use in humans or animals, and our staff cannot answer questions of that kind.

## Buyer confirmation
By purchasing, you confirm that you are at least 21 years old, that you understand the nature of these materials, and that you will use them only for lawful laboratory research.
`,
    ),
  },
};

export const POLICY_IDS: PolicyId[] = ["terms", "privacy", "shipping", "refunds", "research-use"];

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => typeof v === "object" && v !== null && !Array.isArray(v);

/** Deep merge `over` onto `base`: objects merge key by key, everything else (arrays included) is replaced. */
export function mergeDeep<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : (over as T)) as T;
  const out: Loose = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    const b = (base as Loose)[k];
    out[k] = isObj(b) && isObj(v) ? mergeDeep(b, v) : v;
  }
  return out as T;
}

function parse(json: string | null | undefined): unknown {
  if (!json) return {};
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export function parseStore(json: string | null | undefined): StoreSettings {
  const s = mergeDeep(DEFAULT_STORE, parse(json));
  if (!/^#[0-9a-fA-F]{6}$/.test(s.accentColor)) s.accentColor = DEFAULT_ACCENT;
  if (!Array.isArray(s.alertEmails)) s.alertEmails = [];
  // Tiers: always the three known ids, in order, with saved values on top.
  const saved = new Map((Array.isArray(s.shippingTiers) ? s.shippingTiers : []).map((t) => [t?.id, t]));
  s.shippingTiers = DEFAULT_STORE.shippingTiers.map((t) => ({ ...t, ...(saved.get(t.id) ?? {}), id: t.id }));
  if (!Array.isArray(s.freeShippingTiers)) s.freeShippingTiers = ["standard"];
  s.qtyDeals = cleanQtyDeals(s.qtyDeals) ?? [];
  s.autoCancelHours = Math.min(720, Math.max(1, Number(s.autoCancelHours) || 24));
  // Both default to on, also for settings saved before these switches existed.
  s.unpaidReminder = s.unpaidReminder !== false;
  s.lowStockAlerts = s.lowStockAlerts !== false;
  return s;
}

export function parseContent(json: string | null | undefined): SiteContent {
  const c = mergeDeep(DEFAULT_CONTENT, parse(json));
  // Sections: keep the saved order, drop unknown ids, add any section introduced later.
  const known = new Map(DEFAULT_CONTENT.sections.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const sections = (Array.isArray(c.sections) ? c.sections : []).filter((s) => {
    if (!s || !known.has(s.id) || seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
  for (const s of DEFAULT_CONTENT.sections) if (!seen.has(s.id)) sections.push(s);
  c.sections = sections;
  if (!Array.isArray(c.faq)) c.faq = DEFAULT_CONTENT.faq;
  return c;
}

/** Valid tiers, sorted by quantity. Null when the input is not a list. */
export function cleanQtyDeals(v: unknown): { minQty: number; percentOff: number }[] | null {
  if (!Array.isArray(v)) return null;
  const byQty = new Map<number, number>();
  for (const t of v) {
    const minQty = Math.floor(Number(t?.minQty));
    const percentOff = Number(t?.percentOff);
    if (minQty >= 2 && minQty <= 1000 && percentOff > 0 && percentOff < 100) byQty.set(minQty, percentOff);
  }
  return [...byQty.entries()].sort((a, b) => a[0] - b[0]).map(([minQty, percentOff]) => ({ minQty, percentOff }));
}

/** Launch checklist inputs that come from settings alone. */
export const paymentInfoSet = (s: StoreSettings) =>
  (["zelle", "cashapp", "venmo"] as const).some((m) => s.payments[m].enabled && !!s.payments[m].details.trim());
export const shipFromSet = (s: StoreSettings) => {
  const f = s.shipFrom;
  return !!(f.name.trim() && f.street1.trim() && f.city.trim() && f.state.trim() && f.zip.trim());
};
