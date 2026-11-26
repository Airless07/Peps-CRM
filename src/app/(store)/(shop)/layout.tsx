import Link from "next/link";
import { TAGLINE } from "@/lib/store/config";
import { storeAccess, storeSnapshot } from "@/lib/store/server";
import { currentAccount } from "@/lib/account";
import { SavedReferral } from "@/components/storefront/saved-referral";

/** Everything in this group needs the store to be open (or an admin previewing it). */
export default async function ShopGate({ children }: { children: React.ReactNode }) {
  const access = await storeAccess();
  if (access.allowed) return <>{children}</>;
  const [{ data }, account] = await Promise.all([storeSnapshot(), currentAccount()]);
  const signedIn = !!account && !account.mustChangePassword;
  return (
    <section className="s-wrap flex min-h-[68dvh] flex-col justify-center py-20">
      <p className="text-sm font-medium text-brand">Coming soon</p>
      <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-[1.02] sm:text-7xl" style={{ letterSpacing: "-0.035em" }}>
        {data.store.storeName} is getting ready to open.
      </h1>
      <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone">{TAGLINE} The store opens shortly. Check back soon.</p>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-coal" data-coming-soon-accounts>
        Create your account now to get your referral code ready for launch.
      </p>
      <SavedReferral />
      <div className="mt-9 flex flex-wrap gap-3" data-coming-soon-actions>
        {signedIn ? (
          <>
            <Link href="/account" className="s-btn-primary">
              My account
            </Link>
            <Link href="/account/referrals" className="s-btn-line">
              My referral code
            </Link>
          </>
        ) : (
          <>
            <Link href="/account?start=signup" className="s-btn-primary">
              Create an account
            </Link>
            <Link href="/account" className="s-btn-line">
              Sign in
            </Link>
          </>
        )}
        <Link href="/order-lookup" className="s-btn-line">
          Look up an order
        </Link>
        <Link href="/research-use" className="s-btn-line">
          Research use policy
        </Link>
      </div>
    </section>
  );
}
