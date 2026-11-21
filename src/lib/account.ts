// Customer accounts for the store. Separate from the admin login: its own cookie, its own rules.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { HttpError } from "./api";
import { prisma } from "./db";
import { creditBalance } from "./credit-ops";
import { inviteEmail, passwordResetEmail, sendEmail, type EmailOutcome } from "./email";
import { getStore, siteUrl } from "./order-ops";
import { uniqueReferralCode } from "./referral-codes";
import { json } from "./serialize";
import { signValue, verifyValue } from "./session";
import type { Address } from "./types";

export const ACCOUNT_COOKIE = "peps_account";
const DAYS = 60;

const norm = (email: string) => email.trim().toLowerCase();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export interface Account {
  id: string;
  name: string;
  email: string;
  phone: string;
  addresses: Address[];
  /** Signed in with a temporary password: must choose a new one before anything else. */
  mustChangePassword: boolean;
}

/** Hash cost for customer passwords (bcrypt). Plain passwords are never stored, logged, emailed or returned. */
const COST = 11;
export const hashPassword = (password: string) => bcrypt.hash(password, COST);

type Row = { id: string; name: string; email: string; phone: string; addressesJson: string; mustChangePassword: boolean };
const toAccount = (c: Row): Account => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, addresses: json<Address[]>(c.addressesJson, []), mustChangePassword: c.mustChangePassword });

async function setCookie(customerId: string) {
  const { token, expires } = await signValue(customerId, DAYS);
  (await cookies()).set(ACCOUNT_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires });
}

export async function signOut() {
  (await cookies()).set(ACCOUNT_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** The signed-in customer, or null. */
export async function currentAccount(): Promise<Account | null> {
  const id = await verifyValue((await cookies()).get(ACCOUNT_COOKIE)?.value);
  if (!id) return null;
  const c = await prisma.customer.findUnique({ where: { id } });
  if (!c || !c.passwordHash) return null;
  return toAccount(c);
}

export async function requireAccount(opts: { allowTemporary?: boolean } = {}): Promise<Account> {
  const a = await currentAccount();
  if (!a) throw new HttpError(401, "Sign in to continue.");
  if (a.mustChangePassword && !opts.allowTemporary) throw new HttpError(403, "Choose a new password on your account page first. Your current one is temporary.");
  return a;
}

export async function findByEmail(email: string) {
  const e = norm(email);
  // SQLite compares case-sensitively; emails are stored lowercased for accounts, but CRM rows may not be.
  const rows = await prisma.customer.findMany({ where: { email: { not: "" } } });
  return rows.find((c) => c.email.toLowerCase() === e) ?? null;
}

export const CLAIM_MESSAGE = "This email already has an account with us. We sent a link to claim it.";

/**
 * Create an account. When the email already belongs to a customer (in-person customer, invited, or a
 * real account), nothing is created and nobody is signed in: a claim link goes to that email instead.
 * Only the owner of the inbox can use it, so typing someone's email never shows their account or credit.
 */
export async function signUp(input: { name: string; email: string; password: string }, origin = ""): Promise<{ account: Account } | { claim: true; message: string }> {
  const email = norm(input.email);
  const existing = await findByEmail(email);
  if (existing) {
    await sendInvite(existing.id, origin, { claim: true }).catch((e) => console.error("claim email failed", e instanceof Error ? e.message : e));
    return { claim: true, message: CLAIM_MESSAGE };
  }
  const passwordHash = await hashPassword(input.password);
  const c = await prisma.customer.create({
    data: { id: randomUUID(), name: input.name.trim(), email, passwordHash, lastLoginAt: new Date(), referralCode: await uniqueReferralCode(prisma, input.name) },
  });
  await setCookie(c.id);
  return { account: toAccount(c) };
}

export async function signIn(input: { email: string; password: string }): Promise<Account> {
  const c = await findByEmail(input.email);
  // Same message either way, so the form doesn't reveal which emails have accounts.
  const ok = c?.passwordHash ? await bcrypt.compare(input.password, c.passwordHash) : (await bcrypt.compare(input.password, "$2a$11$C6UzMDM.H6dfI/f/IKcEeO5t9uG2rN6mY0oZqkq0P9Q0s6mZb5K0e"), false);
  if (!c || !ok) throw new HttpError(401, "That email and password don't match. Try again, or reset your password.");
  await prisma.customer.update({ where: { id: c.id }, data: { lastLoginAt: new Date() } });
  await setCookie(c.id);
  return toAccount(c);
}

/** Change the password while signed in (required after a temporary password). */
export async function changePassword(customerId: string, password: string) {
  await prisma.customer.update({ where: { id: customerId }, data: { passwordHash: await hashPassword(password), mustChangePassword: false, resetTokenHash: null, resetExpiresAt: null } });
}

// ---------------------------------------------------------------- Invite / claim links
/** Make a new invite link. The old one stops working. Only its hash is stored. */
export async function newInviteLink(customerId: string, origin = ""): Promise<{ url: string; expiresAt: Date; days: number }> {
  const { store } = await getStore();
  const c = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!c) throw new HttpError(404, "Customer not found. Reload the page.");
  if (!c.email.trim()) throw new HttpError(400, "Add an email to this customer first. The account is linked to it.");
  const days = store.referrals.inviteDays;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + days * 86_400_000);
  await prisma.customer.update({ where: { id: customerId }, data: { inviteTokenHash: sha(token), inviteExpiresAt: expiresAt } });
  return { url: `${siteUrl(store, origin)}/account/invite?token=${token}`, expiresAt, days };
}

