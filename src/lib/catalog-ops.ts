// Products and variants in the database: keeping every variant attached to a parent product,
// combining existing products into one product with sizes, and splitting a size back out.
// None of this touches stock, cost, price or sales history: only Product.listingId and labels change.
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { HttpError } from "./api";
import { prisma } from "./db";
import { uniqueSlug } from "./store/slug";

type Tx = Prisma.TransactionClient;

async function takenSlugs(tx: Tx | typeof prisma, exceptId?: string) {
  const rows = await tx.listing.findMany({ select: { id: true, slug: true } });
  return new Set(rows.filter((r) => r.id !== exceptId && r.slug).map((r) => r.slug));
}

/** A unique slug for a listing (from the wanted slug or the name). */
export async function freeSlug(tx: Tx | typeof prisma, wanted: string, exceptId?: string) {
  return uniqueSlug(wanted, await takenSlugs(tx, exceptId));
}

/**
 * Run at startup: every product gets a parent, every parent gets a URL slug.
 * (The migration creates parents without slugs; products made by old backups may have none.)
 */
export async function ensureCatalog() {
  const orphans = await prisma.product.findMany({ where: { listingId: null } });
  for (const p of orphans) {
    await prisma.$transaction(async (tx) => {
      const id = `l-${p.id}`;
      const exists = await tx.listing.findUnique({ where: { id } });
      if (!exists) await tx.listing.create({ data: { id, name: p.name, slug: await freeSlug(tx, p.name), sortOrder: p.sortOrder, createdAt: p.createdAt } });
      await tx.product.update({ where: { id: p.id }, data: { listingId: id } });
    });
  }
  const unslugged = await prisma.listing.findMany({ where: { slug: "" }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  if (unslugged.length) {
    const taken = await takenSlugs(prisma);
    for (const l of unslugged) await prisma.listing.update({ where: { id: l.id }, data: { slug: uniqueSlug(l.name, taken) } });
  }
}

/**
 * Combine existing products into one product with sizes.
 * `items` = the products to combine with the size label for each (for example "5mg", "10mg").
 * The first item's parent supplies the website fields (photos, description...).
 * Parents left with no variants are removed. Stock, cost, price and sales history are untouched.
 */
export async function combineProducts(input: { name: string; items: { productId: string; label: string }[] }): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new HttpError(400, "Give the combined product a name.");
  if (input.items.length < 2) throw new HttpError(400, "Pick at least two products to combine.");
  if (new Set(input.items.map((i) => i.productId)).size !== input.items.length) throw new HttpError(400, "The same product was picked twice.");
  const labels = input.items.map((i) => i.label.trim().toLowerCase());
  if (labels.some((l) => !l)) throw new HttpError(400, "Every size needs a label (for example 5mg or 10mg).");
  if (new Set(labels).size !== labels.length) throw new HttpError(400, "Two sizes have the same label. Give each one a different label.");

  return prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({ where: { id: { in: input.items.map((i) => i.productId) } } });
    if (products.length !== input.items.length) throw new HttpError(404, "One of those products no longer exists. Reload the page.");
    const first = products.find((p) => p.id === input.items[0].productId)!;
    const base = first.listingId ? await tx.listing.findUnique({ where: { id: first.listingId } }) : null;
    const oldIds = [...new Set(products.map((p) => p.listingId).filter((x): x is string => !!x))];

    const id = randomUUID();
    const { id: _i, createdAt: _c, variants: _v, ...web } = (base ?? {}) as Record<string, unknown>;
    await tx.listing.create({
      data: { ...(web as Prisma.ListingUncheckedCreateInput), id, name, slug: await freeSlug(tx, name), sortOrder: base?.sortOrder ?? first.sortOrder },
    });
    for (const [i, it] of input.items.entries()) {
      await tx.product.update({ where: { id: it.productId }, data: { listingId: id, variantLabel: it.label.trim(), variantSort: i } });
    }
    // Remove parents that have no variants left.
    for (const old of oldIds) {
      if ((await tx.product.count({ where: { listingId: old } })) === 0) await tx.listing.delete({ where: { id: old } });
    }
    return id;
  });
}

/** Undo for one size: it becomes its own single-variant product again (hidden from the website). */
export async function splitVariantOut(productId: string): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const p = await tx.product.findUnique({ where: { id: productId } });
    if (!p) throw new HttpError(404, "That size no longer exists. Reload the page.");
    const siblings = p.listingId ? await tx.product.count({ where: { listingId: p.listingId } }) : 0;
    if (siblings < 2) throw new HttpError(400, "This product has only one size, so there is nothing to split out.");
    const id = randomUUID();
    await tx.listing.create({ data: { id, name: p.name, slug: await freeSlug(tx, p.name), sortOrder: p.sortOrder } });
    await tx.product.update({ where: { id: productId }, data: { listingId: id, variantLabel: "", variantSort: 0 } });
    return id;
  });
}
