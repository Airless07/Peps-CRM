// Turn any backup file (old or new format) into a complete AppData.
// Old backups (version 1, before customers and payment methods) still import:
// orders get "Unknown" as payment method and customers are rebuilt from order names.
import { groupCustomersFromOrders } from "./customers";
import { uid } from "./format";
import type { AppData, CustomerRec, OrderRec } from "./types";
import { DEFAULT_SETTINGS, UNKNOWN_PAYMENT } from "./types";

export const BACKUP_VERSION = 2;

type Loose = Record<string, unknown>;

export function cleanPaymentMethods(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? safeJson(v) : null;
  if (!Array.isArray(list)) return [...DEFAULT_SETTINGS.paymentMethods];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of list) {
    if (typeof x !== "string") continue;
    const name = x.trim().slice(0, 40);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out.length ? out : [...DEFAULT_SETTINGS.paymentMethods];
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function normalizeBackup(raw: Loose & { orders: Loose[] }, makeId: () => string = uid): AppData {
  const data = raw as unknown as AppData & { customers?: CustomerRec[] };
  const settings = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
  settings.paymentMethods = cleanPaymentMethods((data.settings as unknown as Loose | undefined)?.paymentMethods);

  let orders: OrderRec[] = (data.orders ?? []).map((o) => ({
    ...o,
    customer: typeof o.customer === "string" ? o.customer : "",
    customerId: typeof o.customerId === "string" && o.customerId ? o.customerId : null,
    paymentMethod: typeof o.paymentMethod === "string" && o.paymentMethod.trim() ? o.paymentMethod.trim() : UNKNOWN_PAYMENT,
  }));

  let customers: CustomerRec[];
  if (Array.isArray(data.customers)) {
    customers = data.customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone ?? "",
      notes: c.notes ?? "",
      createdAt: c.createdAt ?? new Date().toISOString(),
    }));
    const byId = new Map(customers.map((c) => [c.id, c]));
    // Never leave an order pointing at a customer that isn't in the file.
    orders = orders.map((o) => {
      const c = o.customerId ? byId.get(o.customerId) : undefined;
      return c ? { ...o, customer: c.name } : { ...o, customerId: null };
    });
  } else {
    const g = groupCustomersFromOrders(orders, makeId);
    customers = g.customers;
    const byId = new Map(customers.map((c) => [c.id, c]));
    orders = orders.map((o) => {
      const cid = g.links.get(o.id);
      return cid ? { ...o, customerId: cid, customer: byId.get(cid)!.name } : { ...o, customerId: null };
    });
  }

  return {
    settings,
    products: data.products ?? [],
    customers,
    purchases: data.purchases ?? [],
    adjustments: data.adjustments ?? [],
    orders,
    splits: data.splits ?? [],
    payouts: data.payouts ?? [],
  };
}
