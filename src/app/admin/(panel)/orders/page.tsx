"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReceiptText, Search } from "lucide-react";
import { StepButton, useOrderActions } from "@/components/order-actions";
import { RowMenu } from "@/components/row-menu";
import { useLoaded } from "@/components/store";
import { Badge, Button, Empty, Input, PageHeader, PageSkeleton, Segmented, cx } from "@/components/ui";
import { allOrders, customerName, itemsSummary, orderPlaced, orderTotal, shipToLines, statusLabel, STATUS_TONE } from "@/lib/admin/orders-view";
import { fmtDate, fmtMoney, fmtTime, plural } from "@/lib/format";
import { trackingUrl } from "@/lib/tracking";
import type { OrderRec } from "@/lib/types";
import { lineName } from "@/lib/size";

type Source = "all" | "online" | "inperson" | "owner";
type View = "open" | "all" | "archived";
const PAGE = 60;

export default function OrdersPage() {
  const s = useLoaded();
  const router = useRouter();
  const actions = useOrderActions();
  const [source, setSource] = useState<Source>("all");
  const [view, setView] = useState<View>("all");
  const [status, setStatus] = useState<string>("any");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);

  // The dashboard links here with ?view=open
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("view");
    if (v === "open" || v === "archived") setView(v);
  }, []);

  const everything = useMemo(() => (s ? allOrders(s.data) : []), [s]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/^#/, "");
    return everything
      .filter((o) => (view === "archived" ? o.archived : !o.archived))
      .filter((o) => view !== "open" || (o.source === "online" && !["delivered", "picked_up", "canceled"].includes(o.status)))
      .filter((o) => source === "all" || (source === "owner" ? !!o.owner : o.source === source))
      .filter((o) => status === "any" || o.status === status)
      .filter(
        (o) =>
          !needle ||
          String(o.number ?? "").includes(needle) ||
          customerName(o).toLowerCase().includes(needle) ||
          (o.web?.email ?? "").toLowerCase().includes(needle) ||
          (o.web?.trackingNumber ?? "").toLowerCase().includes(needle) ||
          o.lines.some((l) => lineName(l).toLowerCase().includes(needle)),
      );
  }, [everything, view, source, status, q]);

  if (!s) return <PageSkeleton />;
  const { ledger } = s;
  const archivedCount = everything.filter((o) => o.archived).length;
  const openCount = everything.filter((o) => !o.archived && o.source === "online" && !["delivered", "picked_up", "canceled"].includes(o.status)).length;
  const shown = list.slice(0, limit);
  const open = (o: OrderRec) => router.push(`/admin/orders/${o.id}`);

  const statusCell = (o: OrderRec) => {
    const w = o.web;
    const url = w?.trackingNumber ? trackingUrl(w.trackingCarrier, w.trackingNumber) : null;
    return (
      <div className="min-w-0">
        <Badge tone={STATUS_TONE[o.status]}>{statusLabel(o)}</Badge>
        {o.status === "awaiting_payment" && w?.hasScreenshot && <div className="mt-1 text-xs font-medium text-accent">Screenshot uploaded</div>}
        {w?.trackingNumber && (
          <div className="mt-1 truncate text-xs text-muted">
            {url ? (
              <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="font-medium text-accent underline-offset-2 hover:underline">
                {w.trackingNumber}
              </a>
            ) : (
              <span className="tabular-nums">{w.trackingNumber}</span>
            )}
            <span className="block">{w.trackingCarrier}</span>
          </div>
        )}
        {o.status === "canceled" && w?.cancelReason && <div className="mt-1 line-clamp-2 text-xs text-muted">{w.cancelReason.replace(/^Canceled:\s*/i, "")}</div>}
      </div>
    );
  };

  return (
    <div>
      <PageHeader title="Orders" sub="Every order, online and in person. Orders are never deleted: archive one to tidy the list." />

      <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center">
        <Segmented<View>
          className="md:w-[22rem]"
          value={view}
          onChange={(v) => (setView(v), setLimit(PAGE))}
          options={[
            { value: "all", label: "All" },
            { value: "open", label: `To do${openCount ? ` (${openCount})` : ""}` },
            { value: "archived", label: `Archived${archivedCount ? ` (${archivedCount})` : ""}` },
          ]}
        />
        <div className="relative flex-1">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => (setQ(e.target.value), setLimit(PAGE))} placeholder="Search order #, name, email, tracking, product" className="pl-10" aria-label="Search orders" />
        </div>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Segmented<Source>
          size="sm"
          className="w-full sm:w-[26rem]"
          value={source}
          onChange={(v) => (setSource(v), setLimit(PAGE))}
          options={[
            { value: "all", label: "All sources" },
            { value: "online", label: "Online" },
            { value: "inperson", label: "In person" },
            { value: "owner", label: "Owner purchases" },
          ]}
        />
        <label className="sr-only" htmlFor="status-filter">
          Status
        </label>
        <select
          id="status-filter"
          value={status}
          onChange={(e) => (setStatus(e.target.value), setLimit(PAGE))}
          className="h-10 rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        >
          <option value="any">Any status</option>
          <option value="awaiting_payment">Awaiting payment</option>
          <option value="paid">Paid, no label</option>
          <option value="label_purchased">Label purchased</option>
          <option value="shipped">Shipped</option>
          <option value="ready">Ready (local)</option>
          <option value="picked_up">Picked up (local)</option>
          <option value="delivered">Delivered</option>
          <option value="canceled">Canceled</option>
          <option value="completed">Completed (in person)</option>
        </select>
        <span className="ml-auto text-sm tabular-nums text-muted">{plural(list.length, "order")}</span>
      </div>

      {everything.length === 0 ? (
        <Empty
          icon={<ReceiptText size={32} />}
          title="No orders yet"
          body="Website orders and in-person sales both show up here."
          action={
            <Link href="/admin/sell">
              <Button variant="primary">Record an in-person sale</Button>
            </Link>
          }
        />
      ) : list.length === 0 ? (
        <Empty title={view === "archived" ? "Nothing is archived" : "No matching orders"} body={view === "archived" ? "Archived orders show up here. Nothing is ever deleted." : "Try a different search, or clear the filters."} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl border border-line bg-surface lg:block">
            <table className="w-full table-fixed text-left text-sm">
              <caption className="sr-only">Orders</caption>
              <thead className="border-b border-line text-xs font-semibold uppercase tracking-wider text-muted">
                <tr>
                  <th scope="col" className="w-[7.5rem] px-4 py-3">Order #</th>
                  <th scope="col" className="w-[8rem] px-3 py-3">Date</th>
                  <th scope="col" className="px-3 py-3">Customer</th>
                  <th scope="col" className="px-3 py-3">Ship to</th>
                  <th scope="col" className="w-[6.5rem] px-3 py-3 text-right">Total</th>
                  <th scope="col" className="w-[11.5rem] px-3 py-3">Status</th>
                  <th scope="col" className="w-[15.5rem] px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((o) => {
                  const ship = shipToLines(o);
                  return (
                    <tr key={o.id} onClick={() => open(o)} className="cursor-pointer align-top transition hover:bg-surface2/50">
                      <td className="px-4 py-3.5">
                        <Link href={`/admin/orders/${o.id}`} onClick={(e) => e.stopPropagation()} className="font-semibold tabular-nums text-ink hover:text-accent">
                          #{o.number ?? "—"}
                        </Link>
                        <div className="text-xs text-muted">{o.source === "online" ? "Online" : "In person"}</div>
                        {o.owner && <Badge tone="accent">Owner</Badge>}
                      </td>
                      <td className="px-3 py-3.5 tabular-nums text-muted">
                        <div className="text-ink">{fmtDate(orderPlaced(o))}</div>
                        <div className="text-xs">{fmtTime(orderPlaced(o))}</div>
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="truncate font-medium">{customerName(o)}</div>
                        {o.web?.email && <div className="truncate text-xs text-muted">{o.web.email}</div>}
                        <div className="mt-0.5 truncate text-xs text-muted">{itemsSummary(o)}</div>
                      </td>
                      <td className="px-3 py-3.5 text-muted">
                        {ship.length ? ship.map((l, i) => <div key={i} className={cx("truncate", i === 0 && "text-ink")}>{l}</div>) : <span>In person</span>}
                      </td>
                      <td className="px-3 py-3.5 text-right font-semibold tabular-nums">{fmtMoney(orderTotal(o, ledger))}</td>
                      <td className="px-3 py-3.5">{statusCell(o)}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center justify-end gap-2">
                          <StepButton order={o} className="h-10" />
                          <RowMenu items={actions.menu(o)} describedRow={`order ${o.number}`} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Phone and tablet: cards */}
          <ul className="space-y-3 lg:hidden">
            {shown.map((o) => {
              const ship = shipToLines(o);
              return (
                <li key={o.id} className="rounded-2xl border border-line bg-surface">
                  <Link href={`/admin/orders/${o.id}`} className="block px-4 pb-3 pt-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-semibold tabular-nums">#{o.number ?? "—"}</span>
                          <span className="text-xs text-muted">{o.source === "online" ? "Online" : "In person"}</span>
                          {o.owner && <Badge tone="accent">Owner</Badge>}
                        </div>
                        <div className="mt-0.5 truncate font-medium">{customerName(o)}</div>
                        {o.web?.email && <div className="truncate text-sm text-muted">{o.web.email}</div>}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-base font-semibold tabular-nums">{fmtMoney(orderTotal(o, ledger))}</div>
                        <div className="text-xs tabular-nums text-muted">{fmtDate(orderPlaced(o))}</div>
                      </div>
                    </div>
                    <div className="mt-2 truncate text-sm text-muted">{itemsSummary(o)}</div>
                    <div className="mt-1 truncate text-sm text-muted">{ship.length ? `Ship to: ${ship.slice(1).join(", ")}` : "In person"}</div>
                  </Link>
                  <div className="flex items-end justify-between gap-3 border-t border-line px-4 py-3">
                    {statusCell(o)}
                    <div className="flex shrink-0 items-center gap-2">
                      <StepButton order={o} className="h-10" />
                      <RowMenu items={actions.menu(o)} describedRow={`order ${o.number}`} label="More" />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {list.length > limit && (
            <div className="mt-4 flex justify-center">
              <Button onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, list.length - limit)} more</Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
