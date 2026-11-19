"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, ExternalLink, PackageCheck, Printer } from "lucide-react";
import { useOrderActions } from "@/components/order-actions";
import { useLoaded } from "@/components/store";
import { Button, Card, Empty, PageHeader, PageSkeleton, cx } from "@/components/ui";
import { isReadyToShip } from "@/lib/admin/counts";
import { orderTotal, shipToLines } from "@/lib/admin/orders-view";
import { fmtMoney, plural } from "@/lib/format";
import { lineName } from "@/lib/size";

/** One paid, unshipped website order at a time: buy label, print label, print packing slip, mark shipped, next. */
export default function ShipQueuePage() {
  const s = useLoaded();
  const actions = useOrderActions();
  const [index, setIndex] = useState(0);
  const [printed, setPrinted] = useState<Record<string, { label?: boolean; slip?: boolean }>>({});

  // Oldest paid order first.
  const queue = useMemo(
    () => (s ? s.data.orders.filter(isReadyToShip).sort((a, b) => new Date(a.web?.paidAt ?? a.date).getTime() - new Date(b.web?.paidAt ?? b.date).getTime()) : []),
    [s],
  );
  useEffect(() => {
    if (index > 0 && index >= queue.length) setIndex(Math.max(0, queue.length - 1));
  }, [index, queue.length]);

  if (!s) return <PageSkeleton />;
  const order = queue[index];

  if (!order) {
    return (
      <div>
        <PageHeader title="Ship queue" />
        <Empty
          icon={<PackageCheck size={36} />}
          title="Nothing to ship"
          body="Paid website orders show up here, oldest first, as soon as you mark them paid."
          action={
            <Link href="/admin/orders">
              <Button variant="primary">Go to orders</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const hasLabel = !!order.web?.labelUrl;
  const p = printed[order.id] ?? {};
  const mark = (k: "label" | "slip") => setPrinted((x) => ({ ...x, [order.id]: { ...x[order.id], [k]: true } }));
  const ship = shipToLines(order);

  const step = (n: number, title: string, done: boolean, body: React.ReactNode) => (
    <li className={cx("flex gap-4 rounded-2xl border p-4 sm:p-5", done ? "border-line bg-surface2/50" : "border-line bg-surface")}>
      <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold", done ? "bg-pos/15 text-pos" : "bg-accent/10 text-accent")}>
        {done ? <Check size={18} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-3 text-base font-semibold">{title}</div>
        {body}
      </div>
    </li>
  );

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Ship queue" sub={`Order ${index + 1} of ${queue.length} · ${plural(queue.length, "order")} paid and waiting`} />

      <Card className="mb-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/admin/orders/${order.id}`} className="text-2xl font-semibold tabular-nums tracking-tight hover:text-accent">
              #{order.number}
            </Link>
            <address className="mt-1 text-[15px] not-italic leading-relaxed">
              {ship.map((l, i) => (
                <div key={i} className={i === 0 ? "font-medium" : "text-muted"}>
                  {l}
                </div>
              ))}
            </address>
          </div>
          <div className="shrink-0 text-right text-sm text-muted">
            <div className="text-base font-semibold tabular-nums text-ink">{fmtMoney(orderTotal(order, s.ledger))}</div>
            <div>{order.web?.shippingMethod}</div>
          </div>
        </div>
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {order.lines.map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-2.5 text-[15px]">
              <span className="flex h-8 min-w-8 items-center justify-center rounded-lg bg-surface2 px-2 font-semibold tabular-nums">{l.quantity}×</span>
              <span className="font-medium">{lineName(l)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <ol className="space-y-3">
        {step(
          1,
          "Buy the shipping label",
          hasLabel,
          hasLabel ? (
            <p className="text-sm text-muted">
              Bought. Tracking {order.web?.trackingNumber} ({order.web?.trackingCarrier}) was emailed to the customer.
            </p>
          ) : (
            <Button variant="primary" size="lg" block onClick={() => actions.run("buy-label", order)}>
              Buy label
            </Button>
          ),
        )}
        {step(
          2,
          "Print the label",
          !!p.label,
          <Button
            variant={hasLabel && !p.label ? "primary" : "secondary"}
            size="lg"
            block
            disabled={!hasLabel}
            onClick={() => {
              actions.run("open-label", order);
              mark("label");
            }}
          >
            <ExternalLink size={18} /> {hasLabel ? "Open label to print" : "Buy the label first"}
          </Button>,
        )}
        {step(
          3,
          "Print the packing slip",
          !!p.slip,
          <Button
            variant={hasLabel && p.label && !p.slip ? "primary" : "secondary"}
            size="lg"
            block
            onClick={() => {
              window.open(`/admin/print/${order.id}`, "_blank", "noopener");
              mark("slip");
            }}
          >
            <Printer size={18} /> Print packing slip
          </Button>,
        )}
        {step(
          4,
          "Hand it to the carrier",
          false,
          <>
            <Button variant={p.label && p.slip ? "primary" : "secondary"} size="lg" block disabled={actions.busyId === order.id} onClick={() => actions.run("mark-shipped", order)}>
              Mark shipped
            </Button>
            <p className="mt-2 text-sm text-muted">Marking it shipped takes it off this queue. If Shippo tracking updates are set up, this also happens on its own when the carrier scans the package.</p>
          </>,
        )}
      </ol>

      <div className="mt-5 flex gap-2">
        <Button size="lg" className="flex-1" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
          <ArrowLeft size={18} /> Previous
        </Button>
        <Button size="lg" className="flex-1" disabled={index >= queue.length - 1} onClick={() => setIndex((i) => Math.min(queue.length - 1, i + 1))}>
          Next order <ArrowRight size={18} />
        </Button>
      </div>
    </div>
  );
}
