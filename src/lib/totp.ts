/**
 * Time-based one-time codes (RFC 6238, the 6-digit codes of Google Authenticator, 1Password, Authy).
 * SHA-1, 30-second steps, one step of clock drift allowed either way.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of buf) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | ALPHABET.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpCode(secret: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

export const currentStep = (now = Date.now()) => Math.floor(now / 30_000);

/** The step the code is valid for (now, or one step either side), or null. Never accepts a step at or before `lastStep`. */
export function verifyTotp(secret: string, code: string, lastStep = 0, now = Date.now()): number | null {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c) || !secret) return null;
  const step = currentStep(now);
  for (const s of [step - 1, step, step + 1]) {
    if (s <= lastStep) continue;
    if (timingSafeEqual(Buffer.from(totpCode(secret, s)), Buffer.from(c))) return s;
  }
  return null;
}

export function otpauthUrl(secret: string, label: string, issuer: string): string {
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${label}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
