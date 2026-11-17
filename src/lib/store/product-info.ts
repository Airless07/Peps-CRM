// Product data quality checks used by the admin (Inventory, product editor, dashboard, launch checklist).
// Pure: server and client.
import type { ListingRec } from "../types";

/** The compound info fields of the Website tab, in the order the product page shows them. */
export const INFO_FIELDS = [
  { key: "casNumber", label: "CAS number" },
  { key: "formula", label: "Molecular formula" },
  { key: "molecularWeight", label: "Molecular weight" },
  { key: "purity", label: "Purity" },
  { key: "form", label: "Form" },
  { key: "storage", label: "Storage" },
] as const satisfies readonly { key: keyof ListingRec; label: string }[];

export type InfoKey = (typeof INFO_FIELDS)[number]["key"];
export type InfoValues = Pick<ListingRec, InfoKey>;

export interface WebsiteInfo {
  filled: number;
  total: number;
  missing: string[];
  /** "Website info 3/6" */
  label: string;
}

/** How much of the compound info is filled in. */
export function websiteInfo(l: InfoValues): WebsiteInfo {
  const missing = INFO_FIELDS.filter((f) => !String(l[f.key] ?? "").trim()).map((f) => f.label);
  const total = INFO_FIELDS.length;
  const filled = total - missing.length;
  return { filled, total, missing, label: `Website info ${filled}/${total}` };
}

/** Products that are shown on the website with none of the compound info filled in. */
export const listingsWithNoInfo = <T extends InfoValues & Pick<ListingRec, "showOnWebsite">>(listings: T[]): T[] =>
  listings.filter((l) => l.showOnWebsite && websiteInfo(l).filled === 0);

/** Products on the website with at least one compound info field still empty. */
export const listingsMissingInfo = <T extends InfoValues & Pick<ListingRec, "showOnWebsite">>(listings: T[]): T[] =>
  listings.filter((l) => l.showOnWebsite && websiteInfo(l).filled < INFO_FIELDS.length);

// A size inside a product name: "10mg", "5 mg", "100mcg", "2.5 mL", "5mg/5mg", "10 IU".
const SIZE = /\b\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|ug|g|kg|ml|iu|units?)\b(?:\s?\/\s?\d+(?:[.,]\d+)?\s?(?:mg|mcg|µg|ug|g|kg|ml|iu|units?)\b)*/i;

/** The size written inside a product name ("Reta 10mg" gives "10mg"), or "" when there is none. */
export function sizeInName(name: string): string {
  return name.match(SIZE)?.[0].trim() ?? "";
}

/** The name with the size taken out: "CJC/IPA 5mg/5mg" gives "CJC/IPA". */
export function nameWithoutSize(name: string): string {
  return name.replace(SIZE, " ").replace(/\s{2,}/g, " ").replace(/[\s\-–,·(]+$/g, "").trim();
}
