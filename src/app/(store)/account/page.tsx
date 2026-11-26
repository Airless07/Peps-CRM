import type { Metadata } from "next";
import { AccountView } from "@/components/storefront/forms";
import { currentAccount } from "@/lib/account";
import { accountOrders, PUBLIC_STATUS } from "@/lib/store/order-view";
import { referralDashboard } from "@/lib/store/referral-dashboard";
import { storeSnapshot } from "@/lib/store/server";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

export default async function AccountPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const account = await currentAccount();
  const start = (await searchParams)?.start === "signup" ? "signup" : "signin";
  const { data } = await storeSnapshot();
  const orders = account && !account.mustChangePassword ? await accountOrders(account.id, data.store) : [];
  // Balance, referral code and history. Only what the customer should see (no internal "who did it",
  // and other buyers only ever as first name + last initial).
  const credit =
    account && !account.mustChangePassword
      ? await referralDashboard(account.id).then((d) => ({
          balanceCents: d.balanceCents,
          pendingCents: d.pendingCents,
          referralCode: d.code,
          history: d.history.slice(0, 100),
        }))
      : null;
  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-14">
      <AccountView account={account} orders={orders} statusText={PUBLIC_STATUS} credit={credit} initial={start} />
    </div>
  );
}
