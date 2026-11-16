import { body, HttpError, route, type Ctx } from "@/lib/api";
import { freeSlug } from "@/lib/catalog-ops";
import { prisma } from "@/lib/db";
import { toListing } from "@/lib/serialize";
import { cleanQtyDeals } from "@/lib/store/config";
import { listingUpdate } from "@/lib/store/schemas";
import { slugify } from "@/lib/store/slug";

export const PATCH = route(async (req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const { photos, groupIds, badges, qtyDeals, slug, ...rest } = await body(req, listingUpdate);
  const data: Record<string, unknown> = { ...rest };
  if (photos !== undefined) data.photosJson = JSON.stringify(photos);
  if (groupIds !== undefined) data.groupsJson = JSON.stringify(groupIds);
  if (badges !== undefined) data.badgesJson = JSON.stringify([...new Set(badges)]);
  if (qtyDeals !== undefined) data.qtyDealsJson = qtyDeals === null ? "" : JSON.stringify(cleanQtyDeals(qtyDeals) ?? []);
  if (slug !== undefined) {
    const wanted = slugify(slug || rest.name || "");
    const free = await freeSlug(prisma, wanted, id);
    if (slug && free !== wanted) throw new HttpError(409, `Another product already uses the address "${wanted}". Pick a different URL slug.`);
    data.slug = free;
  }
  return toListing(await prisma.listing.update({ where: { id }, data }));
});

/** Delete a product only when it has no sizes left (delete or split out its sizes first). */
export const DELETE = route(async (_req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  if ((await prisma.product.count({ where: { listingId: id } })) > 0) {
    throw new HttpError(400, "This product still has sizes. Delete each size first (or archive them to keep the history).");
  }
  await prisma.listing.delete({ where: { id } });
  return { ok: true };
});
