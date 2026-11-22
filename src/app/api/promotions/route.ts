import { body, HttpError, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { codeOwner, isCodeClash } from "@/lib/referral-codes";
import { promotionInput } from "@/lib/store/schemas";

async function checked(req: Parameters<Parameters<typeof route>[0]>[0], exceptId?: string) {
  const { listingIds, groupIds, shippingTiers, bogo, ...p } = await body(req, promotionInput);
  if (p.kind === "code") {
    if (!p.code) throw new HttpError(400, "Enter the code customers will type, for example SAVE10.");
    const clash = await prisma.promotion.findFirst({ where: { kind: "code", code: p.code, NOT: { id: exceptId ?? "" } } });
    if (clash) throw new HttpError(409, `The code ${p.code} already exists. Edit that one or pick a different code.`);
    // Discount codes and customer referral codes share one namespace.
    const owner = await codeOwner(prisma, p.code);
    if (owner?.kind === "referral") throw new HttpError(409, `${p.code} is already a customer's referral code. Pick a different code.`);
  } else p.code = "";
  const tiers = [...new Set(shippingTiers)];
  if (p.kind === "free_shipping" && tiers.length === 0) throw new HttpError(400, "Pick at least one shipping option this rule makes free.");
  if (p.kind === "bogo") {
    if (!bogo) throw new HttpError(400, "Pick what the customer buys and what they get.");
    if (!p.name.trim()) throw new HttpError(400, "Give the deal a name customers will see, for example “Buy 1 GHK-Cu, get 1 free”.");
    if (bogo.buy.listingIds.length + bogo.buy.variantIds.length === 0) throw new HttpError(400, "Pick at least one product or size the customer buys.");
    if (!bogo.get.same && bogo.get.listingIds.length + bogo.get.variantIds.length === 0) throw new HttpError(400, "Pick the product or size the customer gets.");
    if (!bogo.online && !bogo.inPerson) throw new HttpError(400, "Pick where the deal applies: online, in person, or both.");
    // "Same item" deals give the buy items: never keep stale get picks.
    if (bogo.get.same) {
      bogo.get.listingIds = [];
      bogo.get.variantIds = [];
    }
  } else if (p.kind !== "free_shipping") {
    if (p.discountValue <= 0) throw new HttpError(400, "Enter how much the discount takes off.");
    if (p.discountType === "%" && p.discountValue > 100) throw new HttpError(400, "A percent discount can't be more than 100.");
  }
  if (p.startsAt && p.endsAt && p.endsAt <= p.startsAt) throw new HttpError(400, "The end date must be after the start date.");
  if (p.kind === "bogo") {
    p.discountType = "%";
    p.discountValue = bogo!.get.percentOff;
    p.minSubtotalCents = 0;
    p.oncePerEmail = false;
  }
  return {
    ...p,
    listingIdsJson: JSON.stringify(p.kind === "bogo" ? [] : listingIds),
    groupIdsJson: JSON.stringify(p.kind === "bogo" ? [] : groupIds),
    shippingTiersJson: JSON.stringify(p.kind === "free_shipping" ? tiers : []),
    bogoJson: p.kind === "bogo" && bogo ? JSON.stringify(bogo) : "",
  };
}

const clashMessage = "That code is already used (by another discount code or a customer's referral code). Pick a different code.";

export const POST = route(async (req) => {
  const data = await checked(req);
  await prisma.promotion.create({ data }).catch((e) => {
    throw isCodeClash(e) ? new HttpError(409, clashMessage) : e;
  });
  return { ok: true };
});

/** Update (the id comes in the body). */
export const PUT = route(async (req) => {
  const clone = req.clone();
  const { id } = (await clone.json()) as { id: string };
  const { id: _i, ...data } = await checked(req, id);
  await prisma.promotion.update({ where: { id }, data }).catch((e) => {
    throw isCodeClash(e) ? new HttpError(409, clashMessage) : e;
  });
  return { ok: true };
});

export const DELETE = route(async (req) => {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) throw new HttpError(400, "Missing id.");
  await prisma.promotion.delete({ where: { id } });
  return { ok: true };
});
