import type { Metadata } from "next";
import Link from "next/link";
import { InviteForm } from "@/components/storefront/forms";
import { inviteInfo } from "@/lib/account";

export const metadata: Metadata = { title: "Set up your account", robots: { index: false } };
export const dynamic = "force-dynamic";

const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** Invite and claim links land here: "Welcome, name. You have $X store credit." then choose a password. */
export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const info = token ? await inviteInfo(token) : null;
  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-14">
      <div className="mx-auto max-w-md">
        {info ? (
          <>
            <h1 className="text-4xl font-semibold" style={{ letterSpacing: "-0.03em" }} data-invite-welcome>
              Welcome, {info.name.split(" ")[0]}.
            </h1>
            <p className="mt-3 text-[1.0625rem] leading-relaxed text-stone" data-invite-credit>
              You have {money(info.creditCents)} store credit. Choose a password to finish setting up your account.
            </p>
            <div className="mt-7">
              <InviteForm token={token!} />
            </div>
          </>
        ) : (
          <>
            <h1 className="text-4xl font-semibold" style={{ letterSpacing: "-0.03em" }}>
              This link doesn’t work anymore
            </h1>
            <p className="mt-3 text-[1.0625rem] leading-relaxed text-stone">It has expired or was already used. Ask us for a new one, or use “Forgot your password” on the sign in page.</p>
            <Link href="/account" className="s-btn-primary mt-6">
              Go to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
