import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderStatus } from "@/components/storefront/order-status";
import { ShareCodeBanner } from "@/components/storefront/referrals-view";
import { currentAccount } from "@/lib/account";
import { prisma } from "@/lib/db";
import { localStatusText, PUBLIC_STATUS, publicOrderByToken } from "@/lib/store/order-view";
import { storeSnapshot } from "@/lib/store/server";

export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Order status through the secret link from the confirmation email. Works even when the store is closed. */
export default async function OrderPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ placed?: string }> }) {
  const [{ token }, q, { data }, account] = await Promise.all([params, searchParams, storeSnapshot(), currentAccount()]);
  const order = await publicOrderByToken(token, data.store);
  if (!order) notFound();
  const { reviewToken, ...view } = order;
  // The viewer's own code when signed in (never the code of whoever placed the order).
  const me = account && !account.mustChangePassword ? await prisma.customer.findUnique({ where: { id: account.id }, select: { referralCode: true, referralCodeDisplay: true } }) : null;
  const code = me ? me.referralCodeDisplay || me.referralCode || null : null;
  return (
    <>
      <OrderStatus order={view} placed={q.placed === "1"} reviewToken={reviewToken} statusText={localStatusText(view) ?? PUBLIC_STATUS[view.status]} />
      <ShareCodeBanner code={code} percent={data.store.referrals.percent} />
    </>
  );
}
