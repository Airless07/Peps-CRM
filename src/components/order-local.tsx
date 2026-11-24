"use client";

// Admin order page: how a local order is handed over (method, time, notes, pickup spot or delivery address).
import { isLocalOrder } from "@/lib/admin/orders-view";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import type { OrderRec } from "@/lib/types";
import { Card, Row } from "./ui";

export function OrderLocalCard({ order: o }: { order: OrderRec }) {
  if (!isLocalOrder(o)) return null;
  const spot = o.localSpot;
  const to = o.web?.shipTo;
  const sw = o.localSwitch;
  return (
    <Card className="p-4 sm:p-5" data-order-local>
      <h2 className="mb-3 text-sm font-semibold">{o.fulfillment === "pickup" ? "Local pickup" : "Local delivery"} · no shipping label</h2>
      <Row label="Preferred time">{o.localTime || "—"}</Row>
      <Row label="Phone">{o.web?.phone ? <a href={`tel:${o.web.phone}`} className="text-accent hover:underline">{o.web.phone}</a> : "—"}</Row>
      <Row label="Payment">{o.payAtPickup ? "Pays at the handover (cash or Zelle)" : "Paid online"}</Row>
      {o.readyAt && <Row label="Ready since">{fmtDateTime(o.readyAt)}</Row>}
      {o.fulfillment === "pickup" && spot && (
        <Row label="Pickup spot">
          <span className="text-right">
            {spot.name}
            <span className="block text-sm text-muted">{[spot.street1, `${spot.city}, ${spot.state} ${spot.zip}`].join(", ")}</span>
          </span>
        </Row>
      )}
      {o.fulfillment === "delivery" && to && <Row label="Deliver to">{[to.street1, to.street2, `${to.city}, ${to.state} ${to.zip}`].filter(Boolean).join(", ")}</Row>}
      {o.localNotes && <p className="mt-2 rounded-lg bg-surface2/70 px-3 py-2 text-sm">Customer notes: {o.localNotes}</p>}
      {sw && (
        <div className="mt-3 rounded-lg bg-surface2/70 px-3 py-2 text-sm" data-order-switch>
          <div className="font-medium">
            Switched from shipping by {sw.by}, {fmtDateTime(sw.at)}
          </div>
          <div className="text-muted">
            Was {sw.from.method} ({fmtMoney(sw.from.shippingCents)}). Local fee {fmtMoney(sw.feeCents)}.
            {sw.diffCents > 0 &&
              (sw.handling === "credit"
                ? ` ${fmtMoney(sw.creditCents)} refunded as store credit (the order keeps the ${fmtMoney(sw.shippingAfterCents)} paid).`
                : sw.handling === "refund_owed"
                  ? ` Refund owed: ${fmtMoney(sw.refundOwedCents)}${sw.refundPaidAt ? `, paid back ${fmtDateTime(sw.refundPaidAt)}.` : ", not paid back yet (Actions, Mark refund paid back)."}`
                  : sw.handling === "lower"
                    ? ` ${fmtMoney(sw.diffCents)} taken off the unpaid total.`
                    : ` Difference of ${fmtMoney(sw.diffCents)} kept.`)}
          </div>
          {sw.note && <div className="mt-1">Note: {sw.note}</div>}
        </div>
      )}
    </Card>
  );
}
