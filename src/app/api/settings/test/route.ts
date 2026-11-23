import { z } from "zod";
import { body, HttpError, route } from "@/lib/api";
import { resendKey, sendEmail, testEmail } from "@/lib/email";
import { getStore } from "@/lib/order-ops";
import { envSiteUrl } from "@/lib/site";
import { adminPasswordCheck } from "@/lib/password";
import { shippoIsTestKey, shippoKey, testConnection, webhookSecret } from "@/lib/shippo";

export const dynamic = "force-dynamic";

/** Which keys are set (never the keys themselves), and the launch checks that need the server. */
export const GET = route(async () => ({
  adminPassword: await adminPasswordCheck(),
  resend: !!resendKey(),
  shippo: !!shippoKey(),
  shippoTest: shippoIsTestKey(),
  /** Path to paste into Shippo's webhook settings (after your site address). */
  webhookPath: `/api/webhooks/shippo?key=${webhookSecret()}`,
  /** SITE_URL from the environment: when set, it is the address used for every link. */
  siteUrl: envSiteUrl(),
}));

/** "Send test email" and "Test Shippo connection". Always answers with a clear success or the exact error. */
export const POST = route(async (req) => {
  const input = await body(req, z.discriminatedUnion("what", [z.object({ what: z.literal("email"), to: z.string().trim().max(200) }), z.object({ what: z.literal("shippo") })]));
  if (input.what === "shippo") return testConnection();
  const { store } = await getStore();
  const to = input.to || store.alertEmails[0] || "";
  if (!to) throw new HttpError(400, "Add an alert email first (or type an address), so there is somewhere to send the test.");
  const out = await sendEmail(store, to, testEmail(store));
  if (out.sent) return { ok: true, message: `Test email sent to ${to}. Check the inbox (and spam).` };
  return { ok: false, message: out.skipped ? `${out.reason} Add RESEND_API_KEY to the environment variables (Railway: Variables) and redeploy.` : `Resend refused the email: ${out.error}` };
});
