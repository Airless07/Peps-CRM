/**
 * Admin sessions on the server (Node only, reads the database).
 * A session is valid when its signature is right, it has not expired, and its generation matches the
 * current one. The generation changes when the admin password changes (in Settings or APP_PASSWORD on
 * Railway) or when someone uses "Sign out everywhere", so old sessions stop working at once.
 */
import { createHash } from "node:crypto";
import { getSettingsRow } from "./serialize";
import { createSessionToken, sessionTokenGen } from "./session";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function adminGeneration(): Promise<string> {
  const s = await getSettingsRow();
  const pw = s.passwordHash ? `db:${s.passwordHash}` : `env:${sha(process.env.APP_PASSWORD ?? "")}`;
  return sha(`${pw}|${s.adminSessionVersion}`).slice(0, 16);
}

export async function isAdminToken(token: string | undefined | null): Promise<boolean> {
  const gen = await sessionTokenGen(token);
  if (!gen) return false;
  return gen === (await adminGeneration());
}

/** A new admin session token for the current generation. */
export async function createAdminToken() {
  return createSessionToken(await adminGeneration());
}
