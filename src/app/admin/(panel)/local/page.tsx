"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { MapPin, Phone } from "lucide-react";
import { useOrderActions } from "@/components/order-actions";
import { useLoaded } from "@/components/store";
import { Badge, Button, Card, Empty, PageHeader, PageSkeleton, Segmented } from "@/components/ui";
import { isOpenLocal } from "@/lib/admin/counts";
import { customerName, handOverLabel, isLocalOrder, orderPlaced, orderTotal, statusLabel, STATUS_TONE } from "@/lib/admin/orders-view";
import { fmtDateTime, fmtMoney, plural } from "@/lib/format";
import { itemsSummary } from "@/lib/admin/orders-view";

/** Local pickup and delivery orders: who, when, how they pay, and the three buttons. Never in the ship queue. */
export default function LocalOrdersPage() {
  const s = useLoaded();
  const actions = useOrderActions();
  const [view, setView] = useState<"open" | "done">("open");

  const list = useMemo(() => {
    if (!s) return [];
    const all = [...s.data.orders, ...s.data.pendingOrders].filter((o) => o.source === "online" && isLocalOrder(o) && !o.archived);
    const rows = view === "open" ? all.filter(isOpenLocal) : all.filter((o) => !isOpenLocal(o));
    return rows.sort((a, b) => new Date(orderPlaced(view === "open" ? a : b)).getTime() - new Date(orderPlaced(view === "open" ? b : a)).getTime());
  }, [s, view]);

  if (!s) return <PageSkeleton />;
  const loc = s.data.store.local;
  const off = !loc.pickup.enabled && !loc.delivery.enabled;

  return (
    <div data-admin-local>
      <PageHeader
        title="Local orders"
        sub={
          <>
            Pickup {loc.pickup.enabled ? "on" : "off"} · delivery {loc.delivery.enabled ? `on (${fmtMoney(loc.delivery.feeCents)})` : "off"} · {loc.radiusMiles} mi around {loc.homeZip || "no home ZIP"} ·{" "}
            <Link href="/admin/settings?tab=local" className="underline underline-offset-4">
              settings
            </Link>
          </>
        }
      />
      <Segmented
        size="sm"
        className="mb-4"
        value={view}
        onChange={setView}
        options={[
          { value: "open", label: "To hand over" },
          { value: "done", label: "Done / canceled" },
        ]}
      />
      {list.length === 0 ? (
        <Empty
          icon={<MapPin size={32} />}
          title={view === "open" ? "No local orders to hand over" : "Nothing here yet"}
          body={off ? "Turn on local pickup or delivery in Settings → Local orders. Customers near you then see the option at checkout." : "Pickup and delivery orders from customers near you show up here, oldest first."}
        />
      ) : (
        <div className="space-y-3">
          {list.map((o) => {
            const total = orderTotal(o, s.ledger);
            const owes = o.payAtPickup && o.status === "awaiting_payment";
            const step = actions.step(o);
            return (
              <Card key={o.id} className="p-4 sm:p-5" data-local-order={o.number ?? ""}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/orders/${o.id}`} className="text-lg font-semibold tabular-nums hover:underline">
                        #{o.number}
                      </Link>
                      <Badge tone="accent">{o.fulfillment === "pickup" ? "Pickup" : "Delivery"}</Badge>
                      <Badge tone={STATUS_TONE[o.status]}>{statusLabel(o)}</Badge>
                      {owes && <Badge tone="warn">Owes {fmtMoney(total)} at handover</Badge>}
                    </div>
                    <div className="mt-1 font-medium">{customerName(o)}</div>
                    {o.web?.phone && (
                      <a href={`tel:${o.web.phone}`} className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-accent hover:underline">
                        <Phone size={14} /> {o.web.phone}
                      </a>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold tabular-nums">{fmtMoney(total)}</div>
                    <div className="text-xs text-muted">{o.payAtPickup ? "pay at handover" : o.status === "awaiting_payment" ? "unpaid" : "paid online"}</div>
                  </div>
                </div>
                <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="inline text-muted">Preferred time: </dt>
                    <dd className="inline font-medium">{o.localTime || "—"}</dd>
                  </div>
                  <div>
                    <dt className="inline text-muted">Placed: </dt>
                    <dd className="inline">{fmtDateTime(orderPlaced(o))}</dd>
                  </div>
                  {o.fulfillment === "delivery" && o.web?.shipTo && (
                    <div className="sm:col-span-2">
                      <dt className="inline text-muted">Deliver to: </dt>
                      <dd className="inline">{[o.web.shipTo.street1, o.web.shipTo.street2, `${o.web.shipTo.city}, ${o.web.shipTo.state} ${o.web.shipTo.zip}`].filter(Boolean).join(", ")}</dd>
                    </div>
                  )}
                  {o.localNotes && (
                    <div className="sm:col-span-2">
                      <dt className="inline text-muted">Notes: </dt>
                      <dd className="inline">{o.localNotes}</dd>
                    </div>
                  )}
                  <div className="sm:col-span-2 text-muted">{itemsSummary(o)}</div>
                </dl>
                {view === "open" && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant={step === "mark-paid" ? "primary" : "soft"} disabled={o.status !== "awaiting_payment" || actions.busyId === o.id} onClick={() => actions.run("mark-paid", o)} data-local-paid>
                      Mark paid
                    </Button>
                    <Button
                      size="sm"
                      variant={step === "mark-ready" ? "primary" : "soft"}
                      disabled={!!o.readyAt || o.status === "ready" || !(o.status === "paid" || (o.status === "awaiting_payment" && o.payAtPickup)) || actions.busyId === o.id}
                      onClick={() => actions.run("mark-ready", o)}
                      data-local-ready
                    >
                      Mark ready
                    </Button>
                    <Button size="sm" variant={step === "mark-handed-over" ? "primary" : "soft"} disabled={!(o.status === "paid" || o.status === "ready") || actions.busyId === o.id} onClick={() => actions.run("mark-handed-over", o)} data-local-handover>
                      {handOverLabel(o)}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
          <p className="text-xs text-muted">{plural(list.length, "order")}</p>
        </div>
      )}
    </div>
  );
}
