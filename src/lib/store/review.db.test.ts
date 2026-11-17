// Database-backed tests for the Buckshot Labs review pass: the data migration on stored text,
// internal order notes, the unpaid order reminder, low stock alerts, analytics counters,
// order / review tokens and the login lockout. Uses a fresh SQLite file with every migration applied.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LEGACY_CONTENT_JSON, LEGACY_STORE_JSON, OLD_BRAND } from "./legacy-fixture";

const dir = mkdtempSync(path.join(tmpdir(), "labs-review-test-"));
const root = path.resolve(import.meta.dirname, "../../..");
const dbPath = path.join(dir, "test.db");
process.env.DATABASE_URL = `file:${dbPath.split(path.sep).join("/")}`;
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.RESEND_API_KEY = "re_test_key";
process.env.SHIPPO_API_KEY = "shippo_test_fake";

let prisma: (typeof import("../db"))["prisma"];
let ops: typeof import("../order-ops");
let alerts: typeof import("../stock-alerts");
let analytics: typeof import("../analytics");
let view: typeof import("./order-view");
let ser: typeof import("../serialize");
let money: typeof import("../money");
let rate: typeof import("../ratelimit");
let restoreMod: typeof import("../restore");

/** Every email "sent" through the mocked Resend endpoint. */
const sent: { to: string[]; subject: string; html: string; text: string; from: string }[] = [];
const realFetch = globalThis.fetch;

const STORE = {
  open: true,
  payments: { zelle: { enabled: true, details: "pay@buckshot.test" } },
  alertEmails: ["owner@buckshot.test"],
  autoCancelHours: 24,
  shipFrom: { name: "Buckshot Labs", street1: "1 Main St", city: "Austin", state: "TX", zip: "78701", country: "US", phone: "5125550100", email: "ship@buckshot.test" },
};
const setStore = (over: Record<string, unknown> = {}) => prisma.settings.update({ where: { id: 1 }, data: { storeJson: JSON.stringify({ ...STORE, ...over }) } });

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("../db"));
  ops = await import("../order-ops");
  alerts = await import("../stock-alerts");
  analytics = await import("../analytics");
  view = await import("./order-view");
  ser = await import("../serialize");
  money = await import("../money");
  rate = await import("../ratelimit");
  restoreMod = await import("../restore");

  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith("https://api.resend.com/")) {
      const b = JSON.parse(String(init?.body));
      sent.push({ to: b.to, subject: b.subject, html: b.html, text: b.text, from: b.from });
      return new Response(JSON.stringify({ id: `email-${sent.length}` }), { status: 200 });
    }
    return realFetch(url as never, init);
  });

  await prisma.settings.create({ data: { id: 1, startingBalanceCents: 0, lowStockThreshold: 3, storeJson: JSON.stringify(STORE) } });
  await prisma.listing.createMany({
    data: [
      { id: "l-reta", name: "Reta", slug: "reta", showOnWebsite: true, sortOrder: 0 },
      { id: "l-kpv", name: "KPV", slug: "kpv", showOnWebsite: true, sortOrder: 1 },
    ],
  });
  await prisma.product.createMany({
    data: [
      { id: "r10", name: "Reta 10mg", variantLabel: "10mg", defaultPriceCents: 7000, listingId: "l-reta", variantSort: 0 },
      { id: "r20", name: "Reta 20mg", variantLabel: "20mg", defaultPriceCents: 12000, listingId: "l-reta", variantSort: 1 },
      { id: "kpv", name: "KPV", defaultPriceCents: 4000, listingId: "l-kpv" },
    ],
  });
  const d = new Date("2026-01-01T12:00:00Z");
  await prisma.purchase.createMany({
    data: [
      { id: "pu-r10", date: d, productId: "r10", quantity: 6, totalCostCents: 12000, fromInvestment: true },
      { id: "pu-r20", date: d, productId: "r20", quantity: 20, totalCostCents: 80000, fromInvestment: true },
      { id: "pu-kpv", date: d, productId: "kpv", quantity: 20, totalCostCents: 20000, fromInvestment: true },
    ],
  });
  await prisma.customer.create({ data: { id: "cust", name: "Dana Reed", email: "dana@example.com", passwordHash: "x" } });
}, 120_000);

