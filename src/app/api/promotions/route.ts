import { body, HttpError, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { promotionInput } from "@/lib/store/schemas";

async function checked(req: Parameters<Parameters<typeof route>[0]>[0], exceptId?: string) {
  const { listingIds, groupIds, shippingTiers, ...p } = await body(req, promotionInput);
  if (p.kind === "code") {
    if (!p.code) throw new HttpError(400, "Enter the code customers will type, for example SAVE10.");
    const clash = await prisma.promotion.findFirst({ where: { kind: "code", code: p.code, NOT: { id: exceptId ?? "" } } });
    if (clash) throw new HttpError(409, `The code ${p.code} already exists. Edit that one or pick a different code.`);
  } else p.code = "";
  const tiers = [...new Set(shippingTiers)];
  if (p.kind === "free_shipping" && tiers.length === 0) throw new HttpError(400, "Pick at least one shipping option this rule makes free.");
  if (p.kind !== "free_shipping") {
    if (p.discountValue <= 0) throw new HttpError(400, "Enter how much the discount takes off.");
    if (p.discountType === "%" && p.discountValue > 100) throw new HttpError(400, "A percent discount can't be more than 100.");
  }
  if (p.startsAt && p.endsAt && p.endsAt <= p.startsAt) throw new HttpError(400, "The end date must be after the start date.");
  return { ...p, listingIdsJson: JSON.stringify(listingIds), groupIdsJson: JSON.stringify(groupIds), shippingTiersJson: JSON.stringify(p.kind === "free_shipping" ? tiers : []) };
}

export const POST = route(async (req) => {
  await prisma.promotion.create({ data: await checked(req) });
  return { ok: true };
});

/** Update (the id comes in the body). */
export const PUT = route(async (req) => {
  const clone = req.clone();
  const { id } = (await clone.json()) as { id: string };
  const { id: _i, ...data } = await checked(req, id);
  await prisma.promotion.update({ where: { id }, data });
  return { ok: true };
});

export const DELETE = route(async (req) => {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) throw new HttpError(400, "Missing id.");
  await prisma.promotion.delete({ where: { id } });
  return { ok: true };
});
