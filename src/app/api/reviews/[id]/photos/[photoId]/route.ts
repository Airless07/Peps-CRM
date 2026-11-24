import { z } from "zod";
import { body, route, type Ctx } from "@/lib/api";
import { setPhotoStatus } from "@/lib/reviews/ops";

const input = z.object({ status: z.enum(["approved", "rejected", "pending"]) });

/** Approve or reject one review photo. Approved photos show on the site right away (when the review is live). */
export const PATCH = route(async (req, ctx: Ctx<{ id: string; photoId: string }>) => {
  const { id, photoId } = await ctx.params;
  const { status } = await body(req, input);
  await setPhotoStatus(id, photoId, status);
  return { ok: true };
});
