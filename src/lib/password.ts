import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { getSettingsRow } from "./serialize";

/** Uses the hashed DB password once one is set in Settings, otherwise APP_PASSWORD. */
export async function checkPassword(input: string): Promise<boolean> {
  const s = await getSettingsRow();
  if (s.passwordHash) return bcrypt.compare(input, s.passwordHash);
  const envPw = process.env.APP_PASSWORD;
  if (!envPw) throw new Error("APP_PASSWORD is not set");
  const a = Buffer.from(input);
  const b = Buffer.from(envPw);
  return a.length === b.length && timingSafeEqual(a, b);
}
