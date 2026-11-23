import { randomUUID } from "node:crypto";
import { body, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { adminContactEmail, sendEmail } from "@/lib/email";
import { getStore, requestOrigin, siteUrl } from "@/lib/order-ops";
import { allow, rateLimit } from "@/lib/ratelimit";
import { contactInput } from "@/lib/store/schemas";

/** Contact form: saved for the admin and emailed to the alert list. */
export const POST = route(
  async (req) => {
    rateLimit(req, "contact", 5, 30 * 60_000);
    const { website: _honeypot, ...m } = await body(req, contactInput);
    await prisma.contactMessage.create({ data: { id: randomUUID(), ...m } });
    const { store } = await getStore();
    // Saved always; emailed at most 30 times an hour in total, so a flood from many IPs can't burn the Resend account.
    if (store.alertEmails.length && allow("contact-mail:all", 30, 3600_000)) {
      await sendEmail(store, store.alertEmails, adminContactEmail(store, m, `${siteUrl(store, requestOrigin(req))}/admin/content?tab=messages`)).catch(() => {});
    }
    return { ok: true };
  },
  { public: true },
);
