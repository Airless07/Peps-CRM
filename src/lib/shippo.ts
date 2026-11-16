// Shippo: live rates, address validation, label purchase, tracking.
// Adapted from the VALO project's lib/shipping.ts and lib/carrier.ts. Rules kept from there:
//  - Shippo never breaks checkout: any failure falls back to flat prices and says why.
//  - A label is bought only for a rate this server fetched for that order's own address.
//  - Errors are Shippo's own words, never swallowed.
import type { Address } from "./types";
import { TIER_SERVICE, type ShipFrom, type ShippingTierId, type StoreSettings } from "./store/config";

import { createHash } from "node:crypto";
import { carrierDisplayName, carrierFamily, trackingUrl } from "./tracking";

const SHIPPO_BASE = "https://api.goshippo.com";

/** Secret in the webhook URL given to Shippo. SHIPPO_WEBHOOK_SECRET, or one derived from SESSION_SECRET. */
export function webhookSecret(): string {
  if (process.env.SHIPPO_WEBHOOK_SECRET) return process.env.SHIPPO_WEBHOOK_SECRET;
  return createHash("sha256").update(`shippo-webhook:${process.env.SESSION_SECRET ?? ""}`).digest("hex").slice(0, 32);
}
const TIMEOUT_MS = 12_000;

export const shippoKey = () => (process.env.SHIPPO_API_KEY ?? "").trim();
export const shippoIsTestKey = () => shippoKey().startsWith("shippo_test_");

type Res<T> = { ok: true; data: T } | { ok: false; error: string };

