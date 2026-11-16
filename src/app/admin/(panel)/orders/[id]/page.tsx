"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Mail, MessageSquareText, CircleDot } from "lucide-react";
import { StepButton, useOrderActions } from "@/components/order-actions";
import { RowMenu } from "@/components/row-menu";
import { api, useLoaded } from "@/components/store";
import { Badge, Button, Card, Empty, PageSkeleton, Row, SectionTitle, cx } from "@/components/ui";
import { customerName, orderPlaced, shipToLines, statusLabel, STATUS_TONE } from "@/lib/admin/orders-view";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { orderTotals } from "@/lib/money";
import { payMethod } from "@/lib/store/payments";
import { trackingUrl } from "@/lib/tracking";
import type { OrderEventRec } from "@/lib/types";

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const s = useLoaded();
  const actions = useOrderActions();
  const [events, setEvents] = useState<OrderEventRec[] | null>(null);
  const [eventsError, setEventsError] = useState("");
  const order = s ? [...s.data.orders, ...s.data.pendingOrders].find((o) => o.id === id) : undefined;
  // Reload the timeline whenever the order changes.
  const stamp = order ? `${order.status}|${order.archived}|${order.web?.trackingNumber}|${order.web?.hasScreenshot}|${order.web?.trackingStatus}` : "";

  useEffect(() => {
    if (!order) return;
    api<{ events: OrderEventRec[] }>(`/api/orders/${id}/detail`)
      .then((d) => (setEvents(d.events), setEventsError("")))
      .catch((e) => setEventsError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, stamp]);

  if (!s) return <PageSkeleton />;
  if (!order) {
    return (
      <Empty
        title="Order not found"
        body="It may have been removed, or the link is wrong."
        action={
          <Link href="/admin/orders">
            <Button variant="primary">Back to orders</Button>
          </Link>
        }
      />
    );
  }

  const { ledger, data } = s;
  const t = orderTotals(order);
  const r = ledger.orders.get(order.id);
  const w = order.web;
  const online = order.source === "online";
  const ship = shipToLines(order);
  const track = w?.trackingNumber ? trackingUrl(w.trackingCarrier, w.trackingNumber) : null;
  const labels = data.labels.filter((l) => l.orderId === order.id);
  const emails = (events ?? []).filter((e) => e.kind === "email");
  const timeline = (events ?? []).filter((e) => e.kind !== "email");
  const review = data.reviews.find((x) => x.orderId === order.id);

  return (
    <div className="pb-8">
      <Link href="/admin/orders" className="mb-3 inline-flex h-10 items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft size={16} /> All orders
      </Link>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tabular-nums tracking-tight">Order #{order.number ?? "—"}</h1>
            <Badge tone={STATUS_TONE[order.status]}>{statusLabel(order)}</Badge>
            {order.archived && <Badge>Archived</Badge>}
          </div>
          <div className="mt-1 text-sm text-muted">
            {online ? "Online" : "In person"} · {fmtDateTime(orderPlaced(order))} · {customerName(order)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StepButton order={order} size="md" />
          <RowMenu items={actions.menu(order)} describedRow={`order ${order.number}`} />
        </div>
      </div>

      {order.status === "awaiting_payment" && w?.expiresAt && (
        <div className="mb-4 rounded-xl bg-warn/12 px-4 py-3 text-sm text-warn">
          Waiting for payment. It is canceled automatically on {fmtDateTime(w.expiresAt)} if it is not marked paid.
          {w.hasScreenshot && " The customer uploaded a payment screenshot: open it from Actions."}
        </div>
      )}
      {order.status === "canceled" && w?.cancelReason && <div className="mb-4 rounded-xl bg-neg/10 px-4 py-3 text-sm text-neg">{w.cancelReason}</div>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-4">
          <Card className="p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold">Items</h2>
            <ul className="divide-y divide-line">
              {order.lines.map((l) => (
                <li key={l.id} className="flex items-baseline justify-between gap-3 py-2.5 text-[15px]">
                  <span className="min-w-0">
                    <span className="font-medium">{l.productName || "Deleted product"}</span>
                    <span className="ml-2 tabular-nums text-muted">
                      {l.quantity} × {fmtMoney(l.unitPriceCents)}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{fmtMoney(l.quantity * l.unitPriceCents)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 border-t border-line pt-3">
              <Row label="Subtotal">{fmtMoney(t.subtotal)}</Row>
              {t.discount > 0 && (
                <Row label={`Discount${w?.promo?.labels.length ? ` (${w.promo.labels.join(", ")})` : ""}`}>
                  <span className="text-neg">-{fmtMoney(t.discount)}</span>
                </Row>
              )}
              {t.tip > 0 && <Row label="Tip">{fmtMoney(t.tip)}</Row>}
              {online && <Row label={`Shipping${w?.shippingMethod ? ` (${w.shippingMethod})` : ""}`}>{t.shipping > 0 ? fmtMoney(t.shipping) : "Free"}</Row>}
              <Row label="Total" strong>
                {fmtMoney(t.total)}
              </Row>
            </div>
            {r ? (
              <div className="mt-3 rounded-xl bg-surface2/70 px-4 py-3 text-sm">
                <div className="mb-1 font-medium">Money (admin only)</div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 tabular-nums text-muted">
                  <span>Cost {fmtMoney(r.cost)}</span>
                  <span>Profit {fmtMoney(r.profit)}</span>
                  <span>
                    {s.name("A")} {fmtMoney(r.a)}
                  </span>
                  <span>
                    {s.name("B")} {fmtMoney(r.b)}
                  </span>
                  <span>Business {fmtMoney(r.business)}</span>
                  {labels.filter((l) => !l.voided).length > 0 && <span>Label cost {fmtMoney(labels.filter((l) => !l.voided).reduce((x, l) => x + l.costCents, 0))}</span>}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted">This order does not count in stock or money{order.status === "canceled" ? " (canceled)." : " until it is marked paid."}</p>
            )}
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="mb-3 text-sm font-semibold">Timeline</h2>
            {eventsError ? (
              <p className="text-sm text-neg">Couldn’t load the timeline: {eventsError}</p>
            ) : !events ? (
              <div className="h-20 animate-shimmer rounded-xl bg-surface2" />
            ) : timeline.length === 0 ? (
              <p className="text-sm text-muted">{online ? "Nothing yet." : "In-person sale. No status changes to show."}</p>
            ) : (
              <ol className="relative space-y-4 pl-6 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-px before:bg-line">
                {timeline.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-6 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-surface text-muted">
                      {e.kind === "note" ? <MessageSquareText size={14} /> : <CircleDot size={14} className="text-accent" />}
                    </span>
                    <div className="text-[15px] font-medium">{e.message}</div>
                    {e.detail && <div className="text-sm text-muted">{e.detail}</div>}
                    <div className="text-xs tabular-nums text-muted">{fmtDateTime(e.at)}</div>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          {online && (
            <Card className="p-4 sm:p-5">
              <h2 className="mb-3 text-sm font-semibold">Emails sent</h2>
              {!events ? (
                <div className="h-12 animate-shimmer rounded-xl bg-surface2" />
              ) : emails.length === 0 ? (
                <p className="text-sm text-muted">No emails yet.</p>
              ) : (
                <ul className="space-y-3">
                  {emails.map((e) => {
                    const ok = /: Sent$/.test(e.message);
                    return (
                      <li key={e.id} className="flex gap-3">
                        <Mail size={16} className={cx("mt-0.5 shrink-0", ok ? "text-pos" : "text-warn")} />
                        <div className="min-w-0">
                          <div className="text-[15px]">{e.message}</div>
                          <div className="truncate text-xs text-muted">
                            {e.detail} · {fmtDateTime(e.at)}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card className="p-4 sm:p-5">
            <h2 className="mb-2 text-sm font-semibold">Customer</h2>
            <div className="text-[15px] font-medium">{customerName(order)}</div>
            {w?.email && (
              <a href={`mailto:${w.email}`} className="block break-all text-[15px] text-accent hover:underline">
                {w.email}
              </a>
            )}
            {w?.phone && <div className="text-[15px] tabular-nums text-muted">{w.phone}</div>}
            {order.customerId && (
              <Link href={`/admin/customers?open=${order.customerId}`} className="mt-2 inline-block text-sm font-medium text-accent hover:underline">
                Open customer
              </Link>
            )}
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="mb-2 text-sm font-semibold">{online ? "Ship to" : "Delivery"}</h2>
            {ship.length ? (
              <address className="text-[15px] not-italic leading-relaxed">
                {ship.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </address>
            ) : (
              <p className="text-[15px] text-muted">In person</p>
            )}
            {w?.trackingNumber && (
              <div className="mt-3 border-t border-line pt-3 text-[15px]">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">{w.trackingCarrier || "Tracking"}</div>
                {track ? (
                  <a href={track} target="_blank" rel="noreferrer" className="break-all font-medium text-accent hover:underline">
                    {w.trackingNumber}
                  </a>
                ) : (
                  <span className="break-all font-medium tabular-nums">{w.trackingNumber}</span>
                )}
                {w.trackingStatus && <div className="text-sm text-muted">Carrier status: {w.trackingStatus.replace("_", " ").toLowerCase()}</div>}
              </div>
            )}
          </Card>

          <Card className="p-4 sm:p-5">
            <h2 className="mb-2 text-sm font-semibold">Payment</h2>
            <Row label="Method">{online && order.status === "awaiting_payment" ? `${payMethod(w?.payChoice ?? "")?.name ?? order.paymentMethod} (chosen)` : order.paymentMethod}</Row>
            {w?.paidAt && <Row label="Paid">{fmtDateTime(w.paidAt)}</Row>}
            <Row label="Sold by">{s.name(order.soldBy)}</Row>
            {order.note && <p className="mt-2 text-sm text-muted">Note: {order.note}</p>}
            {w?.hasScreenshot && (
              <div className="mt-3">
                <SectionTitle>Payment screenshot</SectionTitle>
                <a href={`/api/orders/${order.id}/screenshot`} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/orders/${order.id}/screenshot`} alt={`Payment screenshot for order ${order.number}`} className="max-h-72 rounded-xl border border-line" />
                </a>
              </div>
            )}
          </Card>

          {review && (
            <Card className="p-4 sm:p-5">
              <h2 className="mb-2 text-sm font-semibold">Review</h2>
              <div className="text-[15px]">
                {review.rating} / 5 · {review.displayName} · <span className="text-muted">{review.status}</span>
              </div>
              {review.text && <p className="mt-1 text-sm text-muted">{review.text}</p>}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
