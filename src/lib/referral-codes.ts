// Referral codes: every customer gets one. Server only.
import { prisma } from "./db";
import { cleanCode, makeReferralCode } from "./credit";

type Db = Pick<typeof prisma, "customer">;

/** A code nobody has yet. */
export async function uniqueReferralCode(db: Db, name: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = makeReferralCode(name);
    if (!(await db.customer.findUnique({ where: { referralCode: code }, select: { id: true } }))) return code;
  }
  return makeReferralCode("") + Date.now().toString(36).toUpperCase().slice(-3);
}

/** Give a code to every customer without one. Only writes to rows whose code is still empty. */
export async function assignMissingReferralCodes(db: Db = prisma): Promise<number> {
  const missing = await db.customer.findMany({ where: { referralCode: null }, select: { id: true, name: true } });
  let n = 0;
  for (const c of missing) {
    const code = await uniqueReferralCode(db, c.name);
    const r = await db.customer.updateMany({ where: { id: c.id, referralCode: null }, data: { referralCode: code } }).catch(() => ({ count: 0 }));
    n += r.count;
  }
  return n;
}

/** The customer a typed referral code belongs to, or null. */
export async function customerByReferralCode(db: Db, code: string) {
  const c = cleanCode(code);
  if (!c) return null;
  return db.customer.findUnique({ where: { referralCode: c } });
}
