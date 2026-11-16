import { z } from "zod";
import { body, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { groupInput } from "@/lib/store/schemas";
import { uniqueSlug } from "@/lib/store/slug";

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), group: groupInput }),
  z.object({ action: z.literal("rename"), group: groupInput }),
  z.object({ action: z.literal("delete"), id: z.string() }),
  z.object({ action: z.literal("reorder"), ids: z.array(z.string()).max(200) }),
]);

/** Product groups (shown as "Collections" on the store). */
export const POST = route(async (req) => {
  const input = await body(req, action);
  const slugs = async (except?: string) => new Set((await prisma.productGroup.findMany()).filter((g) => g.id !== except).map((g) => g.slug));
  switch (input.action) {
    case "create":
      await prisma.productGroup.create({ data: { ...input.group, slug: uniqueSlug(input.group.name, await slugs()), sortOrder: await prisma.productGroup.count() } });
      break;
    case "rename":
      await prisma.productGroup.update({ where: { id: input.group.id }, data: { name: input.group.name, slug: uniqueSlug(input.group.name, await slugs(input.group.id)) } });
      break;
    case "delete": {
      await prisma.productGroup.delete({ where: { id: input.id } });
      // Take the group off every product that had it.
      for (const l of await prisma.listing.findMany({ where: { groupsJson: { contains: input.id } } })) {
        const ids = (JSON.parse(l.groupsJson) as string[]).filter((g) => g !== input.id);
        await prisma.listing.update({ where: { id: l.id }, data: { groupsJson: JSON.stringify(ids) } });
      }
      break;
    }
    case "reorder":
      await prisma.$transaction(input.ids.map((id, i) => prisma.productGroup.update({ where: { id }, data: { sortOrder: i } })));
      break;
  }
  return { ok: true };
});
