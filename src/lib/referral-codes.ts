// Referral codes: every customer gets one. Server only.
//
// Referral codes and discount codes share one namespace. The CodeClaim table (primary key = code) is
// filled by SQL triggers on Customer.referralCode and Promotion.code, so the DATABASE refuses a clash
// whatever code path writes it. The checks here only exist to give a friendly message first.
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { HttpError } from "./api";
import { makeReferralCode } from "./credit";
import { prisma } from "./db";
import { CODE_PROBLEM_TEXT, codeProblem, normalizeCode } from "./referral-rules";

type Db = Prisma.TransactionClient | typeof prisma;

/** True when a database error is the shared-code uniqueness guard firing. */
export function isCodeClash(e: unknown): boolean {
  const err = e as { code?: string; message?: string; meta?: { target?: unknown } };
  const text = `${err?.message ?? ""} ${JSON.stringify(err?.meta ?? {})}`;
  return (err?.code === "P2002" && /referralCode|CodeClaim|code/i.test(text)) || /CodeClaim/.test(text);
}

/** Who holds a code right now: a customer (referral), a discount code, or nobody. */
export async function codeOwner(db: Db, code: string): Promise<{ kind: "referral"; customerId: string } | { kind: "promo"; promotionId: string } | null> {
  const c = normalizeCode(code);
  if (!c) return null;
  const claim = await db.codeClaim.findUnique({ where: { code: c } });
  if (claim?.kind === "referral" && claim.customerId) return { kind: "referral", customerId: claim.customerId };
  if (claim?.kind === "promo" && claim.promotionId) return { kind: "promo", promotionId: claim.promotionId };
  // Fallback for rows written before the claim table existed (should not happen after the migration).
  const cust = await db.customer.findUnique({ where: { referralCode: c }, select: { id: true } });
  if (cust) return { kind: "referral", customerId: cust.id };
  const promo = await db.promotion.findFirst({ where: { kind: "code", code: c }, select: { id: true } });
  return promo ? { kind: "promo", promotionId: promo.id } : null;
}

/** A code nobody has yet (neither a customer nor a discount code). */
export async function uniqueReferralCode(db: Db, name: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const code = makeReferralCode(i < 20 ? name : "");
    if (!(await codeOwner(db, code))) return code;
  }
  return makeReferralCode("") + Date.now().toString(36).toUpperCase().slice(-3);
}

/** Give a code to every customer without one. Only writes to rows whose code is still empty. */
export async function assignMissingReferralCodes(db: Db = prisma): Promise<number> {
  const missing = await db.customer.findMany({ where: { referralCode: null }, select: { id: true, name: true } });
  let n = 0;
  for (const c of missing) {
    const code = await uniqueReferralCode(db, c.name);
    const r = await db.customer.updateMany({ where: { id: c.id, referralCode: null }, data: { referralCode: code, referralCodeDisplay: code } }).catch(() => ({ count: 0 }));
    n += r.count;
  }
  return n;
}

/** The customer a typed referral code belongs to, or null. Not case sensitive. */
export async function customerByReferralCode(db: Db, code: string) {
  const c = normalizeCode(code);
  if (!c) return null;
  return db.customer.findUnique({ where: { referralCode: c } });
}

/** Can this customer take this code? Returns the message to show, or "" when it is free. */
export async function codeAvailability(db: Db, code: string, customerId: string | null): Promise<string> {
  const problem = codeProblem(code);
  if (problem) return CODE_PROBLEM_TEXT[problem];
  const owner = await codeOwner(db, code);
  if (!owner) return "";
  if (owner.kind === "referral" && owner.customerId === customerId) return "";
  return CODE_PROBLEM_TEXT.taken;
}

/**
 * Change a customer's referral code (customer on their account page, or admin). Same rules for both.
 * The old code stops working at once and is free for anyone to claim; earned credit stays; old orders keep
 * the code string they were placed with. The change is written to the code history.
 */
export async function changeReferralCode(customerId: string, input: string, by: string): Promise<{ code: string; display: string }> {
  const display = input.trim();
  const problem = codeProblem(display);
  if (problem) throw new HttpError(400, CODE_PROBLEM_TEXT[problem]);
  const code = normalizeCode(display);
  try {
    return await prisma.$transaction(async (tx) => {
      const c = await tx.customer.findUnique({ where: { id: customerId }, select: { referralCode: true, referralCodeDisplay: true } });
      if (!c) throw new HttpError(404, "Customer not found. Reload the page.");
      const oldDisplay = c.referralCodeDisplay || c.referralCode || "";
      if (c.referralCode === code && oldDisplay === display) throw new HttpError(400, CODE_PROBLEM_TEXT.same);
      const owner = await codeOwner(tx, code);
      if (owner && !(owner.kind === "referral" && owner.customerId === customerId)) throw new HttpError(409, CODE_PROBLEM_TEXT.taken);
      await tx.customer.update({ where: { id: customerId }, data: { referralCode: code, referralCodeDisplay: display } });
      await tx.referralCodeChange.create({ data: { id: randomUUID(), customerId, oldCode: oldDisplay, newCode: display, by: by.trim() } });
      return { code, display };
    });
  } catch (e) {
    // Two people saving the same code at the same moment: the database guard decides.
    if (isCodeClash(e)) throw new HttpError(409, CODE_PROBLEM_TEXT.taken);
    throw e;
  }
}
