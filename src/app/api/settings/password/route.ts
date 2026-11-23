import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { body, HttpError, route } from "@/lib/api";
import { createAdminToken } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { checkPassword } from "@/lib/password";
import { passwordChange } from "@/lib/schemas";
import { SESSION_COOKIE } from "@/lib/session";

/**
 * Change the admin password. Every other admin session ends (they were made for the old password);
 * this device gets a new session so it stays signed in.
 */
export const POST = route(async (req) => {
  const { current, next } = await body(req, passwordChange);
  if (!(await checkPassword(current))) throw new HttpError(400, "Current password is wrong");
  await prisma.settings.update({ where: { id: 1 }, data: { passwordHash: await bcrypt.hash(next, 12) } });
  const { token, expires } = await createAdminToken();
  const res = NextResponse.json({ ok: true, message: "Password changed. Other devices were signed out." });
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires });
  return res;
});
