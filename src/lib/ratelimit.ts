import type { NextRequest } from "next/server";
import { HttpError } from "./api";

// In-memory sliding windows. One server instance (SQLite), so memory is enough.
const g = globalThis as unknown as { __rate?: Map<string, number[]> };
const hits = (g.__rate ??= new Map<string, number[]>());

export function clientIp(req: NextRequest | Request): string {
  // The proxy in front (Railway) adds the real client address at the END of X-Forwarded-For. Anything
  // before it was sent by the client and can be faked, so it is never used for rate limits.
  const list = (req.headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.at(-1) || req.headers.get("x-real-ip") || "local";
}

/** True when this call is allowed. Records it. */
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return false;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t > 3600_000)) hits.delete(k);
  return true;
}

/** How many calls were recorded for this key in the window (without recording one). */
export function recent(key: string, windowMs: number): number {
  const now = Date.now();
  return (hits.get(key) ?? []).filter((t) => now - t < windowMs).length;
}

/** Throws a 429 with a plain message when the caller is going too fast. */
export function rateLimit(req: NextRequest | Request, name: string, max: number, windowMs: number) {
  if (!allow(`${name}:${clientIp(req)}`, max, windowMs)) {
    const mins = Math.max(1, Math.round(windowMs / 60000));
    throw new HttpError(429, `Too many tries. Wait ${mins} minute${mins === 1 ? "" : "s"} and try again.`);
  }
}

// ---------------------------------------------------------------- Login lockout
const fails = ((globalThis as unknown as { __fails?: Map<string, { n: number; until: number }> }).__fails ??= new Map());

/** Minutes left while locked out, 0 when allowed to try. */
export function lockedFor(key: string): number {
  const f = fails.get(key);
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0;
}

/** Record a failed attempt. 5 in a row lock for 5 minutes, and each further round doubles (max 1 hour). */
export function recordFailure(key: string) {
  const f = fails.get(key) ?? { n: 0, until: 0 };
  f.n += 1;
  if (f.n % 5 === 0) f.until = Date.now() + Math.min(60, 5 * 2 ** (f.n / 5 - 1)) * 60_000;
  fails.set(key, f);
}

export const clearFailures = (key: string) => void fails.delete(key);
