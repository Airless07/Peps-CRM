import { randomUUID } from "node:crypto";
import { body, HttpError, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { computeLedger, planSplit } from "@/lib/money";
import { splitConfirm } from "@/lib/schemas";
import { loadAll } from "@/lib/serialize";

/** Confirm a split: records what it covered and auto-creates matching payout entries. */
export const POST = route(async (req) => {
  const input = await body(req, splitConfirm);
  const data = await loadAll();
  const plan = planSplit(data, computeLedger(data));
  if (plan.items.length === 0) throw new HttpError(400, "Nothing to split");
  if (plan.partnerACents !== input.expectedA || plan.partnerBCents !== input.expectedB) {
    throw new HttpError(409, "Numbers changed since you opened the split. Review and try again.");
  }
  const date = input.date ?? new Date();
  const payouts = (
    [
      ["A", plan.partnerACents],
      ["B", plan.partnerBCents],
    ] as const
  )
    .filter(([, amt]) => amt !== 0)
    .map(([person, amountCents]) => ({ id: randomUUID(), date, person, amountCents, note: "From split" }));

  await prisma.split.create({
    data: {
      id: input.id,
      date,
      note: input.note,
      partnerACents: plan.partnerACents,
      partnerBCents: plan.partnerBCents,
      businessCents: plan.businessCents,
      items: {
        create: plan.items.map((it) => ({
          id: randomUUID(),
          orderId: it.orderId,
          partnerACents: it.partnerACents,
          partnerBCents: it.partnerBCents,
          businessCents: it.businessCents,
        })),
      },
      payouts: { create: payouts },
    },
  });
  return { ok: true };
});
