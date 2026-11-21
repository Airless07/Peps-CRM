import type { Metadata } from "next";
import { AccountView } from "@/components/storefront/forms";
import { currentAccount } from "@/lib/account";
import { creditBalance } from "@/lib/credit-ops";
import { prisma } from "@/lib/db";
import { accountOrders, PUBLIC_STATUS } from "@/lib/store/order-view";
import { storeSnapshot } from "@/lib/store/server";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

export default async function AccountPage() {
  const account = await currentAccount();
  const { data } = await storeSnapshot();
  const orders = account && !account.mustChangePassword ? await accountOrders(account.id, data.store) : [];
  // Balance, referral code and history. Only what the customer should see (no internal "who did it").
  const credit =
    account && !account.mustChangePassword
      ? await Promise.all([
          creditBalance(prisma, account.id),
          prisma.customer.findUnique({ where: { id: account.id }, select: { referralCode: true } }),
          prisma.creditEntry.findMany({ where: { customerId: account.id }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 100 }),
        ]).then(([balance, c, rows]) => ({
          balanceCents: Math.max(0, balance),
          referralCode: c?.referralCode ?? "",
          history: rows.map((r) => ({ id: r.id, date: r.date.toISOString(), amountCents: r.amountCents, reason: r.reason, orderNumber: r.orderNumber })),
        }))
      : null;
  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-14">
      <AccountView account={account} orders={orders} statusText={PUBLIC_STATUS} credit={credit} />
    </div>
  );
}
