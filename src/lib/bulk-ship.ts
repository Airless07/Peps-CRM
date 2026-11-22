// Bulk shipping from the ship queue: buy many labels, print them as one PDF, print all packing slips as
// one PDF, mark many orders shipped. Every order goes through the SAME single-order functions
// (labelRates, buyLabel, markShipped), so label costs, money, emails and the timeline are identical.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { HttpError } from "./api";
import { prisma } from "./db";
import { buyLabel, getStore, labelRates, markShipped } from "./order-ops";
import { LINE_SIZE, toOrder } from "./serialize";
import { lineName } from "./size";
import type { OrderRec } from "./types";

export type BulkAction = "buy" | "print" | "ship";

/** Why this order can't be part of a bulk action (null = it can). */
export function bulkBlock(o: OrderRec | null | undefined, action: BulkAction): string | null {
  if (!o) return "Order not found. Reload the page.";
  if (o.source !== "online") return "Not a website order.";
  const f = o.fulfillment ?? "ship";
  if (f === "pickup" || f === "delivery") return `Local ${f} order: no shipping label needed.`;
  if (o.status === "awaiting_payment") return "Not paid yet.";
  if (o.status === "canceled") return "Canceled.";
  if (o.status === "shipped" || o.status === "delivered") return "Already shipped.";
  if (o.status !== "paid" && o.status !== "label_purchased") return `Can't ship from "${o.status.replace(/_/g, " ")}".`;
  if (action === "buy" && o.web?.labelUrl) return "Label already bought.";
  if (action === "print" && !o.web?.labelUrl) return "No label bought yet.";
  return null;
}

async function loadOrders(ids: string[]): Promise<Map<string, OrderRec>> {
  const rows = await prisma.order.findMany({ where: { id: { in: ids } }, include: { lines: LINE_SIZE } });
  return new Map(rows.map((r) => [r.id, toOrder(r)]));
}

const uniq = (ids: string[]) => [...new Set(ids.filter((x) => typeof x === "string" && x))].slice(0, 200);
const errText = (e: unknown) => (e instanceof HttpError ? e.message : e instanceof Error ? e.message : "Something went wrong.");

export interface BulkQuoteRow {
  id: string;
  number: number | null;
  ok: boolean;
  /** Label price of the rate that will be bought (the service the customer paid for, else the cheapest). */
  cents: number;
  carrier: string;
  service: string;
  error: string;
}

/** What "Buy labels (N)" would buy: one rate per order and the total. Nothing is bought. */
export async function quoteBulkLabels(idsIn: string[]): Promise<{ rows: BulkQuoteRow[]; totalCents: number; count: number }> {
  const ids = uniq(idsIn);
  const orders = await loadOrders(ids);
  const rows: BulkQuoteRow[] = [];
  for (const id of ids) {
    const o = orders.get(id);
    const block = bulkBlock(o, "buy");
    if (block) {
      rows.push({ id, number: o?.number ?? null, ok: false, cents: 0, carrier: "", service: "", error: block });
      continue;
    }
    try {
      const r = await labelRates(id);
      const rate = r.rates.find((x) => x.rateId === r.suggestedRateId) ?? r.rates[0];
      rows.push({ id, number: o!.number ?? null, ok: true, cents: rate.cents, carrier: rate.carrier, service: rate.service, error: "" });
    } catch (e) {
      rows.push({ id, number: o!.number ?? null, ok: false, cents: 0, carrier: "", service: "", error: errText(e) });
    }
  }
  const ok = rows.filter((r) => r.ok);
  return { rows, totalCents: ok.reduce((s, r) => s + r.cents, 0), count: ok.length };
}

export interface BulkResult {
  id: string;
  number: number | null;
  ok: boolean;
  /** Skipped on purpose (unpaid, local, already has a label...), not a failure of the carrier. */
  skipped: boolean;
  message: string;
  cents?: number;
  trackingNumber?: string;
}

/** Buy one label per order, one after the other. A label is never bought twice (see buyLabel's lock). */
export async function buyBulkLabels(idsIn: string[], origin?: string): Promise<BulkResult[]> {
  const ids = uniq(idsIn);
  const orders = await loadOrders(ids);
  const out: BulkResult[] = [];
  for (const id of ids) {
    const o = orders.get(id);
    const block = bulkBlock(o, "buy");
    if (block) {
      out.push({ id, number: o?.number ?? null, ok: false, skipped: true, message: block });
      continue;
    }
    try {
      const label = await buyLabel(id, undefined, origin);
      out.push({ id, number: o!.number ?? null, ok: true, skipped: false, message: `${label.carrier} ${label.service}`.trim(), cents: label.cents, trackingNumber: label.trackingNumber });
    } catch (e) {
      out.push({ id, number: o!.number ?? null, ok: false, skipped: false, message: errText(e) });
    }
  }
  return out;
}

