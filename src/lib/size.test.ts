// Sizes on every product, the one-time fill-in from product names, and the number field buttons.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planSizeBackfill } from "./data-migrations";
import { lineName, sizeWithVolume, stepValue, withSize } from "./size";
import { variantDisplayName } from "./store/catalog";

describe("size next to the name", () => {
  it("adds the size, never twice", () => {
    expect(withSize("BPC-157", "10mg")).toBe("BPC-157 10mg");
    expect(withSize("GHK-Cu 100mg", "100mg")).toBe("GHK-Cu 100mg");
    expect(withSize("CJC/IPA 5mg/5mg", "5mg / 5mg")).toBe("CJC/IPA 5mg/5mg");
    expect(withSize("Reta 10 mg", "10mg")).toBe("Reta 10 mg");
    expect(withSize("KPV", "")).toBe("KPV");
    expect(variantDisplayName({ name: "GHK-Cu 100mg" }, { variantLabel: "100mg" })).toBe("GHK-Cu 100mg");
    expect(variantDisplayName({ name: "BPC-157" }, { variantLabel: "10mg" })).toBe("BPC-157 10mg");
  });
  it("order lines show the product's size; deleted products still read clearly", () => {
    expect(lineName({ productName: "BPC-157", size: "10mg" })).toBe("BPC-157 10mg");
    expect(lineName({ productName: "Reta 20mg", size: "20mg" })).toBe("Reta 20mg");
    expect(lineName({ productName: "Old item" })).toBe("Old item");
    expect(lineName({ productName: "" })).toBe("Deleted product");
  });
  it("vial volume joins the size", () => {
    expect(sizeWithVolume("10mg", "3ml")).toBe("10mg · 3ml");
    expect(sizeWithVolume("10mg", "")).toBe("10mg");
  });
});

describe("filling empty sizes from product names (one time)", () => {
  const listings = [
    { id: "l-ghk", name: "GHK-Cu 100mg" },
    { id: "l-bpc", name: "BPC-157" },
    { id: "l-kpv", name: "KPV" },
    { id: "l-reta", name: "Reta" },
    { id: "l-cjc", name: "CJC/IPA 5mg/5mg" },
  ];
  const plan = planSizeBackfill(
    [
      { id: "ghk", name: "GHK-Cu 100mg", variantLabel: "", listingId: "l-ghk" },
      { id: "bpc", name: "BPC-157 10mg", variantLabel: "", listingId: "l-bpc" },
      { id: "kpv", name: "KPV", variantLabel: "", listingId: "l-kpv" },
      { id: "r10", name: "Reta 10mg", variantLabel: "10mg", listingId: "l-reta" },
      { id: "r10b", name: "Reta 10mg (old)", variantLabel: "", listingId: "l-reta" },
      { id: "cjc", name: "CJC", variantLabel: "", listingId: "l-cjc" },
      { id: "solo", name: "MOTS-c 10mg", variantLabel: "", listingId: null },
    ],
    listings,
  );
  it("fills from the variant's name, else the product's name", () => {
    expect(plan).toEqual([
      { productId: "ghk", product: "GHK-Cu 100mg", size: "100mg" },
      { productId: "bpc", product: "BPC-157 10mg", size: "10mg" },
      { productId: "cjc", product: "CJC", size: "5mg/5mg" },
      { productId: "solo", product: "MOTS-c 10mg", size: "10mg" },
    ]);
  });
  it("leaves blank when no size is found, never overwrites, never duplicates a size in one product", () => {
    expect(plan.find((f) => f.productId === "kpv")).toBeUndefined();
    expect(plan.find((f) => f.productId === "r10")).toBeUndefined();
    expect(plan.find((f) => f.productId === "r10b")).toBeUndefined();
  });
  it("the migration is additive: new columns with defaults, a new table, one UPDATE of a new column only", () => {
    const sql = readFileSync(path.join(__dirname, "../../prisma/migrations/20261118120000_sizes_shipping_rules/migration.sql"), "utf8").replace(/^\s*--.*$/gm, "");
    expect(sql).not.toMatch(/\bDROP\b|\bDELETE\b|RENAME|PRAGMA|INSERT INTO/i);
    expect(sql).toMatch(/ALTER TABLE "Product" ADD COLUMN "vialVolume" TEXT NOT NULL DEFAULT ''/);
    expect(sql).toMatch(/ALTER TABLE "Promotion" ADD COLUMN "shippingTiersJson" TEXT NOT NULL DEFAULT '\[\]'/);
    expect(sql.match(/CREATE TABLE/g)).toHaveLength(1);
    const updates = sql.match(/UPDATE[^;]+;/g) ?? [];
    expect(updates).toEqual([`UPDATE "Promotion" SET "shippingTiersJson" = '["standard"]' WHERE "kind" = 'free_shipping';`]);
  });
});

describe("- / + buttons on number fields", () => {
  it("steps by the step and stays within limits", () => {
    expect(stepValue(5, 1, 1, 1)).toBe(6);
    expect(stepValue(1, -1, 1, 1)).toBe(1); // quantity minimum 1
    expect(stepValue(0, -1, 100, 0)).toBe(0); // $0 minimum
    expect(stepValue(4999, 1, 100, 0)).toBe(5000); // $49.99 + goes to $50
    expect(stepValue(4999, -1, 100, 0)).toBe(4900);
    expect(stepValue(0.2, 1, 0.1)).toBe(0.3);
    expect(stepValue(10, 1, 0.5, 0, 10)).toBe(10);
  });
});
