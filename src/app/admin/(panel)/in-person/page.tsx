"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ReceiptText, Search, SlidersHorizontal } from "lucide-react";
import { OrderEditSheet } from "@/components/order-edit";
import { useLoaded } from "@/components/store";
import { Badge, Button, Empty, Field, Input, PageHeader, PageSkeleton, Segmented, Select, cx } from "@/components/ui";
import { dayKey, fmtDay, fmtMoney, fmtTime, plural } from "@/lib/format";
import { splitOrderIds } from "@/lib/money";
import { UNKNOWN_PAYMENT, type Partner } from "@/lib/types";

export default function OrdersPage() {
  const s = useLoaded();
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [seller, setSeller] = useState<"all" | Partner>("all");
  const [payment, setPayment] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const groups = useMemo(() => {
    if (!s) return [];
    const needle = q.trim().toLowerCase();
    const list = s.data.orders
      .filter((o) => o.source === "inperson")
      .filter((o) => !needle || o.customer.toLowerCase().includes(needle) || o.note.toLowerCase().includes(needle))
      .filter((o) => seller === "all" || o.soldBy === seller)
      .filter((o) => payment === "all" || o.paymentMethod === payment)
      .filter((o) => !from || dayKey(o.date) >= from)
      .filter((o) => !to || dayKey(o.date) <= to)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const map = new Map<string, typeof list>();
    for (const o of list) {
      const k = dayKey(o.date);
      map.set(k, [...(map.get(k) ?? []), o]);
    }
    return [...map.entries()];
  }, [s, q, from, to, seller, payment]);

  if (!s) return <PageSkeleton />;
  const { data, ledger, name } = s;
  const split = splitOrderIds(data);
  const inPerson = data.orders.filter((o) => o.source === "inperson");
  const filtersOn = !!from || !!to || seller !== "all" || payment !== "all";
  // Methods offered now, plus any older names still on orders (e.g. "Unknown" or a removed method)
  const used = new Set(inPerson.map((o) => o.paymentMethod));
  const paymentOptions = [
    ...data.settings.paymentMethods,
    ...[...used].filter((m) => !data.settings.paymentMethods.includes(m)).sort((a, b) => (a === UNKNOWN_PAYMENT ? 1 : b === UNKNOWN_PAYMENT ? -1 : a.localeCompare(b))),
  ];

  return (
    <div>
      <PageHeader title="In-person orders" sub={`${plural(inPerson.length, "sale")} made from the Sell screen`} />

      <div className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer or note" className="pl-10" />
        </div>
        <Button
          className={cx("h-12 w-12 px-0", filtersOn && "border-accent text-accent")}
          aria-label="Filters"
          onClick={() => setShowFilters((v) => !v)}
        >
          <SlidersHorizontal size={18} />
        </Button>
      </div>

      {showFilters && (
        <div className="mb-5 animate-fade-in space-y-3 rounded-2xl border border-line bg-surface p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="From">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="To">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <Field label="Sold by">
            <Segmented
              value={seller}
              onChange={setSeller}
              options={[
                { value: "all", label: "Everyone" },
                { value: "A", label: name("A") },
                { value: "B", label: name("B") },
              ]}
            />
          </Field>
          <Field label="Payment method">
            <Select value={payment} onChange={(e) => setPayment(e.target.value)}>
              <option value="all">All payment methods</option>
              {paymentOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          {filtersOn && (
            <button
              className="text-sm font-medium text-accent"
              onClick={() => {
                setFrom("");
                setTo("");
                setSeller("all");
                setPayment("all");
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {inPerson.length === 0 ? (
        <Empty
          icon={<ReceiptText size={32} />}
          title="No orders yet"
          body="Completed sales show up here. Start one from the Sell screen."
          action={
            <Link href="/admin/sell">
              <Button variant="primary">Go to Sell</Button>
            </Link>
          }
        />
      ) : groups.length === 0 ? (
        <Empty title="No matching orders" body="Try a different search or clear the filters." />
      ) : (
        <div className="space-y-6">
          {groups.map(([day, orders]) => {
            const dayTotal = orders.reduce((x, o) => x + (ledger.orders.get(o.id)?.total ?? 0), 0);
            return (
              <section key={day}>
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <h2 className="text-sm font-semibold">{fmtDay(day)}</h2>
                  <span className="text-sm tabular-nums text-muted">
                    {plural(orders.length, "order")} · <span className="font-medium text-ink">{fmtMoney(dayTotal)}</span>
                  </span>
                </div>
                <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
                  {orders.map((o) => {
                    const r = ledger.orders.get(o.id);
                    if (!r) return null;
                    const items = o.lines.map((l) => `${l.quantity > 1 ? l.quantity + "× " : ""}${l.productName}`).join(", ");
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => setEditing(o.id)}
                        className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-surface2/60 active:bg-surface2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{o.customer || "Walk-in"}</span>
                            {split.has(o.id) && <Badge>Split</Badge>}
                          </div>
                          <div className="mt-0.5 truncate text-sm text-muted">{items}</div>
                          <div className="mt-0.5 text-xs text-muted">
                            {fmtTime(o.date)} · {name(o.soldBy)} · {o.paymentMethod}
                            {o.note ? ` · ${o.note}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-sm tabular-nums">
                          <div className="text-base font-semibold">{fmtMoney(r.total)}</div>
                          {(r.discount > 0 || r.tip > 0) && <div className="text-muted">{fmtMoney(r.subtotal)}</div>}
                          {r.discount > 0 && <div className="text-neg">-{fmtMoney(r.discount)}</div>}
                          {r.tip > 0 && <div className="text-pos">+{fmtMoney(r.tip)} tip</div>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <OrderEditSheet orderId={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
