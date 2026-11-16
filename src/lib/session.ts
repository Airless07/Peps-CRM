// Signed session cookie using Web Crypto (works in both the Edge middleware and Node routes).
export const SESSION_COOKIE = "peps_session";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET is missing or too short (use 32+ random characters).");
  if (process.env.NODE_ENV === "production" && s.startsWith("local-dev-only-secret")) {
    throw new Error("SESSION_SECRET is still the local default. Set a real random secret in production.");
  }
  return s;
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Sign any short value (used for the customer account cookie). */
export async function signValue(value: string, days: number): Promise<{ token: string; expires: Date }> {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const payload = `c1.${expires.getTime()}.${value}`;
  return { token: `${payload}.${await hmac(payload)}`, expires };
}

/** The signed value, or null when the token is missing, expired or tampered with. */
export async function verifyValue(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "c1") return null;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  try {
    return safeEqual(parts[3], await hmac(parts.slice(0, 3).join("."))) ? parts[2] : null;
  } catch {
    return null;
  }
}

export async function createSessionToken(): Promise<{ token: string; expires: Date }> {
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const payload = `v1.${expires.getTime()}`;
  return { token: `${payload}.${await hmac(payload)}`, expires };
}

export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  try {
    return safeEqual(parts[2], await hmac(`${parts[0]}.${parts[1]}`));
  } catch {
    return false;
  }
}
