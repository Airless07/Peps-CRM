import { body, route, type Ctx } from "@/lib/api";
import { newInviteLink, sendInvite, sendPasswordReset, setTemporaryPassword } from "@/lib/account";
import { outcomeText } from "@/lib/email";
import { requestOrigin } from "@/lib/order-ops";
import { prisma } from "@/lib/db";
import { customerAccountAction } from "@/lib/schemas";
import { toCustomer } from "@/lib/serialize";

/**
 * Admin actions on a customer's store account. No response ever contains a password or a hash:
 * the temporary password is only hashed and stored, the invite link is the one secret returned (so it can be copied).
 */
export const POST = route(async (req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const input = await body(req, customerAccountAction);
  const origin = requestOrigin(req);
  const customer = async () => toCustomer((await prisma.customer.findUniqueOrThrow({ where: { id } })));
  switch (input.action) {
    case "invite-link": {
      const link = await newInviteLink(id, origin);
      return { url: link.url, expiresAt: link.expiresAt.toISOString(), days: link.days, customer: await customer(), message: `New invite link copied. It works once, for ${link.days} days. Any older link stopped working.` };
    }
    case "invite-email": {
      const out = await sendInvite(id, origin);
      return { ok: out.sent, customer: await customer(), message: out.sent ? "Invite emailed. Any older link stopped working." : `Invite not emailed. ${outcomeText(out)}` };
    }
    case "reset-email": {
      const out = await sendPasswordReset(id, origin);
      return { ok: out.sent, customer: await customer(), message: out.sent ? "Password reset link emailed. It works for 1 hour." : `Reset email not sent. ${outcomeText(out)}` };
    }
    case "temp-password":
      await setTemporaryPassword(id, input.password);
      return { ok: true, customer: await customer(), message: "Temporary password set. They must choose a new one when they sign in." };
  }
});
