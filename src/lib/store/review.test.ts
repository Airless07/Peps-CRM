// Tests for the Buckshot Labs review pass: rebrand, honest testing copy, product data checks,
// storefront fixes, admin helpers, reminder / low stock emails, analytics. Pure (no database).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyticsDay, isBot, summarize } from "../analytics";
import { sellGroups, sellVariantLabel } from "../admin/sell-groups";
import {
  adminNewOrderEmail,
  canceledEmail,
  deliveredEmail,
  lowStockEmail,
  orderReceivedEmail,
  passwordResetEmail,
  paymentConfirmedEmail,
  paymentReminderEmail,
  renderEmail,
  shippedEmail,
  testEmail,
  timeLeftText,
  type EmailOrder,
} from "../email";
import { computeLedger } from "../money";
import { lowStockCrossings } from "../stock-alerts";
import type { AppData, ListingRec, ProductRec } from "../types";
import { DEFAULT_SETTINGS, emptyStoreData, PRODUCT_DEFAULTS, type TestingStatus } from "../types";
import { bestSellerRow, buildCatalog, type PublicProduct } from "./catalog";
import { DEFAULT_CONTENT, DEFAULT_STORE, parseContent, parseStore, PAY_METHODS_TOKEN, TAGLINE, type PaymentSettings } from "./config";
import { faqForDisplay, joinOr, payMethodsText, productTestingSummary, testingClaim } from "./copy";
import { OLD_BRAND } from "./legacy-fixture";
import { INFO_FIELDS, listingsMissingInfo, listingsWithNoInfo, nameWithoutSize, sizeInName, websiteInfo } from "./product-info";
import { ROBOTS_DISALLOW, robotsFor } from "./robots";

const day = (n: number, h = 12) => new Date(Date.UTC(2026, 0, n, h)).toISOString();
const NOW = new Date(day(15));

const listing = (id: string, over: Partial<ListingRec> = {}): ListingRec => ({
  id,
  name: id.toUpperCase(),
  slug: id,
  summary: "",
  description: "",
  casNumber: "",
  formula: "",
  molecularWeight: "",
  purity: "",
  form: "",
  storage: "",
  showOnWebsite: true,
  photos: [],
  hoverGif: "",
  groupIds: [],
  badges: [],
  bestSeller: false,
  qtyDeals: null,
  sortOrder: 0,
  seoTitle: "",
  seoDescription: "",
  createdAt: day(1),
  ...over,
});
const product = (id: string, listingId: string | null, price: number, over: Partial<ProductRec> = {}): ProductRec => ({
  id,
  name: id,
  defaultPriceCents: price,
  costOverrideCents: null,
  lowStockThreshold: null,
  color: "slate",
  sortOrder: 0,
  archived: false,
  createdAt: day(1),
  ...PRODUCT_DEFAULTS,
  listingId,
  ...over,
});
function appData(over: Partial<AppData> = {}): AppData {
  return { settings: { ...DEFAULT_SETTINGS, startingBalanceCents: 0 }, products: [], customers: [], purchases: [], adjustments: [], orders: [], splits: [], payouts: [], ...emptyStoreData(), ...over };
}
const withZelle = (over: Partial<PaymentSettings> = {}): PaymentSettings => ({ ...DEFAULT_STORE.payments, zelle: { enabled: true, details: "pay@example.com" }, ...over });

// Claims that were false while most products are "COA coming soon".
const FALSE_CLAIMS = /every lot|every batch is|each batch is sent|independent lab|third-party tested, and|lot-specific|verified batch|COA on every product|certificate of analysis for every|third-party certificates of analysis for every/i;

