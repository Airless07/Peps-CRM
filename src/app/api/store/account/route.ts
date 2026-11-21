import { body, route } from "@/lib/api";
import { changePassword, claimInvite, currentAccount, requestPasswordReset, requireAccount, resetPassword, setAddresses, signIn, signOut, signUp } from "@/lib/account";
import { prisma } from "@/lib/db";
import { requestOrigin } from "@/lib/order-ops";
import { clearFailures, clientIp, lockedFor, rateLimit, recordFailure } from "@/lib/ratelimit";
import { HttpError } from "@/lib/api";
import { accountAction } from "@/lib/store/schemas";

export const dynamic = "force-dynamic";

/** Who is signed in (null when nobody). */
export const GET = route(async () => ({ account: await currentAccount() }), { public: true });

export const POST = route(
  async (req) => {
    const input = await body(req, accountAction);
    switch (input.action) {
      case "signup": {
        rateLimit(req, "signup", 6, 30 * 60_000);
        // An email we already know never signs anyone in: a claim link goes to that inbox instead.
        const r = await signUp(input, requestOrigin(req));
        return "account" in r ? { account: r.account } : { ok: true, claim: true, message: r.message };
      }
      case "claim":
        rateLimit(req, "claim", 10, 30 * 60_000);
        return { account: await claimInvite(input.token, input.password, input.email) };
      case "change-password": {
        const a = await requireAccount({ allowTemporary: true });
        await changePassword(a.id, input.password);
        return { ok: true, account: { ...a, mustChangePassword: false } };
      }
      case "signin": {
        const key = `acct:${clientIp(req)}:${input.email}`;
        const wait = lockedFor(key);
        if (wait > 0) throw new HttpError(429, `Too many wrong passwords. Wait ${wait} minute${wait === 1 ? "" : "s"}, or reset your password.`);
        try {
          const account = await signIn(input);
          clearFailures(key);
          return { account };
        } catch (e) {
          recordFailure(key);
          throw e;
        }
      }
      case "signout":
        await signOut();
        return { ok: true };
      case "reset-request": {
        rateLimit(req, "reset", 4, 30 * 60_000);
        const r = await requestPasswordReset(input.email, requestOrigin(req));
        return {
          ok: true,
          message: r.emailWorking
            ? "If an account uses that email, a link to choose a password is on its way."
            : "We couldn't send the reset email right now. Please use the contact page and we will help you get back in.",
        };
      }
      case "reset":
        rateLimit(req, "reset-use", 10, 30 * 60_000);
        await resetPassword(input.token, input.password);
        return { ok: true };
      case "addresses": {
        const a = await requireAccount();
        await setAddresses(a.id, input.addresses.map((x) => ({ ...x, street2: x.street2 ?? "" })));
        return { ok: true };
      }
      case "profile": {
        const a = await requireAccount();
        await prisma.$transaction([
          prisma.customer.update({ where: { id: a.id }, data: { name: input.name, phone: input.phone } }),
          prisma.order.updateMany({ where: { customerId: a.id }, data: { customer: input.name } }),
        ]);
        return { ok: true };
      }
    }
  },
  { public: true },
);
