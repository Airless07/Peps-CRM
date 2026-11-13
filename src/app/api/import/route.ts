import { z } from "zod";
import { body, HttpError, route } from "@/lib/api";
import { restore } from "@/lib/restore";
import type { AppData } from "@/lib/types";

const backup = z.object({
  app: z.literal("peps-crm").optional(),
  version: z.number(),
  data: z.object({
    settings: z.record(z.string(), z.unknown()),
    products: z.array(z.record(z.string(), z.unknown())),
    purchases: z.array(z.record(z.string(), z.unknown())),
    adjustments: z.array(z.record(z.string(), z.unknown())),
    orders: z.array(z.object({ lines: z.array(z.record(z.string(), z.unknown())) }).loose()),
    splits: z.array(z.object({ items: z.array(z.record(z.string(), z.unknown())) }).loose()),
    payouts: z.array(z.record(z.string(), z.unknown())),
  }),
});

export const POST = route(async (req) => {
  const parsed = await body(req, backup);
  if (parsed.version !== 1) throw new HttpError(400, "Unsupported backup version");
  try {
    await restore(parsed.data as unknown as AppData);
  } catch (e) {
    console.error(e);
    throw new HttpError(400, "Backup file could not be imported. Nothing was changed.");
  }
  return { ok: true };
});
