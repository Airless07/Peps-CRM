// Customer accounts for the store. Separate from the admin login: its own cookie, its own rules.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { HttpError } from "./api";
import { prisma } from "./db";
import { allow } from "./ratelimit";
import { creditBalance } from "./credit-ops";
import { inviteEmail, passwordResetEmail, sendEmail, type EmailOutcome } from "./email";
import { getStore, siteUrl } from "./order-ops";
import { uniqueReferralCode } from "./referral-codes";
import { json } from "./serialize";
import { SESSION_COOKIE, signValue, verifyValue } from "./session";
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

/** A short fingerprint of the password hash. In the cookie, so a new password ends every older session. */
const pwPrint = (passwordHash: string | null) => sha(`acct:${passwordHash ?? ""}`).slice(0, 16);

async function setCookie(customerId: string, passwordHash: string | null) {
  const { token, expires } = await signValue(`${customerId}:${pwPrint(passwordHash)}`, DAYS);
  (await cookies()).set(ACCOUNT_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires });
}

/**
 * Sign out of the store. One browser is one person: the admin session (if any) ends too, so signing out
 * never leaves half of a session behind on a shared computer. (Admin sign out ends the store session too.)
 */
export async function signOut() {
  const jar = await cookies();
  jar.set(ACCOUNT_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  jar.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** The signed-in customer, or null. */
export async function currentAccount(): Promise<Account | null> {
  const value = await verifyValue((await cookies()).get(ACCOUNT_COOKIE)?.value);
  if (!value) return null;
  const [id, print] = value.split(":");
  if (!id || !print) return null;
  const c = await prisma.customer.findUnique({ where: { id } });
  // The password changed since this cookie was made (reset, change, or a new temporary one): signed out.
  if (!c || !c.passwordHash || print !== pwPrint(c.passwordHash)) return null;
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
    if (inboxOk(existing.email)) await sendInvite(existing.id, origin, { claim: true }).catch((e) => console.error("claim email failed", e instanceof Error ? e.message : e));
    return { claim: true, message: CLAIM_MESSAGE };
  }
  const passwordHash = await hashPassword(input.password);
  const c = await prisma.customer.create({
    data: { id: randomUUID(), name: input.name.trim(), email, passwordHash, lastLoginAt: new Date(), referralCode: await uniqueReferralCode(prisma, input.name) },
  });
  await setCookie(c.id, passwordHash);
  return { account: toAccount(c) };
}

export async function signIn(input: { email: string; password: string }): Promise<Account> {
  const c = await findByEmail(input.email);
  // Same message either way, so the form doesn't reveal which emails have accounts.
  const ok = c?.passwordHash ? await bcrypt.compare(input.password, c.passwordHash) : (await bcrypt.compare(input.password, "$2a$11$C6UzMDM.H6dfI/f/IKcEeO5t9uG2rN6mY0oZqkq0P9Q0s6mZb5K0e"), false);
  if (!c || !ok) throw new HttpError(401, "That email and password don't match. Try again, or reset your password.");
  await prisma.customer.update({ where: { id: c.id }, data: { lastLoginAt: new Date() } });
  await setCookie(c.id, c.passwordHash);
  return toAccount(c);
}

/**
 * Change the password while signed in. After a temporary password this is required; otherwise the
 * current password must be given (a borrowed or stolen session can't lock the owner out). Every other
 * browser is signed out; this one gets a new session.
 */
export async function changePassword(customerId: string, password: string, current?: string) {
  const c = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!c?.passwordHash) throw new HttpError(401, "Sign in to continue.");
  if (!c.mustChangePassword && !(current && (await bcrypt.compare(current, c.passwordHash)))) {
    throw new HttpError(400, "Enter your current password to choose a new one.");
  }
  const passwordHash = await hashPassword(password);
  await prisma.customer.update({ where: { id: customerId }, data: { passwordHash, mustChangePassword: false, resetTokenHash: null, resetExpiresAt: null } });
  await setCookie(customerId, passwordHash);
}

// ---------------------------------------------------------------- Invite / claim links
/**
 * Make a new invite link (32 random bytes). The old one stops working. Only its hash is stored, so the
 * full link is shown once, to the admin who made it. Works for customers with no email too: they type
 * one when they claim it.
 */
export async function newInviteLink(customerId: string, origin = ""): Promise<{ url: string; expiresAt: Date; days: number }> {
  const { store } = await getStore();
  const c = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!c) throw new HttpError(404, "Customer not found. Reload the page.");
  const days = store.referrals.inviteDays;
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + days * 86_400_000);
  await prisma.customer.update({ where: { id: customerId }, data: { inviteTokenHash: sha(token), inviteExpiresAt: expiresAt, inviteCreatedAt: now } });
  return { url: `${siteUrl(store, origin)}/account/invite?token=${token}`, expiresAt, days };
}

