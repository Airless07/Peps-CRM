import { z } from "zod";
import { body, route } from "@/lib/api";
import { resetAll } from "@/lib/restore";

export const POST = route(async (req) => {
  await body(req, z.object({ confirm: z.literal("RESET") }));
  await resetAll();
  return { ok: true };
});
