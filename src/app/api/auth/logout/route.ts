import { NextResponse } from "next/server";
import { ACCOUNT_COOKIE } from "@/lib/account";
import { SESSION_COOKIE } from "@/lib/session";

/** Admin sign out. Ends the store account session in this browser too (no half-signed-in state). */
export async function POST() {
  const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  res.cookies.set(ACCOUNT_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
