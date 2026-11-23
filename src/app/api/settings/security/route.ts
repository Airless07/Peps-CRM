import { NextResponse } from "next/server";
import { z } from "zod";
import { body, HttpError, route } from "@/lib/api";
import { createAdminToken } from "@/lib/admin-auth";
import { prisma } from "@/lib/db";
import { getSettingsRow } from "@/lib/serialize";
import { SESSION_COOKIE } from "@/lib/session";
import { currentStep, newTotpSecret, otpauthUrl, verifyTotp } from "@/lib/totp";

/** Two-step sign in status (never the secret once it is on). */
export const GET = route(async () => {
  const s = await getSettingsRow();
  return { totpEnabled: s.totpEnabled };
});

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("signout-everywhere") }),
  z.object({ action: z.literal("totp-start") }),
  z.object({ action: z.literal("totp-enable"), code: z.string().max(12) }),
  z.object({ action: z.literal("totp-disable"), code: z.string().max(12) }),
]);

const freshSession = async (body: Record<string, unknown>) => {
  const { token, expires } = await createAdminToken();
  const res = NextResponse.json(body);
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires });
  return res;
};

export const POST = route(async (req) => {
  const i = await body(req, input);
  const s = await getSettingsRow();
  switch (i.action) {
    case "signout-everywhere":
      // Every admin session made before now stops working. This device gets a new one.
      await prisma.settings.update({ where: { id: 1 }, data: { adminSessionVersion: { increment: 1 } } });
      return freshSession({ ok: true, message: "Every other device was signed out." });
    case "totp-start": {
      if (s.totpEnabled) throw new HttpError(409, "Two-step sign in is already on. Turn it off first to set up a new app.");
      const secret = newTotpSecret();
      await prisma.settings.update({ where: { id: 1 }, data: { totpSecret: secret, totpLastStep: 0 } });
      return { secret, url: otpauthUrl(secret, "admin", "Buckshot Labs") };
    }
    case "totp-enable": {
      if (s.totpEnabled) throw new HttpError(409, "Two-step sign in is already on.");
      if (!s.totpSecret) throw new HttpError(400, "Start the setup first.");
      const step = verifyTotp(s.totpSecret, i.code, 0);
      if (step === null) throw new HttpError(400, "That code doesn't match. Check the app shows Buckshot Labs and enter the current 6-digit code.");
      await prisma.settings.update({ where: { id: 1 }, data: { totpEnabled: true, totpLastStep: step, adminSessionVersion: { increment: 1 } } });
      return freshSession({ ok: true, message: "Two-step sign in is on. Other devices were signed out and need the code next time." });
    }
    case "totp-disable": {
      if (!s.totpEnabled) return { ok: true };
      if (verifyTotp(s.totpSecret, i.code, s.totpLastStep) === null) throw new HttpError(400, "That code is wrong. Enter the current 6-digit code to turn two-step sign in off.");
      await prisma.settings.update({ where: { id: 1 }, data: { totpEnabled: false, totpSecret: "", totpLastStep: currentStep() } });
      return { ok: true, message: "Two-step sign in is off." };
    }
  }
});
