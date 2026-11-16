"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { draftPayload, draftToOrder, orderToDraft, resolveDraftCustomer, type Draft } from "@/lib/draft";
import { splitOrderIds } from "@/lib/money";
import { api, useLoaded } from "./store";
import { useToast } from "./toast";
import { Button, Sheet, useConfirm } from "./ui";
import { OrderForm } from "./order-form";

export function OrderEditSheet({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const s = useLoaded();
  const confirm = useConfirm();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const order = s?.data.orders.find((o) => o.id === orderId) ?? null;
  const online = order?.source === "online";

  useEffect(() => {
    if (orderId && order) setDraft(orderToDraft(order));
    // only when opening a different order
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  if (!s) return null;
  const wasSplit = !!orderId && splitOrderIds(s.data).has(orderId);

  async function save() {
    if (!draft || !order) return;
    if (draft.lines.length === 0) {
      toast.show({ message: "An order needs at least one item. Delete it instead.", tone: "error" });
      return;
    }
    const { draft: d, created } = resolveDraftCustomer(draft, s!.data.customers);
    onClose();
    const ok = await s!.mutate(
      (data) => ({
        ...data,
        customers: created ? [...data.customers, created] : data.customers,
        orders: data.orders.map((o) => (o.id === d.id ? draftToOrder(d, o.createdAt, o) : o)),
      }),
      () => api(`/api/orders/${d.id}`, "PUT", draftPayload(d)),
    );
    if (ok) toast.show({ message: wasSplit ? "Order saved. The difference goes to the next split." : "Order saved" });
  }

  async function remove() {
    if (!order) return;
    const ok = await confirm({
      title: "Delete this order?",
      body: wasSplit
        ? "This order was already split. Deleting it adds a negative adjustment to the next split. Stock is returned."
        : "Stock is returned and every balance is recalculated.",
      confirmText: "Delete order",
      danger: true,
    });
    if (!ok) return;
    onClose();
    await s!.mutate(
      (data) => ({ ...data, orders: data.orders.filter((o) => o.id !== order.id) }),
      () => api(`/api/orders/${order.id}`, "DELETE"),
    );
  }

  return (
    <Sheet
      open={!!orderId && !!draft}
      onClose={onClose}
      title="Edit order"
      footer={
        <div className="flex gap-2">
          {!online && (
            <Button variant="ghost" className="text-neg" onClick={remove} aria-label="Delete order">
              <Trash2 size={18} />
            </Button>
          )}
          <Button block onClick={onClose}>
            Cancel
          </Button>
          <Button block variant="primary" onClick={save}>
            Save
          </Button>
        </div>
      }
    >
      {wasSplit && (
        <div className="mb-5 flex gap-3 rounded-xl bg-warn/12 px-4 py-3 text-sm text-warn">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <span>This order was already split. Any change in the partners’ share is added as an adjustment to the next split.</span>
        </div>
      )}
      {draft && <OrderForm mode="edit" draft={draft} onChange={setDraft} />}
    </Sheet>
  );
}
