// The customer's own Referrals dashboard. Server only. Everything a buyer could be identified by stays out:
// buyers show as first name + last initial, never an email, full name, address or what they ordered.
import { prisma } from "../db";
import { referralSummary, referralUses, type UseStatus } from "../referral-stats";
import { shortName } from "../referral-rules";
import { toCreditEntry, toOrder } from "../serialize";
import { countsInMoney, type OrderStatus } from "../types";

export interface DashboardUse {
  id: string;
  buyer: string;
  date: string;
  creditCents: number;
  status: UseStatus;
}

export interface DashboardHistory {
  id: string;
  date: string;
  amountCents: number;
  /** "Earned" | "Spent" | "Reversed" | "Refunded" | "Added" | "Removed" */
  type: string;
  label: string;
}

export interface ReferralDashboard {
  code: string;
  uses: number;
  earnedCents: number;
  pendingCents: number;
  balanceCents: number;
  negative: boolean;
  useRows: DashboardUse[];
  history: DashboardHistory[];
}

export async function referralDashboard(customerId: string): Promise<ReferralDashboard> {
  const [c, orderRows, entryRows] = await Promise.all([
    prisma.customer.findUnique({ where: { id: customerId }, select: { referralCode: true, referralCodeDisplay: true } }),
    prisma.order.findMany({ where: { referredById: customerId }, include: { lines: true } }),
    prisma.creditEntry.findMany({ where: { customerId }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 300 }),
  ]);
  const all = orderRows.map(toOrder);
  const data = {
    orders: all.filter((o) => countsInMoney(o.status as OrderStatus)),
    pendingOrders: all.filter((o) => !countsInMoney(o.status as OrderStatus)),
    creditEntries: entryRows.map(toCreditEntry),
  };
  const sum = referralSummary(data, customerId);
  const useRows = referralUses(data, customerId).map((u) => ({
    id: u.order.id,
    buyer: shortName(u.order.customer || u.order.web?.shipTo?.name),
    date: u.order.web?.placedAt ?? u.order.date,
    creditCents: u.creditCents,
    status: u.status,
  }));
  // Spendable history only (pending credit is shown in the uses table). Reasons are rewritten here so a
  // buyer's name never appears beyond first name + last initial.
  const history = data.creditEntries
    .filter((e) => !e.pending)
    .map((e) => {
      const ord = e.orderNumber ? ` (order #${e.orderNumber})` : "";
      let type: string;
      let label: string;
      if (e.kind === "referral" || e.kind === "referral_new") {
        type = e.amountCents >= 0 ? "Earned" : "Reversed";
        label = e.amountCents >= 0 ? `Referral credit earned${ord}` : `Referral credit reversed${ord}`;
      } else if (e.kind === "order") {
        type = e.amountCents < 0 ? "Spent" : "Refunded";
        label = e.amountCents < 0 ? `Used at checkout${ord}` : `Given back${ord}`;
      } else {
        type = e.amountCents >= 0 ? "Added" : "Removed";
        label = e.reason || (e.amountCents >= 0 ? "Store credit added" : "Store credit removed");
      }
      return { id: e.id, date: e.date, amountCents: e.amountCents, type, label };
    });
  return {
    code: c?.referralCodeDisplay || c?.referralCode || "",
    uses: sum.uses,
    earnedCents: sum.earnedCents,
    pendingCents: sum.pendingCents,
    balanceCents: sum.balanceCents,
    negative: sum.negative,
    useRows,
    history,
  };
}
