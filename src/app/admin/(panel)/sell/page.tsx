"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bookmark, CalendarDays, ChevronDown, ChevronUp, Copy, PackagePlus, Plus, X } from "lucide-react";
import { useCart } from "@/components/cart";
import { NumpadSheet } from "@/components/numpad";
import { OrderForm } from "@/components/order-form";
import { PriceChangeNotes, SavedOrdersList, SavedOrdersSummary, useSellActions } from "@/components/saved-orders";
import { useLoaded } from "@/components/store";
import { useToast } from "@/components/toast";
import { Button, Empty, PageHeader, PageSkeleton, Sheet, cx, useConfirm } from "@/components/ui";
import { receiptText, todaySummary } from "@/lib/sell-tools";
import { lineCount } from "@/lib/draft";
import { orderTotals } from "@/lib/money";
import { sellGroups, sellVariantLabel } from "@/lib/admin/sell-groups";
import { colorHex, fmtMoney, plural } from "@/lib/format";
import type { ProductRec } from "@/lib/types";
import { heldBy } from "@/lib/saved-orders";

export default function SellPage() {
  const s = useLoaded();
  const cart = useCart();
  const confirm = useConfirm();
  const { confirmStock, submitSale, saveForLater } = useSellActions();
  const [cartOpen, setCartOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [customFor, setCustomFor] = useState<ProductRec | null>(null);
  const [busy, setBusy] = useState(false);
  /** The sale just completed (its id), for "Copy receipt". */
  const [lastSale, setLastSale] = useState<string | null>(null);
  const toast = useToast();

  // Links from the Dashboard and the In-person orders page: ?saved=1 opens the saved list, ?cart=1 the cart.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("saved")) setSavedOpen(true);
    if (q.get("cart")) setCartOpen(true);
    if (q.get("saved") || q.get("cart")) window.history.replaceState(null, "", "/admin/sell");
  }, []);

  if (!s || !cart.ready) return <PageSkeleton />;
  const { data, ledger } = s;
  const products = data.products.filter((p) => !p.archived);
  const groups = sellGroups(data);
  const { draft } = cart;
  const count = lineCount(draft);
  const totals = orderTotals(draft);
  const savedCount = data.savedOrders.length;
  /** The saved order now open in the cart, if any. Saving updates it, completing removes it. */
  const editingSaved = data.savedOrders.find((o) => o.id === draft.id) ?? null;

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
    if (!(await confirmStock(draft.lines, draft.id))) return;
    setBusy(true);
    setCartOpen(false);
    cart.reset();
    const final = await submitSale(draft);
    setBusy(false);
    if (!final) cart.setDraft(draft); // give the order back so nothing is lost
    else setLastSale(final.id);
  }

  async function copyReceipt(id: string) {
    const o = data.orders.find((x) => x.id === id);
    if (!o) return;
    const text = receiptText(o, { storeName: data.store.storeName, ownerName: o.owner ? s!.name(o.owner) : undefined });
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older browsers: copy through a hidden text box.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast.show({ message: "Receipt copied. Paste it into a text message.", tone: "success" });
  }

  /** Put the cart aside as a saved order. No stock or money change. */
  async function saveLater() {
    if (draft.lines.length === 0 || busy) return;
    setBusy(true);
    setCartOpen(false);
    cart.reset();
    const ok = await saveForLater(draft);
    setBusy(false);
    if (!ok) cart.setDraft(draft);
  }

  return (
    <div>
      <PageHeader
        title="Sell"
        sub={products.length ? <span className="hidden sm:inline">Tap a size to add it to the order</span> : undefined}
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setSavedOpen(true)} data-saved-orders-button>
              <Bookmark size={18} /> Saved orders ({savedCount})
            </Button>
            <Button variant="primary" onClick={newOrder}>
              <Plus size={18} /> New order
            </Button>
          </div>
        }
      />

      {/* On phones the two header buttons need the row, so the hint sits on its own line. */}
      {products.length > 0 && <p className="-mt-3 mb-4 text-sm text-muted sm:hidden">Tap a size to add it to the order</p>}

      <TodayCard />

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
        // One card per product, its sizes together inside it, in the same order as the store.
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.name} data-sell-product={g.name} className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface">
              <div className="flex items-center gap-3 border-b border-line px-3.5 py-3">
                {g.photoId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/media/${g.photoId}-480.webp`} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-xl bg-surface2 object-cover" />
                ) : (
                  <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white" style={{ background: colorHex(g.color) }}>
                    {g.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base font-semibold leading-snug">{g.name}</h2>
                  <div className="text-xs text-muted">{g.variants.length > 1 ? `${g.variants.length} sizes` : "1 size"}</div>
                </div>
              </div>
              <ul className="divide-y divide-line">
                {g.variants.map((p) => {
                  const n = inCart(p.id);
                  // Stock already has the open saved order's units taken out: count only what the cart adds.
                  const stock = (ledger.stock.get(p.id)?.stock ?? 0) - n + heldBy(editingSaved, p.id);
                  const stockTone = stock <= 0 ? "text-neg" : stock <= threshold(p) ? "text-warn" : "text-muted";
                  const label = sellVariantLabel(g, p);
                  return (
                    <li key={p.id} data-sell-variant={p.name} className="px-3.5 py-3">
                      {/* Line 1: which size and how many are left. Line 2: the two buttons, full width, so nothing is cut off. */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorHex(p.color) }} />
                          <span className="text-[15px] font-semibold" data-sell-size>
                            {label || "One size"}
                            {p.vialVolume.trim() && <span className="ml-1.5 text-sm font-normal text-muted">{p.vialVolume.trim()}</span>}
                          </span>
                          {n > 0 && (
                            <span className="flex h-6 min-w-6 shrink-0 animate-pop-in items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-ink" aria-label={`${n} in the current order`}>
                              {n}
                            </span>
                          )}
                        </div>
                        <div className={cx("shrink-0 whitespace-nowrap text-sm tabular-nums", stockTone)}>
                          {stock} in stock{stock <= 0 ? "" : stock <= threshold(p) ? " · low" : ""}
                        </div>
                      </div>
                      <div className="mt-2.5 flex gap-2">
                        <button
                          type="button"
                          onClick={() => setCustomFor(p)}
                          aria-label={`Sell ${p.name} at another price`}
                          className="flex h-12 flex-1 items-center justify-center whitespace-nowrap rounded-xl border border-line px-3 text-sm font-medium text-muted transition hover:bg-surface2 hover:text-ink active:scale-[.97]"
                        >
                          Other price
                        </button>
                        <button
                          type="button"
                          onClick={() => cart.addProduct(p, p.defaultPriceCents)}
                          aria-label={`Sell 1 ${p.name} for ${fmtMoney(p.defaultPriceCents, { compact: true })}`}
                          className="flex h-12 flex-[1.5] items-center justify-center whitespace-nowrap rounded-xl bg-accent px-3.5 text-[15px] font-semibold tabular-nums text-accent-ink transition hover:brightness-110 active:scale-[.97]"
                        >
                          Sell 1 · {fmtMoney(p.defaultPriceCents, { compact: true })}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* Room so the last product card is never hidden behind the order bar */}
      {count > 0 && <div aria-hidden className="h-24" />}

      {/* Just completed: copy a receipt to paste into a text message */}
      {count === 0 && lastSale && data.orders.some((o) => o.id === lastSale) && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-30 animate-toast-in px-3 md:bottom-24 md:left-60 md:px-8" data-last-sale>
          <div className="mx-auto flex min-h-16 w-full max-w-2xl items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2 shadow-xl">
            <div className="min-w-0 flex-1 text-sm">
              <div className="font-semibold">
                Sale complete{(() => {
                  const o = data.orders.find((x) => x.id === lastSale);
                  return o?.number ? ` · #${o.number}` : "";
                })()}
              </div>
              <div className="text-muted">{fmtMoney(ledger.orders.get(lastSale)?.total ?? 0)}</div>
            </div>
            <Button variant="primary" className="h-11" onClick={() => copyReceipt(lastSale)} data-copy-receipt>
              <Copy size={17} /> Copy receipt
            </Button>
            <button type="button" aria-label="Close" onClick={() => setLastSale(null)} className="flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-surface2">
              <X size={18} />
            </button>
          </div>
        </div>
      )}

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
        title={draft.owner ? `Owner purchase · ${s.name(draft.owner)}` : editingSaved ? "Saved order" : "Current order"}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button size="lg" className="sm:flex-1" disabled={draft.lines.length === 0 || busy} onClick={saveLater}>
              Save for later
            </Button>
            <Button variant="primary" size="lg" className="sm:flex-[1.7]" disabled={draft.lines.length === 0 || busy} onClick={complete}>
              {draft.owner ? "Complete at cost" : "Complete order"} · {fmtMoney(totals.total)}
            </Button>
          </div>
        }
      >
        {editingSaved && (
          <div className="mb-4 rounded-xl bg-accent/10 px-3.5 py-2.5 text-sm">
            This is a saved order. “Save for later” keeps your changes, “Complete order” finishes it.
            <PriceChangeNotes order={editingSaved} className="mt-1.5" />
          </div>
        )}
        <OrderForm mode="cart" draft={draft} onChange={cart.setDraft} />
      </Sheet>

      <Sheet open={savedOpen} onClose={() => setSavedOpen(false)} title={`Saved orders (${savedCount})`} aside={<SavedOrdersSummary />} wide>
        <SavedOrdersList
          onOpened={() => {
            setSavedOpen(false);
            setCartOpen(true);
          }}
        />
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

