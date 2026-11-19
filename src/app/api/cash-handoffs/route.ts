import { body, HttpError, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { cashHandoffCreate } from "@/lib/schemas";

/** Record cash moving between the partners and the bank. Business money does not change. */
export const POST = route(async (req) => {
  const { from, to, ...h } = await body(req, cashHandoffCreate);
  await prisma.cashHandoff.create({ data: { ...h, fromHolder: from, toHolder: to } });
  return { ok: true };
});

export const DELETE = route(async (req) => {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) throw new HttpError(400, "Missing id.");
  await prisma.cashHandoff.deleteMany({ where: { id } });
  return { ok: true };
});
