import type { Metadata } from "next";
import { AccountView } from "@/components/storefront/forms";
import { currentAccount } from "@/lib/account";
import { accountOrders, PUBLIC_STATUS } from "@/lib/store/order-view";
import { storeSnapshot } from "@/lib/store/server";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

export default async function AccountPage() {
  const account = await currentAccount();
  const { data } = await storeSnapshot();
  const orders = account ? await accountOrders(account.id, data.store) : [];
  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-14">
      <AccountView account={account} orders={orders} statusText={PUBLIC_STATUS} />
    </div>
  );
}
