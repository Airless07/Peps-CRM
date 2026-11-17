// Low stock alert: when a sale or a stock adjustment takes a size from above its low stock
// warning level to at or below it, the alert emails are told once. "Crossing" is worked out by
// comparing stock before and after the change, so nothing extra is stored and a size that is
// already low does not alert again on every sale.
import { lowStockEmail, sendEmail, type EmailOutcome } from "./email";
import { computeLedger, type Ledger } from "./money";
import { siteUrl } from "./order-ops";
import { loadAll } from "./serialize";
import type { AppData } from "./types";

export interface LowStockItem {
  id: string;
  name: string;
  stock: number;
  lowAt: number;
}

/** Sizes whose stock went from above the warning level to at or below it. Pure. */
export function lowStockCrossings(data: Pick<AppData, "products" | "settings">, before: Ledger, after: Ledger): LowStockItem[] {
  const out: LowStockItem[] = [];
  for (const p of data.products) {
    if (p.archived) continue;
    const was = before.stock.get(p.id);
    if (!was) continue; // new product: nothing to compare with
    const now = after.stock.get(p.id)?.stock ?? 0;
    const lowAt = p.lowStockThreshold ?? data.settings.lowStockThreshold;
    if (was.stock > lowAt && now <= lowAt) out.push({ id: p.id, name: p.name, stock: now, lowAt });
  }
  return out.sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name));
}

/**
 * Run something that changes stock (a sale, mark paid, an adjustment) and email the alert list
 * about every size it pushed down to its low stock level. The change itself never fails because
 * of the alert: a problem with the email is logged and swallowed.
 */
export async function withLowStockAlert<T>(run: () => Promise<T>, origin?: string): Promise<T> {
  let before: Ledger | null = null;
  try {
    before = computeLedger(await loadAll());
  } catch (e) {
    console.error("[low stock] could not read stock before the change", e);
  }
  const result = await run();
  if (before) {
    try {
      await sendLowStockAlert(before, origin);
    } catch (e) {
      console.error("[low stock] alert failed", e);
    }
  }
  return result;
}

export async function sendLowStockAlert(before: Ledger, origin?: string): Promise<{ items: LowStockItem[]; outcome: EmailOutcome | null }> {
  const data = await loadAll();
  const items = lowStockCrossings(data, before, computeLedger(data));
  if (items.length === 0 || !data.store.lowStockAlerts || data.store.alertEmails.length === 0) return { items, outcome: null };
  const outcome = await sendEmail(data.store, data.store.alertEmails, lowStockEmail(data.store, items, `${siteUrl(data.store, origin)}/admin/inventory`));
  return { items, outcome };
}
