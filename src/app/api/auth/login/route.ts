import { NextResponse } from "next/server";
import { z } from "zod";
import { body, route } from "@/lib/api";
import { createAdminToken } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { checkPassword } from "@/lib/password";
import { allow, clearFailures, clientIp, lockedFor, recent, recordFailure } from "@/lib/ratelimit";
import { getSettingsRow } from "@/lib/serialize";
import { SESSION_COOKIE } from "@/lib/session";
import { verifyTotp } from "@/lib/totp";

/** Wrong passwords from every IP together: past this, admin sign in pauses (stops spread-out guessing). */
const GLOBAL_FAILS = 50;
const GLOBAL_WINDOW = 15 * 60_000;

const fail = (error: string, status = 401, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

/**
 * Admin sign in: password (bcrypt hash from Settings, or APP_PASSWORD), then the 6-digit code when
 * two-step sign in is on. Locks an IP after 5 wrong tries (doubling up to an hour), and pauses for
 * everyone after 50 wrong tries in 15 minutes from all IPs together.
 */
export const POST = route(
  async (req) => {
    const key = `admin:${clientIp(req)}`;
    const wait = lockedFor(key);
    if (wait > 0) return fail(`Too many wrong passwords. Wait ${wait} minute${wait === 1 ? "" : "s"} and try again.`, 429);
    if (recent("admin-fail:all", GLOBAL_WINDOW) >= GLOBAL_FAILS) return fail("Admin sign in is paused for a few minutes after many wrong passwords. Try again shortly.", 429);
    const { password, code } = await body(req, z.object({ password: z.string().min(1).max(200), code: z.string().max(12).optional() }));
    const wrong = async (msg: string) => {
      recordFailure(key);
      allow("admin-fail:all", Number.MAX_SAFE_INTEGER, GLOBAL_WINDOW);
      await new Promise((r) => setTimeout(r, 400));
      const now = lockedFor(key);
      return fail(now > 0 ? `${msg} Too many tries: wait ${now} minute${now === 1 ? "" : "s"} before trying again.` : msg);
    };
    if (!(await checkPassword(password))) return wrong("Wrong password. Check it and try again.");

    const s = await getSettingsRow();
    if (s.totpEnabled) {
      if (!code) return fail("Enter the 6-digit code from your authenticator app.", 401, { needCode: true });
      const step = verifyTotp(s.totpSecret, code, s.totpLastStep);
      if (step === null) return wrong("That code is wrong or was already used. Enter the current 6-digit code.");
      // A code works once: the step is saved only if no other sign in used it first.
      const used = await prisma.settings.updateMany({ where: { id: 1, totpLastStep: { lt: step } }, data: { totpLastStep: step } });
      if (used.count !== 1) return wrong("That code was already used. Wait for the next one.");
    }

    clearFailures(key);
    const { token, expires } = await createAdminToken();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires });
    return res;
  },
  { public: true },
);
