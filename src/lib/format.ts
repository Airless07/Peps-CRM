const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** $1,234.56 (negatives as -$1,234.56) */
export function fmtMoney(cents: number, opts: { compact?: boolean; sign?: boolean } = {}): string {
  const v = cents / 100;
  const s = opts.compact && Math.abs(cents) % 100 === 0 ? usd0.format(v) : usd.format(v);
  return opts.sign && cents > 0 ? `+${s}` : s;
}

/** Parse "12.5", "$1,234.56", "-3" into cents. Returns null when empty/invalid. */
export function parseMoney(input: string): number | null {
  const s = input.replace(/[$,\s]/g, "");
  if (s === "" || s === "-" || s === ".") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export const centsToInput = (c: number | null | undefined) =>
  c === null || c === undefined ? "" : (c / 100).toFixed(2).replace(/\.00$/, "");

export function fmtPercent(n: number, digits = 0) {
  return `${n.toFixed(digits)}%`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local "YYYY-MM-DD" key for grouping by day. */
export function dayKey(d: Date | string): string {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function fmtDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = startOfDay();
  if (date.getTime() === today.getTime()) return "Today";
  if (date.getTime() === addDays(today, -1).getTime()) return "Yesterday";
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: y === today.getFullYear() ? undefined : "numeric",
  });
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function fmtDateTime(iso: string): string {
  return `${fmtDate(iso)}, ${fmtTime(iso)}`;
}

/** ISO → value for <input type="datetime-local"> in local time. */
export function toLocalDateTimeInput(iso: string): string {
  const d = new Date(iso);
  return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO → value for <input type="date"> in local time. */
export const toLocalDateInput = (iso: string) => dayKey(iso);

/** <input type="datetime-local"> or <input type="date"> value → ISO (local time). */
export function fromLocalInput(v: string): string {
  if (!v) return new Date().toISOString();
  const [date, time = "12:00"] = v.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm).toISOString();
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const PRODUCT_COLORS: Record<string, string> = {
  slate: "#64748b",
  red: "#ef4444",
  orange: "#f97316",
  amber: "#f59e0b",
  green: "#22c55e",
  teal: "#14b8a6",
  sky: "#0ea5e9",
  blue: "#3b82f6",
  indigo: "#6366f1",
  violet: "#8b5cf6",
  pink: "#ec4899",
};
export const colorHex = (c: string) => PRODUCT_COLORS[c] ?? (c.startsWith("#") ? c : PRODUCT_COLORS.slate);

export function plural(n: number, word: string, pluralWord = word + "s") {
  return `${n} ${n === 1 ? word : pluralWord}`;
}
