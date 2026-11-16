"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronUp, PackagePlus, Plus } from "lucide-react";
import { useCart } from "@/components/cart";
import { NumpadSheet } from "@/components/numpad";
import { OrderForm } from "@/components/order-form";
import { api, useLoaded } from "@/components/store";
import { useToast } from "@/components/toast";
import { Button, Empty, PageHeader, PageSkeleton, Sheet, cx, useConfirm } from "@/components/ui";
import { draftPayload, draftToOrder, lineCount, resolveDraftCustomer } from "@/lib/draft";
import { orderTotals } from "@/lib/money";
import { colorHex, fmtMoney, plural } from "@/lib/format";
import type { ProductRec } from "@/lib/types";

export default function SellPage() {
  const s = useLoaded();
  const cart = useCart();
  const confirm = useConfirm();
  const toast = useToast();
  const [cartOpen, setCartOpen] = useState(false);
  const [customFor, setCustomFor] = useState<ProductRec | null>(null);
  const [busy, setBusy] = useState(false);

  if (!s || !cart.ready) return <PageSkeleton />;
  const { data, ledger, mutate } = s;
  const products = data.products.filter((p) => !p.archived);
  const { draft } = cart;
  const count = lineCount(draft);
  const totals = orderTotals(draft);

  // Stock remaining after what's already in the cart
  const inCart = (pid: string) => draft.lines.filter((l) => l.productId === pid).reduce((x, l) => x + l.quantity, 0);
  const threshold = (p: ProductRec) => p.lowStockThreshold ?? data.settings.lowStockThreshold;

  async function newOrder() {
    if (draft.lines.length > 0) {
      const ok = await confirm({
        title: "Discard current order?",
        body: `It has ${plural(count, "item")} totaling ${fmtMoney(totals.total)}.`,
        confirmText: "Discard",
        danger: true,
      });
      if (!ok) return;
    }
    cart.reset();
    setCartOpen(false);
  }

  async function complete() {
    if (draft.lines.length === 0 || busy) return;
    const short = draft.lines.filter((l) => {
      if (!l.productId) return false;
      const stock = ledger.stock.get(l.productId)?.stock ?? 0;
      return stock - inCart(l.productId) < 0;
    });
    if (short.length) {
      const names = [...new Set(short.map((l) => l.productName))].join(", ");
      const ok = await confirm({
        title: "Not enough stock",
        body: `${names} will go below zero. Complete the order anyway?`,
        confirmText: "Complete anyway",
      });
      if (!ok) return;
    }
    // Link the typed customer (existing one by name, or a new one created with the order)
    const { draft: linked, created } = resolveDraftCustomer(draft, data.customers);
    // Snapshot cost and cut at the moment of sale
    const final = {
      ...linked,
      date: new Date().toISOString(),
      lines: draft.lines.map((l) => ({
        ...l,
        unitCostCents: l.productId ? ledger.stock.get(l.productId)?.unitCost ?? l.unitCostCents : l.unitCostCents,
        cutPercent: data.settings.businessCutPercent,
      })),
    };
    if (final.soldBy !== "W") cart.rememberSeller(final.soldBy);
    cart.rememberPayment(final.paymentMethod);
    setBusy(true);
    setCartOpen(false);
    cart.reset();
    const ok = await mutate(
      (d) => ({
        ...d,
        customers: created ? [...d.customers, created] : d.customers,
        orders: [draftToOrder(final), ...d.orders],
      }),
      () => api("/api/orders", "POST", draftPayload(final)),
    );
    setBusy(false);
    if (!ok) {
      cart.setDraft(draft); // give the order back so nothing is lost
      return;
    }
    toast.show({
      message: `Order saved · ${fmtMoney(orderTotals(final).total)}`,
      action: {
        label: "Undo",
        onClick: () =>
          mutate(
            (d) => ({ ...d, orders: d.orders.filter((o) => o.id !== final.id) }),
            () => api(`/api/orders/${final.id}`, "DELETE"),
          ).then((undone) => undone && toast.show({ message: "Order undone" })),
      },
      duration: 5000,
    });
  }

  return (
    <div>
      <PageHeader
        title="Sell"
        sub={products.length ? "Tap a product to add it" : undefined}
        actions={
          <Button variant="primary" onClick={newOrder}>
            <Plus size={18} /> New order
          </Button>
        }
      />

      {products.length === 0 ? (
        <Empty
          icon={<PackagePlus size={32} />}
          title="No products yet"
          body="Add your first product in Inventory, then sell it from here."
          action={
            <Link href="/admin/inventory?add=1">
              <Button variant="primary">Add a product</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => {
            const stock = (ledger.stock.get(p.id)?.stock ?? 0) - inCart(p.id);
            const n = inCart(p.id);
            const stockTone = stock <= 0 ? "text-neg" : stock <= threshold(p) ? "text-warn" : "text-muted";
            return (
              <div key={p.id} className="relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
                <div className="h-1.5" style={{ background: colorHex(p.color) }} />
                <div className="flex flex-1 flex-col p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="line-clamp-2 font-semibold leading-snug">{p.name}</div>
                    {n > 0 && (
                      <span className="flex h-6 min-w-6 shrink-0 animate-pop-in items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-ink">
                        {n}
                      </span>
                    )}
                  </div>
                  <div className={cx("mt-1 text-sm tabular-nums", stockTone)}>
                    {stock} in stock{stock <= 0 ? "" : stock <= threshold(p) ? " · low" : ""}
                  </div>
                  <div className="mt-auto space-y-2 pt-4">
                    <button
                      type="button"
                      onClick={() => cart.addProduct(p, p.defaultPriceCents)}
                      className="flex h-12 w-full items-center justify-center rounded-xl bg-accent text-[15px] font-semibold text-accent-ink transition hover:brightness-110 active:scale-[.97]"
                    >
                      Sell 1 for {fmtMoney(p.defaultPriceCents, { compact: true })}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCustomFor(p)}
                      className="flex h-10 w-full items-center justify-center rounded-xl text-sm font-medium text-muted transition hover:bg-surface2 hover:text-ink active:scale-[.97]"
                    >
                      Other price
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Room so the last product card is never hidden behind the order bar */}
      {count > 0 && <div aria-hidden className="h-24" />}

      {/* Sticky current-order bar */}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-30 animate-toast-in px-3 md:bottom-6 md:left-60 md:px-8">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="mx-auto flex h-16 w-full max-w-2xl items-center gap-3 rounded-2xl bg-ink px-5 text-bg shadow-xl transition active:scale-[.99]"
          >
            <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-bg/15 px-2 text-sm font-semibold tabular-nums">{count}</span>
            <span className="flex-1 text-left font-medium">Current order</span>
            <span className="text-lg font-semibold tabular-nums">{fmtMoney(totals.total)}</span>
            <ChevronUp size={20} className="opacity-60" />
          </button>
        </div>
      )}

      <Sheet
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        title="Current order"
        footer={
          <Button variant="primary" size="lg" block disabled={draft.lines.length === 0 || busy} onClick={complete}>
            Complete order · {fmtMoney(totals.total)}
          </Button>
        }
      >
        <OrderForm mode="cart" draft={draft} onChange={cart.setDraft} />
      </Sheet>

      <NumpadSheet
        open={!!customFor}
        onClose={() => setCustomFor(null)}
        title={customFor ? `${customFor.name} · custom price` : ""}
        initialCents={customFor?.defaultPriceCents}
        onSubmit={(c) => customFor && cart.addProduct(customFor, c)}
      />
    </div>
  );
}
