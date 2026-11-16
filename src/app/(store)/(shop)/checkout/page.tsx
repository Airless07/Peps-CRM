import type { Metadata } from "next";
import { CheckoutView } from "@/components/storefront/checkout-view";
import { currentAccount } from "@/lib/account";
import { STATES } from "@/lib/store/schemas";
import { storeAccess, storeSnapshot } from "@/lib/store/server";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage() {
  const [{ data }, account, access] = await Promise.all([storeSnapshot(), currentAccount(), storeAccess()]);
  return <CheckoutView account={account} states={STATES} ack={data.content.acknowledgments} preview={access.preview} />;
}
