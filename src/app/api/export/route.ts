import { NextResponse } from "next/server";
import { HttpError, route } from "@/lib/api";
import { BACKUP_VERSION } from "@/lib/backup";
import { loadAll } from "@/lib/serialize";
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
  customers: (d) => d.customers.map((c) => ({ ...c })),
  products: (d) => d.products.map((p) => ({ ...p })),
  purchases: (d) => d.purchases.map((p) => ({ ...p })),
  adjustments: (d) => d.adjustments.map((a) => ({ ...a })),
  orders: (d) => d.orders.map(({ lines, ...o }) => ({ ...o, lineCount: lines.length })),
  order_lines: (d) => d.orders.flatMap((o) => o.lines.map((l) => ({ ...l }))),
  splits: (d) => d.splits.map(({ items, ...s }) => ({ ...s, itemCount: items.length })),
  split_items: (d) => d.splits.flatMap((s) => s.items.map((i) => ({ ...i }))),
  payouts: (d) => d.payouts.map((p) => ({ ...p })),
};

export const GET = route(async (req) => {
  const table = req.nextUrl.searchParams.get("table");
  const data = await loadAll();
  const stamp = new Date().toISOString().slice(0, 10);
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
