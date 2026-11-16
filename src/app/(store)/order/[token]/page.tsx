import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderStatus } from "@/components/storefront/order-status";
import { PUBLIC_STATUS, publicOrderByToken } from "@/lib/store/order-view";
import { storeSnapshot } from "@/lib/store/server";

export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Order status through the secret link from the confirmation email. Works even when the store is closed. */
export default async function OrderPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ placed?: string }> }) {
  const [{ token }, q, { data }] = await Promise.all([params, searchParams, storeSnapshot()]);
  const order = await publicOrderByToken(token, data.store);
  if (!order) notFound();
  const { reviewToken, ...view } = order;
  return <OrderStatus order={view} placed={q.placed === "1"} reviewToken={reviewToken} statusText={PUBLIC_STATUS[view.status]} />;
}