afterEach(() => {
  sent.length = 0;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const shipTo = { name: "Dana Reed", street1: "500 Oak Ave", street2: "", city: "Denver", state: "CO", zip: "80202", country: "US" };
/** One KPV, standard shipping: $40.00 + $6.95. */
const checkout = (over: Partial<Parameters<(typeof ops)["placeOrder"]>[0]> = {}) =>
  ops.placeOrder({ customerId: "cust", name: "Dana Reed", email: "dana@example.com", phone: "", shipTo, items: [{ variantId: "kpv", quantity: 1 }], code: "", tier: "standard", payChoice: "zelle", expectedTotalCents: 4000 + 695, origin: "http://localhost:3000", ...over });
const ledgerNow = async () => money.computeLedger(await ser.loadAll());

// ---------------------------------------------------------------- Migration on stored text
describe("migration 20261116120000_labs_review on stored values", () => {
  const migration = readFileSync(path.join(root, "prisma/migrations/20261116120000_labs_review/migration.sql"), "utf8");
  const updates = migration
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter((s) => s.startsWith("UPDATE"));

  /** A copy of the test database holding the given stored JSON, with the migration's text updates run on it. */
  function migrate(storeJson: string, contentJson: string) {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE "Settings" (id INTEGER PRIMARY KEY, "storeJson" TEXT NOT NULL, "contentJson" TEXT NOT NULL);
             CREATE TABLE "Listing" (id TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', "seoTitle" TEXT NOT NULL DEFAULT '', "seoDescription" TEXT NOT NULL DEFAULT '');`);
    db.prepare(`INSERT INTO "Settings" VALUES (1, ?, ?)`).run(storeJson, contentJson);
    db.prepare(`INSERT INTO "Listing" (id, summary, "seoTitle") VALUES ('l1', ?, ?)`).run(`Sold by ${OLD_BRAND}.`, `KPV | ${OLD_BRAND}`);
    for (const sql of updates) db.exec(sql);
    const row = db.prepare(`SELECT "storeJson", "contentJson" FROM "Settings"`).get() as { storeJson: string; contentJson: string };
    const listing = db.prepare(`SELECT summary, "seoTitle" FROM "Listing"`).get() as { summary: string; seoTitle: string };
    db.close();
    return { raw: row, store: JSON.parse(row.storeJson), content: JSON.parse(row.contentJson), listing };
  }

  it("is additive only: no table is dropped, rebuilt or emptied", () => {
    expect(migration).not.toMatch(/\bDROP\b|\bDELETE\b|RENAME|PRAGMA foreign_keys|INSERT INTO "new_/i);
    expect(updates.length).toBeGreaterThan(10);
    for (const u of updates) expect(u).toMatch(/^UPDATE "(Settings|Listing)" SET/);
    expect(migration).not.toContain(OLD_BRAND);
  });

  it("renames the brand in every stored value", () => {
    expect(LEGACY_STORE_JSON).toContain(OLD_BRAND);
    const out = migrate(LEGACY_STORE_JSON, LEGACY_CONTENT_JSON);
    expect(out.store.storeName).toBe("Buckshot Labs");
    expect(out.store.emailFromName).toBe("Buckshot Labs");
    expect(out.content.about.title).toBe("About Buckshot Labs");
    expect(out.content.seo.title).toBe("Buckshot Labs | Research peptides with testing status on every product");
    expect(out.listing).toEqual({ summary: "Sold by Buckshot Labs.", seoTitle: "KPV | Buckshot Labs" });
    expect(out.raw.storeJson + out.raw.contentJson).not.toContain(OLD_BRAND);
    expect(out.raw.storeJson + out.raw.contentJson).not.toMatch(/\bPeps\b/i);
  });

  it("replaces every old testing claim with the accurate wording", () => {
    const { content: c, raw } = migrate(LEGACY_STORE_JSON, LEGACY_CONTENT_JSON);
    expect(c.hero.subtext).toBe("Research materials with testing status shown on every product. Certificates of analysis are published per batch as they're completed.");
    expect(c.hero.headline).toBe("Research peptides for the lab.");
    expect(c.sections.find((s: { id: string }) => s.id === "quality").title).toBe("Testing, shown honestly");
    expect(c.quality.points.map((p: { title: string }) => p.title)).toEqual(["Status on every product", "COAs by batch", "Lot traceability"]);
    expect(c.faq[0].a).toContain("{payment_methods}");
    expect(c.faq[0].a).not.toContain("Cash App");
    expect(raw.contentJson).not.toMatch(/every lot|independent lab|third-party tested|lot-specific|verified batch|COA on every product|third-party certificates/i);
  });

  it("the migrated content equals the new defaults (so stored and default text agree)", async () => {
    const { DEFAULT_CONTENT } = await import("./config");
    const { content: c } = migrate(LEGACY_STORE_JSON, LEGACY_CONTENT_JSON);
    expect(c.hero).toEqual(DEFAULT_CONTENT.hero);
    expect(c.quality).toEqual(DEFAULT_CONTENT.quality);
    expect(c.faq).toEqual(DEFAULT_CONTENT.faq);
    expect(c.about).toEqual(DEFAULT_CONTENT.about);
    expect(c.seo).toEqual(DEFAULT_CONTENT.seo);
    expect(c.sections).toEqual(DEFAULT_CONTENT.sections);
    expect(c.policies).toEqual(DEFAULT_CONTENT.policies);
  });

  it("hand-edited text that still makes an old claim is replaced; other hand-edited text is kept", () => {
    const content = JSON.parse(LEGACY_CONTENT_JSON);
    content.hero.subtext = "Every lot we sell is tested by an independent lab.";
    content.footerText = `${OLD_BRAND}: every batch third-party tested.`;
    content.quality.points[0] = { title: "Lab verified", text: "We send every lot out for testing." };
    content.contact.note = `${OLD_BRAND} replies fast.`;
    content.about.body = "A small shop run by two friends.";
    content.policies.terms.body += `\n\nSeller: ${OLD_BRAND} LLC.`;
    const { content: c } = migrate(LEGACY_STORE_JSON, JSON.stringify(content));
    expect(c.hero.subtext).toMatch(/^Research materials with testing status/);
    expect(c.footerText).toBe("Research materials with testing status shown on every product.");
    expect(c.quality.points[0]).toEqual({ title: "Status on every product", text: "Each product and size shows its current testing status, so you know what is on file before you order." });
    expect(c.contact.note).toBe("Buckshot Labs replies fast.");
    expect(c.about.body).toBe("A small shop run by two friends.");
    expect(c.policies.terms.body).toMatch(/Seller: Buckshot Labs LLC\.$/);
  });

  it("leaves empty settings and a second run unchanged", () => {
    expect(migrate("{}", "{}").raw).toEqual({ storeJson: "{}", contentJson: "{}" });
    const once = migrate(LEGACY_STORE_JSON, LEGACY_CONTENT_JSON).raw;
    const twice = migrate(once.storeJson, once.contentJson).raw;
    expect(twice).toEqual(once);
  });

  it("the real database got the new column defaults and the analytics table", async () => {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const cols = (db.prepare(`pragma table_info("Order")`).all() as { name: string; dflt_value: string | null; notnull: number }[]).filter((c) => ["adminNote", "reminderSentAt"].includes(c.name));
    expect(cols).toEqual([expect.objectContaining({ name: "adminNote", dflt_value: "''", notnull: 1 }), expect.objectContaining({ name: "reminderSentAt", notnull: 0 })]);
    expect(db.prepare(`select name from sqlite_master where name = 'AnalyticsDay'`).get()).toBeTruthy();
    db.close();
  });
});

// ---------------------------------------------------------------- Internal notes
describe("internal order notes", () => {
  const SECRET = "INTERNAL-ONLY-zx81 paid from a friend's account";
  let id = "";
  let token = "";

  it("is saved on the order and visible to the admin", async () => {
    const placed = await checkout();
    id = placed.id;
    token = placed.token;
    expect((await ser.loadAll()).pendingOrders.find((o) => o.id === id)!.adminNote).toBe("");
    await prisma.order.update({ where: { id }, data: { adminNote: SECRET } });
    expect((await ser.loadAll()).pendingOrders.find((o) => o.id === id)!.adminNote).toBe(SECRET);
  });

  it("is never in what the customer can see: order page, account page, any email", async () => {
    const data = await ser.loadAll();
    const pub = await view.publicOrderByToken(token, data.store);
    expect(pub).not.toBeNull();
    expect(JSON.stringify(pub)).not.toContain("INTERNAL-ONLY");
    expect(Object.keys(pub!)).not.toContain("adminNote");
    expect(JSON.stringify(await view.accountOrders("cust", data.store))).not.toContain("INTERNAL-ONLY");

    sent.length = 0;
    await ops.markPaid(id, { paymentMethod: "Zelle" });
    await ops.markShipped(id, { trackingNumber: "9400100000000000000000", carrier: "USPS" });
    await ops.markDelivered(id);
    expect(sent.map((e) => e.subject)).toEqual([expect.stringContaining("Payment confirmed"), expect.stringContaining("has shipped"), expect.stringContaining("How was your order")]);
    for (const e of sent) expect(e.html + e.text + e.subject).not.toContain("INTERNAL-ONLY");
    // Marking paid, shipped and delivered keeps the note.
    expect((await ser.loadAll()).orders.find((o) => o.id === id)!.adminNote).toBe(SECRET);
  });

  it("does not change the money of the order", async () => {
    const before = await ledgerNow();
    await prisma.order.update({ where: { id }, data: { adminNote: "changed" } });
    const after = await ledgerNow();
    expect(after.businessCents).toBe(before.businessCents);
    expect(after.orders.get(id)).toEqual(before.orders.get(id));
    await prisma.order.update({ where: { id }, data: { adminNote: SECRET } });
  });

  it("survives a backup and restore", async () => {
    const backup = await ser.loadBackup();
    await restoreMod.restore(JSON.parse(JSON.stringify(backup)));
    expect((await ser.loadAll()).orders.find((o) => o.id === id)!.adminNote).toBe(SECRET);
    await setStore();
  });
});

// ---------------------------------------------------------------- Unpaid reminder
describe("unpaid order reminder", () => {
  let id = "";
  let placedAt = 0;
  const HOUR = 3600_000;

  it("is not sent before the halfway point", async () => {
    await setStore();
    const placed = await checkout();
    id = placed.id;
    placedAt = (await prisma.order.findUnique({ where: { id } }))!.placedAt!.getTime();
    sent.length = 0;
    expect(await ops.sendUnpaidReminders(new Date(placedAt + 11 * HOUR + 59 * 60_000))).toBe(0);
    expect(sent).toEqual([]);
  });

  it("is not sent while the switch is off", async () => {
    await setStore({ unpaidReminder: false });
    expect(await ops.sendUnpaidReminders(new Date(placedAt + 13 * HOUR))).toBe(0);
    expect(sent).toEqual([]);
    expect((await prisma.order.findUnique({ where: { id } }))!.reminderSentAt).toBeNull();
    await setStore();
  });

  it("is sent once at the halfway point, with instructions and the time left", async () => {
    const now = new Date(placedAt + 12 * HOUR + 60_000);
    expect(await ops.sendUnpaidReminders(now)).toBe(1);
    expect(sent).toHaveLength(1);
    const e = sent[0];
    const number = (await prisma.order.findUnique({ where: { id } }))!.number;
    expect(e.to).toEqual(["dana@example.com"]);
    expect(e.subject).toBe(`Reminder: order #${number} is waiting for payment`);
    expect(e.from).toMatch(/^Buckshot Labs </);
    for (const s of ["$46.95", "pay@buckshot.test", `Put your order number in the memo: ${number}`, "about 12 hours", "/order/"]) expect(e.text).toContain(s);
    const row = (await prisma.order.findUnique({ where: { id } }))!;
    expect(row.reminderSentAt?.getTime()).toBe(now.getTime());
    expect(row.status).toBe("awaiting_payment");
    const events = await prisma.orderEvent.findMany({ where: { orderId: id, kind: "email" } });
    expect(events.map((x) => x.message)).toContain("Payment reminder email: Sent");
  });

  it("is never sent twice", async () => {
    expect(await ops.sendUnpaidReminders(new Date(placedAt + 13 * HOUR))).toBe(0);
    expect(await ops.sendUnpaidReminders(new Date(placedAt + 20 * HOUR))).toBe(0);
    expect(sent).toEqual([]);
  });

  it("is not sent for paid, canceled or expired orders, and auto-cancel still works after it", async () => {
    const paid = await checkout();
    await ops.markPaid(paid.id, { paymentMethod: "Zelle", notify: false });
    const canceled = await checkout();
    await ops.cancelOrder(canceled.id, "Canceled by the store", { notify: false });
    const fresh = await checkout();
    const freshPlaced = (await prisma.order.findUnique({ where: { id: fresh.id } }))!.placedAt!.getTime();
    sent.length = 0;
    // Past the deadline: nothing to remind about (auto-cancel handles it).
    expect(await ops.sendUnpaidReminders(new Date(freshPlaced + 25 * HOUR))).toBe(0);
    expect(sent).toEqual([]);
    expect(await ops.autoCancelDue(new Date(freshPlaced + 25 * HOUR))).toBeGreaterThanOrEqual(1);
    expect((await prisma.order.findUnique({ where: { id: fresh.id } }))!.status).toBe("canceled");
    expect((await prisma.order.findUnique({ where: { id } }))!.status).toBe("canceled");
  });

  it("reminderDue follows the order's own auto-cancel window", () => {
    const placed = new Date("2026-03-01T00:00:00Z");
    const o = { placedAt: placed, expiresAt: new Date("2026-03-03T00:00:00Z"), reminderSentAt: null, status: "awaiting_payment" };
    expect(ops.reminderDue(o, new Date("2026-03-01T23:59:00Z"))).toBe(false);
    expect(ops.reminderDue(o, new Date("2026-03-02T00:00:00Z"))).toBe(true);
    expect(ops.reminderDue(o, new Date("2026-03-03T00:00:00Z"))).toBe(false);
    expect(ops.reminderDue({ ...o, reminderSentAt: placed }, new Date("2026-03-02T01:00:00Z"))).toBe(false);
    expect(ops.reminderDue({ ...o, status: "paid" }, new Date("2026-03-02T01:00:00Z"))).toBe(false);
  });
});

// ---------------------------------------------------------------- Low stock alert
describe("low stock alert email", () => {
  const sale = (idSuffix: string, qty: number) =>
    prisma.order.create({ data: { id: `ip-${idSuffix}`, date: new Date(), soldBy: "A", lines: { create: [{ id: `ip-${idSuffix}-l`, productId: "r10", productName: "Reta 10mg", quantity: qty, unitPriceCents: 7000, unitCostCents: 2000, cutPercent: 10 }] } } });

  it("a sale that keeps stock above the warning level sends nothing", async () => {
    await setStore();
    expect((await ledgerNow()).stock.get("r10")!.stock).toBe(6);
    await alerts.withLowStockAlert(() => sale("1", 2)); // 6 -> 4, warning at 3
    expect(sent).toEqual([]);
  });

  it("the sale that reaches the warning level emails the alert list once", async () => {
    await alerts.withLowStockAlert(() => sale("2", 1), "https://buckshotlabs.test"); // 4 -> 3
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(["owner@buckshot.test"]);
    expect(sent[0].subject).toBe("Low stock: Reta 10mg (3 left)");
    expect(sent[0].text).toContain("Reta 10mg: 3 left (warning at 3)");
    expect(sent[0].text).toContain("https://buckshotlabs.test/admin/inventory");
  });

  it("further sales while already low do not email again", async () => {
    await alerts.withLowStockAlert(() => sale("3", 1)); // 3 -> 2
    expect(sent).toEqual([]);
  });

  it("marking a website order paid can trigger it too, and a stock adjustment as well", async () => {
    await prisma.purchase.create({ data: { id: "pu-r10b", date: new Date(), productId: "r10", quantity: 3, totalCostCents: 6000, fromInvestment: true } }); // 2 -> 5
    const placed = await checkout({ items: [{ variantId: "r10", quantity: 2 }], expectedTotalCents: 13300 + 695 });
    sent.length = 0;
    // Awaiting payment takes no stock, so no alert yet.
    expect((await ledgerNow()).stock.get("r10")!.stock).toBe(5);
    await alerts.withLowStockAlert(() => ops.markPaid(placed.id, { paymentMethod: "Zelle", notify: false })); // 5 -> 3
    expect(sent.map((e) => e.subject)).toEqual(["Low stock: Reta 10mg (3 left)"]);

    sent.length = 0;
    await alerts.withLowStockAlert(() => prisma.stockAdjustment.create({ data: { id: "adj-kpv", date: new Date(), productId: "kpv", quantity: -16, reason: "breakage" } }));
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/^Low stock: KPV \(\d left\)$/);
  });

  it("is silent when the switch is off or there is no alert email, and never blocks the sale", async () => {
    await prisma.purchase.create({ data: { id: "pu-r10c", date: new Date(), productId: "r10", quantity: 5, totalCostCents: 10000, fromInvestment: true } }); // 3 -> 8
    await setStore({ lowStockAlerts: false });
    await alerts.withLowStockAlert(() => sale("4", 5)); // 8 -> 3
    expect(sent).toEqual([]);
    await prisma.purchase.create({ data: { id: "pu-r10d", date: new Date(), productId: "r10", quantity: 5, totalCostCents: 10000, fromInvestment: true } }); // 3 -> 8
    await setStore({ alertEmails: [] });
    await alerts.withLowStockAlert(() => sale("5", 5));
    expect(sent).toEqual([]);
    expect(await prisma.order.findUnique({ where: { id: "ip-5" } })).not.toBeNull();
    // An error inside the change itself is passed on, not swallowed.
    await expect(alerts.withLowStockAlert(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    await setStore();
  });
});

// ---------------------------------------------------------------- Analytics
describe("analytics counters", () => {
  it("count per day and metric, and per product for product metrics", async () => {
    await prisma.analyticsDay.deleteMany();
    const now = new Date("2026-03-02T17:00:00Z");
    await analytics.track("visit", "", now);
    await analytics.track("visit", "", now);
    await analytics.track("visit", "", new Date("2026-03-01T17:00:00Z"));
    await analytics.track("product_view", "l-reta", now);
    await analytics.track("product_view", "l-reta", now);
    await analytics.track("add_to_cart", "l-reta", now);
    await analytics.track("checkout_start", "", now);
    const s = await analytics.analyticsSummary(7, now);
    expect(s.days).toBe(7);
    expect(s.to).toBe("2026-03-02");
    expect(s.totals).toEqual({ visit: 3, product_view: 2, add_to_cart: 1, checkout_start: 1, order: 0 });
    expect(s.daily.at(-1)).toEqual({ day: "2026-03-02", visit: 2, product_view: 2, add_to_cart: 1, checkout_start: 1, order: 0 });
    expect(s.daily.at(-2)!.visit).toBe(1);
    expect(s.products).toEqual([{ id: "l-reta", views: 2, addToCarts: 1 }]);
    expect((await analytics.analyticsSummary(30, now)).daily).toHaveLength(30);
  });

  it("placing an order adds one order to today's count", async () => {
    const today = analytics.analyticsDay();
    const before = (await prisma.analyticsDay.findUnique({ where: { day_metric_key: { day: today, metric: "order", key: "" } } }))?.count ?? 0;
    await checkout();
    const after = (await prisma.analyticsDay.findUnique({ where: { day_metric_key: { day: today, metric: "order", key: "" } } }))!.count;
    expect(after).toBe(before + 1);
  });

  it("the table holds nothing but day, metric, key and count", async () => {
    const rows = await prisma.analyticsDay.findMany();
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["count", "day", "key", "metric"]);
    for (const r of rows) expect(r.key === "" || r.key.startsWith("l-")).toBe(true);
  });
});

// ---------------------------------------------------------------- Tokens and lockout
describe("order status and review tokens cannot be guessed or enumerated", () => {
  it("tokens are 192 random bits, URL safe, and never repeat", () => {
    const tokens = Array.from({ length: 2000 }, () => ops.newToken());
    expect(new Set(tokens).size).toBe(2000);
    for (const t of tokens.slice(0, 50)) expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("an order is only found by its exact token: not by number, id, a prefix or a near miss", async () => {
    const data = await ser.loadAll();
    const placed = await checkout();
    const row = (await prisma.order.findUnique({ where: { id: placed.id } }))!;
    expect(await view.publicOrderByToken(placed.token, data.store)).toMatchObject({ number: row.number });
    const flipped = placed.token.slice(0, -1) + (placed.token.endsWith("A") ? "B" : "A");
    for (const guess of [String(row.number), placed.id, placed.token.slice(0, 16), placed.token.slice(0, 31), flipped, placed.token.toLowerCase() === placed.token ? placed.token.toUpperCase() : placed.token.toLowerCase(), "", "1001", "%", "_".repeat(32)]) {
      expect(await view.publicOrderByToken(guess, data.store), guess).toBeNull();
    }
  });

  it("order tokens and review tokens are different secrets, and consecutive orders share nothing", async () => {
    const a = await checkout();
    const b = await checkout();
    expect(a.token).not.toBe(b.token);
    expect(b.number).toBe(a.number + 1); // numbers are sequential, tokens are not derived from them
    await ops.markPaid(a.id, { paymentMethod: "Zelle", notify: false });
    await ops.markDelivered(a.id);
    const row = (await prisma.order.findUnique({ where: { id: a.id } }))!;
    expect(row.reviewToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(row.reviewToken).not.toBe(row.token);
    // The review link is only handed out on the order page after delivery.
    const data = await ser.loadAll();
    expect((await view.publicOrderByToken(a.token, data.store))!.reviewToken).toBe(row.reviewToken);
    expect((await view.publicOrderByToken(b.token, data.store))!.reviewToken).toBeNull();
  });
});

describe("admin login lockout", () => {
  it("locks after 5 wrong passwords in a row, and longer after 10", () => {
    const key = "admin:test-lockout";
    for (let i = 0; i < 4; i++) rate.recordFailure(key);
    expect(rate.lockedFor(key)).toBe(0);
    rate.recordFailure(key);
    expect(rate.lockedFor(key)).toBe(5);
    for (let i = 0; i < 5; i++) rate.recordFailure(key);
    expect(rate.lockedFor(key)).toBe(10);
    // Another client is not affected, and a correct login clears the count.
    expect(rate.lockedFor("admin:someone-else")).toBe(0);
    rate.clearFailures(key);
    expect(rate.lockedFor(key)).toBe(0);
  });

  it("general rate limits stop a client after the allowed number of tries", () => {
    const k = `lookup:test-${Date.now()}`;
    for (let i = 0; i < 10; i++) expect(rate.allow(k, 10, 600_000)).toBe(true);
    expect(rate.allow(k, 10, 600_000)).toBe(false);
  });
});
