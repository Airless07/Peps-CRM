// Pure customer helpers shared by the server (migration of backups, merge) and the client
// (optimistic updates, autocomplete). No database access here.
import { uid } from "./format";
import type { AppData, CustomerRec, OrderRec } from "./types";

/** How two names are matched: trimmed and case-insensitive ("mike" == "Mike "). */
export const customerKey = (name: string) => name.trim().toLowerCase();

const time = (iso: string) => new Date(iso).getTime();

/**
 * Build one customer per distinct order name (same rules as the database migration):
 * trimmed, matched case-insensitively, spelling taken from the most recent order,
 * createdAt = the first order's date. Orders with no name get no customer.
 */
export function groupCustomersFromOrders(
  orders: Pick<OrderRec, "id" | "date" | "createdAt" | "customer">[],
  makeId: () => string = uid,
): { customers: CustomerRec[]; links: Map<string, string> } {
  const groups = new Map<string, { latest: (typeof orders)[number]; first: string; orderIds: string[] }>();
  for (const o of orders) {
    const key = customerKey(o.customer ?? "");
    if (!key) continue;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { latest: o, first: o.date, orderIds: [o.id] });
      continue;
    }
    g.orderIds.push(o.id);
    if (time(o.date) < time(g.first)) g.first = o.date;
    const newer =
      time(o.date) - time(g.latest.date) ||
      time(o.createdAt) - time(g.latest.createdAt) ||
      (o.id > g.latest.id ? 1 : -1);
    if (newer > 0) g.latest = o;
  }
  const customers: CustomerRec[] = [];
  const links = new Map<string, string>();
  for (const g of groups.values()) {
    const id = makeId();
    customers.push({ id, name: g.latest.customer.trim(), phone: "", email: "", hasAccount: false, addresses: [], notes: "", createdAt: new Date(g.first).toISOString() });
    for (const oid of g.orderIds) links.set(oid, id);
  }
  return { customers, links };
}

/** Phone/notes after merging `from` into `into`: keep the target's, fill gaps from the duplicate. */
export function mergedFields(into: Pick<CustomerRec, "phone" | "notes">, from: Pick<CustomerRec, "phone" | "notes">) {
  const phone = into.phone.trim() || from.phone.trim();
  const a = into.notes.trim();
  const b = from.notes.trim();
  const notes = !b || a.includes(b) ? a : a ? `${a}\n${b}` : b;
  return { phone, notes };
}

/** Merge customer `fromId` into `intoId`: moves all orders, then removes the duplicate. */
export function mergeCustomersData(data: AppData, fromId: string, intoId: string): AppData {
  const into = data.customers.find((c) => c.id === intoId);
  const from = data.customers.find((c) => c.id === fromId);
  if (!into || !from || fromId === intoId) return data;
  const merged = { ...into, ...mergedFields(into, from) };
  return {
    ...data,
    customers: data.customers.filter((c) => c.id !== fromId).map((c) => (c.id === intoId ? merged : c)),
    orders: data.orders.map((o) => (o.customerId === fromId ? { ...o, customerId: intoId, customer: merged.name } : o)),
  };
}

/** Delete a customer locally: their orders are unlinked, never deleted. */
export function deleteCustomerData(data: AppData, id: string): AppData {
  return {
    ...data,
    customers: data.customers.filter((c) => c.id !== id),
    orders: data.orders.map((o) => (o.customerId === id ? { ...o, customerId: null } : o)),
  };
}

/** Rename/edit locally: the linked orders' name snapshot follows. */
export function updateCustomerData(data: AppData, id: string, patch: Partial<Omit<CustomerRec, "id" | "createdAt">>): AppData {
  return {
    ...data,
    customers: data.customers.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    orders:
      patch.name !== undefined ? data.orders.map((o) => (o.customerId === id ? { ...o, customer: patch.name! } : o)) : data.orders,
  };
}

/** Customers matching a search on name or phone (digits only for phone). */
export function searchCustomers(customers: CustomerRec[], query: string): CustomerRec[] {
  const q = customerKey(query);
  if (!q) return customers;
  const digits = q.replace(/\D/g, "");
  return customers.filter(
    (c) => c.name.toLowerCase().includes(q) || (!!c.email && c.email.toLowerCase().includes(q)) || (digits.length >= 3 && c.phone.replace(/\D/g, "").includes(digits)),
  );
}
