// Turn any backup file (old or new format) into complete data.
// Version 1 (before customers and payment methods) and version 2 (before the store) still import:
// orders get "Unknown" as payment method, customers are rebuilt from order names, every product
// gets its own parent product (single variant), and orders are numbered from 1001 in date order.
import { groupCustomersFromOrders } from "./customers";
import { uid } from "./format";
import { parseContent, parseStore } from "./store/config";
import { uniqueSlug } from "./store/slug";
import { cleanSellButtons } from "./sell-buttons";
import type {
  AppData,
  CashHandoffRec,
  CoaRec,
  CreditEntryRec,
  CustomerRec,
  GroupRec,
  LabelRec,
  ListingRec,
  MessageRec,
  OrderEventRec,
  OrderRec,
  ProductRec,
  PromotionRec,
  ReviewRec,
  SavedOrderRec,
} from "./types";
import { DEFAULT_SETTINGS, ORDER_DEFAULTS, PRODUCT_DEFAULTS, UNKNOWN_PAYMENT, countsInMoney } from "./types";

export const BACKUP_VERSION = 3;
export const SUPPORTED_BACKUP_VERSIONS = [1, 2, 3];

/** Everything a backup holds: the app data plus order timelines. */
export type BackupData = AppData & { events: OrderEventRec[] };

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

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const time = (iso: string) => new Date(iso).getTime();

export function emptyListing(id: string, name: string, slug: string, sortOrder = 0, createdAt = new Date().toISOString()): ListingRec {
  return {
    id,
    name,
    slug,
    summary: "",
    description: "",
    casNumber: "",
    formula: "",
    molecularWeight: "",
    purity: "",
    form: "",
    storage: "",
    showOnWebsite: false,
    photos: [],
    hoverGif: "",
    groupIds: [],
    badges: [],
    bestSeller: false,
    qtyDeals: null,
    sortOrder,
    seoTitle: "",
    seoDescription: "",
    createdAt,
  };
}

