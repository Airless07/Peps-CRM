import { body, HttpError, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { variantCreate } from "@/lib/store/schemas";

/** Add a size (variant) to an existing product. New products are created through /api/listings. */
export const POST = route(async (req) => {
  const { listingId, ...v } = await body(req, variantCreate);
  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) throw new HttpError(404, "That product no longer exists. Reload the page.");
  const count = await prisma.product.count({ where: { listingId } });
  const total = await prisma.product.count();
  return prisma.product.create({ data: { ...v, listingId, variantSort: count, sortOrder: total } });
});
