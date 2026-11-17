"use client";

import { useEffect, useState } from "react";
import { api, useLoaded } from "@/components/store";
import { Card, PageHeader, PageSkeleton, SectionTitle, Segmented, cx } from "@/components/ui";
import type { AnalyticsSummary } from "@/lib/analytics";
import { fmtDay } from "@/lib/format";

const fmt = (n: number) => n.toLocaleString("en-US");

export default function AnalyticsPage() {
  const s = useLoaded();
  const [days, setDays] = useState<"7" | "30">("7");
  const [sum, setSum] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setSum(null);
    api<AnalyticsSummary>(`/api/analytics?days=${days}`)
      .then((r) => live && (setSum(r), setError("")))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [days]);

  if (!s) return <PageSkeleton />;
  const listingName = (id: string) => s.data.listings.find((l) => l.id === id)?.name ?? "Removed product";
  const t = sum?.totals;
  const tiles: { label: string; value: string; hint: string }[] = t
    ? [
        { label: "Store visits", value: fmt(t.visit), hint: "One per browser per day" },
        { label: "Product page views", value: fmt(t.product_view), hint: "Every time a product page is opened" },
        { label: "Add to carts", value: fmt(t.add_to_cart), hint: "Taps on Add to cart" },
        { label: "Checkouts started", value: fmt(t.checkout_start), hint: "Opened checkout with items in the cart" },
        { label: "Orders placed", value: fmt(t.order), hint: "Website orders, paid or not yet" },
        { label: "Conversion rate", value: sum!.conversionPercent === null ? "—" : `${sum!.conversionPercent}%`, hint: "Orders placed per 100 visits" },
      ]
    : [];
  const maxVisit = Math.max(1, ...(sum?.daily.map((d) => d.visit) ?? [1]));
  const newestFirst = sum ? [...sum.daily].reverse() : [];

  return (
    <div>
      <PageHeader title="Analytics" sub="Counts from your own store. No third-party tracking, nothing about individual visitors." />
      <Segmented
        className="mb-5 max-w-xs"
        value={days}
        onChange={setDays}
        options={[
          { value: "7", label: "Last 7 days" },
          { value: "30", label: "Last 30 days" },
        ]}
      />

      {error ? (
        <Card className="px-5 py-6 text-sm text-neg">Couldn’t load the numbers: {error}. Check your connection and reload the page.</Card>
      ) : !sum ? (
        <PageSkeleton />
      ) : (
        <>
          {!s.data.store.open && <p className="mb-4 rounded-xl bg-surface2 px-4 py-3 text-sm text-muted">The store is closed, so nothing is being counted. Counting starts when the store opens. Your own visits while signed in to the admin are never counted.</p>}
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-analytics-tiles>
            {tiles.map((x) => (
              <Card key={x.label} className="p-4">
                <dt className="text-sm font-medium text-muted">{x.label}</dt>
                <dd className="mt-1 text-3xl font-semibold tabular-nums tracking-tight" data-metric={x.label}>
                  {x.value}
                </dd>
                <dd className="mt-1 text-xs text-muted">{x.hint}</dd>
              </Card>
            ))}
          </dl>

          <SectionTitle>Day by day</SectionTitle>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="text-xs text-muted">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-2.5 font-medium">Day</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Visits</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Product views</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Add to carts</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Checkouts</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Orders</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {newestFirst.map((d) => (
                  <tr key={d.day} className={cx(d.visit + d.product_view + d.add_to_cart + d.checkout_start + d.order === 0 && "text-muted")}>
                    <th scope="row" className="whitespace-nowrap px-4 py-2.5 font-medium">{fmtDay(d.day)}</th>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="w-9 shrink-0 tabular-nums">{fmt(d.visit)}</span>
                        <span aria-hidden className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface2">
                          <span className="block h-full rounded-full bg-accent" style={{ width: `${(d.visit / maxVisit) * 100}%` }} />
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmt(d.product_view)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmt(d.add_to_cart)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmt(d.checkout_start)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmt(d.order)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <SectionTitle>Products</SectionTitle>
          {sum.products.length === 0 ? (
            <Card className="px-5 py-8 text-center text-sm text-muted">No product page views in this period yet.</Card>
          ) : (
            <Card className="overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr className="border-b border-line">
                    <th scope="col" className="px-4 py-2.5 font-medium">Product</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">Page views</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">Add to carts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {sum.products.slice(0, 20).map((p) => (
                    <tr key={p.id}>
                      <th scope="row" className="max-w-0 truncate px-4 py-2.5 font-medium">{listingName(p.id)}</th>
                      <td className="px-3 py-2.5 text-right tabular-nums">{fmt(p.views)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt(p.addToCarts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          <p className="mt-4 text-xs text-muted">
            What is stored: one number per day for each count above (and per product for views and add to carts). No IP addresses, no cookies, no visitor ids. Search engine crawlers and link previews are left out.
          </p>
        </>
      )}
    </div>
  );
}
