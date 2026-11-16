import type { AppData } from "../types";
import { STATUS_LABEL } from "../types";

export interface SearchHit {
  kind: "order" | "customer" | "product";
  id: string;
  title: string;
  sub: string;
  href: string;
}

/** Global admin search: order number, customer name, email, phone, product or size. */
export function searchAdmin(data: AppData, query: string, limit = 12): SearchHit[] {
  const q = query.trim().toLowerCase().replace(/^#/, "");
  if (!q) return [];
  const digits = q.replace(/\D/g, "");
  const hits: (SearchHit & { rank: number })[] = [];

  for (const o of [...data.orders, ...data.pendingOrders]) {
    const num = o.number ? String(o.number) : "";
    const email = o.web?.email.toLowerCase() ?? "";
    const name = (o.customer || o.web?.shipTo?.name || "").toLowerCase();
    const tracking = o.web?.trackingNumber.toLowerCase() ?? "";
    let rank = -1;
    if (num && num === q) rank = 0;
    else if (num && q.length >= 2 && num.includes(q)) rank = 2;
    else if (email && email.includes(q)) rank = 3;
    else if (name && name.includes(q)) rank = 4;
    else if (tracking && q.length >= 5 && tracking.includes(q)) rank = 4;
    if (rank < 0) continue;
    hits.push({
      rank,
      kind: "order",
      id: o.id,
      title: `#${o.number ?? "—"} · ${o.customer || o.web?.shipTo?.name || "Walk-in"}`,
      sub: `${o.source === "online" ? "Online" : "In person"} · ${STATUS_LABEL[o.status]}${email ? ` · ${email}` : ""}`,
      href: `/admin/orders/${o.id}`,
    });
  }

  for (const c of data.customers) {
    const match =
      c.name.toLowerCase().includes(q) || (c.email && c.email.toLowerCase().includes(q)) || (digits.length >= 3 && c.phone.replace(/\D/g, "").includes(digits));
    if (!match) continue;
    hits.push({
      rank: c.name.toLowerCase().startsWith(q) ? 1 : 5,
      kind: "customer",
      id: c.id,
      title: c.name,
      sub: [c.email, c.phone].filter(Boolean).join(" · "),
      href: `/admin/customers?open=${encodeURIComponent(c.id)}`,
    });
  }

  for (const l of data.listings) {
    const variants = data.products.filter((p) => p.listingId === l.id);
    const text = [l.name, l.casNumber, ...variants.map((v) => `${v.name} ${v.variantLabel}`)].join(" ").toLowerCase();
    if (!text.includes(q)) continue;
    hits.push({
      rank: l.name.toLowerCase().startsWith(q) ? 1 : 5,
      kind: "product",
      id: l.id,
      title: l.name,
      sub: variants.length > 1 ? `${variants.length} sizes` : l.showOnWebsite ? "On website" : "Not on website",
      href: `/admin/inventory?open=${encodeURIComponent(l.id)}`,
    });
  }

  return hits.sort((a, b) => a.rank - b.rank).slice(0, limit);
}
