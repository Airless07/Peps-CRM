import { NextResponse } from "next/server";
import { z } from "zod";
import { body, route } from "@/lib/api";
import { checkPassword } from "@/lib/password";
import { clearFailures, clientIp, lockedFor, recordFailure } from "@/lib/ratelimit";
import { createSessionToken, SESSION_COOKIE } from "@/lib/session";

export const POST = route(
  async (req) => {
    const key = `admin:${clientIp(req)}`;
    const wait = lockedFor(key);
    if (wait > 0) {
      return NextResponse.json({ error: `Too many wrong passwords. Wait ${wait} minute${wait === 1 ? "" : "s"} and try again.` }, { status: 429 });
    }
    const { password } = await body(req, z.object({ password: z.string().min(1).max(200) }));
    if (!(await checkPassword(password))) {
      recordFailure(key);
      await new Promise((r) => setTimeout(r, 400));
      const now = lockedFor(key);
      return NextResponse.json(
        { error: now > 0 ? `Wrong password. Too many tries: wait ${now} minute${now === 1 ? "" : "s"} before trying again.` : "Wrong password. Check it and try again." },
        { status: 401 },
      );
    }
    clearFailures(key);
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
