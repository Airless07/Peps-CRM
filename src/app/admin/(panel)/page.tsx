"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, CircleCheck } from "lucide-react";
import { useLoaded } from "@/components/store";
import { Badge, Button, Card, PageHeader, PageSkeleton, SectionTitle, cx } from "@/components/ui";
import { adminCounts } from "@/lib/admin/counts";
import { allOrders, customerName, orderPlaced, orderTotal, statusLabel, STATUS_TONE } from "@/lib/admin/orders-view";
import { dayKey, fmtDay, fmtMoney, plural, startOfDay } from "@/lib/format";
import { shipFromSet } from "@/lib/store/config";
import { paymentWarnings } from "@/lib/store/payments";
import { listingsMissingInfo } from "@/lib/store/product-info";
import type { OrderRec } from "@/lib/types";

interface Todo {
  key: string;
  text: string;
  sub?: string;
  button: string;
  href: string;
  tone: "warn" | "accent" | "neg" | "neutral";
}

export default function DashboardPage() {
  const s = useLoaded();

  const view = useMemo(() => {
    if (!s) return null;
    const { data, ledger } = s;
    const c = adminCounts(data);
    const todos: Todo[] = [];
    const plur = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

    // Most urgent first: money waiting to be confirmed, then packages, then stock, then the rest.
    if (c.screenshots > 0) todos.push({ key: "shots", text: plur(c.screenshots, "payment screenshot to review", "payment screenshots to review"), sub: "A customer says they paid. Check your payment app and mark the order paid.", button: "Review payments", href: "/admin/orders?view=open", tone: "accent" });
    if (c.awaitingPayment > 0) todos.push({ key: "await", text: plur(c.awaitingPayment, "order waiting for payment", "orders waiting for payment"), sub: "Mark each one paid when the money arrives.", button: "View orders", href: "/admin/orders?view=open", tone: "warn" });
    if (c.readyToShip > 0) todos.push({ key: "ship", text: plur(c.readyToShip, "order paid, ready to ship", "orders paid, ready to ship"), sub: "Buy labels and print packing slips, one order at a time.", button: "Open ship queue", href: "/admin/ship", tone: "accent" });

    if (data.savedOrders.length > 0) todos.push({ key: "saved", text: plur(data.savedOrders.length, "saved order waiting to be completed", "saved orders waiting to be completed"), sub: "Put aside on the Sell screen. They change no stock or money until you complete them.", button: "Open saved orders", href: "/admin/sell?saved=1", tone: "neutral" });
    const low = data.products
      .filter((p) => !p.archived)
      .map((p) => ({ p, stock: ledger.stock.get(p.id)?.stock ?? 0, lowAt: p.lowStockThreshold ?? data.settings.lowStockThreshold }))
      .filter((x) => x.stock <= x.lowAt)
      .sort((a, b) => a.stock - b.stock);
    for (const x of low.slice(0, 4)) {
      todos.push({ key: `low-${x.p.id}`, text: `${x.stock <= 0 ? "Out of stock" : "Low stock"}: ${x.p.name}`, sub: `${x.stock} left (warning at ${x.lowAt}).`, button: "Restock", href: "/admin/inventory", tone: x.stock <= 0 ? "neg" : "warn" });
    }
    if (low.length > 4) todos.push({ key: "low-more", text: `${low.length - 4} more products are low on stock`, button: "Open inventory", href: "/admin/inventory", tone: "warn" });
    if (c.reviews > 0) todos.push({ key: "reviews", text: plur(c.reviews, "review waiting for you", "reviews waiting for you"), sub: "Flagged text or photos to approve.", button: "Open reviews", href: "/admin/reviews", tone: "neutral" });
    if (c.messages > 0) todos.push({ key: "msgs", text: plur(c.messages, "new message", "new messages"), button: "Read messages", href: "/admin/content?tab=messages", tone: "neutral" });
    for (const [i, w] of paymentWarnings(data.store.payments).entries()) todos.push({ key: `pay-${i}`, text: w, button: "Open settings", href: "/admin/settings?tab=payments", tone: "warn" });

    // Setup gaps that quietly break things later.
    if (data.store.alertEmails.length === 0) todos.push({ key: "setup-alerts", text: "No alert email is set", sub: "Nobody is emailed about new orders, payment screenshots, contact messages or low stock.", button: "Add an alert email", href: "/admin/settings?tab=email", tone: "warn" });
    if (!data.store.emailFromAddress.trim()) todos.push({ key: "setup-from", text: "No email from-address is set", sub: "Order emails go out from Resend’s test sender, which only delivers to your own Resend account. Customers will not get them.", button: "Set the from-address", href: "/admin/settings?tab=email", tone: "warn" });
    if (!shipFromSet(data.store)) todos.push({ key: "setup-shipfrom", text: "The ship-from address is missing", sub: "It is needed for shipping labels and packing slips.", button: "Add the address", href: "/admin/settings?tab=shipping", tone: "warn" });
    const missingInfo = listingsMissingInfo(data.listings);
    if (missingInfo.length > 0) todos.push({ key: "setup-info", text: plur(missingInfo.length, "website product is missing compound info", "website products are missing compound info"), sub: `${missingInfo.slice(0, 3).map((l) => l.name).join(", ")}${missingInfo.length > 3 ? " and more" : ""}. Fill in CAS, formula, weight, purity, form and storage on the product’s Website tab.`, button: "Open inventory", href: "/admin/inventory", tone: "neutral" });

    const today = dayKey(startOfDay());
    const month = today.slice(0, 7);
    // Owner purchases (partners buying at cost) are not sales.
    const sum = (all: OrderRec[]) => {
      const orders = all.filter((o) => !o.owner);
      return { orders: orders.length, revenue: orders.reduce((x, o) => x + (ledger.orders.get(o.id)?.total ?? 0), 0) };
    };
    const inDay = data.orders.filter((o) => dayKey(o.date) === today);
    const inMonth = data.orders.filter((o) => dayKey(o.date).startsWith(month));
    const split = (list: OrderRec[]) => ({ all: sum(list), online: sum(list.filter((o) => o.source === "online")), inperson: sum(list.filter((o) => o.source === "inperson")) });

    return { todos, low, today: split(inDay), month: split(inMonth), recent: allOrders(data).filter((o) => !o.archived).slice(0, 8) };
  }, [s]);

  if (!s || !view) return <PageSkeleton />;
  const { data, ledger } = s;
  const toneDot = { warn: "bg-warn", accent: "bg-accent", neg: "bg-neg", neutral: "bg-muted" };

  const stat = (title: string, v: (typeof view)["today"]) => (
    <Card className="p-4 sm:p-5">
      <div className="text-sm font-medium text-muted">{title}</div>
      <div className="mt-1 flex items-baseline gap-3">
        <span className="text-3xl font-semibold tabular-nums tracking-tight">{fmtMoney(v.all.revenue)}</span>
        <span className="text-sm text-muted">{plural(v.all.orders, "order")}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
        <div>
          <dt className="text-muted">Online</dt>
          <dd className="font-medium tabular-nums">
            {fmtMoney(v.online.revenue)} <span className="font-normal text-muted">· {v.online.orders}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted">In person</dt>
          <dd className="font-medium tabular-nums">
            {fmtMoney(v.inperson.revenue)} <span className="font-normal text-muted">· {v.inperson.orders}</span>
          </dd>
        </div>
      </dl>
    </Card>
  );

  return (
    <div>
      <PageHeader
        title="Dashboard"
        sub={data.store.open ? "The store is open." : "The store is closed. Visitors see “Coming soon”."}
        actions={
          <Link href="/admin/sell">
            <Button variant="primary">New in-person sale</Button>
          </Link>
        }
      />

      <SectionTitle>To do</SectionTitle>
      {view.todos.length === 0 ? (
        <Card className="flex items-center gap-3 px-5 py-6">
          <CircleCheck size={24} className="shrink-0 text-pos" />
          <div>
            <div className="font-semibold">All caught up.</div>
            <div className="text-sm text-muted">No payments to confirm, nothing to ship, stock is fine.</div>
          </div>
        </Card>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {view.todos.map((t) => (
            <li key={t.key} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className={cx("mt-2 h-2.5 w-2.5 shrink-0 rounded-full", toneDot[t.tone])} />
                <div className="min-w-0">
                  <div className="font-medium">{t.text}</div>
                  {t.sub && <div className="text-sm text-muted">{t.sub}</div>}
                </div>
              </div>
              <Link href={t.href} className="shrink-0 sm:ml-auto">
                <Button variant={t.tone === "accent" ? "primary" : "secondary"} className="w-full sm:w-auto">
                  {t.button} <ArrowRight size={16} />
                </Button>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>Sales</SectionTitle>
      <div className="grid gap-3 md:grid-cols-2">
        {stat("Today", view.today)}
        {stat("This month", view.month)}
      </div>
      <p className="mt-2 text-sm text-muted">
        Paid orders only. Business money is <Link href="/admin/money" className="font-medium text-accent hover:underline">{fmtMoney(ledger.businessCents)}</Link>.
      </p>

      <div className="grid gap-x-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          <SectionTitle
            right={
              <Link href="/admin/orders" className="text-sm font-medium text-accent hover:underline">
                All orders
              </Link>
            }
          >
            Recent orders
          </SectionTitle>
          {view.recent.length === 0 ? (
            <Card className="px-5 py-8 text-center text-sm text-muted">No orders yet. Website orders and in-person sales will show up here.</Card>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {view.recent.map((o) => (
                <li key={o.id}>
                  <Link href={`/admin/orders/${o.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-surface2/60 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold tabular-nums">#{o.number}</span>
                        <span className="truncate">{customerName(o)}</span>
                      </div>
                      <div className="text-xs text-muted">
                        {o.source === "online" ? "Online" : "In person"} · {fmtDay(dayKey(orderPlaced(o)))}
                      </div>
                    </div>
                    <Badge tone={STATUS_TONE[o.status]}>{statusLabel(o)}</Badge>
                    <span className="w-20 shrink-0 text-right font-semibold tabular-nums">{fmtMoney(orderTotal(o, ledger))}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <SectionTitle
            right={
              <Link href="/admin/inventory" className="text-sm font-medium text-accent hover:underline">
                Inventory
              </Link>
            }
          >
            Low stock
          </SectionTitle>
          {view.low.length === 0 ? (
            <Card className="px-5 py-8 text-center text-sm text-muted">Every product is above its low stock warning.</Card>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {view.low.slice(0, 8).map((x) => (
                <li key={x.p.id}>
                  <Link href="/admin/inventory" className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-surface2/60 sm:px-5">
                    <span className="truncate font-medium">{x.p.name}</span>
                    <span className={cx("shrink-0 text-sm font-semibold tabular-nums", x.stock <= 0 ? "text-neg" : "text-warn")}>{x.stock <= 0 ? "Out" : `${x.stock} left`}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
