import { createHash, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { getSettingsRow } from "./serialize";

/** Uses the hashed DB password once one is set in Settings, otherwise APP_PASSWORD. */
export async function checkPassword(input: string): Promise<boolean> {
  const s = await getSettingsRow();
  if (s.passwordHash) return bcrypt.compare(input, s.passwordHash);
  const envPw = process.env.APP_PASSWORD;
  if (!envPw) throw new Error("APP_PASSWORD is not set");
  // Compare fixed-length digests, so the time taken says nothing about the length or the content.
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(envPw).digest();
  return timingSafeEqual(a, b);
}

/** Passwords that must never be the admin password: the shipped default and the usual guesses. */
import { WEAK_PASSWORDS as WEAK } from "./weak-passwords";
const strongCache = new Map<string, boolean>();

/**
 * Launch checklist: is the admin password a real one? With a password set in Settings, checks the hash
 * against the default and common passwords (cached per hash). Without one, checks APP_PASSWORD itself.
 * Never returns the password.
 */
export async function adminPasswordCheck(): Promise<{ ok: boolean; detail: string }> {
  const s = await getSettingsRow();
  if (s.passwordHash) {
    let weak = strongCache.get(s.passwordHash);
    if (weak === undefined) {
      weak = false;
      for (const w of WEAK) if (await bcrypt.compare(w, s.passwordHash)) weak = true;
      strongCache.set(s.passwordHash, weak);
    }
    return weak ? { ok: false, detail: "The admin password is a default or very common one. Change it in Settings, Password." } : { ok: true, detail: "Set in Settings, and not a default or common password." };
  }
  const envPw = process.env.APP_PASSWORD ?? "";
  if (WEAK.includes(envPw.toLowerCase())) return { ok: false, detail: "Still the default APP_PASSWORD. Change it in Settings, Password." };
  if (envPw.length < 12) return { ok: false, detail: "APP_PASSWORD is shorter than 12 characters. Set a longer one in Settings, Password." };
  return { ok: true, detail: "Uses APP_PASSWORD from the Railway variables (12+ characters, not a common one)." };
}
