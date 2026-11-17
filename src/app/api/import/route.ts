import { z } from "zod";
import { body, HttpError, route } from "@/lib/api";
import { SUPPORTED_BACKUP_VERSIONS } from "@/lib/backup";
import { restore } from "@/lib/restore";

const backup = z.object({
  app: z.string().optional(),
  version: z.number(),
  data: z
    .object({
    settings: z.record(z.string(), z.unknown()),
    products: z.array(z.record(z.string(), z.unknown())),
    /** Missing in version 1 backups: rebuilt from order names on import. */
    customers: z.array(z.record(z.string(), z.unknown())).optional(),
    purchases: z.array(z.record(z.string(), z.unknown())),
    adjustments: z.array(z.record(z.string(), z.unknown())),
    orders: z.array(z.object({ lines: z.array(z.record(z.string(), z.unknown())) }).loose()),
    splits: z.array(z.object({ items: z.array(z.record(z.string(), z.unknown())) }).loose()),
    payouts: z.array(z.record(z.string(), z.unknown())),
    })
    // Version 3 adds the store tables; they are read by normalizeBackup when present.
    .loose(),
});

export const POST = route(async (req) => {
  const parsed = await body(req, backup);
  if (!SUPPORTED_BACKUP_VERSIONS.includes(parsed.version)) {
    throw new HttpError(400, `This backup is version ${parsed.version}, which this app can't read. Use a backup made by this app.`);
  }
  try {
    await restore(parsed.data);
  } catch (e) {
    console.error(e);
    throw new HttpError(400, "That backup file could not be imported, so nothing was changed. Make sure it is a JSON backup downloaded from Settings.");
  }
  return { ok: true };
});
