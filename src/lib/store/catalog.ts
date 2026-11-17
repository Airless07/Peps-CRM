// The public catalog: what the store and the public API are allowed to show.
// Built from the admin data by copying ONLY the fields listed here. Cost, profit, margins,
// exact stock counts, purchases and customer data never enter these objects.
// (src/lib/store/catalog.test.ts proves no cost fields leak.)
import type { Ledger } from "../money";
import type { AppData, CoaRec, ListingRec, ProductRec, QtyDeal, TestingStatus } from "../types";
import { TESTING_LABEL } from "../types";
import type { PricedVariant } from "./pricing";

export type StockLevel = "in" | "low" | "out";
export const STOCK_LABEL: Record<StockLevel, string> = { in: "In stock", low: "Low stock", out: "Sold out" };

export interface PublicCoa {
  id: string;
  url: string;
  lot: string;
  testDate: string | null;
  purity: string;
  isPdf: boolean;
}

export interface PublicVariant {
  id: string;
  label: string;
  priceCents: number;
  stock: StockLevel;
  testing: TestingStatus;
  testingLabel: string;
  /** Purity to show with the testing badge (from the current COA). */
  purity: string;
  coa: PublicCoa | null;
  olderCoas: PublicCoa[];
}

export interface PublicProduct {
  id: string;
  slug: string;
  name: string;
  summary: string;
  description: string;
  specs: { label: string; value: string }[];
  photos: { id: string; alt: string }[];
  hoverGif: string;
  groupIds: string[];
  badges: string[];
  qtyDeals: QtyDeal[];
  variants: PublicVariant[];
  priceFromCents: number;
  priceToCents: number;
  stock: StockLevel;
  bestSeller: boolean;
  /** The owner ticked "Best seller" on this product (a manual pick, whatever the best seller mode is). */
  featured: boolean;
  /** Position in the best selling order (0 = top). Not a sales figure. */
  sellRank: number;
  createdAt: string;
  seoTitle: string;
  seoDescription: string;
}

export interface PublicGroup {
  id: string;
  name: string;
  slug: string;
  count: number;
}

export interface PublicCatalog {
  products: PublicProduct[];
  groups: PublicGroup[];
}

const DAY = 86400000;

export function stockLevel(stock: number, lowAt: number): StockLevel {
  if (stock <= 0) return "out";
  return stock <= lowAt ? "low" : "in";
}

export const mediaUrl = (file: string) => `/media/${file}`;
/** Photo file for an upload id at a given width (uploads are saved at 480, 960 and 1600). */
export const photoUrl = (id: string, width: 480 | 960 | 1600 = 960) => `/media/${id}-${width}.webp`;
export const photoSrcSet = (id: string) => `${photoUrl(id, 480)} 480w, ${photoUrl(id, 960)} 960w, ${photoUrl(id, 1600)} 1600w`;

function publicCoa(c: CoaRec): PublicCoa {
  return { id: c.id, url: mediaUrl(c.file), lot: c.lot, testDate: c.testDate, purity: c.purity, isPdf: c.mime === "application/pdf" || c.file.endsWith(".pdf") };
}

/** Variants of a listing that can be sold on the website, in display order. */
export function listingVariants(data: Pick<AppData, "products">, listingId: string): ProductRec[] {
  return data.products
    .filter((p) => p.listingId === listingId && !p.archived)
    .sort((a, b) => a.variantSort - b.variantSort || a.defaultPriceCents - b.defaultPriceCents || a.sortOrder - b.sortOrder);
}

/** What the customer sees for a variant: "BPC-157 10mg", or just the product name when it has one size. */
export function variantDisplayName(l: Pick<ListingRec, "name">, v: Pick<ProductRec, "variantLabel">): string {
  return v.variantLabel.trim() ? `${l.name} ${v.variantLabel.trim()}` : l.name;
}

export const resolveQtyDeals = (l: Pick<ListingRec, "qtyDeals">, storeDefault: QtyDeal[]): QtyDeal[] => l.qtyDeals ?? storeDefault;

/** Units sold per variant in the last `days` days (counted sales only). */
export function unitsSoldByVariant(data: Pick<AppData, "orders">, now: Date, days = 30): Map<string, number> {
  const since = now.getTime() - days * DAY;
  const out = new Map<string, number>();
  for (const o of data.orders) {
    if (new Date(o.date).getTime() < since) continue;
    for (const l of o.lines) if (l.productId) out.set(l.productId, (out.get(l.productId) ?? 0) + l.quantity);
  }
  return out;
}

