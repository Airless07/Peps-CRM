// Signing out ends the session on the server (Node only, reads the database).
// Cookies are signed, not stored, so without this a copied cookie would keep working after sign out
// until it expired (30 days admin, 60 days customer). Signing out lists the cookie's signature here;
// listed cookies are refused. Rows are removed once the cookie would have expired anyway.
import { createHash } from "node:crypto";
import { prisma } from "./db";

const idOf = (token: string) => createHash("sha256").update(`revoked:${token.split(".").pop() ?? ""}`).digest("hex");

/** Expiry written in a signed token ("<v>.<expires ms>.<value>.<sig>"), or null. */
function expiryOf(token: string): Date | null {
  const exp = Number(token.split(".")[1]);
  return Number.isFinite(exp) && exp > Date.now() ? new Date(exp) : null;
}

/** Refuse this (already verified) token from now on. Never throws. */
export async function revokeToken(token: string | undefined | null): Promise<void> {
  if (!token) return;
  const expiresAt = expiryOf(token);
  if (!expiresAt) return;
  try {
    const id = idOf(token);
    await prisma.revokedSession.upsert({ where: { id }, update: {}, create: { id, expiresAt } });
    await prisma.revokedSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  } catch (e) {
    console.error("revoke session failed", e instanceof Error ? e.message : e);
  }
}

export async function isRevoked(token: string): Promise<boolean> {
  return (await prisma.revokedSession.count({ where: { id: idOf(token) } })) > 0;
}
