"use client";

// Saved (open) in-person orders: the list with Open / Complete / Delete, and the actions the
// Sell screen shares with it. A saved order changes nothing until it is completed; completing it
// runs the exact same steps as a sale from the cart (finalizeSale + POST /api/orders).
import { useState } from "react";
import { Bookmark } from "lucide-react";
import { useCart } from "@/components/cart";
import { api, useLoaded } from "@/components/store";
import { useToast } from "@/components/toast";
import { Button, Empty, Row, Sheet, cx, useConfirm } from "@/components/ui";
import { draftPayload, draftToOrder, lineCount, type Draft } from "@/lib/draft";
import { fmtDateTime, fmtMoney, plural } from "@/lib/format";
import { orderTotals } from "@/lib/money";
import { finalizeSale, heldBy, priceChanges, savedItemsText, savedToDraft, savedTotals, stockShortfalls, toSavedOrder } from "@/lib/saved-orders";
import type { SavedOrderRec } from "@/lib/types";

/** Actions shared by the Sell cart and the saved orders list. */
export function useSellActions() {
  const s = useLoaded();
  const cart = useCart();
  const confirm = useConfirm();
  const toast = useToast();

  /** Warn when the sale would push any size below zero stock. Resolves false when the user backs out. */
  async function confirmStock(lines: Draft["lines"], savedId?: string): Promise<boolean> {
    if (!s) return false;
    // Completing a saved order: its own held units are available to it.
    const saved = savedId ? s.data.savedOrders.find((o) => o.id === savedId) : null;
    const short = stockShortfalls(lines, (pid) => (s.ledger.stock.get(pid)?.stock ?? 0) + heldBy(saved, pid));
    if (short.length === 0) return true;
    return confirm({
      title: "Not enough stock",
      body: `${short.join(", ")} will go below zero. Complete the order anyway?`,
      confirmText: "Complete anyway",
    });
  }

  /** Record the sale. When the draft is a saved order, that saved order is removed with it. */
  async function submitSale(draft: Draft): Promise<boolean> {
    if (!s || draft.lines.length === 0) return false;
    const { data, ledger, mutate } = s;
    const saved = data.savedOrders.find((o) => o.id === draft.id) ?? null;
    const { final, created } = finalizeSale(draft, {
      customers: data.customers,
      unitCost: (pid) => ledger.stock.get(pid)?.unitCost,
      cutPercent: data.settings.businessCutPercent,
    });
    if (final.soldBy !== "W") cart.rememberSeller(final.soldBy);
    cart.rememberPayment(final.paymentMethod);
    const ok = await mutate(
      (d) => ({
        ...d,
        customers: created ? [...d.customers, created] : d.customers,
        orders: [draftToOrder(final), ...d.orders],
        savedOrders: d.savedOrders.filter((o) => o.id !== final.id),
      }),
      () => api("/api/orders", "POST", { ...draftPayload(final), fromSavedId: saved ? saved.id : null }),
    );
    if (!ok) return false;
    toast.show({
      message: `Order saved · ${fmtMoney(orderTotals(final).total)}`,
      action: {
        label: "Undo",
        onClick: () =>
          mutate(
            (d) => ({ ...d, orders: d.orders.filter((o) => o.id !== final.id), savedOrders: saved ? [saved, ...d.savedOrders] : d.savedOrders }),
            async () => {
              await api(`/api/orders/${final.id}`, "DELETE");
              // Undoing the completion of a saved order puts it back in the saved list.
              if (saved) await api("/api/saved-orders", "POST", saved);
            },
          ).then((undone) => undone && toast.show({ message: saved ? "Order undone and saved again" : "Order undone" })),
      },
      duration: 5000,
    });
    return true;
  }

  /** Put the cart aside. Stock and money do not change. */
  async function saveForLater(draft: Draft): Promise<boolean> {
    if (!s || draft.lines.length === 0) return false;
    const { data, mutate } = s;
    const rec = toSavedOrder(draft, data.products, data.savedOrders.find((o) => o.id === draft.id));
    const ok = await mutate(
      (d) => ({ ...d, savedOrders: [rec, ...d.savedOrders.filter((o) => o.id !== rec.id)] }),
      () => api("/api/saved-orders", "POST", rec),
    );
    if (ok) toast.show({ message: "Saved for later. Stock and money are unchanged." });
    return ok;
  }

  async function deleteSaved(o: SavedOrderRec): Promise<boolean> {
    if (!s) return false;
    const ok = await confirm({
      title: "Delete this saved order?",
      body: `${o.customer || "No customer"} · ${plural(lineCount(o), "item")} · ${fmtMoney(savedTotals(o).total)}. It was never completed, so stock and money stay as they are.`,
      confirmText: "Delete",
      danger: true,
    });
    if (!ok) return false;
    const done = await s.mutate(
      (d) => ({ ...d, savedOrders: d.savedOrders.filter((x) => x.id !== o.id) }),
      () => api(`/api/saved-orders/${o.id}`, "DELETE"),
    );
    if (done) toast.show({ message: "Saved order deleted" });
    return done;
  }

  return { confirmStock, submitSale, saveForLater, deleteSaved };
}

/** Small note for each line whose product has a different regular price now. The saved price is what gets charged. */
export function PriceChangeNotes({ order, className }: { order: Pick<SavedOrderRec, "lines">; className?: string }) {
  const s = useLoaded();
  if (!s) return null;
  const changes = priceChanges(order, s.data.products);
  if (changes.length === 0) return null;
  return (
    <ul data-price-note className={cx("space-y-0.5 text-xs text-warn", className)}>
      {changes.map((c) => (
        <li key={c.lineId}>
          {c.productName}: the regular price is now {fmtMoney(c.nowCents)} (was {fmtMoney(c.wasCents)} when saved). This order keeps {fmtMoney(c.savedCents)}.
        </li>
      ))}
    </ul>
  );
}

