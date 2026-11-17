// Built-in analytics. No third-party tracking and nothing about a person: the only thing stored
// is a counter per day, per metric (and per product for product metrics). No IP address, no user
// agent, no cookie, no visitor id.
import { prisma } from "./db";

export const METRICS = ["visit", "product_view", "add_to_cart", "checkout_start", "order"] as const;
export type Metric = (typeof METRICS)[number];
/** Metrics a browser may report. "order" is only ever counted by the server when an order is saved. */
export const CLIENT_METRICS: Metric[] = ["visit", "product_view", "add_to_cart", "checkout_start"];
/** Metrics that are counted per product (key = listing id). */
export const PRODUCT_METRICS: Metric[] = ["product_view", "add_to_cart"];

const TZ = process.env.STORE_TZ || "America/New_York";

/** Calendar day in the store's time zone, "YYYY-MM-DD". */
export function analyticsDay(now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const BOT = /bot|crawl|spider|slurp|preview|monitor|lighthouse|headless|pingdom|uptime|curl|wget|python|scrapy|facebookexternalhit|whatsapp|telegram|discord/i;
/** Crawlers and link previewers are not visits. */
export const isBot = (userAgent: string | null | undefined) => !userAgent || BOT.test(userAgent);

/** Add one to today's counter. */
export async function track(metric: Metric, key = "", now = new Date()): Promise<void> {
  const day = analyticsDay(now);
  await prisma.analyticsDay.upsert({
    where: { day_metric_key: { day, metric, key } },
    create: { day, metric, key, count: 1 },
    update: { count: { increment: 1 } },
  });
}

export interface AnalyticsDayRow {
  day: string;
  visit: number;
  product_view: number;
  add_to_cart: number;
  checkout_start: number;
  order: number;
}
export interface AnalyticsSummary {
  days: number;
  from: string;
  to: string;
  totals: Omit<AnalyticsDayRow, "day">;
  /** Orders placed per 100 store visits. Null when there were no visits. */
  conversionPercent: number | null;
  daily: AnalyticsDayRow[];
  products: { id: string; views: number; addToCarts: number }[];
}

const emptyRow = (day: string): AnalyticsDayRow => ({ day, visit: 0, product_view: 0, add_to_cart: 0, checkout_start: 0, order: 0 });

/** The last `days` calendar days (today included), oldest first, with totals and per-product counts. */
export async function analyticsSummary(days: number, now = new Date()): Promise<AnalyticsSummary> {
  const n = Math.min(90, Math.max(1, Math.floor(days)));
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i--) keys.push(analyticsDay(new Date(now.getTime() - i * 86400_000)));
  const rows = await prisma.analyticsDay.findMany({ where: { day: { gte: keys[0], lte: keys[keys.length - 1] } } });
  return summarize(keys, rows);
}

/** Pure part of the summary (tested without a database). */
export function summarize(dayKeys: string[], rows: { day: string; metric: string; key: string; count: number }[]): AnalyticsSummary {
  const byDay = new Map(dayKeys.map((d) => [d, emptyRow(d)]));
  const products = new Map<string, { id: string; views: number; addToCarts: number }>();
  for (const r of rows) {
    const row = byDay.get(r.day);
    if (!row || !(METRICS as readonly string[]).includes(r.metric)) continue;
    row[r.metric as Metric] += r.count;
    if (r.key && PRODUCT_METRICS.includes(r.metric as Metric)) {
      const p = products.get(r.key) ?? { id: r.key, views: 0, addToCarts: 0 };
      if (r.metric === "product_view") p.views += r.count;
      else p.addToCarts += r.count;
      products.set(r.key, p);
    }
  }
  const daily = [...byDay.values()];
  const totals = daily.reduce(
    (t, d) => ({ visit: t.visit + d.visit, product_view: t.product_view + d.product_view, add_to_cart: t.add_to_cart + d.add_to_cart, checkout_start: t.checkout_start + d.checkout_start, order: t.order + d.order }),
    { visit: 0, product_view: 0, add_to_cart: 0, checkout_start: 0, order: 0 },
  );
  return {
    days: dayKeys.length,
    from: dayKeys[0] ?? "",
    to: dayKeys[dayKeys.length - 1] ?? "",
    totals,
    conversionPercent: totals.visit > 0 ? Math.round((totals.order / totals.visit) * 1000) / 10 : null,
    daily,
    products: [...products.values()].sort((a, b) => b.views - a.views || b.addToCarts - a.addToCarts),
  };
}
