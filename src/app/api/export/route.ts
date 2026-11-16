import { NextResponse } from "next/server";
import { HttpError, route } from "@/lib/api";
import { BACKUP_VERSION } from "@/lib/backup";
import { loadAll, loadBackup } from "@/lib/serialize";
import type { AppData } from "@/lib/types";

export const dynamic = "force-dynamic";

function csv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\r\n");
}

const tables: Record<string, (d: AppData) => Record<string, unknown>[]> = {
  settings: (d) => [{ ...d.settings, paymentMethods: d.settings.paymentMethods.join(" | ") }],
  customers: (d) => d.customers.map(({ addresses, ...c }) => ({ ...c, savedAddresses: addresses.length })),
  products: (d) => d.products.map((p) => ({ ...p, product: d.listings.find((l) => l.id === p.listingId)?.name ?? "" })),
  purchases: (d) => d.purchases.map((p) => ({ ...p })),
  adjustments: (d) => d.adjustments.map((a) => ({ ...a })),
  orders: (d) =>
    [...d.orders, ...d.pendingOrders].map(({ lines, web, ...o }) => ({
      ...o,
      lineCount: lines.length,
      email: web?.email ?? "",
      shipTo: web?.shipTo ? [web.shipTo.name, web.shipTo.street1, web.shipTo.street2, web.shipTo.city, web.shipTo.state, web.shipTo.zip].filter(Boolean).join(", ") : "",
      trackingNumber: web?.trackingNumber ?? "",
      cancelReason: web?.cancelReason ?? "",
    })),
  order_lines: (d) => [...d.orders, ...d.pendingOrders].flatMap((o) => o.lines.map((l) => ({ ...l }))),
  labels: (d) => d.labels.map((l) => ({ ...l })),
  splits: (d) => d.splits.map(({ items, ...s }) => ({ ...s, itemCount: items.length })),
  split_items: (d) => d.splits.flatMap((s) => s.items.map((i) => ({ ...i }))),
  payouts: (d) => d.payouts.map((p) => ({ ...p })),
};

export const GET = route(async (req) => {
  const table = req.nextUrl.searchParams.get("table");
  const stamp = new Date().toISOString().slice(0, 10);
  const data = !table || table === "json" ? await loadBackup() : await loadAll();
  if (!table || table === "json") {
    return new NextResponse(JSON.stringify({ app: "peps-crm", version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data }, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="peps-crm-backup-${stamp}.json"`,
      },
    });
  }
  const fn = tables[table];
  if (!fn) throw new HttpError(400, "Unknown table");
  return new NextResponse(csv(fn(data)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="peps-crm-${table}-${stamp}.csv"`,
    },
  });
});
