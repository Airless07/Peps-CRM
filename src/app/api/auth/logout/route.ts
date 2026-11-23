import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ACCOUNT_COOKIE } from "@/lib/account";
import { revokeToken } from "@/lib/revoke";
import { SESSION_COOKIE, verifySessionToken, verifyValue } from "@/lib/session";

/**
 * Admin sign out. Ends the store account session in this browser too (no half-signed-in state).
 * Both cookies are refused on the server from now on, so a copied cookie stops working too.
 */
export async function POST() {
  const jar = await cookies();
  const admin = jar.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(admin)) await revokeToken(admin);
  const acct = jar.get(ACCOUNT_COOKIE)?.value;
  if (await verifyValue(acct)) await revokeToken(acct);
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  res.cookies.set(ACCOUNT_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