async function shippoFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<Res<T>> {
  const key = shippoKey();
  if (!key) return { ok: false, error: "SHIPPO_API_KEY is not set. Add it to the environment variables and redeploy." };
  try {
    const res = await fetch(`${SHIPPO_BASE}${path}`, {
      method: init.method ?? "GET",
      headers: { Authorization: `ShippoToken ${key}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: `Shippo rejected the API key (HTTP ${res.status}). Check SHIPPO_API_KEY.` };
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Shippo answered with HTTP ${res.status}. ${text.slice(0, 240)}`.trim() };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return { ok: false, error: `Could not reach Shippo: ${err instanceof Error ? err.message : "network error"}.` };
  }
}

export interface RateOption {
  rateId: string;
  carrier: string;
  service: string;
  /** Shippo's service token, e.g. "usps_priority". */
  token: string;
  cents: number;
  estimatedDays: number | null;
}

interface ShippoRate {
  object_id?: string;
  amount?: string;
  provider?: string;
  servicelevel?: { name?: string; token?: string };
  estimated_days?: number;
}

const fromAddress = (f: ShipFrom) => ({ name: f.name, street1: f.street1, street2: f.street2, city: f.city, state: f.state, zip: f.zip, country: f.country || "US", phone: f.phone, email: f.email });
const toAddress = (a: Address, email?: string, phone?: string) => ({ name: a.name, street1: a.street1, street2: a.street2, city: a.city, state: a.state, zip: a.zip, country: a.country || "US", ...(email ? { email } : {}), ...(phone ? { phone } : {}) });

export interface Parcel {
  weightOz: number;
  lengthIn: number;
  widthIn: number;
  heightIn: number;
}

/** One box for the whole order: default box size, weight = sum of item weights (default weight per item when unset). */
export function parcelFor(store: Pick<StoreSettings, "parcel">, items: { quantity: number; weightOz: number | null }[]): Parcel {
  const p = store.parcel;
  // Default parcel weight = the box and packing (and any item with no weight set). Item weights are added on top.
  const itemsOz = items.reduce((s, i) => s + i.quantity * (i.weightOz ?? 0), 0);
  const weightOz = Math.max(1, Math.ceil(p.weightOz + itemsOz));
  return { weightOz, lengthIn: p.lengthIn, widthIn: p.widthIn, heightIn: p.heightIn };
}

/** Every rate Shippo returns for this shipment, cheapest first. */
export async function quoteRates(store: StoreSettings, to: Address, parcel: Parcel, contact?: { email?: string; phone?: string }): Promise<Res<{ rates: RateOption[]; messages: string[] }>> {
  const f = store.shipFrom;
  if (!(f.street1 && f.city && f.state && f.zip)) return { ok: false, error: "The ship-from address is not set. Add it in Settings, under Shipping." };
  const res = await shippoFetch<{ rates?: ShippoRate[]; messages?: { text?: string }[] }>("/shipments/", {
    method: "POST",
    body: {
      address_from: fromAddress(f),
      address_to: toAddress(to, contact?.email, contact?.phone),
      parcels: [{ length: String(parcel.lengthIn), width: String(parcel.widthIn), height: String(parcel.heightIn), distance_unit: "in", weight: String(parcel.weightOz), mass_unit: "oz" }],
      async: false,
    },
  });
  if (!res.ok) return res;
  const rates: RateOption[] = [];
  for (const r of res.data.rates ?? []) {
    const cents = Math.round(Number(r.amount) * 100);
    if (!r.object_id || !Number.isFinite(cents)) continue;
    rates.push({
      rateId: r.object_id,
      carrier: r.provider ?? "",
      service: r.servicelevel?.name ?? "",
      token: r.servicelevel?.token ?? "",
      cents,
      estimatedDays: Number(r.estimated_days) > 0 ? Math.floor(Number(r.estimated_days)) : null,
    });
  }
  rates.sort((a, b) => a.cents - b.cents);
  return { ok: true, data: { rates, messages: (res.data.messages ?? []).map((m) => String(m?.text ?? "").trim()).filter(Boolean) } };
}

export function estimateFromDays(days: number | null): string {
  if (!days || days <= 0) return "";
  if (days === 1) return "About 1 business day";
  return `About ${Math.max(1, days - 1)} to ${days + 1} business days`;
}

/** Live price per shipping tier (the tier's USPS service). Tiers Shippo did not price are left out. */
export function ratesByTier(rates: RateOption[]): Partial<Record<ShippingTierId, { cents: number; service: string; estimate: string; rateId: string }>> {
  const out: Partial<Record<ShippingTierId, { cents: number; service: string; estimate: string; rateId: string }>> = {};
  for (const tier of Object.keys(TIER_SERVICE) as ShippingTierId[]) {
    const r = rates.find((x) => x.token === TIER_SERVICE[tier].token);
    if (r) out[tier] = { cents: r.cents, service: `${r.carrier} ${r.service}`.trim(), estimate: estimateFromDays(r.estimatedDays), rateId: r.rateId };
  }
  return out;
}

/** The rate to buy for an order: the tier's service if offered, else the cheapest. */
export function pickRate(rates: RateOption[], tier: string): RateOption | null {
  const token = TIER_SERVICE[tier as ShippingTierId]?.token;
  return (token && rates.find((r) => r.token === token)) || rates[0] || null;
}

export interface AddressCheck {
  /** "valid" | "invalid" | "skipped" (Shippo not consulted: no key or it failed; checkout continues). */
  result: "valid" | "invalid" | "skipped";
  reason: string;
  suggestion: Address | null;
}

export async function validateAddress(to: Address): Promise<AddressCheck> {
  if (!shippoKey()) return { result: "skipped", reason: "Shippo is not connected.", suggestion: null };
  const res = await shippoFetch<{
    street1?: string;
    street2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    is_complete?: boolean;
    validation_results?: { is_valid?: boolean; messages?: { text?: string }[] };
  }>("/addresses/", { method: "POST", body: { ...toAddress(to), validate: true } });
  if (!res.ok) return { result: "skipped", reason: res.error, suggestion: null };
  const d = res.data;
  const v = d.validation_results;
  if (!v || typeof v.is_valid !== "boolean") return { result: "skipped", reason: "Shippo returned no validation result.", suggestion: null };
  const differs = !!d.street1 && (d.street1 !== to.street1 || (d.city ?? "") !== to.city || (d.state ?? "") !== to.state || (d.zip ?? "") !== to.zip);
  const suggestion: Address | null = differs ? { name: to.name, street1: d.street1!, street2: d.street2 ?? to.street2, city: d.city ?? to.city, state: d.state ?? to.state, zip: d.zip ?? to.zip, country: d.country ?? to.country } : null;
  if (v.is_valid && d.is_complete !== false) return { result: "valid", reason: "", suggestion };
  return {
    result: "invalid",
    reason: (v.messages ?? []).map((m) => String(m?.text ?? "").trim()).filter(Boolean).join(" ") || "The carrier could not confirm this address. Check the street, city, state and ZIP code.",
    suggestion,
  };
}

export interface BoughtLabel {
  trackingNumber: string;
  carrier: string;
  service: string;
  cents: number;
  labelUrl: string;
  transactionId: string;
}

export async function buyRate(rate: RateOption): Promise<Res<BoughtLabel>> {
  const res = await shippoFetch<{ status?: string; tracking_number?: string; label_url?: string; object_id?: string; messages?: { text?: string }[] }>("/transactions/", {
    method: "POST",
    body: { rate: rate.rateId, label_file_type: "PDF_4x6", async: false },
  });
  if (!res.ok) return res;
  const tx = res.data;
  if (tx.status !== "SUCCESS") {
    const detail = (tx.messages ?? []).map((m) => m.text).filter(Boolean).join("; ");
    return { ok: false, error: `Shippo did not complete the label purchase (status ${tx.status ?? "unknown"}). ${detail}`.trim() };
  }
  return {
    ok: true,
    data: { trackingNumber: tx.tracking_number ?? "", carrier: carrierDisplayName(rate.carrier), service: rate.service, cents: rate.cents, labelUrl: tx.label_url ?? "", transactionId: tx.object_id ?? "" },
  };
}

export interface TrackResult {
  /** PRE_TRANSIT / TRANSIT / DELIVERED / RETURNED / FAILURE / UNKNOWN */
  status: string;
  detail: string;
  /** When the carrier first reported TRANSIT / DELIVERED. */
  shippedAt: string | null;
  deliveredAt: string | null;
}

export function readTrack(track: { tracking_status?: { status?: string; status_details?: string; status_date?: string } | null; tracking_history?: { status?: string; status_date?: string }[] | null }): TrackResult {
  const first = (status: string): string | null => {
    const dates = (track.tracking_history ?? [])
      .filter((h) => h?.status === status && h?.status_date)
      .map((h) => new Date(String(h.status_date)).getTime())
      .filter(Number.isFinite);
    if (dates.length) return new Date(Math.min(...dates)).toISOString();
    const own = track.tracking_status?.status === status ? track.tracking_status?.status_date : null;
    return own && Number.isFinite(new Date(own).getTime()) ? new Date(own).toISOString() : null;
  };
  return { status: track.tracking_status?.status ?? "UNKNOWN", detail: track.tracking_status?.status_details ?? "", shippedAt: first("TRANSIT"), deliveredAt: first("DELIVERED") };
}

export async function trackPackage(carrier: string, trackingNumber: string): Promise<Res<TrackResult>> {
  const token = carrierFamily(carrier) || carrier.toLowerCase();
  const res = await shippoFetch<Parameters<typeof readTrack>[0]>(`/tracks/${encodeURIComponent(token)}/${encodeURIComponent(trackingNumber)}`);
  return res.ok ? { ok: true, data: readTrack(res.data) } : res;
}

/** Ask Shippo to send tracking updates for this package to our webhook. Best effort. */
export async function registerTracking(carrier: string, trackingNumber: string, metadata: string) {
  return shippoFetch("/tracks/", { method: "POST", body: { carrier: carrierFamily(carrier) || carrier.toLowerCase(), tracking_number: trackingNumber, metadata } });
}

export async function testConnection(): Promise<{ ok: boolean; message: string }> {
  if (!shippoKey()) return { ok: false, message: "SHIPPO_API_KEY is not set. Add it to the environment variables (Railway: Variables) and redeploy." };
  const res = await shippoFetch<{ results?: { carrier?: string; active?: boolean }[] }>("/carrier_accounts/?results=20");
  if (!res.ok) return { ok: false, message: res.error };
  const carriers = [...new Set((res.data.results ?? []).filter((c) => c.active !== false).map((c) => String(c.carrier ?? "").toUpperCase()))].filter(Boolean);
  return { ok: true, message: `Connected to Shippo${shippoIsTestKey() ? " (TEST key: labels are samples and cost nothing)" : " (LIVE key)"}. Carriers: ${carriers.join(", ") || "none listed"}.` };
}

export { carrierDisplayName, carrierFamily, trackingUrl };
