import { HttpError, route } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { formFile, removeUpload, saveGif, saveImage, type ImageKind } from "@/lib/uploads";

const KINDS = new Set(["product", "hero", "logo", "share", "favicon", "gif"]);

/** Admin image upload. Multipart: file + kind. Returns the upload id (photos) or file name (gif). */
export const POST = route(async (req) => {
  rateLimit(req, "admin-upload", 120, 10 * 60_000);
  const { buf, form } = await formFile(req);
  const kind = String(form.get("kind") ?? "product");
  if (!KINDS.has(kind)) throw new HttpError(400, "Unknown upload type.");
  if (kind === "gif") return { ok: true, file: await saveGif(buf) };
  const saved = await saveImage(buf, kind as ImageKind);
  return { ok: true, ...saved };
});

/** Remove an upload that is no longer used. Body: { id } */
export const DELETE = route(async (req) => {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (typeof id === "string") await removeUpload(id);
  return { ok: true };
});