/** Mark orders shipped (saves tracking, takes them off the queue, emails like a single order). */
export async function shipBulk(idsIn: string[], origin?: string): Promise<BulkResult[]> {
  const ids = uniq(idsIn);
  const orders = await loadOrders(ids);
  const out: BulkResult[] = [];
  for (const id of ids) {
    const o = orders.get(id);
    const block = bulkBlock(o, "ship");
    if (block) {
      out.push({ id, number: o?.number ?? null, ok: false, skipped: true, message: block });
      continue;
    }
    try {
      await markShipped(id, { origin });
      out.push({ id, number: o!.number ?? null, ok: true, skipped: false, message: o!.web?.trackingNumber ? `Tracking ${o!.web.trackingNumber}` : "No tracking number" });
    } catch (e) {
      out.push({ id, number: o!.number ?? null, ok: false, skipped: false, message: errText(e) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- PDFs
const IN = 72;
const LABEL_SIZE: [number, number] = [4 * IN, 6 * IN];

/** Helvetica (WinAnsi) can't draw every character: anything it can't is replaced. */
const safe = (s: string) => s.replace(/[‐-―]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[×]/g, "x").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");

/** All labels of these orders, in the order given, as one 4x6 PDF. Orders without a label are listed in `skipped`. */
export async function combinedLabels(idsIn: string[]): Promise<{ pdf: Uint8Array; included: number[]; skipped: { number: number | null; reason: string }[] }> {
  const ids = uniq(idsIn);
  const orders = await loadOrders(ids);
  const doc = await PDFDocument.create();
  const included: number[] = [];
  const skipped: { number: number | null; reason: string }[] = [];
  for (const id of ids) {
    const o = orders.get(id);
    const block = bulkBlock(o, "print");
    if (block) {
      skipped.push({ number: o?.number ?? null, reason: block });
      continue;
    }
    try {
      const res = await fetch(o!.web!.labelUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`The label file could not be downloaded (${res.status}).`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const type = res.headers.get("content-type") ?? "";
      if (type.includes("pdf") || (bytes[0] === 0x25 && bytes[1] === 0x50)) {
        const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
        for (const pg of await doc.copyPages(src, src.getPageIndices())) doc.addPage(pg);
      } else {
        // Image label (PNG): one 4x6 page, scaled to fit.
        const img = type.includes("png") || bytes[0] === 0x89 ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
        const page = doc.addPage(LABEL_SIZE);
        const k = Math.min(LABEL_SIZE[0] / img.width, LABEL_SIZE[1] / img.height);
        page.drawImage(img, { x: (LABEL_SIZE[0] - img.width * k) / 2, y: (LABEL_SIZE[1] - img.height * k) / 2, width: img.width * k, height: img.height * k });
      }
      included.push(o!.number ?? 0);
    } catch (e) {
      skipped.push({ number: o!.number ?? null, reason: errText(e) });
    }
  }
  if (included.length === 0) throw new HttpError(409, skipped.length ? `No labels to print. ${skipped.map((s) => `#${s.number}: ${s.reason}`).join(" ")}` : "Pick at least one order.");
  return { pdf: await doc.save(), included, skipped };
}

/** One packing slip per order (4x6, continued on a new page when there are many items), in the order given. */
export async function combinedPackingSlips(idsIn: string[]): Promise<Uint8Array> {
  const ids = uniq(idsIn);
  if (ids.length === 0) throw new HttpError(400, "Pick at least one order.");
  const orders = await loadOrders(ids);
  const { store } = await getStore();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [W, H] = LABEL_SIZE;
  const M = 0.25 * IN;
  for (const id of ids) {
    const o = orders.get(id);
    if (!o) continue;
    let page: PDFPage = doc.addPage(LABEL_SIZE);
    let y = H - M;
    const text = (t: string, size: number, f: PDFFont = font, x = M, color = rgb(0, 0, 0)) => {
      page.drawText(safe(t), { x, y, size, font: f, color });
    };
    const wrap = (t: string, size: number, f: PDFFont, width: number) => {
      const words = safe(t).split(/\s+/);
      const lines: string[] = [];
      let cur = "";
      for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        if (f.widthOfTextAtSize(next, size) > width && cur) {
          lines.push(cur);
          cur = w;
        } else cur = next;
      }
      if (cur) lines.push(cur);
      return lines;
    };
    const header = (cont: boolean) => {
      y -= 12;
      text(store.storeName || "Packing slip", 11, bold);
      text(cont ? "Packing slip (continued)" : "Packing slip", 8, font, W - M - font.widthOfTextAtSize(cont ? "Packing slip (continued)" : "Packing slip", 8), rgb(0.35, 0.35, 0.35));
      y -= 26;
      text(`Order #${o.number ?? ""}`, 20, bold);
      y -= 16;
    };
    header(false);
    const name = o.web?.shipTo?.name || o.customer || "Customer";
    text(name, 12, bold);
    y -= 13;
    const ship = o.web?.shipTo;
    if (ship) {
      for (const l of [ship.street1, ship.street2, `${ship.city}, ${ship.state} ${ship.zip}`].filter((x) => x && x.trim())) {
        text(l, 9);
        y -= 11;
      }
    }
    text(new Date(o.web?.placedAt ?? o.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + (o.web?.shippingMethod ? `  ·  ${o.web.shippingMethod}` : ""), 8, font, M, rgb(0.35, 0.35, 0.35));
    y -= 12;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.75, color: rgb(0, 0, 0) });
    y -= 16;
    text("QTY", 8, bold);
    text("ITEM", 8, bold, M + 40);
    y -= 14;
    let units = 0;
    for (const l of o.lines) {
      units += l.quantity;
      const lines = wrap(lineName(l), 11, font, W - 2 * M - 40);
      if (y - lines.length * 13 < M + 30) {
        page = doc.addPage(LABEL_SIZE);
        y = H - M;
        header(true);
      }
      text(`${l.quantity}x`, 12, bold);
      for (const [i, t] of lines.entries()) {
        text(t, 11, font, M + 40);
        if (i < lines.length - 1) y -= 13;
      }
      y -= 18;
    }
    page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
    y -= 8;
    text(`${units} ${units === 1 ? "item" : "items"}`, 10, bold);
    y = M + 4;
    text("For research use only. Not for human consumption.", 7, font, M, rgb(0.35, 0.35, 0.35));
  }
  if (doc.getPageCount() === 0) throw new HttpError(404, "Those orders were not found. Reload the page.");
  return doc.save();
}