// ---------------------------------------------------------------- 1. Rebrand
describe("rebrand to Buckshot Labs", () => {
  it("defaults use the new name everywhere", () => {
    expect(DEFAULT_STORE.storeName).toBe("Buckshot Labs");
    expect(DEFAULT_STORE.emailFromName).toBe("Buckshot Labs");
    expect(DEFAULT_CONTENT.about.title).toBe("About Buckshot Labs");
    expect(DEFAULT_CONTENT.seo.title).toMatch(/^Buckshot Labs \|/);
    const all = JSON.stringify({ DEFAULT_STORE, DEFAULT_CONTENT });
    expect(all).not.toContain(OLD_BRAND);
    expect(all).not.toMatch(/\bPeps\b/);
  });

  it("a store saved with no name falls back to the new name", () => {
    expect(parseStore("{}").storeName).toBe("Buckshot Labs");
    expect(parseStore(JSON.stringify({ open: true })).emailFromName).toBe("Buckshot Labs");
  });

  it("every email carries the store name from Settings and never the old one", () => {
    const o: EmailOrder = { number: 1001, name: "Dana Reed", email: "d@example.com", lines: [{ name: "Reta 10mg", quantity: 2, totalCents: 7600 }], subtotalCents: 7600, discountCents: 0, shippingCents: 695, totalCents: 8295, shippingMethod: "Standard", shipTo: ["Dana Reed"], statusUrl: "https://x.test/order/t" };
    const pay = { name: "Zelle", sendTo: "pay@example.com", note: "" };
    const all = [
      orderReceivedEmail(DEFAULT_STORE, o, pay, new Date(day(16))),
      paymentReminderEmail(DEFAULT_STORE, o, pay, new Date(day(16)), new Date(day(15))),
      paymentConfirmedEmail(DEFAULT_STORE, o),
      shippedEmail(DEFAULT_STORE, o, { number: "9400", carrier: "USPS", url: null }),
      deliveredEmail(DEFAULT_STORE, o, "https://x.test/review/r"),
      canceledEmail(DEFAULT_STORE, o, "Canceled"),
      passwordResetEmail(DEFAULT_STORE, "https://x.test/reset"),
      adminNewOrderEmail(DEFAULT_STORE, o, "https://x.test/admin"),
      lowStockEmail(DEFAULT_STORE, [{ name: "Reta 10mg", stock: 3, lowAt: 3 }], "https://x.test/admin/inventory"),
      testEmail(DEFAULT_STORE),
    ];
    for (const c of all) {
      const { html, text } = renderEmail(DEFAULT_STORE, c);
      expect(html).toContain("Buckshot Labs");
      expect(text).toContain("Buckshot Labs");
      for (const s of [html, text, c.subject]) {
        expect(s).not.toContain(OLD_BRAND);
        expect(s).not.toMatch(FALSE_CLAIMS);
        expect(s).not.toMatch(/third-party tested/i);
      }
    }
  });

  it("source files that show text to people do not contain the old name", () => {
    const root = path.resolve(import.meta.dirname, "../../..");
    for (const f of ["src/app/manifest.ts", "src/app/admin/layout.tsx", "src/app/admin/login/page.tsx", "src/components/shell.tsx", "src/lib/store/config.ts", "README.md", "launch.bat", "PRODUCT.md"]) {
      const text = readFileSync(path.join(root, f), "utf8");
      expect(text, f).not.toContain(OLD_BRAND);
      expect(text, f).not.toMatch(/Peps (CRM|admin)/);
    }
  });
});

