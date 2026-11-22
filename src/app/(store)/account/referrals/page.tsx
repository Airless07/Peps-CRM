import type { Metadata } from "next";
import { headers } from "next/headers";
import { AccountGate } from "@/components/storefront/forms";
import { AccountTabs, ReferralsView } from "@/components/storefront/referrals-view";
import { currentAccount } from "@/lib/account";
import { siteUrl } from "@/lib/order-ops";
import { referralDashboard } from "@/lib/store/referral-dashboard";
import { storeSnapshot } from "@/lib/store/server";

export const metadata: Metadata = { title: "Referrals", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ReferralsPage() {
  const account = await currentAccount();
  const { data } = await storeSnapshot();
  if (!account || account.mustChangePassword) {
    return (
      <div className="s-wrap pb-8 pt-10 sm:pt-14">
        <AccountGate account={account} title="Your referral dashboard" intro="Create a free account to get your own referral code, or sign in to see your referrals." initial="signup" />
      </div>
    );
  }
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") || host?.startsWith("127.") ? "http" : "https");
  const base = siteUrl(data.store, host ? `${proto}://${host}` : undefined);
  const dash = await referralDashboard(account.id);
  const r = data.store.referrals;
  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-14">
      <AccountTabs />
      <ReferralsView data={dash} shareBase={base} rewardPercent={r.percent} buyerPercent={r.buyerDiscountPercent} />
    </div>
  );
}
