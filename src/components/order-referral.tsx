"use client";

// Admin order page: the referral on this order (code, owner, credit and its status) and refunds.
import Link from "next/link";
import { useState } from "react";
import { refundableOf } from "@/lib/credit";
import { fmtMoney } from "@/lib/format";
import { referralUses } from "@/lib/referral-stats";
import { countsInMoney, type OrderRec } from "@/lib/types";
import { api, useLoaded } from "./store";
import { useToast } from "./toast";
import { Badge, Button, Card, Field, Input, MoneyInput, Row } from "./ui";

export function OrderReferralCard({ order }: { order: OrderRec }) {
  const s = useLoaded();
  if (!s || !order.referredById) return null;
  const owner = s.data.customers.find((c) => c.id === order.referredById);
  const use = referralUses(s.data, order.referredById).find((u) => u.order.id === order.id);
  const status = use?.status ?? (order.owner ? "None (owner price)" : "None");
  return (
    <Card className="p-4 sm:p-5" data-order-referral>
      <h2 className="mb-3 text-sm font-semibold">Referral</h2>
      <Row label="Code used">
        <span className="font-mono font-semibold">{order.referralCode || "—"}</span>
      </Row>
      <Row label="Code owner">
        {owner ? (
          <Link href={`/admin/referrals/${owner.id}`} className="font-medium text-accent hover:underline">
            {owner.name}
          </Link>
        ) : (
          "Deleted customer"
        )}
      </Row>
      <Row label="Owner reward">{order.referralRatePct != null ? `${order.referralRatePct}%` : "—"}</Row>
      {(order.referralDiscountCents ?? 0) > 0 && <Row label={`Buyer discount (${order.referralDiscountPct}%)`}>-{fmtMoney(order.referralDiscountCents!)} (inside the discount)</Row>}
      <Row label="Credit">
        <span className="flex items-center gap-2">
          <span className="font-semibold tabular-nums" data-order-referral-credit>
            {fmtMoney(use?.creditCents ?? 0)}
          </span>
          <Badge tone={status === "Pending" ? "warn" : status === "Available" ? "pos" : "neg"}>{status}</Badge>
        </span>
      </Row>
    </Card>
  );
}

/** Record a refund (partial or full) on an order that counts. Referral credit follows automatically. */
export function RefundCard({ order }: { order: OrderRec }) {
  const s = useLoaded();
  const toast = useToast();
  const [amount, setAmount] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!s || !countsInMoney(order.status)) return null;
  const cap = refundableOf(order);
  const done = order.refundedCents ?? 0;
  const left = Math.max(0, cap - done);
  async function refund(cents: number) {
    setBusy(true);
    const ok = await s!.mutate(null, () => api(`/api/orders/${order.id}/action`, "POST", { action: "refund", amountCents: cents, expectedRefundedCents: done, reason }));
    setBusy(false);
    if (ok) {
      toast.show({ message: `Refund of ${fmtMoney(cents)} recorded`, tone: "success" });
      setAmount(null);
      setReason("");
    }
  }
  return (
    <Card className="p-4 sm:p-5" data-refund-card>
      <h2 className="mb-1 text-sm font-semibold">Refund</h2>
      <p className="mb-3 text-sm text-muted">
        Record money you gave back (send it yourself in your payment app). It comes off revenue, and any referral credit this order earned is reduced in proportion.
        {done > 0 ? ` Refunded so far ${fmtMoney(done)} of ${fmtMoney(cap)}.` : ""}
      </p>
      {left <= 0 ? (
        <p className="text-sm font-medium">Fully refunded.</p>
      ) : (
        <div className="space-y-3">
          <Field label="Amount" hint={`Up to ${fmtMoney(left)}.`}>
            <MoneyInput value={amount} nullable onChange={setAmount} label="refund amount" />
          </Field>
          <Field label="Reason (optional)">
            <Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="For example Damaged vial" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="h-11" disabled={busy || !amount || amount <= 0 || amount > left} onClick={() => amount && refund(amount)} data-refund-partial>
              Refund {amount ? fmtMoney(amount) : ""}
            </Button>
            <Button size="sm" variant="soft" className="h-11" disabled={busy} onClick={() => refund(left)} data-refund-full>
              Refund all ({fmtMoney(left)})
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
