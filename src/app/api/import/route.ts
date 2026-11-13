import { z } from "zod";
import { body, HttpError, route } from "@/lib/api";
import { BACKUP_VERSION } from "@/lib/backup";
import { restore } from "@/lib/restore";

const backup = z.object({
  app: z.literal("peps-crm").optional(),
  version: z.number(),
  data: z.object({
    settings: z.record(z.string(), z.unknown()),
    products: z.array(z.record(z.string(), z.unknown())),
    /** Missing in version 1 backups: rebuilt from order names on import. */
    customers: z.array(z.record(z.string(), z.unknown())).optional(),
    purchases: z.array(z.record(z.string(), z.unknown())),
    adjustments: z.array(z.record(z.string(), z.unknown())),
    orders: z.array(z.object({ lines: z.array(z.record(z.string(), z.unknown())) }).loose()),
    splits: z.array(z.object({ items: z.array(z.record(z.string(), z.unknown())) }).loose()),
    payouts: z.array(z.record(z.string(), z.unknown())),
  }),
});

export const POST = route(async (req) => {
  const parsed = await body(req, backup);
  if (parsed.version !== 1 && parsed.version !== BACKUP_VERSION) throw new HttpError(400, "Unsupported backup version");
  try {
    await restore(parsed.data);
  } catch (e) {
    console.error(e);
    throw new HttpError(400, "Backup file could not be imported. Nothing was changed.");
  }
  return { ok: true };
});
