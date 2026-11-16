import { z } from "zod";
import { body, route } from "@/lib/api";
import { combineProducts, freeSlug, splitVariantOut } from "@/lib/catalog-ops";
import { prisma } from "@/lib/db";
import { combineInput, listingCreate } from "@/lib/store/schemas";

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), listing: listingCreate }),
  z.object({ action: z.literal("combine"), input: combineInput }),
  z.object({ action: z.literal("split"), productId: z.string().min(1).max(64) }),
  /** Drag and drop order of products (also the order on the Sell screen and in the shop). */
  z.object({ action: z.literal("reorder"), ids: z.array(z.string()).max(2000) }),
  z.object({ action: z.literal("reorder-variants"), ids: z.array(z.string()).max(200) }),
]);

export const POST = route(async (req) => {
  const input = await body(req, action);
  switch (input.action) {
    case "create": {
      const { id, name, variant } = input.listing;
      await prisma.$transaction(async (tx) => {
        const order = await tx.listing.count();
        await tx.listing.create({ data: { id, name, slug: await freeSlug(tx, name), sortOrder: order } });
        await tx.product.create({ data: { ...variant, listingId: id, sortOrder: await tx.product.count() } });
      });
      return { ok: true };
    }
    case "combine":
      return { ok: true, id: await combineProducts(input.input) };
    case "split":
      return { ok: true, id: await splitVariantOut(input.productId) };
    case "reorder": {
      // Listings get the new order; their variants follow so the Sell screen matches.
      const variants = await prisma.product.findMany({ select: { id: true, listingId: true, variantSort: true }, orderBy: { variantSort: "asc" } });
      let n = 0;
      const ops = [];
      for (const [i, id] of input.ids.entries()) {
        ops.push(prisma.listing.updateMany({ where: { id }, data: { sortOrder: i } }));
        for (const v of variants.filter((x) => x.listingId === id)) ops.push(prisma.product.update({ where: { id: v.id }, data: { sortOrder: n++ } }));
      }
      await prisma.$transaction(ops);
      return { ok: true };
    }
    case "reorder-variants":
      await prisma.$transaction(input.ids.map((id, i) => prisma.product.update({ where: { id }, data: { variantSort: i } })));
      return { ok: true };
  }
});