export function normalizeBackup(raw: Loose & { orders: Loose[] }, makeId: () => string = uid): BackupData {
  const data = raw as unknown as Partial<BackupData> & { customers?: CustomerRec[] };
  const { store: _s, content: _c, ...flat } = (data.settings ?? {}) as Loose;
  const settings = { ...DEFAULT_SETTINGS, ...(flat as Partial<AppData["settings"]>) };
  settings.paymentMethods = cleanPaymentMethods((data.settings as unknown as Loose | undefined)?.paymentMethods);
  settings.sellButtons = cleanSellButtons((data.settings as unknown as Loose | undefined)?.sellButtons);

  const fixOrder = (o: OrderRec): OrderRec => ({
    ...ORDER_DEFAULTS,
    ...o,
    customer: typeof o.customer === "string" ? o.customer : "",
    customerId: typeof o.customerId === "string" && o.customerId ? o.customerId : null,
    paymentMethod: typeof o.paymentMethod === "string" && o.paymentMethod.trim() ? o.paymentMethod.trim() : UNKNOWN_PAYMENT,
  });
  let all: OrderRec[] = [...arr<OrderRec>(data.orders), ...arr<OrderRec>(data.pendingOrders)].map(fixOrder);

  let customers: CustomerRec[];
  if (Array.isArray(data.customers)) {
    customers = data.customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone ?? "",
      email: c.email ?? "",
      hasAccount: !!c.hasAccount,
      addresses: Array.isArray(c.addresses) ? c.addresses : [],
      notes: c.notes ?? "",
      createdAt: c.createdAt ?? new Date().toISOString(),
      // Accounts, credit and referrals: missing in older backups (then the database defaults apply).
      ...(c.lastLoginAt ? { lastLoginAt: c.lastLoginAt } : {}),
      ...(c.mustChangePassword ? { mustChangePassword: true } : {}),
      ...(typeof c.referralCode === "string" && c.referralCode ? { referralCode: c.referralCode.toUpperCase() } : {}),
      ...(typeof c.referralCodeDisplay === "string" && c.referralCodeDisplay ? { referralCodeDisplay: c.referralCodeDisplay } : {}),
      ...(typeof c.referredById === "string" && c.referredById ? { referredById: c.referredById } : {}),
    }));
    const ids = new Set(customers.map((c) => c.id));
    for (const c of customers) if (c.referredById && (!ids.has(c.referredById) || c.referredById === c.id)) c.referredById = null;
    const byId = new Map(customers.map((c) => [c.id, c]));
    // Never leave an order pointing at a customer that isn't in the file.
    all = all.map((o) => {
      const c = o.customerId ? byId.get(o.customerId) : undefined;
      return c ? { ...o, customer: c.name } : { ...o, customerId: null };
    });
  } else {
    const g = groupCustomersFromOrders(all, makeId);
    customers = g.customers;
    const byId = new Map(customers.map((c) => [c.id, c]));
    all = all.map((o) => {
      const cid = g.links.get(o.id);
      return cid ? { ...o, customerId: cid, customer: byId.get(cid)!.name } : { ...o, customerId: null };
    });
  }

  // Order numbers: keep the ones in the file, number the rest after them in date order.
  const used = new Set(all.map((o) => o.number).filter((n): n is number => typeof n === "number"));
  let next = Math.max(1000, ...used) + 1;
  const unnumbered = all
    .filter((o) => typeof o.number !== "number")
    .sort((a, b) => time(a.date) - time(b.date) || time(a.createdAt) - time(b.createdAt) || (a.id < b.id ? -1 : 1));
  const assigned = new Map(unnumbered.map((o) => [o.id, next++]));
  all = all.map((o) => (assigned.has(o.id) ? { ...o, number: assigned.get(o.id)! } : o));

  // Products: each one needs a parent product. Old backups have none, so each becomes a single-variant product.
  const listings: ListingRec[] = arr<ListingRec>(data.listings).map((l) => ({ ...emptyListing(l.id, l.name, l.slug ?? ""), ...l }));
  const listingIds = new Set(listings.map((l) => l.id));
  const slugs = new Set(listings.map((l) => l.slug).filter(Boolean));
  const products: ProductRec[] = arr<ProductRec>(data.products).map((p) => {
    const rec: ProductRec = { ...PRODUCT_DEFAULTS, ...p };
    if (rec.listingId && listingIds.has(rec.listingId)) return rec;
    const id = `l-${rec.id}`;
    if (!listingIds.has(id)) {
      listings.push(emptyListing(id, rec.name, uniqueSlug(rec.name, slugs), rec.sortOrder, rec.createdAt));
      listingIds.add(id);
    }
    return { ...rec, listingId: id };
  });
  for (const l of listings) if (!l.slug) l.slug = uniqueSlug(l.name, slugs);

  const store = parseStore(JSON.stringify(data.store ?? {}));
  const content = parseContent(JSON.stringify(data.content ?? {}));

  return {
    settings,
    products,
    customers,
    purchases: data.purchases ?? [],
    adjustments: data.adjustments ?? [],
    orders: all.filter((o) => countsInMoney(o.status)),
    pendingOrders: all.filter((o) => !countsInMoney(o.status)),
    splits: data.splits ?? [],
    payouts: data.payouts ?? [],
    labels: arr<LabelRec>(data.labels),
    listings,
    groups: arr<GroupRec>(data.groups),
    coas: arr<CoaRec>(data.coas),
    promotions: arr<PromotionRec>(data.promotions).map((p) => ({ ...p, uses: arr(p.uses), bogo: p.kind === "bogo" ? p.bogo ?? null : null })),
    reviews: arr<ReviewRec>(data.reviews),
    messages: arr<MessageRec>(data.messages),
    // Saved (open) orders: missing in older backups. Kept apart from orders, so they never count in money.
    savedOrders: arr<SavedOrderRec>(data.savedOrders)
      .filter((s) => s && typeof s.id === "string" && Array.isArray(s.lines) && s.lines.length > 0)
      .map((s) => ({ ...s, lines: s.lines.map((l) => ({ ...l, listPriceCents: typeof l.listPriceCents === "number" ? l.listPriceCents : null })) })),
    // Cash hand-offs: missing in older backups.
    cashHandoffs: arr<CashHandoffRec>(data.cashHandoffs).filter((h) => h && typeof h.id === "string" && typeof h.amountCents === "number"),
    events: arr<OrderEventRec>(data.events),
    // Store credit history: missing in older backups. Only entries of customers in the file.
    creditEntries: arr<CreditEntryRec>(data.creditEntries).filter((e) => e && typeof e.id === "string" && typeof e.amountCents === "number" && customers.some((c) => c.id === e.customerId)),
    store,
    content,
  };
}