/** Email an invite (or a claim link) with a fresh link. */
export async function sendInvite(customerId: string, origin = "", opts: { claim?: boolean } = {}): Promise<EmailOutcome> {
  const { store } = await getStore();
  const link = await newInviteLink(customerId, origin);
  const c = (await prisma.customer.findUnique({ where: { id: customerId } }))!;
  const creditCents = Math.max(0, await creditBalance(prisma, customerId));
  return sendEmail(store, c.email, inviteEmail(store, { name: c.name, creditCents, url: link.url, days: link.days, claim: !!opts.claim }));
}

async function inviteRow(token: string) {
  if (!token || token.length < 20) return null;
  const c = await prisma.customer.findFirst({ where: { inviteTokenHash: sha(token) } });
  if (!c || !c.inviteExpiresAt || c.inviteExpiresAt.getTime() < Date.now()) return null;
  return c;
}

/** What the invite page shows: the name and store credit. Null when the link is wrong, used or expired. */
export async function inviteInfo(token: string): Promise<{ name: string; creditCents: number } | null> {
  const c = await inviteRow(token);
  if (!c) return null;
  return { name: c.name, creditCents: Math.max(0, await creditBalance(prisma, c.id)) };
}

/** Use an invite link: set the password, sign in. The link can't be used again. */
export async function claimInvite(token: string, password: string): Promise<Account> {
  const c = await inviteRow(token);
  if (!c) throw new HttpError(400, "This link has expired or was already used. Ask us for a new one, or use Forgot your password.");
  // Single use even if two tabs submit at once: only the request that clears this exact hash wins.
  const done = await prisma.customer.updateMany({
    where: { id: c.id, inviteTokenHash: c.inviteTokenHash },
    data: { passwordHash: await hashPassword(password), inviteTokenHash: null, inviteExpiresAt: null, mustChangePassword: false, resetTokenHash: null, resetExpiresAt: null, lastLoginAt: new Date() },
  });
  if (done.count !== 1) throw new HttpError(400, "This link has expired or was already used. Ask us for a new one, or use Forgot your password.");
  await setCookie(c.id);
  return toAccount({ ...c, mustChangePassword: false });
}

/** Admin: set a temporary password. The customer must choose a new one at next sign in. */
export async function setTemporaryPassword(customerId: string, password: string) {
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { email: true } });
  if (!c) throw new HttpError(404, "Customer not found. Reload the page.");
  if (!c.email.trim()) throw new HttpError(400, "Add an email to this customer first. They sign in with it.");
  await prisma.customer.update({ where: { id: customerId }, data: { passwordHash: await hashPassword(password), mustChangePassword: true, inviteTokenHash: null, inviteExpiresAt: null } });
}

/** Admin: email a password reset link (accounts with a password only). */
export async function sendPasswordReset(customerId: string, origin = ""): Promise<EmailOutcome> {
  const c = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!c) throw new HttpError(404, "Customer not found. Reload the page.");
  if (!c.passwordHash) throw new HttpError(409, "This customer has not set a password yet. Send the invite link instead.");
  const { store } = await getStore();
  const token = randomBytes(24).toString("base64url");
  await prisma.customer.update({ where: { id: c.id }, data: { resetTokenHash: sha(token), resetExpiresAt: new Date(Date.now() + 3600_000) } });
  return sendEmail(store, c.email, passwordResetEmail(store, `${siteUrl(store, origin)}/account/reset?token=${token}`));
}

/** Always succeeds from the caller's point of view (never reveals whether the email exists). */
export async function requestPasswordReset(emailInput: string, origin: string): Promise<{ emailWorking: boolean }> {
  const { store } = await getStore();
  const c = await findByEmail(emailInput);
  if (!c) return { emailWorking: !!process.env.RESEND_API_KEY };
  // No password yet (invited, or an in-person customer): the claim link is how they set one.
  if (!c.passwordHash) return { emailWorking: (await sendInvite(c.id, origin, { claim: true })).sent };
  const token = randomBytes(24).toString("base64url");
  await prisma.customer.update({ where: { id: c.id }, data: { resetTokenHash: sha(token), resetExpiresAt: new Date(Date.now() + 3600_000) } });
  const out = await sendEmail(store, c.email, passwordResetEmail(store, `${siteUrl(store, origin)}/account/reset?token=${token}`));
  return { emailWorking: out.sent };
}

export async function resetPassword(token: string, password: string) {
  const c = await prisma.customer.findFirst({ where: { resetTokenHash: sha(token) } });
  if (!c || !c.resetExpiresAt || c.resetExpiresAt.getTime() < Date.now()) {
    throw new HttpError(400, "This reset link has expired or was already used. Ask for a new one.");
  }
  await prisma.customer.update({ where: { id: c.id }, data: { passwordHash: await hashPassword(password), resetTokenHash: null, resetExpiresAt: null, mustChangePassword: false, lastLoginAt: new Date() } });
  await setCookie(c.id);
}

const sameAddress = (a: Address, b: Address) =>
  [a.name, a.street1, a.street2, a.city, a.state, a.zip].join("|").toLowerCase() === [b.name, b.street1, b.street2, b.city, b.state, b.zip].join("|").toLowerCase();

/** Remember an address on the account (most recent first, max 5, no duplicates). */
export async function saveAddress(customerId: string, address: Address) {
  const c = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!c) return;
  const list = json<Address[]>(c.addressesJson, []).filter((a) => !sameAddress(a, address));
  await prisma.customer.update({ where: { id: customerId }, data: { addressesJson: JSON.stringify([address, ...list].slice(0, 5)) } });
}

export async function setAddresses(customerId: string, addresses: Address[]) {
  await prisma.customer.update({ where: { id: customerId }, data: { addressesJson: JSON.stringify(addresses.slice(0, 5)) } });
}