/** Today on the Sell screen: in-person sales, revenue and profit by seller and by payment method, cash per person. */
function TodayCard() {
  const s = useLoaded();
  const [open, setOpen] = useState(false);
  if (!s) return null;
  const { data, ledger, name } = s;
  const t = todaySummary(data, ledger);
  if (t.count === 0 && t.owner.count === 0) return null;
  const cell = "px-2 py-2 text-right tabular-nums";
  return (
    <section data-today className="mb-4 rounded-2xl border border-line bg-surface">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left">
        <CalendarDays size={18} className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1 text-sm">
          <span className="font-semibold">Today</span>
          <span className="text-muted">
            {" "}
            · {plural(t.count, "sale")} · <span className="font-medium text-ink">{fmtMoney(t.revenue)}</span> revenue · <span className="font-medium text-pos">{fmtMoney(t.profit)}</span> profit
          </span>
        </span>
        <ChevronDown size={18} className={cx("shrink-0 text-muted transition", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-line px-4 pb-4 pt-3 text-sm">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted">
                <th className="py-1.5 font-medium">By seller</th>
                <th className="px-2 py-1.5 text-right font-medium">Sales</th>
                <th className="px-2 py-1.5 text-right font-medium">Revenue</th>
                <th className="py-1.5 pl-2 text-right font-medium">Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(["A", "B"] as const).map((p) => (
                <tr key={p} data-today-seller={p}>
                  <td className="py-2 font-medium">{name(p)}</td>
                  <td className={cell}>{t.bySeller[p].count}</td>
                  <td className={cell}>{fmtMoney(t.bySeller[p].revenue)}</td>
                  <td className="py-2 pl-2 text-right tabular-nums text-pos">{fmtMoney(t.bySeller[p].profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {t.byMethod.length > 0 && (
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted">
                  <th className="py-1.5 font-medium">By payment</th>
                  <th className="px-2 py-1.5 text-right font-medium">Sales</th>
                  <th className="px-2 py-1.5 text-right font-medium">Revenue</th>
                  <th className="py-1.5 pl-2 text-right font-medium">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {t.byMethod.map((m) => (
                  <tr key={m.method}>
                    <td className="py-2 font-medium">{m.method}</td>
                    <td className={cell}>{m.count}</td>
                    <td className={cell}>{fmtMoney(m.revenue)}</td>
                    <td className="py-2 pl-2 text-right tabular-nums text-pos">{fmtMoney(m.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="flex flex-wrap gap-2" data-today-cash>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted">Cash received</span>
            {(["A", "B"] as const).map((p) => (
              <span key={p} className="rounded-full bg-surface2 px-3 py-1 font-medium tabular-nums">
                {name(p)} {fmtMoney(t.cash[p])}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted">
            Revenue is after discounts, before tips. Profit includes tips.
            {t.owner.count > 0 ? ` Not included: ${plural(t.owner.count, "owner purchase")} (${fmtMoney(t.owner.costCents)} at cost).` : ""}
          </p>
        </div>
      )}
    </section>
  );
}
