// Customer accounts for the store. Separate from the admin login: its own cookie, its own rules.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { HttpError } from "./api";
import { prisma } from "./db";
import { passwordResetEmail, sendEmail } from "./email";
import { getStore, siteUrl } from "./order-ops";
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
}

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
  return { id: c.id, name: c.name, email: c.email, phone: c.phone, addresses: json<Address[]>(c.addressesJson, []) };
}

export async function requireAccount(): Promise<Account> {
  const a = await currentAccount();
  if (!a) throw new HttpError(401, "Sign in to continue.");
  return a;
}

async function findByEmail(email: string) {
  const e = norm(email);
  // SQLite compares case-sensitively; emails are stored lowercased for accounts, but CRM rows may not be.
  const rows = await prisma.customer.findMany({ where: { email: { not: "" } } });
  return rows.find((c) => c.email.toLowerCase() === e) ?? null;
}

export async function signUp(input: { name: string; email: string; password: string }): Promise<Account> {
  const email = norm(input.email);
  const existing = await findByEmail(email);
  if (existing?.passwordHash) throw new HttpError(409, "An account with this email already exists. Sign in instead, or reset your password.");
  const passwordHash = await bcrypt.hash(input.password, 11);
  const c = existing
    ? await prisma.customer.update({ where: { id: existing.id }, data: { passwordHash, email, name: existing.name || input.name.trim() } })
    : await prisma.customer.create({ data: { id: randomUUID(), name: input.name.trim(), email, passwordHash } });
  await setCookie(c.id);
  return { id: c.id, name: c.name, email: c.email, phone: c.phone, addresses: json<Address[]>(c.addressesJson, []) };
}

export async function signIn(input: { email: string; password: string }): Promise<Account> {
  const c = await findByEmail(input.email);
  // Same message either way, so the form doesn't reveal which emails have accounts.
  const ok = c?.passwordHash ? await bcrypt.compare(input.password, c.passwordHash) : (await bcrypt.compare(input.password, "$2a$11$C6UzMDM.H6dfI/f/IKcEeO5t9uG2rN6mY0oZqkq0P9Q0s6mZb5K0e"), false);
  if (!c || !ok) throw new HttpError(401, "That email and password don't match. Try again, or reset your password.");
  await setCookie(c.id);
  return { id: c.id, name: c.name, email: c.email, phone: c.phone, addresses: json<Address[]>(c.addressesJson, []) };
}

/** Always succeeds from the caller's point of view (never reveals whether the email exists). */
export async function requestPasswordReset(emailInput: string, origin: string): Promise<{ emailWorking: boolean }> {
  const { store } = await getStore();
  const c = await findByEmail(emailInput);
  if (!c?.passwordHash) return { emailWorking: !!process.env.RESEND_API_KEY };
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
  await prisma.customer.update({ where: { id: c.id }, data: { passwordHash: await bcrypt.hash(password, 11), resetTokenHash: null, resetExpiresAt: null } });
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
