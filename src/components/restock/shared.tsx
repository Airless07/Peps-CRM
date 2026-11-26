"use client";

// Restock order pieces used by Inventory > Restock history and Money > Expenses.
import Link from "next/link";
import { ChevronDown, Paperclip, Pencil, Trash2 } from "lucide-react";
import { api, useLoaded } from "../store";
import { useToast } from "../toast";
import { Badge, cx, useConfirm } from "../ui";
import { dayKey, fmtDay, fmtMoney } from "@/lib/format";
import type { AppData, ProductRec, PurchaseRec, RestockOrderRec } from "@/lib/types";
import type { Ledger } from "@/lib/money";

/** "Retatrutide 10mg": the size only when the name doesn't already end with it. */
export const productLabel = (p: Pick<ProductRec, "name" | "variantLabel">) =>
  !p.variantLabel || p.name.toLowerCase().endsWith(p.variantLabel.toLowerCase()) ? p.name : `${p.name} ${p.variantLabel}`;

export const restockLines = (data: AppData, id: string): PurchaseRec[] =>
  data.purchases.filter((p) => p.restockOrderId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

export const restockTotal = (data: AppData, id: string) => restockLines(data, id).reduce((a, l) => a + l.totalCostCents, 0);

/** Sizes whose stock would go below 0 without this order (its units were already sold). */
export function stockWarnings(data: AppData, ledger: Ledger, id: string): string[] {
  const by = new Map<string, number>();
  for (const l of restockLines(data, id)) by.set(l.productId, (by.get(l.productId) ?? 0) + l.quantity);
  const out: string[] = [];
  for (const [pid, qty] of by) {
    const now = ledger.stock.get(pid)?.stock ?? 0;
    if (now - qty < 0) {
      const p = data.products.find((x) => x.id === pid);
      out.push(`${p ? productLabel(p) : "Deleted product"}: ${now} → ${now - qty}`);
    }
  }
  return out;
}

/** Delete with a confirm that says what reverses, and warns when stock would go negative. */
export function useDeleteRestock() {
  const s = useLoaded();
  const confirm = useConfirm();
  const toast = useToast();
  return async (r: RestockOrderRec): Promise<boolean> => {
    if (!s) return false;
    const { data, ledger, name, mutate } = s;
    const total = restockTotal(data, r.id);
    const warn = stockWarnings(data, ledger, r.id);
    const ok = await confirm({
      title: `Delete "${r.name}"?`,
      body: `Its stock comes off, each size's cost per vial goes back, and business money and ${name(r.paidBy)}'s cash held go back up by ${fmtMoney(total)}.${
        warn.length ? ` Warning: some of these units were already sold, so stock would go negative (${warn.join(", ")}).` : ""
      } The change stays in the history.`,
      confirmText: "Delete restock",
      danger: true,
    });
    if (!ok) return false;
    const done = await mutate(
      (d) => ({ ...d, restockOrders: (d.restockOrders ?? []).filter((x) => x.id !== r.id), purchases: d.purchases.filter((p) => p.restockOrderId !== r.id) }),
      () => api(`/api/restocks/${r.id}`, "DELETE"),
    );
    if (done) toast.show({ message: `"${r.name}" deleted · ${fmtMoney(total)} back in business money`, tone: "success" });
    return done;
  };
}

/** One restock order that expands to its lines. */
export function RestockOrderRow({ r, from }: { r: RestockOrderRec; from?: "expenses" }) {
  const s = useLoaded();
  const remove = useDeleteRestock();
  if (!s) return null;
  const { data, name } = s;
  const lines = restockLines(data, r.id);
  const total = lines.reduce((a, l) => a + l.totalCostCents, 0);
  const vials = lines.reduce((a, l) => a + l.quantity, 0);
  const label = (id: string) => {
    const p = data.products.find((x) => x.id === id);
    return p ? productLabel(p) : "Deleted product";
  };
  return (
    <details className="group" data-restock-row={r.id}>
      <summary className="flex min-h-14 cursor-pointer list-none items-start gap-3 px-4 py-3 text-sm">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">Restock: {r.name}</span>
            <Badge tone="accent">Restock</Badge>
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {fmtDay(dayKey(r.date))} · {lines.length} {lines.length === 1 ? "line" : "lines"}, {vials} vials · paid by <span className="font-medium text-ink">{name(r.paidBy)}</span>
            {r.supplier ? ` · ${r.supplier}` : ""}
            {r.lot ? ` · lot ${r.lot}` : ""}
          </div>
        </div>
        <span className="font-semibold tabular-nums">{fmtMoney(total)}</span>
        <ChevronDown size={16} className="mt-0.5 shrink-0 text-muted transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-line bg-surface2/40 px-4 py-2 text-sm">
        <ul className="divide-y divide-line">
          {lines.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="font-medium">{label(l.productId)}</span>
                <span className="text-muted">
                  {" "}
                  · {l.quantity} {l.quantity === 1 ? "vial" : "vials"}{l.listCents === 0 ? " · free" : ` · ${fmtMoney(Math.round(l.totalCostCents / l.quantity))}/vial`}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">{fmtMoney(l.totalCostCents)}</span>
            </li>
          ))}
        </ul>
        {r.notes && <p className="py-2 text-xs text-muted">{r.notes}</p>}
        <div className="flex flex-wrap items-center gap-2 py-2">
          {r.file && (
            <a href={`/api/expenses/file/${encodeURIComponent(r.file)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-1 text-xs font-medium text-accent">
              <Paperclip size={13} /> {r.fileName || "Invoice"}
            </a>
          )}
          <span className="flex-1" />
          <Link href={`/admin/inventory/restock?edit=${r.id}${from ? `&from=${from}` : ""}`} className={cx("inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium hover:bg-surface2")} data-edit-restock>
            <Pencil size={15} /> Edit
          </Link>
          <button type="button" onClick={() => remove(r)} className="inline-flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-neg hover:bg-surface2" data-delete-restock>
            <Trash2 size={15} /> Delete
          </button>
        </div>
      </div>
    </details>
  );
}