/** Email an invite (or a claim link) with a fresh link. Needs the email on file. */
export async function sendInvite(customerId: string, origin = "", opts: { claim?: boolean } = {}): Promise<EmailOutcome> {
  const { store } = await getStore();
  const found = await prisma.customer.findUnique({ where: { id: customerId }, select: { email: true } });
  if (!found) throw new HttpError(404, "Customer not found. Reload the page.");
  if (!found.email.trim()) throw new HttpError(400, "This customer has no email to send to. Use Create invite link and send it yourself.");
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

/**
 * What the invite page shows: the name and the customer's store credit (their real balance, the same sum
 * the account page and the admin show). `needsEmail`: no email on file, so the page asks for one.
 * Null when the link is wrong, used or expired.
 */
export async function inviteInfo(token: string): Promise<{ name: string; creditCents: number; needsEmail: boolean } | null> {
  const c = await inviteRow(token);
  if (!c) return null;
  return { name: c.name, creditCents: await creditBalance(prisma, c.id), needsEmail: !c.email.trim() };
}

export const EMAIL_TAKEN_MESSAGE = "That email is already linked to another account. Use a different email or contact us.";
const LINK_DEAD = "This link has expired or was already used. Ask us for a new one, or use Forgot your password.";

/**
 * Use an invite link: set the password and sign in, on the SAME customer (same credit, orders and referrals).
 * A customer with no email types one here; it is saved on them. An email that belongs to any other customer
 * is refused with one fixed message (nothing about that other customer is shown, nothing is merged or moved),
 * and the link stays usable so they can try another email. The link can't be used again once it worked.
 */
export async function claimInvite(token: string, password: string, emailInput?: string): Promise<Account> {
  const c = await inviteRow(token);
  if (!c) throw new HttpError(400, LINK_DEAD);
  const needsEmail = !c.email.trim();
  const email = needsEmail ? norm(emailInput ?? "") : c.email;
  if (needsEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new HttpError(400, "Enter a valid email address, like name@example.com.");
  const passwordHash = await hashPassword(password);
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    if (needsEmail) {
      const others = await tx.customer.findMany({ where: { id: { not: c.id }, email: { not: "" } }, select: { email: true } });
      if (others.some((o) => o.email.trim().toLowerCase() === email)) throw new HttpError(409, EMAIL_TAKEN_MESSAGE);
    }
    // Single use even if two tabs submit at once: only the request that clears this exact hash wins.
    const done = await tx.customer.updateMany({
      where: { id: c.id, inviteTokenHash: c.inviteTokenHash, ...(needsEmail ? { email: "" } : {}) },
      data: {
        ...(needsEmail ? { email } : {}),
        passwordHash,
        inviteTokenHash: null,
        inviteExpiresAt: null,
        inviteClaimedAt: now,
        inviteClaimedEmail: email,
        mustChangePassword: false,
        resetTokenHash: null,
        resetExpiresAt: null,
        lastLoginAt: now,
      },
    });
    if (done.count !== 1) throw new HttpError(400, LINK_DEAD);
    return tx.customer.findUniqueOrThrow({ where: { id: c.id } });
  });
  await setCookie(c.id, updated.passwordHash);
  return toAccount(updated);
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

/**
 * Account emails (reset, claim) per inbox: at most 3 an hour, from any number of IPs, so nobody can
 * flood someone's inbox (or burn the Resend account) through the forms. Over the limit nothing is sent
 * and the answer looks the same.
 */
const inboxOk = (email: string) => allow(`account-mail:${norm(email)}`, 3, 3600_000);

/** Always succeeds from the caller's point of view (never reveals whether the email exists). */
export async function requestPasswordReset(emailInput: string, origin: string): Promise<{ emailWorking: boolean }> {
  const { store } = await getStore();
  const c = await findByEmail(emailInput);
  if (!c || !inboxOk(c.email)) return { emailWorking: !!process.env.RESEND_API_KEY };
  // No password yet (invited, or an in-person customer): the claim link is how they set one.
  if (!c.passwordHash) return { emailWorking: (await sendInvite(c.id, origin, { claim: true })).sent };
  const token = randomBytes(24).toString("base64url");
  await prisma.customer.update({ where: { id: c.id }, data: { resetTokenHash: sha(token), resetExpiresAt: new Date(Date.now() + 3600_000) } });
  const out = await sendEmail(store, c.email, passwordResetEmail(store, `${siteUrl(store, origin)}/account/reset?token=${token}`));
  return { emailWorking: out.sent };
}

export async function resetPassword(token: string, password: string): Promise<Account> {
  const c = await prisma.customer.findFirst({ where: { resetTokenHash: sha(token) } });
  if (!c || !c.resetExpiresAt || c.resetExpiresAt.getTime() < Date.now()) {
    throw new HttpError(400, "This reset link has expired or was already used. Ask for a new one.");
  }
  const updated = await prisma.customer.update({ where: { id: c.id }, data: { passwordHash: await hashPassword(password), resetTokenHash: null, resetExpiresAt: null, mustChangePassword: false, lastLoginAt: new Date() } });
  await setCookie(c.id, updated.passwordHash);
  return toAccount(updated);
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