const chip = "h-11 rounded-xl border px-3.5 text-sm font-medium transition active:scale-95";

/** Every saved order with Open, Complete and Delete. `onOpened` runs after one is loaded into the cart. */
export function SavedOrdersList({ onOpened }: { onOpened?: () => void }) {
  const s = useLoaded();
  const cart = useCart();
  const confirm = useConfirm();
  const { confirmStock, submitSale, deleteSaved } = useSellActions();
  const [completing, setCompleting] = useState<SavedOrderRec | null>(null);
  const [method, setMethod] = useState("");
  const [busy, setBusy] = useState(false);
  if (!s) return null;
  const { data, name } = s;
  const saved = data.savedOrders;
  const methods = data.settings.paymentMethods;

  async function open(o: SavedOrderRec) {
    const { draft } = cart;
    if (draft.lines.length > 0 && draft.id !== o.id) {
      const ok = await confirm({
        title: "Replace the current order?",
        body: `The cart has ${plural(lineCount(draft), "item")} totaling ${fmtMoney(orderTotals(draft).total)}. Opening this saved order discards them. Save the cart for later first if you want to keep it.`,
        confirmText: "Open saved order",
        danger: true,
      });
      if (!ok) return;
    }
    cart.setDraft(savedToDraft(o, draft.paymentMethod));
    onOpened?.();
  }

  function askComplete(o: SavedOrderRec) {
    setMethod(methods.includes(o.paymentMethod) ? o.paymentMethod : methods.includes(cart.draft.paymentMethod) ? cart.draft.paymentMethod : "");
    setCompleting(o);
  }

  async function complete() {
    const o = completing;
    if (!o || !method || busy) return;
    if (!(await confirmStock(o.lines, o.id))) return;
    setBusy(true);
    const ok = await submitSale({ ...savedToDraft(o, method), paymentMethod: method });
    setBusy(false);
    if (!ok) return;
    setCompleting(null);
    // The same order may be open in the cart: it is done now, so the cart starts fresh.
    if (cart.draft.id === o.id) cart.reset();
  }

  if (saved.length === 0) {
    return <Empty icon={<Bookmark size={32} />} title="No saved orders" body="On the Sell screen, tap “Save for later” in the cart to put an order aside. It changes no stock or money until you complete it." />;
  }

  const total = completing ? savedTotals(completing) : null;
  return (
    <div>
      <ul className="space-y-3">
        {saved.map((o) => {
          const t = savedTotals(o);
          const inCart = cart.draft.id === o.id && cart.draft.lines.length > 0;
          return (
            <li key={o.id} data-saved-order={o.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{o.customer || "No customer"}</div>
                  <div className="mt-0.5 text-sm text-muted">{savedItemsText(o)}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    Saved {fmtDateTime(o.savedAt)} · {name(o.soldBy)}
                    {o.note ? ` · ${o.note}` : ""}
                    {inCart ? " · open in the cart" : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right text-sm tabular-nums">
                  <div className="text-base font-semibold">{fmtMoney(t.total)}</div>
                  {t.discount > 0 && <div className="text-neg">-{fmtMoney(t.discount)}</div>}
                  {t.tip > 0 && <div className="text-pos">+{fmtMoney(t.tip)} tip</div>}
                </div>
              </div>
              <PriceChangeNotes order={o} className="mt-2" />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => open(o)} aria-label={`Open saved order for ${o.customer || "no customer"}`}>
                  Open
                </Button>
                <Button variant="primary" onClick={() => askComplete(o)} aria-label={`Complete saved order for ${o.customer || "no customer"}`}>
                  Complete
                </Button>
                <Button variant="ghost" className="ml-auto text-neg" onClick={() => deleteSaved(o)} aria-label={`Delete saved order for ${o.customer || "no customer"}`}>
                  Delete
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <Sheet
        open={!!completing}
        onClose={() => setCompleting(null)}
        title="Complete saved order"
        footer={
          <Button variant="primary" size="lg" block disabled={!method || busy} onClick={complete}>
            Complete order{total ? ` · ${fmtMoney(total.total)}` : ""}
          </Button>
        }
      >
        {completing && total && (
          <div className="space-y-5">
            <div>
              <div className="font-semibold">{completing.customer || "No customer"}</div>
              <div className="mt-0.5 text-sm text-muted">{savedItemsText(completing)}</div>
              <PriceChangeNotes order={completing} className="mt-2" />
            </div>
            <div>
              <span className="mb-2 block text-sm font-medium text-muted">How did they pay?</span>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Payment method">
                {methods.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={method === m}
                    className={cx(chip, method === m ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface text-ink hover:bg-surface2")}
                    onClick={() => setMethod(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-2xl bg-surface2/70 px-4 py-3">
              <Row label="Subtotal">{fmtMoney(total.subtotal)}</Row>
              {total.discount > 0 && (
                <Row label={<span className="text-neg">Discount{completing.discountType === "%" ? ` (${completing.discountValue}%)` : ""}</span>}>
                  <span className="text-neg">-{fmtMoney(total.discount)}</span>
                </Row>
              )}
              {total.tip > 0 && <Row label="Tip">{fmtMoney(total.tip)}</Row>}
              <div className="my-1.5 border-t border-line" />
              <Row label="Total" strong>
                {fmtMoney(total.total)}
              </Row>
            </div>
            <p className="text-xs text-muted">Completing drops stock and counts the money now, exactly like a sale from the cart. Prices and discount stay as saved.</p>
          </div>
        )}
      </Sheet>
    </div>
  );
}
