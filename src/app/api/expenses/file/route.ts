import { route } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { formFile, saveInvoice } from "@/lib/uploads";

/** Upload an expense attachment (invoice PDF or screenshot). Private. Returns the file to save on the expense. */
export const POST = route(async (req) => {
  rateLimit(req, "admin-upload", 120, 10 * 60_000);
  const { buf, form } = await formFile(req);
  const fileName = ((form.get("file") as File | null)?.name ?? "").slice(0, 120);
  const { file, mime } = await saveInvoice(buf);
  return { ok: true, file, mime, fileName };
});