// ---------------------------------------------------------------- 2. Testing claims
describe("testing claims are accurate", () => {
  it("default content makes none of the old claims", () => {
    const c = DEFAULT_CONTENT;
    const texts = [c.hero.headline, c.hero.subtext, ...c.sections.map((s) => s.title), c.quality.body, ...c.quality.points.flatMap((p) => [p.title, p.text]), ...c.faq.flatMap((f) => [f.q, f.a]), c.about.body, c.seo.title, c.seo.description, c.testing.body, TAGLINE];
    for (const t of texts) expect(t).not.toMatch(FALSE_CLAIMS);
    expect(c.hero.subtext).toBe("Research materials with testing status shown on every product. Certificates of analysis are published per batch as they're completed.");
    expect(c.sections.find((s) => s.id === "quality")!.title).toBe("Testing, shown honestly");
    expect(c.quality.points.map((p) => p.title)).toEqual(["Status on every product", "COAs by batch", "Lot traceability"]);
  });

  it('"third-party tested" is only ever said for COA available', () => {
    const statuses: TestingStatus[] = ["coa_available", "supplier_tested", "pending", "coming_soon"];
    for (const s of statuses) {
      const c = testingClaim(s);
      expect(c.thirdPartyTested).toBe(s === "coa_available");
      expect(/third-party tested/i.test(c.line)).toBe(s === "coa_available");
    }
  });

  it("the product summary for search engines follows the real statuses", () => {
    expect(productTestingSummary("KPV", ["coa_available"])).toMatch(/Third-party tested/);
    expect(productTestingSummary("KPV", ["coa_available", "coming_soon"])).not.toMatch(/Third-party tested/);
    expect(productTestingSummary("KPV", ["coa_available", "coming_soon"])).toMatch(/some sizes/);
    expect(productTestingSummary("KPV", ["coming_soon", "pending"])).not.toMatch(/third-party|certificate of analysis on file/i);
    expect(productTestingSummary("KPV", [])).not.toMatch(/third-party/i);
  });
});

