"use client";

import { useMemo, useState } from "react";
import { Scale, TrendingUp } from "lucide-react";
import { BarChart, type Bucket } from "@/components/bar-chart";
import { OrderEditSheet } from "@/components/order-edit";
import { api, useLoaded } from "@/components/store";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Empty, Field, Input, Money, PageHeader, PageSkeleton, Row, SectionTitle, Segmented, Sheet, cx } from "@/components/ui";
import { addDays, dayKey, fmtDay, fmtMoney, fmtTime, startOfDay, uid } from "@/lib/format";
import { paymentBreakdown } from "@/lib/insights";
import { planSplit } from "@/lib/money";
import type { SplitRec } from "@/lib/types";

type Period = "today" | "week" | "month" | "all" | "custom";

export default function MoneyPage() {
  const s = useLoaded();
  const [period, setPeriod] = useState<Period>("week");
  const [from, setFrom] = useState(dayKey(addDays(new Date(), -29)));
  const [to, setTo] = useState(dayKey(new Date()));
  const [splitOpen, setSplitOpen] = useState(false);

  const range = useMemo((): [string, string] | null => {
    const today = dayKey(new Date());
    if (period === "today") return [today, today];
    if (period === "week") return [dayKey(addDays(startOfDay(), -6)), today];
    if (period === "month") {
      const d = new Date();
      return [dayKey(new Date(d.getFullYear(), d.getMonth(), 1)), today];
    }
    if (period === "custom") return from <= to ? [from, to] : [to, from];
    return null;
  }, [period, from, to]);

  const stats = useMemo(() => {
    if (!s) return null;
    const { data, ledger } = s;
    const inRange = data.orders.filter((o) => {
      if (!range) return true;
      const k = dayKey(o.date);
      return k >= range[0] && k <= range[1];
    });
    const t = { revenue: 0, discount: 0, tip: 0, cost: 0, profit: 0, orders: inRange.length, units: 0 };
    const byProduct = new Map<string, { name: string; units: number; revenue: number; cost: number }>();
    const bySeller = new Map<string, { orders: number; revenue: number; tips: number; units: number }>();
    const byDay = new Map<string, { revenue: number; profit: number }>();
    const bySource = { online: { orders: 0, revenue: 0, profit: 0 }, inperson: { orders: 0, revenue: 0, profit: 0 } };
    let shippingCollected = 0;
    for (const o of inRange) {
      const r = ledger.orders.get(o.id);
      if (!r) continue;
      const src = bySource[o.source];
      src.orders++;
      src.revenue += r.revenue;
      src.profit += r.profit;
      shippingCollected += r.shipping;
      t.revenue += r.revenue;
      t.discount += r.discount;
      t.tip += r.tip;
      t.cost += r.cost;
      t.units += r.units;
      r.lines.forEach((lr, i) => {
        const line = o.lines.find((l) => l.id === lr.lineId) ?? o.lines[i];
        const key = lr.productId ?? `deleted:${line?.productName}`;
        const p = byProduct.get(key) ?? { name: line?.productName || "Deleted product", units: 0, revenue: 0, cost: 0 };
        p.units += lr.quantity;
        p.revenue += lr.revenue;
        p.cost += lr.cost;
        byProduct.set(key, p);
      });
      const sel = bySeller.get(o.soldBy) ?? { orders: 0, revenue: 0, tips: 0, units: 0 };
      sel.orders++;
      sel.revenue += r.revenue;
      sel.tips += r.tip;
      sel.units += r.units;
      bySeller.set(o.soldBy, sel);
      const dk = dayKey(o.date);
      const d = byDay.get(dk) ?? { revenue: 0, profit: 0 };
      d.revenue += r.revenue + r.tip;
      d.profit += r.profit + r.tip;
      byDay.set(dk, d);
    }
    t.profit = t.revenue + t.tip - t.cost;

    // Chart buckets: one per day (or per month for long ranges)
    let start: Date;
    let end = startOfDay();
    if (range) {
      const [a, b] = range;
      start = new Date(`${a}T00:00`);
      end = new Date(`${b}T00:00`);
    } else {
      const first = inRange.reduce((m, o) => (o.date < m ? o.date : m), new Date().toISOString());
      start = startOfDay(new Date(first));
    }
    if (period === "today") start = addDays(end, -6); // show the past week around today
    const days = Math.round((end.getTime() - start.getTime()) / 864e5) + 1;
    const buckets: Bucket[] = [];
    if (days <= 62) {
      for (let i = 0; i < days; i++) {
        const k = dayKey(addDays(start, i));
        const v = byDay.get(k) ?? { revenue: 0, profit: 0 };
        const label = new Date(`${k}T00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        buckets.push({ key: k, label, ...v });
      }
    } else {
      const months = new Map<string, Bucket>();
      for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        const k = `${d.getFullYear()}-${d.getMonth()}`;
        months.set(k, { key: k, label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }), revenue: 0, profit: 0 });
      }
      for (const [dk, v] of byDay) {
        const d = new Date(`${dk}T00:00`);
        const m = months.get(`${d.getFullYear()}-${d.getMonth()}`);
        if (m) {
          m.revenue += v.revenue;
          m.profit += v.profit;
        }
      }
      buckets.push(...months.values());
    }
    return {
      t,
      buckets,
      monthly: days > 62,
      products: [...byProduct.values()].sort((a, b) => b.revenue - a.revenue),
      sellers: bySeller,
      bySource,
      shippingCollected,
      labelCosts: data.labels
        .filter((l) => !l.voided && (!range || (dayKey(l.date) >= range[0] && dayKey(l.date) <= range[1])))
        .reduce((x, l) => x + l.costCents, 0),
      payments: paymentBreakdown(inRange, data.settings.paymentMethods),
    };
  }, [s, range, period]);

  if (!s || !stats) return <PageSkeleton />;
  const { data, ledger, name } = s;
  const plan = planSplit(data, ledger);
  const pending = ledger.pendingA + ledger.pendingB;
  const canSplit = plan.items.length > 0 && (plan.partnerACents !== 0 || plan.partnerBCents !== 0 || plan.newOrderIds.length > 0);
  const progress = ledger.inPayback && ledger.paybackLow < 0 ? Math.max(0, Math.min(1, 1 - ledger.businessCents / ledger.paybackLow)) : 1;
  const { t } = stats;

  return (
    <div>
      <PageHeader title="Money" />

      {/* Top cards */}
      <div className="grid gap-3 md:grid-cols-2">
        <Card className={cx("p-5", ledger.businessCents < 0 && "border-neg/30")}>
          <div className="text-sm font-medium text-muted">Business money</div>
          <div className={cx("mt-1 text-4xl font-semibold tracking-tight tabular-nums", ledger.businessCents < 0 ? "text-neg" : "text-ink")}>
            {fmtMoney(ledger.businessCents)}
          </div>
          {ledger.inPayback ? (
            <div className="mt-4">
              <div className="mb-1.5 flex justify-between text-sm">
                <span className="font-medium text-neg">{fmtMoney(ledger.leftToBreakEven)} left to break even</span>
                <span className="tabular-nums text-muted">{Math.round(progress * 100)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface2">
                <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${progress * 100}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted">Payback mode: all sales go to the business until it reaches $0.</p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">Includes {fmtMoney(pending)} waiting to be split.</p>
          )}
        </Card>

        <Card className="flex flex-col p-5">
          <div className="text-sm font-medium text-muted">Pending split</div>
          <div className="mt-1 text-4xl font-semibold tracking-tight tabular-nums">
            <Money cents={pending} colored="neg" />
          </div>
          <div className="mt-2 flex gap-4 text-sm text-muted">
            <span>
              {name("A")} <Money cents={ledger.pendingA} colored="neg" className="font-medium text-ink" />
            </span>
            <span>
              {name("B")} <Money cents={ledger.pendingB} colored="neg" className="font-medium text-ink" />
            </span>
          </div>
          <Button variant="primary" size="lg" className="mt-4 w-full" disabled={!canSplit} onClick={() => setSplitOpen(true)}>
            <Scale size={19} /> Split
          </Button>
        </Card>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        {(["A", "B"] as const).map((p) => (
          <Card key={p} className="p-4">
            <div className="text-sm text-muted">{name(p)} earned</div>
            <div className="mt-0.5 text-xl font-semibold tabular-nums">{fmtMoney(p === "A" ? ledger.earnedA : ledger.earnedB)}</div>
          </Card>
        ))}
      </div>

      {/* Period */}
      <SectionTitle>Performance</SectionTitle>
      <Segmented
        size="sm"
        value={period}
        onChange={setPeriod}
        options={[
          { value: "today", label: "Today" },
          { value: "week", label: "Week" },
          { value: "month", label: "Month" },
          { value: "all", label: "All" },
          { value: "custom", label: "Custom" },
        ]}
      />
      {period === "custom" && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="From">
            <Input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </Field>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Revenue" value={fmtMoney(t.revenue)} sub="after discounts" />
        <StatCard label="Profit" value={fmtMoney(t.profit)} tone={t.profit < 0 ? "neg" : "pos"} sub="incl. tips" />
        <StatCard label="Cost" value={fmtMoney(t.cost)} />
        <StatCard label="Tips" value={fmtMoney(t.tip)} />
        <StatCard label="Discounts given" value={t.discount ? `-${fmtMoney(t.discount)}` : fmtMoney(0)} tone={t.discount ? "neg" : undefined} />
        <StatCard label="Orders" value={String(t.orders)} />
        <StatCard label="Units sold" value={String(t.units)} />
        <StatCard label="Avg order" value={t.orders ? fmtMoney(Math.round((t.revenue + t.tip) / t.orders)) : "—"} />
      </div>

      <Card className="mt-3 p-4">
        <div className="mb-1 text-sm font-medium">{stats.monthly ? "Monthly" : "Daily"} revenue & profit</div>
        {t.orders === 0 && period !== "today" ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted">No sales in this period</div>
        ) : (
          <BarChart buckets={stats.buckets} />
        )}
      </Card>

      <SectionTitle>Sales by product</SectionTitle>
      {stats.products.length === 0 ? (
        <Empty icon={<TrendingUp size={28} />} title="No sales in this period" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-2.5 font-medium">Product</th>
                <th className="px-2 py-2.5 text-right font-medium">Units</th>
                <th className="px-2 py-2.5 text-right font-medium">Revenue</th>
                <th className="px-4 py-2.5 text-right font-medium">Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {stats.products.map((p) => (
                <tr key={p.name}>
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-2 py-3 text-right tabular-nums">{p.units}</td>
                  <td className="px-2 py-3 text-right tabular-nums">{fmtMoney(p.revenue)}</td>
                  <td className="px-4 py-3 text-right">
                    <Money cents={p.revenue - p.cost} colored="neg" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <SectionTitle>Online vs in person</SectionTitle>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
              <th className="px-4 py-2.5 font-medium">Source</th>
              <th className="px-2 py-2.5 text-right font-medium">Orders</th>
              <th className="px-2 py-2.5 text-right font-medium">Revenue</th>
              <th className="px-4 py-2.5 text-right font-medium">Profit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(
              [
                ["Online", stats.bySource.online],
                ["In person", stats.bySource.inperson],
              ] as const
            ).map(([label, v]) => (
              <tr key={label}>
                <td className="px-4 py-3 font-medium">{label}</td>
                <td className="px-2 py-3 text-right tabular-nums">{v.orders}</td>
                <td className="px-2 py-3 text-right tabular-nums">{fmtMoney(v.revenue)}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <Money cents={v.profit} colored="neg" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-2 text-xs text-muted">Revenue is after discounts, before tips and shipping. Profit is revenue minus item cost.</p>

      <SectionTitle>Shipping</SectionTitle>
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-sm text-muted">Collected from customers</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{fmtMoney(stats.shippingCollected)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted">Spent on labels</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{fmtMoney(stats.labelCosts)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-muted">Difference</div>
          <div className="mt-1 text-xl font-semibold">
            <Money cents={stats.shippingCollected - stats.labelCosts} colored />
          </div>
        </Card>
      </div>
      <p className="mt-2 text-xs text-muted">Shipping charged goes fully to business money and is never split. Each label bought is a business expense. With free shipping, the business pays the label.</p>

      <SectionTitle>Sales by seller</SectionTitle>
      <div className={cx("grid gap-3", stats.sellers.has("W") ? "grid-cols-3" : "grid-cols-2")}>
        {(stats.sellers.has("W") ? (["A", "B", "W"] as const) : (["A", "B"] as const)).map((p) => {
          const v = stats.sellers.get(p) ?? { orders: 0, revenue: 0, tips: 0, units: 0 };
          return (
            <Card key={p} className="p-4">
              <div className="font-medium">{name(p)}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{fmtMoney(v.revenue)}</div>
              <div className="mt-1 text-xs text-muted">
                {v.orders} orders · {v.units} units{v.tips ? ` · ${fmtMoney(v.tips)} tips` : ""}
              </div>
            </Card>
          );
        })}
      </div>

      <SectionTitle>By payment method</SectionTitle>
      {stats.payments.length === 0 ? (
        <Empty title="No sales in this period" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-2.5 font-medium">Method</th>
                <th className="px-2 py-2.5 text-right font-medium">Orders</th>
                <th className="px-4 py-2.5 text-right font-medium">Collected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {stats.payments.map((p) => (
                <tr key={p.method}>
                  <td className={cx("px-4 py-3 font-medium", p.method === "Unknown" && "text-muted")}>{p.method}</td>
                  <td className="px-2 py-3 text-right tabular-nums">{p.orders}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(p.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line font-semibold">
                <td className="px-4 py-3">Total</td>
                <td className="px-2 py-3 text-right tabular-nums">{stats.payments.reduce((x, p) => x + p.orders, 0)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(stats.payments.reduce((x, p) => x + p.total, 0))}</td>
              </tr>
            </tfoot>
          </table>
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted">Collected = order totals after discounts, including tips.</p>
        </Card>
      )}

      <SplitSheet open={splitOpen} onClose={() => setSplitOpen(false)} />
    </div>
  );
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "neg" | "pos" }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("mt-0.5 text-lg font-semibold tabular-nums", tone === "neg" && "text-neg", tone === "pos" && "text-pos")}>{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </Card>
  );
}

function SplitSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useLoaded();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [viewOrder, setViewOrder] = useState<string | null>(null);
  if (!s) return null;
  const { data, ledger, name, mutate } = s;
  const plan = planSplit(data, ledger);
  const ordersById = new Map(data.orders.map((o) => [o.id, o]));

  async function confirmSplit() {
    setBusy(true);
    const id = uid();
    const now = new Date().toISOString();
    const rec: SplitRec = {
      id,
      date: now,
      note: "",
      partnerACents: plan.partnerACents,
      partnerBCents: plan.partnerBCents,
      businessCents: plan.businessCents,
      createdAt: now,
      items: plan.items.map((it) => ({ id: uid(), splitId: id, ...it })),
    };
    const payouts = (["A", "B"] as const)
      .map((p) => ({ p, amt: p === "A" ? plan.partnerACents : plan.partnerBCents }))
      .filter((x) => x.amt !== 0)
      .map((x) => ({ id: uid(), date: now, person: x.p, amountCents: x.amt, note: "From split", splitId: id, createdAt: now }));
    onClose();
    const ok = await mutate(
      (d) => ({ ...d, splits: [rec, ...d.splits], payouts: [...payouts, ...d.payouts] }),
      () => api("/api/splits", "POST", { id, expectedA: plan.partnerACents, expectedB: plan.partnerBCents }),
    );
    setBusy(false);
    if (ok) toast.show({ message: `Split done · ${name("A")} ${fmtMoney(plan.partnerACents)}, ${name("B")} ${fmtMoney(plan.partnerBCents)}`, tone: "success" });
  }

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title="Split"
        footer={
          <Button variant="primary" size="lg" block disabled={busy || plan.items.length === 0} onClick={confirmSplit}>
            Confirm split
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          {(["A", "B"] as const).map((p) => (
            <div key={p} className="rounded-2xl bg-accent/8 p-4">
              <div className="text-sm text-muted">To {name(p)}</div>
              <div className="mt-0.5 text-2xl font-semibold tabular-nums">
                <Money cents={p === "A" ? plan.partnerACents : plan.partnerBCents} colored="neg" />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-2xl bg-surface2/70 px-4 py-3">
          <Row label="Staying in the business">{fmtMoney(plan.businessCents)}</Row>
          <Row label="Business money after split">
            <Money cents={ledger.businessCents - plan.partnerACents - plan.partnerBCents} colored="neg" />
          </Row>
        </div>

        <div className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wider text-muted">
          Covers {plan.newOrderIds.length} unsplit {plan.newOrderIds.length === 1 ? "order" : "orders"}
          {plan.adjustedOrderIds.length ? ` + ${plan.adjustedOrderIds.length} adjusted` : ""}
        </div>
        <div className="divide-y divide-line rounded-2xl border border-line">
          {plan.items.map((it, i) => {
            const o = it.orderId ? ordersById.get(it.orderId) : null;
            const r = it.orderId ? ledger.orders.get(it.orderId) : null;
            return (
              <button
                key={it.orderId ?? `orphan-${i}`}
                type="button"
                disabled={!o}
                onClick={() => o && setViewOrder(o.id)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition enabled:hover:bg-surface2/60"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    {o ? o.customer || "Walk-in" : "Deleted orders"}
                    {it.adjustment && <Badge tone="warn">Adjustment</Badge>}
                  </div>
                  <div className="text-xs text-muted">
                    {o ? `${fmtDay(dayKey(o.date))} · ${fmtTime(o.date)} · ${fmtMoney(r?.total ?? 0)}` : "Correction for orders deleted after a split"}
                  </div>
                </div>
                <div className="text-right text-xs tabular-nums">
                  <div>
                    {name("A")} <Money cents={it.partnerACents} colored="neg" sign={it.adjustment} />
                  </div>
                  <div>
                    {name("B")} <Money cents={it.partnerBCents} colored="neg" sign={it.adjustment} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {plan.items.length === 0 && <p className="py-6 text-center text-sm text-muted">Nothing to split right now.</p>}
      </Sheet>
      <OrderEditSheet orderId={viewOrder} onClose={() => setViewOrder(null)} />
    </>
  );
}
