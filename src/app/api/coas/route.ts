import { randomUUID } from "node:crypto";
import { HttpError, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/ratelimit";
import { formFile, saveCoa } from "@/lib/uploads";

/** Upload a COA (PDF or image) for one size. Multipart: file, productId, lot, testDate, purity, isCurrent. */
export const POST = route(async (req) => {
  rateLimit(req, "admin-upload", 120, 10 * 60_000);
  const { buf, form } = await formFile(req);
  const productId = String(form.get("productId") ?? "");
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new HttpError(404, "That size no longer exists. Reload the page.");
  const fileName = (form.get("file") as File).name?.slice(0, 120) ?? "";
  const rawDate = String(form.get("testDate") ?? "");
  const testDate = rawDate && !Number.isNaN(new Date(rawDate).getTime()) ? new Date(rawDate) : null;
  const makeCurrent = String(form.get("isCurrent") ?? "true") !== "false";
  const { file, mime } = await saveCoa(buf);
  const id = randomUUID();
  await prisma.$transaction(async (tx) => {
    if (makeCurrent) await tx.coa.updateMany({ where: { productId }, data: { isCurrent: false } });
    await tx.coa.create({
      data: { id, productId, file, fileName, mime, lot: String(form.get("lot") ?? "").trim().slice(0, 60), purity: String(form.get("purity") ?? "").trim().slice(0, 40), testDate, isCurrent: makeCurrent },
    });
  });
  return { ok: true, id };
});