// ---------------------------------------------------------------- 3. Product data
describe("product data checks", () => {
  it("finds a size inside a product name", () => {
    expect(sizeInName("Reta 10mg")).toBe("10mg");
    expect(sizeInName("CJC/IPA 5mg/5mg")).toBe("5mg/5mg");
    expect(sizeInName("GHK-Cu 100mg")).toBe("100mg");
    expect(sizeInName("NAD+ 100 mg")).toBe("100 mg");
    expect(sizeInName("BAC water 3ml")).toBe("3ml");
    expect(sizeInName("Semax 2.5mg")).toBe("2.5mg");
    expect(sizeInName("HCG 5000 IU")).toBe("5000 IU");
    expect(sizeInName("Tesa 500mcg")).toBe("500mcg");
  });

  it("leaves compound names with numbers alone", () => {
    for (const n of ["BPC-157", "MT-2", "5 Amino", "5-Amino-1MQ", "MOTS-C", "KLOW", "TB-500", "CJC-1295", "KPV", "NAD+"]) expect(sizeInName(n), n).toBe("");
  });

  it("gives the name without the size", () => {
    expect(nameWithoutSize("Reta 10mg")).toBe("Reta");
    expect(nameWithoutSize("CJC/IPA 5mg/5mg")).toBe("CJC/IPA");
    expect(nameWithoutSize("GHK-Cu 100mg")).toBe("GHK-Cu");
    expect(nameWithoutSize("BPC-157")).toBe("BPC-157");
  });

  it("website info completeness", () => {
    expect(INFO_FIELDS).toHaveLength(6);
    expect(websiteInfo(listing("a"))).toMatchObject({ filled: 0, total: 6, label: "Website info 0/6" });
    const half = listing("b", { casNumber: "137525-51-0", formula: "C62H98N16O22", purity: "  ", form: "Lyophilized powder" });
    expect(websiteInfo(half)).toMatchObject({ filled: 3, label: "Website info 3/6", missing: ["Molecular weight", "Purity", "Storage"] });
    const full = listing("c", { casNumber: "1", formula: "2", molecularWeight: "3", purity: "4", form: "5", storage: "6" });
    expect(websiteInfo(full)).toMatchObject({ filled: 6, missing: [], label: "Website info 6/6" });
    const all = [listing("a"), half, full, listing("off", { showOnWebsite: false })];
    expect(listingsWithNoInfo(all).map((l) => l.id)).toEqual(["a"]);
    expect(listingsMissingInfo(all).map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("the product page gets specs only for filled fields (none = section hidden)", () => {
    const data = appData({ listings: [listing("a"), listing("b", { casNumber: "137525-51-0", storage: "Store at -20°C" })], products: [product("va", "a", 4000), product("vb", "b", 5000)] });
    const cat = buildCatalog(data, computeLedger(data), NOW);
    expect(cat.products.find((p) => p.id === "a")!.specs).toEqual([]);
    expect(cat.products.find((p) => p.id === "b")!.specs).toEqual([
      { label: "CAS number", value: "137525-51-0" },
      { label: "Storage", value: "Store at -20°C" },
    ]);
  });
});

// ---------------------------------------------------------------- 4. Storefront
describe("best sellers row", () => {
  const p = (id: string, over: Partial<PublicProduct> = {}) => ({ id, bestSeller: false, featured: false, sellRank: 99, createdAt: day(1), ...over }) as PublicProduct;

  it("is hidden with fewer than 4 products on the website", () => {
    expect(bestSellerRow([p("a", { bestSeller: true }), p("b"), p("c")])).toEqual([]);
    expect(bestSellerRow([])).toEqual([]);
  });

  it("always has exactly 4: best sellers, then featured, then newest", () => {
    const list = [p("old", { createdAt: day(1) }), p("best2", { bestSeller: true, sellRank: 1 }), p("new", { createdAt: day(9) }), p("feat", { featured: true }), p("best1", { bestSeller: true, sellRank: 0 }), p("mid", { createdAt: day(5) })];
    expect(bestSellerRow(list).map((x) => x.id)).toEqual(["best1", "best2", "feat", "new"]);
  });

  it("fills entirely with newest when nothing has sold, and never repeats a product", () => {
    const list = [p("a", { createdAt: day(1) }), p("b", { createdAt: day(2) }), p("c", { createdAt: day(3) }), p("d", { createdAt: day(4) }), p("e", { createdAt: day(5) })];
    const row = bestSellerRow(list);
    expect(row.map((x) => x.id)).toEqual(["e", "d", "c", "b"]);
    const many = Array.from({ length: 9 }, (_, i) => p(`s${i}`, { bestSeller: true, featured: true, sellRank: i }));
    const full = bestSellerRow(many);
    expect(full).toHaveLength(4);
    expect(new Set(full.map((x) => x.id)).size).toBe(4);
  });

  it("works from the real catalog (featured = the owner's pick)", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const data = appData({ listings: ids.map((id, i) => listing(id, { bestSeller: id === "c", createdAt: day(i + 1) })), products: ids.map((id) => product(`v${id}`, id, 4000)) });
    const cat = buildCatalog(data, computeLedger(data), NOW);
    expect(cat.products.find((x) => x.id === "c")!.featured).toBe(true);
    expect(bestSellerRow(cat.products).map((x) => x.id)).toEqual(["c", "e", "d", "b"]);
  });
});

describe('FAQ "How do I pay?" follows the payment methods that are on', () => {
  it("joins names in plain words", () => {
    expect(joinOr(["Zelle"])).toBe("Zelle");
    expect(joinOr(["Zelle", "Venmo"])).toBe("Zelle or Venmo");
    expect(joinOr(["Zelle", "Cash App", "Venmo"])).toBe("Zelle, Cash App or Venmo");
  });

  it("the default answer names only enabled methods (Cash App is off)", () => {
    expect(DEFAULT_CONTENT.faq[0].a).toContain(PAY_METHODS_TOKEN);
    const a = faqForDisplay(DEFAULT_CONTENT.faq, withZelle())[0].a;
    expect(a).toContain("payment instructions for Zelle,");
    expect(a).not.toContain("Cash App");
    expect(a).not.toContain(PAY_METHODS_TOKEN);
  });

  it("changes when methods are switched on or off", () => {
    const both = withZelle({ cashapp: { enabled: true, details: "$labs" }, venmo: { enabled: true, details: "@labs" } });
    expect(payMethodsText(both)).toBe("Zelle, Cash App or Venmo");
    expect(faqForDisplay(DEFAULT_CONTENT.faq, both)[0].a).toContain("Zelle, Cash App or Venmo");
    // On but without details = hidden at checkout, so it is not named either.
    expect(payMethodsText(withZelle({ venmo: { enabled: true, details: "" } }))).toBe("Zelle");
    expect(payMethodsText(DEFAULT_STORE.payments)).toBe("the payment method you pick at checkout");
  });

  it("a hand-written answer that names a method that is off is replaced; an accurate one is kept", () => {
    const old = [{ q: "How do I pay?", a: "You get payment instructions for Zelle or Cash App." }];
    expect(faqForDisplay(old, withZelle())[0].a).not.toContain("Cash App");
    expect(faqForDisplay(old, withZelle())[0].a).toContain("Zelle");
    const cashOn = withZelle({ cashapp: { enabled: true, details: "$labs" } });
    expect(faqForDisplay(old, cashOn)[0].a).toBe(old[0].a);
    const other = [{ q: "When does my order ship?", a: "After payment by Cash App clears." }];
    expect(faqForDisplay(other, withZelle())[0].a).toBe(other[0].a);
  });
});

describe("robots.txt", () => {
  it("closed store blocks everything and lists no sitemap", () => {
    expect(robotsFor(false, "https://buckshotlabs.com")).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
  });

  it("open store allows public pages, blocks private areas and includes the sitemap", () => {
    const r = robotsFor(true, "https://buckshotlabs.com");
    expect(r.sitemap).toBe("https://buckshotlabs.com/sitemap.xml");
    expect(r.rules).toEqual([{ userAgent: "*", allow: "/", disallow: ROBOTS_DISALLOW }]);
    for (const p of ["/admin", "/account", "/checkout", "/order/", "/review/", "/api/"]) expect(ROBOTS_DISALLOW).toContain(p);
    for (const p of ["/", "/shop", "/product/", "/collections", "/testing", "/faq", "/about", "/contact", "/terms"]) expect(ROBOTS_DISALLOW.some((d) => p.startsWith(d))).toBe(false);
  });
});

// ---------------------------------------------------------------- 5. Admin
describe("Sell screen groups", () => {
  it("puts sizes under their product, in store order", () => {
    const data = {
      listings: [listing("klow", { name: "KLOW", sortOrder: 2 }), listing("reta", { name: "Reta", sortOrder: 0, photos: [{ id: "abcdef0123456789", alt: "" }] }), listing("kpv", { name: "KPV", sortOrder: 1 })],
      products: [
        product("klow80", "klow", 9000, { name: "KLOW" }),
        product("reta20", "reta", 12000, { name: "Reta 20mg", variantLabel: "20mg", variantSort: 1 }),
        product("kpv10", "kpv", 4000, { name: "KPV" }),
        product("reta10", "reta", 7000, { name: "Reta 10mg", variantLabel: "10mg", variantSort: 0 }),
        product("gone", "kpv", 1000, { archived: true }),
        product("loose", null, 500, { name: "Loose item" }),
      ],
    };
    const groups = sellGroups(data);
    expect(groups.map((g) => g.name)).toEqual(["Reta", "KPV", "KLOW", "Loose item"]);
    expect(groups[0].variants.map((v) => v.name)).toEqual(["Reta 10mg", "Reta 20mg"]);
    expect(groups[0].photoId).toBe("abcdef0123456789");
    expect(groups[1].variants.map((v) => v.id)).toEqual(["kpv10"]);
    expect(groups[1].photoId).toBeNull();
    expect(sellVariantLabel(groups[0], groups[0].variants[1])).toBe("20mg");
    expect(sellVariantLabel(groups[1], groups[1].variants[0])).toBe("");
  });
});

// ---------------------------------------------------------------- 6. Additions
describe("store settings switches", () => {
  it("unpaid reminder and low stock alerts default to on, also for settings saved earlier", () => {
    expect(DEFAULT_STORE.unpaidReminder).toBe(true);
    expect(DEFAULT_STORE.lowStockAlerts).toBe(true);
    const old = parseStore(JSON.stringify({ open: true, storeName: "X" }));
    expect(old.unpaidReminder).toBe(true);
    expect(old.lowStockAlerts).toBe(true);
    const off = parseStore(JSON.stringify({ unpaidReminder: false, lowStockAlerts: false }));
    expect(off.unpaidReminder).toBe(false);
    expect(off.lowStockAlerts).toBe(false);
  });

  it("content saved earlier keeps its own text (defaults only fill gaps)", () => {
    const c = parseContent(JSON.stringify({ hero: { subtext: "My own words" } }));
    expect(c.hero.subtext).toBe("My own words");
    expect(c.hero.headline).toBe(DEFAULT_CONTENT.hero.headline);
  });
});

describe("unpaid order reminder email", () => {
  const o: EmailOrder = { number: 1042, name: "Dana Reed", email: "d@example.com", lines: [{ name: "Reta 10mg", quantity: 1, totalCents: 7000 }], subtotalCents: 7000, discountCents: 0, shippingCents: 1195, totalCents: 8195, shippingMethod: "Priority", shipTo: [], statusUrl: "https://x.test/order/tok" };

  it("says how much time is left in plain words", () => {
    expect(timeLeftText(12 * 3600_000)).toBe("about 12 hours");
    expect(timeLeftText(1 * 3600_000)).toBe("about 1 hour");
    expect(timeLeftText(20 * 60_000)).toBe("less than an hour");
    expect(timeLeftText(72 * 3600_000)).toBe("about 3 days");
  });

  it("includes the amount, payment instructions, memo, time left and the order link", () => {
    const now = new Date("2026-03-01T12:00:00Z");
    const c = paymentReminderEmail(DEFAULT_STORE, o, { name: "Zelle", sendTo: "pay@example.com", note: "Business account" }, new Date("2026-03-02T00:00:00Z"), now);
    const { text, html } = renderEmail(DEFAULT_STORE, c);
    expect(c.subject).toBe("Reminder: order #1042 is waiting for payment");
    for (const s of ["$81.95", "pay@example.com", "Put your order number in the memo: 1042", "about 12 hours", "Business account", "https://x.test/order/tok", "Pay with Zelle"]) expect(text).toContain(s);
    expect(html).toContain("https://x.test/order/tok");
  });
});

describe("low stock alert", () => {
  const data = appData({
    listings: [listing("a"), listing("b")],
    products: [product("a", "a", 4000), product("b", "b", 4000, { lowStockThreshold: 5 }), product("arch", "a", 1, { archived: true })],
    purchases: [
      { id: "p1", date: day(1), productId: "a", quantity: 6, totalCostCents: 600, note: "", fromInvestment: true, createdAt: day(1) },
      { id: "p2", date: day(1), productId: "b", quantity: 9, totalCostCents: 900, note: "", fromInvestment: true, createdAt: day(1) },
      { id: "p3", date: day(1), productId: "arch", quantity: 9, totalCostCents: 900, note: "", fromInvestment: true, createdAt: day(1) },
    ],
  });
  const adj = (productId: string, quantity: number) => ({ id: `x-${productId}${quantity}`, date: day(2), productId, quantity, reason: "correction" as const, note: "", createdAt: day(2) });
  const after = (adjustments: AppData["adjustments"]) => computeLedger({ ...data, adjustments });
  const before = computeLedger(data);

  it("fires when a size goes from above its warning level to at or below it", () => {
    // Default warning level is 3: 6 -> 3 crosses.
    expect(lowStockCrossings(data, before, after([adj("a", -3)]))).toEqual([{ id: "a", name: "a", stock: 3, lowAt: 3 }]);
    // 6 -> 4 does not.
    expect(lowStockCrossings(data, before, after([adj("a", -2)]))).toEqual([]);
    // The size's own level (5): 9 -> 5 crosses.
    expect(lowStockCrossings(data, before, after([adj("b", -4)])).map((x) => x.id)).toEqual(["b"]);
  });

  it("does not fire again while already low, when restocked, or for archived sizes", () => {
    const low = after([adj("a", -4)]);
    expect(lowStockCrossings(data, low, computeLedger({ ...data, adjustments: [adj("a", -4), adj("a", -1)] }))).toEqual([]);
    expect(lowStockCrossings(data, low, before)).toEqual([]);
    expect(lowStockCrossings(data, before, after([adj("arch", -9)]))).toEqual([]);
  });

  it("the email lists each size with what is left", () => {
    const c = lowStockEmail(DEFAULT_STORE, [{ name: "Reta 10mg", stock: 3, lowAt: 3 }, { name: "KPV", stock: 0, lowAt: 3 }], "https://x.test/admin/inventory");
    const { text } = renderEmail(DEFAULT_STORE, c);
    expect(c.subject).toBe("Low stock: 2 products");
    expect(text).toContain("Reta 10mg: 3 left (warning at 3)");
    expect(text).toContain("KPV: Out of stock");
    expect(lowStockEmail(DEFAULT_STORE, [{ name: "Reta 10mg", stock: 3, lowAt: 3 }], "u").subject).toBe("Low stock: Reta 10mg (3 left)");
  });
});

describe("analytics", () => {
  it("adds up days, totals, conversion and per-product counts", () => {
    const s = summarize(
      ["2026-03-01", "2026-03-02"],
      [
        { day: "2026-03-01", metric: "visit", key: "", count: 40 },
        { day: "2026-03-02", metric: "visit", key: "", count: 60 },
        { day: "2026-03-01", metric: "product_view", key: "l1", count: 30 },
        { day: "2026-03-02", metric: "product_view", key: "l2", count: 5 },
        { day: "2026-03-02", metric: "add_to_cart", key: "l1", count: 8 },
        { day: "2026-03-02", metric: "checkout_start", key: "", count: 4 },
        { day: "2026-03-02", metric: "order", key: "", count: 3 },
        { day: "2026-02-20", metric: "visit", key: "", count: 999 }, // outside the window
        { day: "2026-03-02", metric: "junk", key: "", count: 999 }, // unknown metric
      ],
    );
    expect(s.totals).toEqual({ visit: 100, product_view: 35, add_to_cart: 8, checkout_start: 4, order: 3 });
    expect(s.conversionPercent).toBe(3);
    expect(s.daily).toEqual([
      { day: "2026-03-01", visit: 40, product_view: 30, add_to_cart: 0, checkout_start: 0, order: 0 },
      { day: "2026-03-02", visit: 60, product_view: 5, add_to_cart: 8, checkout_start: 4, order: 3 },
    ]);
    expect(s.products).toEqual([
      { id: "l1", views: 30, addToCarts: 8 },
      { id: "l2", views: 5, addToCarts: 0 },
    ]);
    expect(summarize(["2026-03-01"], []).conversionPercent).toBeNull();
  });

  it("stores only aggregate counters (no personal fields in the table)", () => {
    const schema = readFileSync(path.resolve(import.meta.dirname, "../../../prisma/schema.prisma"), "utf8");
    const model = schema.slice(schema.indexOf("model AnalyticsDay {"), schema.indexOf("}", schema.indexOf("model AnalyticsDay {")));
    const fields = model.split("\n").map((l) => l.trim()).filter((l) => /^[a-z]\w*\s+(String|Int)/.test(l)).map((l) => l.split(/\s+/)[0]);
    expect(fields).toEqual(["day", "metric", "key", "count"]);
  });

  it("ignores crawlers and link previews, and buckets by calendar day", () => {
    for (const ua of ["Googlebot/2.1", "facebookexternalhit/1.1", "curl/8.0", "Mozilla/5.0 HeadlessChrome", "", null]) expect(isBot(ua)).toBe(true);
    expect(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(analyticsDay(new Date("2026-03-02T17:00:00Z"))).toBe("2026-03-02");
    expect(analyticsDay(new Date("2026-03-02T17:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