export function buildCatalog(data: AppData, ledger: Ledger, now = new Date()): PublicCatalog {
  const sold = unitsSoldByVariant(data, now);
  const coasByVariant = new Map<string, CoaRec[]>();
  for (const c of data.coas) coasByVariant.set(c.productId, [...(coasByVariant.get(c.productId) ?? []), c]);

  const draft: (PublicProduct & { units: number })[] = [];
  for (const l of data.listings) {
    if (!l.showOnWebsite) continue;
    const vs = listingVariants(data, l.id);
    if (vs.length === 0) continue;
    const variants: PublicVariant[] = vs.map((v) => {
      const lowAt = v.lowStockThreshold ?? data.settings.lowStockThreshold;
      const all = [...(coasByVariant.get(v.id) ?? [])].sort((a, b) => (b.testDate ?? b.createdAt).localeCompare(a.testDate ?? a.createdAt));
      const current = all.find((c) => c.isCurrent) ?? null;
      return {
        id: v.id,
        label: v.variantLabel.trim() || (vs.length > 1 ? v.name : ""),
        priceCents: v.defaultPriceCents,
        stock: stockLevel(ledger.stock.get(v.id)?.stock ?? 0, lowAt),
        testing: v.testingStatus,
        testingLabel: TESTING_LABEL[v.testingStatus],
        purity: current?.purity || (v.testingStatus === "coa_available" ? l.purity : ""),
        coa: current ? publicCoa(current) : null,
        olderCoas: all.filter((c) => c !== current).map(publicCoa),
      };
    });
    const prices = variants.map((v) => v.priceCents);
    const specs = [
      { label: "CAS number", value: l.casNumber },
      { label: "Molecular formula", value: l.formula },
      { label: "Molecular weight", value: l.molecularWeight },
      { label: "Purity", value: l.purity },
      { label: "Form", value: l.form },
      { label: "Storage", value: l.storage },
    ].filter((s) => s.value.trim());
    draft.push({
      id: l.id,
      slug: l.slug,
      name: l.name,
      summary: l.summary,
      description: l.description,
      specs,
      photos: l.photos.map((p) => ({ id: p.id, alt: p.alt || l.name })),
      hoverGif: l.hoverGif,
      groupIds: l.groupIds,
      badges: l.badges,
      qtyDeals: resolveQtyDeals(l, data.store.qtyDeals),
      variants,
      priceFromCents: Math.min(...prices),
      priceToCents: Math.max(...prices),
      stock: variants.some((v) => v.stock === "in") ? "in" : variants.some((v) => v.stock === "low") ? "low" : "out",
      bestSeller: false,
      featured: l.bestSeller,
      sellRank: 0,
      createdAt: l.createdAt,
      seoTitle: l.seoTitle,
      seoDescription: l.seoDescription,
      units: vs.reduce((s, v) => s + (sold.get(v.id) ?? 0), 0),
    });
  }

  // Best selling order, then best seller flags (automatic = top sellers of the last 30 days, or manual picks).
  const ranked = [...draft].sort((a, b) => b.units - a.units);
  ranked.forEach((p, i) => (p.sellRank = i));
  const manual = new Set(data.listings.filter((l) => l.bestSeller).map((l) => l.id));
  const auto = new Set(ranked.filter((p) => p.units > 0).slice(0, 8).map((p) => p.id));
  const best = data.store.bestSellerMode === "manual" ? manual : auto;

  const products: PublicProduct[] = draft.map(({ units: _u, ...p }) => ({ ...p, bestSeller: best.has(p.id) }));
  const groups: PublicGroup[] = data.groups
    .map((g) => ({ id: g.id, name: g.name, slug: g.slug, count: products.filter((p) => p.groupIds.includes(g.id)).length }))
    .filter((g) => g.count > 0);
  return { products, groups };
}

/**
 * The home page "Best sellers" row: always a full row, or nothing.
 * Best sellers first, then the owner's featured picks, then the newest products.
 * With fewer products than a full row the section is hidden (returns an empty list).
 */
export function bestSellerRow(products: PublicProduct[], size = 4): PublicProduct[] {
  if (products.length < size) return [];
  const out: PublicProduct[] = [];
  const take = (list: PublicProduct[]) => {
    for (const p of list) if (out.length < size && !out.includes(p)) out.push(p);
  };
  take(products.filter((p) => p.bestSeller).sort((a, b) => a.sellRank - b.sellRank));
  take(products.filter((p) => p.featured));
  take([...products].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  return out;
}

/** Variants in the shape the pricing function needs (website products only). */
export function pricedVariants(data: AppData): PricedVariant[] {
  const out: PricedVariant[] = [];
  for (const l of data.listings) {
    if (!l.showOnWebsite) continue;
    for (const v of listingVariants(data, l.id)) {
      out.push({
        variantId: v.id,
        listingId: l.id,
        groupIds: l.groupIds,
        name: variantDisplayName(l, v),
        priceCents: v.defaultPriceCents,
        qtyDeals: resolveQtyDeals(l, data.store.qtyDeals),
      });
    }
  }
  return out;
}
