import { NextResponse } from "next/server";
import { z } from "zod";
import { body, route } from "@/lib/api";
import { checkPassword } from "@/lib/password";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";

const failures = new Map<string, { n: number; until: number }>();

export const POST = route(
  async (req) => {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    const f = failures.get(ip);
    if (f && f.until > Date.now()) {
      return NextResponse.json({ error: "Too many attempts. Wait a minute and try again." }, { status: 429 });
    }
    const { password } = await body(req, z.object({ password: z.string().min(1).max(200) }));
    if (!(await checkPassword(password))) {
      const n = (f?.n ?? 0) + 1;
      failures.set(ip, { n: n >= 5 ? 0 : n, until: n >= 5 ? Date.now() + 60_000 : 0 });
      await new Promise((r) => setTimeout(r, 400));
      return NextResponse.json({ error: "Wrong password" }, { status: 401 });
    }
    failures.delete(ip);
    const { token, expires } = await createSessionToken();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires,
    });
    return res;
  },
  { public: true },
);
