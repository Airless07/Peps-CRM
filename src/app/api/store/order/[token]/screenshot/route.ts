import { route, type Ctx } from "@/lib/api";
import { attachScreenshot, requestOrigin } from "@/lib/order-ops";
import { rateLimit } from "@/lib/ratelimit";
import { formFile, removeUpload, saveScreenshot } from "@/lib/uploads";

/** Customer uploads a payment screenshot from the order page. Stored privately: only the admin can open it. */
export const POST = route(
  async (req, ctx: Ctx<{ token: string }>) => {
    rateLimit(req, "screenshot", 6, 30 * 60_000);
    const { token } = await ctx.params;
    const { buf } = await formFile(req, "file", 14);
    const file = await saveScreenshot(buf);
    try {
      const old = await attachScreenshot(token, file, requestOrigin(req));
      if (old) await removeUpload(old, "private");
    } catch (e) {
      await removeUpload(file, "private");
      throw e;
    }
    return { ok: true };
  },
  { public: true },
);
