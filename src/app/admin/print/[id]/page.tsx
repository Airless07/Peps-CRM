"use client";

// Packing slip: a clean page made for printing. No prices of cost, no admin data.
import { use, useEffect, useState } from "react";
import { fmtDate, fmtMoney } from "@/lib/format";
import { orderTotals } from "@/lib/money";
import { RESEARCH_LINE } from "@/lib/store/config";
import type { AppData, OrderRec } from "@/lib/types";
import { lineName } from "@/lib/size";

export default function PackingSlipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [state, setState] = useState<{ order: OrderRec; data: AppData } | "missing" | "error" | null>(null);

  useEffect(() => {
    fetch("/api/data", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: AppData) => {
        const order = [...data.orders, ...data.pendingOrders].find((o) => o.id === id);
        setState(order ? { order, data } : "missing");
      })
      .catch(() => setState("error"));
  }, [id]);

  useEffect(() => {
    if (state && typeof state === "object") {
      document.title = `Packing slip #${state.order.number}`;
      const t = setTimeout(() => window.print(), 350);
      return () => clearTimeout(t);
    }
  }, [state]);

  if (!state) return <p className="p-8 text-sm text-neutral-500">Loading packing slip…</p>;
  if (state === "missing") return <p className="p-8 text-sm">That order was not found. Close this tab and try again from the order.</p>;
  if (state === "error") return <p className="p-8 text-sm">Couldn’t load the order. Make sure you are signed in, then reload this page.</p>;

  const { order, data } = state;
  const a = order.web?.shipTo;
  const f = data.store.shipFrom;
  const t = orderTotals(order);
  const units = order.lines.reduce((x, l) => x + l.quantity, 0);

  return (
    <div className="min-h-dvh bg-white text-black">
      <style>{`@page { margin: 14mm; } @media print { .no-print { display: none !important; } body { background: #fff !important; } }`}</style>
      <div className="no-print flex items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50 px-6 py-3">
        <span className="text-sm text-neutral-600">Packing slip for order #{order.number}</span>
        <button onClick={() => window.print()} className="h-10 rounded-lg bg-black px-4 text-sm font-medium text-white">
          Print
        </button>
      </div>
      <div className="mx-auto max-w-[190mm] px-6 py-8 text-[13px] leading-relaxed">
        <div className="flex items-start justify-between border-b-2 border-black pb-4">
          <div>
            <div className="text-xl font-extrabold uppercase tracking-[0.16em]">{data.store.storeName}</div>
            {f.street1 && (
              <div className="mt-1 text-neutral-600">
                {f.street1}
                {f.street2 ? `, ${f.street2}` : ""}, {f.city}, {f.state} {f.zip}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Packing slip</div>
            <div className="text-2xl font-bold tabular-nums">#{order.number}</div>
            <div className="text-neutral-600">{fmtDate(order.web?.placedAt ?? order.date)}</div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-8">
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">Ship to</div>
            {a ? (
              <address className="text-[15px] font-medium not-italic leading-snug">
                {a.name}
                <br />
                {a.street1}
                {a.street2 && (
                  <>
                    <br />
                    {a.street2}
                  </>
                )}
                <br />
                {a.city}, {a.state} {a.zip}
              </address>
            ) : (
              <div className="text-[15px] font-medium">{order.customer || "In-person sale"}</div>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-neutral-500">Shipping</div>
            <div className="text-[15px]">{order.web?.shippingMethod || "In person"}</div>
            {order.web?.trackingNumber && (
              <div className="tabular-nums text-neutral-600">
                {order.web.trackingCarrier} {order.web.trackingNumber}
              </div>
            )}
          </div>
        </div>

        <table className="mt-8 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-black text-xs uppercase tracking-wider text-neutral-500">
              <th className="w-16 py-2 font-semibold">Qty</th>
              <th className="py-2 font-semibold">Item</th>
              <th className="w-16 py-2 text-center font-semibold">Packed</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => (
              <tr key={l.id} className="border-b border-neutral-200">
                <td className="py-3 text-lg font-bold tabular-nums">{l.quantity}</td>
                <td className="py-3 text-[15px] font-medium">{lineName(l)}</td>
                <td className="py-3">
                  <span className="mx-auto block h-5 w-5 rounded border-2 border-neutral-400" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex justify-between text-neutral-600">
          <span>
            {units} item{units === 1 ? "" : "s"} in this package
          </span>
          <span className="tabular-nums">Order total {fmtMoney(t.total)}</span>
        </div>

        <p className="mt-10 border-t border-neutral-300 pt-4 text-xs text-neutral-600">{RESEARCH_LINE}</p>
        <p className="mt-1 text-xs text-neutral-600">Questions about this order? Reply to your order email and include order #{order.number}.</p>
      </div>
    </div>
  );
}
