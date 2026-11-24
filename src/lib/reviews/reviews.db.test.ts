// Customer reviews: guest reviews, the sign in / guest choice, "Verified order", one review per order,
// spam protection, the safety filter, photo approval, EXIF stripping and the automatic review request email.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isValidElement, type ReactNode } from "react";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FLAG_WORDS, flagReason, isGibberish } from "./rules";

// The signed-in customer for the "Write a review" page (null = signed out).
const signedIn: { account: null | { id: string; name: string; email: string; phone: string; addresses: never[]; mustChangePassword: boolean } } = { account: null };
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {} }) }));
vi.mock("@/lib/account", () => ({ currentAccount: async () => signedIn.account }));

const dir = mkdtempSync(path.join(tmpdir(), "reviews-test-"));
const root = path.resolve(import.meta.dirname, "../../..");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").split(path.sep).join("/")}`;
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.RESEND_API_KEY = "re_test_key";

let prisma: (typeof import("../db"))["prisma"];
let rv: typeof import("./ops");
let dataDir: typeof import("../data-dir");

const sent: { to: string[]; subject: string; html: string; text: string }[] = [];
const STORE = { open: true, siteUrl: "https://shop.test", payments: { zelle: { enabled: true, details: "pay@x.test" } }, alertEmails: [] };
const setStore = (over: Record<string, unknown> = {}) => prisma.settings.update({ where: { id: 1 }, data: { storeJson: JSON.stringify({ ...STORE, ...over }) } });
const DAY = 24 * 3600_000;

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("../db"));
  rv = await import("./ops");
  dataDir = await import("../data-dir");
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith("https://api.resend.com/")) {
      const b = JSON.parse(String(init?.body));
      sent.push({ to: b.to, subject: b.subject, html: b.html, text: b.text });
      return new Response(JSON.stringify({ id: `email-${sent.length}` }), { status: 200 });
    }
    throw new Error(`Unexpected network call: ${url}`);
  });
  await prisma.settings.create({ data: { id: 1, startingBalanceCents: 0, storeJson: JSON.stringify(STORE) } });
  await prisma.listing.create({ data: { id: "l-ghk", name: "GHK-Cu", slug: "ghk-cu", showOnWebsite: true } });
  await prisma.product.create({ data: { id: "ghk", name: "GHK-Cu", variantLabel: "100mg", defaultPriceCents: 5000, listingId: "l-ghk" } });
}, 120_000);

beforeEach(async () => {
  sent.length = 0;
  signedIn.account = null;
  await prisma.reviewPhoto.deleteMany();
  await prisma.review.deleteMany();
  await prisma.orderEvent.deleteMany();
  await prisma.order.deleteMany();
  await prisma.customer.deleteMany();
  await setStore();
  await prisma.customer.create({ data: { id: "dana", name: "Dana Reed", email: "dana@example.com" } });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

let nextNumber = 3000;
/** A paid website order for Dana: 1 x $50 + $6.95 shipping, in the given status. */
async function order(status: string, over: Record<string, unknown> = {}) {
  const id = randomUUID();
  const now = Date.now();
  await prisma.order.create({
    data: {
      id,
      number: nextNumber++,
      date: new Date(now - 10 * DAY),
      placedAt: new Date(now - 10 * DAY),
      source: "online",
      status,
      soldBy: "W",
      customer: "Dana Reed",
      customerId: "dana",
      email: "dana@example.com",
      shippingCents: 695,
      paymentMethod: "Zelle",
      token: randomUUID(),
      reviewToken: randomUUID().replace(/-/g, ""),
      paidAt: status === "awaiting_payment" || status === "canceled" ? null : new Date(now - 9 * DAY),
      shippedAt: ["shipped", "delivered"].includes(status) ? new Date(now - 8 * DAY) : null,
      deliveredAt: ["delivered", "picked_up"].includes(status) ? new Date(now - 5 * DAY) : null,
      lines: { create: [{ id: randomUUID(), productId: "ghk", productName: "GHK-Cu", quantity: 1, unitPriceCents: 5000, unitCostCents: 1000, cutPercent: 10 }] },
      ...over,
    },
  });
  return prisma.order.findUniqueOrThrow({ where: { id } });
}

let ipCounter = 0;
const freshIp = () => `10.0.0.${++ipCounter}`;
const base = { rating: 5, title: "", text: "Fast shipping and great packaging, thank you!", displayName: "Dana R.", email: "dana@example.com" };
const submit = (over: Partial<import("./ops").ReviewSubmit> = {}, ctx: Partial<{ ip: string; account: { id: string; email: string } | null; photos: Buffer[] }> = {}) =>
  rv.submitReview({ ...base, ...over }, { ip: ctx.ip ?? freshIp(), account: ctx.account ?? null, photos: ctx.photos ?? [] });

const jpeg = (gps = false) =>
  sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 200, g: 60, b: 40 } } })
    .jpeg()
    .withExif({ IFD0: { Make: "TestCamera", Model: "Phone 15", Artist: "Dana" }, ...(gps ? { IFD3: { GPSLatitudeRef: "N", GPSLatitude: "42/1 19/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "83/1 10/1 0/1" } } : {}) })
    .toBuffer();

/** The props of a component anywhere in a server page's element tree (client components are not run on the server). */
function propsOf(node: ReactNode, type: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const p = propsOf(n, type);
      if (p) return p;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === type) return node.props as Record<string, unknown>;
  return propsOf((node.props as { children?: ReactNode }).children, type);
}
const contains = (node: ReactNode, type: unknown) => propsOf(node, type) !== null;

// ---------------------------------------------------------------- No account needed
describe("reviews work without an account", () => {
  it("a guest can leave a review with name and email only; the email is never in the public data", async () => {
    const r = await submit({ email: "someone@else.test", displayName: "Sam" });
    expect(r).toEqual({ status: "approved", message: "Thanks! Your review is live." });
    const row = await prisma.review.findFirstOrThrow();
    expect(row).toMatchObject({ source: "guest", verified: false, orderId: null, email: "someone@else.test", status: "approved" });
    expect(row.ipHash).toMatch(/^[a-f0-9]{32}$/);
    const list = await rv.listPublicReviews({});
    expect(list.total).toBe(1);
    expect(JSON.stringify(list)).not.toContain("someone@else.test");
    expect(JSON.stringify(list)).not.toContain(row.ipHash);
  });

  it("the form fields are checked: rating, 10 to 1000 characters, name and a real email", async () => {
    await expect(submit({ rating: 0 })).rejects.toThrow(/star rating/);
    await expect(submit({ text: "Too short" })).rejects.toThrow(/at least 10/);
    await expect(submit({ text: "x".repeat(10) + " ok ".repeat(300) })).rejects.toThrow(/under 1000/);
    await expect(submit({ displayName: "  " })).rejects.toThrow(/display name/);
    await expect(submit({ email: "nope" })).rejects.toThrow(/valid email/);
    expect(await prisma.review.count()).toBe(0);
  });
});

// ---------------------------------------------------------------- Sign in / guest choice
describe("the sign in / guest choice", () => {
  it("shows when signed out, skips to the form for guests and signed-in customers (prefilled)", async () => {
    const { default: WriteReviewPage } = await import("@/app/(store)/(shop)/reviews/write/page");
    const { ReviewChoice, ReviewForm } = await import("@/components/storefront/reviews");
    const out = await WriteReviewPage({ searchParams: Promise.resolve({}) });
    expect(contains(out, ReviewChoice)).toBe(true);
    expect(contains(out, ReviewForm)).toBe(false);

    const guest = await WriteReviewPage({ searchParams: Promise.resolve({ guest: "1" }) });
    expect(contains(guest, ReviewChoice)).toBe(false);
    expect(contains(guest, ReviewForm)).toBe(true);

    const o = await order("delivered");
    signedIn.account = { id: "dana", name: "Dana Reed", email: "dana@example.com", phone: "", addresses: [], mustChangePassword: false };
    const mine = await WriteReviewPage({ searchParams: Promise.resolve({ order: String(o.number) }) });
    expect(contains(mine, ReviewChoice)).toBe(false);
    expect(propsOf(mine, ReviewForm)).toMatchObject({ defaultName: "Dana R.", defaultEmail: "dana@example.com", initialOrder: o.number, orders: [expect.objectContaining({ number: o.number })] });
  });

  it("is skipped from the email link: straight to the form for that order, rating preselected", async () => {
    const o = await order("delivered");
    const { default: ReviewPage } = await import("@/app/(store)/review/[token]/page");
    const { ReviewChoice, ReviewForm } = await import("@/components/storefront/reviews");
    const out = await ReviewPage({ params: Promise.resolve({ token: o.reviewToken! }), searchParams: Promise.resolve({ rating: "4" }) });
    expect(contains(out, ReviewChoice)).toBe(false);
    expect(contains(out, ReviewForm)).toBe(true);
    expect(propsOf(out, ReviewForm)).toMatchObject({ token: o.reviewToken, orderNumber: o.number, initialRating: 4, defaultName: "Dana R.", defaultEmail: "dana@example.com" });
  });
});

// ---------------------------------------------------------------- Verified order
describe("Verified order badge", () => {
  it("from the order email link: verified and tied to that order", async () => {
    const o = await order("delivered");
    await submit({ token: o.reviewToken!, email: "typed-anything@x.test" });
    expect(await prisma.review.findFirstOrThrow()).toMatchObject({ verified: true, orderId: o.id, source: "email_link" });
  });

  it("guest whose email matches a paid, delivered / picked up / shipped order: verified", async () => {
    for (const status of ["delivered", "picked_up", "shipped"]) {
      await prisma.review.deleteMany();
      await prisma.order.deleteMany();
      const o = await order(status);
      await submit({ email: "DANA@example.com " });
      expect(await prisma.review.findFirstOrThrow()).toMatchObject({ verified: true, orderId: o.id, source: "guest" });
    }
  });

  it("no badge for an email with no order, or only an unpaid / not yet shipped / canceled / fully refunded order", async () => {
    await order("awaiting_payment");
    await order("paid");
    await order("canceled");
    await order("delivered", { refundedCents: 5695 });
    await submit();
    await submit({ email: "stranger@x.test" });
    const rows = await prisma.review.findMany();
    expect(rows.map((r) => r.verified)).toEqual([false, false]);
    expect(rows.every((r) => r.orderId === null)).toBe(true);
  });

  it("signed in: picks one of their own orders; someone else's order number is refused", async () => {
    const o = await order("delivered");
    await prisma.customer.create({ data: { id: "eve", name: "Eve", email: "eve@x.test" } });
    await expect(submit({ orderNumber: o.number, email: "eve@x.test" }, { account: { id: "eve", email: "eve@x.test" } })).rejects.toThrow(/can't be reviewed/);
    await submit({ orderNumber: o.number }, { account: { id: "dana", email: "dana@example.com" } });
    expect(await prisma.review.findFirstOrThrow()).toMatchObject({ verified: true, orderId: o.id, source: "account" });
  });

  it("an invalid or made-up email link is refused", async () => {
    await expect(submit({ token: "x".repeat(32) })).rejects.toThrow(/not valid/);
    const unpaid = await order("awaiting_payment");
    await expect(submit({ token: unpaid.reviewToken! })).rejects.toThrow(/not valid/);
  });
});

// ---------------------------------------------------------------- One review per order
describe("one review per order", () => {
  it("the email link works once", async () => {
    const o = await order("delivered");
    await submit({ token: o.reviewToken! });
    await expect(submit({ token: o.reviewToken! })).rejects.toThrow(/already/);
    expect(await prisma.review.count()).toBe(1);
  });

  it("the same email can't review its only order twice (link, then as a guest)", async () => {
    const o = await order("delivered");
    await submit({ token: o.reviewToken! });
    await expect(submit()).rejects.toThrow(/already reviewed your order/);
  });

  it("a second order can be reviewed: the guest review goes to the order not reviewed yet", async () => {
    const a = await order("delivered");
    const b = await order("delivered");
    await submit({ token: a.reviewToken! });
    await submit();
    expect((await prisma.review.findMany()).map((r) => r.orderId).sort()).toEqual([a.id, b.id].sort());
  });
});

// ---------------------------------------------------------------- Spam
describe("spam protection", () => {
  it("honeypot: a filled hidden field gets the normal thanks and nothing is saved", async () => {
    const r = await submit({ website: "http://spam.example" });
    expect(r.message).toBe("Thanks! Your review is live.");
    expect(await prisma.review.count()).toBe(0);
  });

  it("at most 3 reviews per IP per day", async () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < 3; i++) await submit({ email: `p${i}@x.test` }, { ip });
    await expect(submit({ email: "p4@x.test" }, { ip })).rejects.toMatchObject({ status: 429 });
    // A day later the same IP can review again.
    await prisma.review.updateMany({ data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    await expect(submit({ email: "p5@x.test" }, { ip })).resolves.toBeTruthy();
  });

  it("at most 3 reviews per email per day (from any IP)", async () => {
    for (let i = 0; i < 3; i++) await submit({ email: "busy@x.test" });
    await expect(submit({ email: "busy@x.test" })).rejects.toMatchObject({ status: 429 });
  });

  it("obvious gibberish is rejected; normal short reviews are not", async () => {
    for (const t of ["asdfghjkl asdfghjkl", "aaaaaaaaaaaaaaa", "qwrtp zxcvb mnbvc", "!!!!!!!!!!!!!!!!!!!!!", "sdfg hjkl wrtp xcvb"]) {
      expect(isGibberish(t)).toBe(true);
      await expect(submit({ text: t })).rejects.toThrow(/doesn't look like a review/);
    }
    for (const t of ["Arrived in 3 days, well packed.", "Great service!!", "Fast. Would order again.", "Shipping was quick and the box was sealed."]) expect(isGibberish(t)).toBe(false);
  });
});

// ---------------------------------------------------------------- Safety filter
describe("auto-approval with the safety filter", () => {
  it("clean text publishes instantly", async () => {
    const r = await submit({ text: "Order came quickly, packed with ice packs. Support answered my email the same day." });
    expect(r.status).toBe("approved");
    expect((await rv.listPublicReviews({})).total).toBe(1);
  });

  it.each([
    ["What dose did you use? I pin twice a week", "dose"],
    ["I lost 12 lbs on this", "lost lbs"],
    ["Running 2 mg a week, great results", "mg a week"],
    ["Injecting it was easy", "injecting"],
    ["My cycle went great with this stack", "cycle"],
    ["Fewer side effects than expected", "side effects"],
    ["Great shop, visit www.cheap-peps.com", "Link"],
    ["Text me at 313-555-0134 for more", "Phone"],
    ["Fucking fast shipping", "Profanity"],
  ])("“%s” goes to Needs review and stays hidden", async (text, why) => {
    const r = await submit({ text });
    expect(r).toEqual({ status: "pending", message: "Thanks! Your review will appear after a quick check." });
    const row = await prisma.review.findFirstOrThrow();
    expect(row.status).toBe("pending");
    expect(row.flagReason.toLowerCase()).toContain(why.toLowerCase());
    expect((await rv.listPublicReviews({})).total).toBe(0);
  });

  it("matches whole words only: spinning, bicycle and dosed-up are not flagged; the owner's edited list is used", async () => {
    expect(flagReason({ text: "The box was spinning on the bicycle delivery" }, DEFAULT_FLAG_WORDS)).toBe("");
    await setStore({ reviews: { flagWords: ["late"] } });
    expect((await submit({ text: "Results were not what I care about, shipping was fine" })).status).toBe("approved");
    expect((await submit({ text: "The package came late but support helped" })).status).toBe("pending");
  });
});

// ---------------------------------------------------------------- Photos
describe("photos", () => {
  it("strip EXIF (camera, location) and are saved privately, resized", async () => {
    const input = await jpeg(true);
    const meta = await sharp(input).metadata();
    expect(meta.exif).toBeDefined();
    expect(meta.exif!.toString("latin1")).toContain("TestCamera");
    await submit({}, { photos: [input] });
    const p = await prisma.reviewPhoto.findFirstOrThrow();
    for (const w of [480, 1600]) {
      const file = path.join(dataDir.privateUploadsDir(), `${p.file}-${w}.webp`);
      expect(existsSync(file)).toBe(true);
      expect(existsSync(path.join(dataDir.publicUploadsDir(), `${p.file}-${w}.webp`))).toBe(false);
      const out = await sharp(file).metadata();
      expect(out.exif).toBeUndefined();
      expect(out.xmp).toBeUndefined();
      expect(out.width).toBeLessThanOrEqual(w);
    }
  });

  it("only JPG, PNG or WebP, at most 5, at most 8 MB", async () => {
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).gif().toBuffer();
    await expect(submit({}, { photos: [gif] })).rejects.toThrow(/JPG, PNG or WebP/);
    const one = await jpeg();
    await expect(submit({}, { photos: [one, one, one, one, one, one] })).rejects.toThrow(/up to 5/);
    await expect(submit({}, { photos: [Buffer.alloc(8 * 1024 * 1024 + 1, 1)] })).rejects.toThrow(/8 MB/);
    expect(await prisma.review.count()).toBe(0);
  });

  it("stay hidden until approved, then show immediately; unapproved photos never show but the text stays live", async () => {
    const { GET } = await import("@/app/api/store/review-photo/[name]/route");
    const get = (name: string) => GET(new Request(`http://x/api/store/review-photo/${name}`), { params: Promise.resolve({ name }) });
    const r = await submit({}, { photos: [await jpeg(), await jpeg()] });
    expect(r.status).toBe("approved");
    const review = await prisma.review.findFirstOrThrow({ include: { photos: { orderBy: { sort: "asc" } } } });
    const [a, b] = review.photos;
    expect(review.photos.map((p) => p.status)).toEqual(["pending", "pending"]);

    // Text is live, photos are not: not in the list, not servable even with the exact address.
    let list = await rv.listPublicReviews({});
    expect(list.total).toBe(1);
    expect(list.reviews[0].photos).toEqual([]);
    expect((await get(`${a.file}-480.webp`)).status).toBe(404);
    expect((await rv.listPublicReviews({ withPhotos: true })).total).toBe(0);

    // Approve one: it shows right away (no cache in between). The other stays hidden forever when rejected.
    await rv.setPhotoStatus(review.id, a.id, "approved");
    await rv.setPhotoStatus(review.id, b.id, "rejected");
    list = await rv.listPublicReviews({});
    expect(list.reviews[0].photos.map((p) => p.file)).toEqual([a.file]);
    const ok = await get(`${a.file}-1600.webp`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/webp");
    expect((await get(`${b.file}-1600.webp`)).status).toBe(404);
    expect((await rv.listPublicReviews({ withPhotos: true })).total).toBe(1);

    // Hiding the review takes its approved photo off the site too.
    await prisma.review.update({ where: { id: review.id }, data: { status: "hidden" } });
    expect((await get(`${a.file}-1600.webp`)).status).toBe(404);
  });

  it("photos on flagged text stay hidden too until the text is approved", async () => {
    await submit({ text: "Great results from this order" }, { photos: [await jpeg()] });
    const review = await prisma.review.findFirstOrThrow({ include: { photos: true } });
    await rv.setPhotoStatus(review.id, review.photos[0].id, "approved");
    expect(await rv.publicPhotoAllowed(review.photos[0].file)).toBe(false);
    await prisma.review.update({ where: { id: review.id }, data: { status: "approved" } });
    expect(await rv.publicPhotoAllowed(review.photos[0].file)).toBe(true);
  });

  it("deleting a review removes its photo files", async () => {
    await submit({}, { photos: [await jpeg()] });
    const review = await prisma.review.findFirstOrThrow({ include: { photos: true } });
    const file = path.join(dataDir.privateUploadsDir(), `${review.photos[0].file}-480.webp`);
    expect(existsSync(file)).toBe(true);
    await rv.deleteReview(review.id);
    expect(existsSync(file)).toBe(false);
    expect(await prisma.reviewPhoto.count()).toBe(0);
  });
});

// ---------------------------------------------------------------- Public page data
describe("public reviews page data", () => {
  it("average, count, star breakdown; sort, verified filter and pages", async () => {
    const o = await order("delivered");
    await submit({ token: o.reviewToken!, rating: 5 });
    await submit({ email: "a@x.test", rating: 4 });
    await submit({ email: "b@x.test", rating: 1, text: "Took two weeks to arrive, sadly." });
    await submit({ email: "c@x.test", text: "My protocol is simple" }); // flagged: not counted
    const s = await rv.reviewSummary();
    expect(s).toEqual({ count: 3, average: 3.3, breakdown: [{ stars: 5, count: 1 }, { stars: 4, count: 1 }, { stars: 3, count: 0 }, { stars: 2, count: 0 }, { stars: 1, count: 1 }] });
    expect((await rv.listPublicReviews({ sort: "highest" })).reviews.map((r) => r.rating)).toEqual([5, 4, 1]);
    expect((await rv.listPublicReviews({ sort: "lowest" })).reviews.map((r) => r.rating)).toEqual([1, 4, 5]);
    expect((await rv.listPublicReviews({ verifiedOnly: true })).reviews.map((r) => r.verified)).toEqual([true]);
    const p2 = await rv.listPublicReviews({ perPage: 2, page: 2 });
    expect([p2.page, p2.pages, p2.reviews.length]).toEqual([2, 2, 1]);
    expect((await rv.latestGoodReviews()).map((r) => r.rating).sort()).toEqual([4, 5]);
  });
});

// ---------------------------------------------------------------- Review request email
describe("review request email", () => {
  const run = (daysFromNow: number) => rv.sendReviewRequests({ now: new Date(Date.now() + daysFromNow * DAY) });

  it("sends once, X days after delivery, with a 5-star row and a Write a review button", async () => {
    const o = await order("delivered", { deliveredAt: new Date() });
    expect(await run(2.9)).toBe(0);
    expect(sent).toHaveLength(0);
    expect(await run(3.1)).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("How was your Buckshot Labs order?");
    expect(sent[0].to).toEqual(["dana@example.com"]);
    for (let n = 1; n <= 5; n++) expect(sent[0].html).toContain(`https://shop.test/review/${o.reviewToken}?rating=${n}`);
    expect(sent[0].html).toContain("Write a review");
    // Never twice.
    expect(await run(4)).toBe(0);
    expect(await run(10)).toBe(0);
    expect(sent).toHaveLength(1);
    const events = await prisma.orderEvent.findMany({ where: { orderId: o.id } });
    expect(events.map((e) => e.message)).toContain("Review request sent");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).reviewRequestSentAt).not.toBeNull();
  });

  it("the link in it works without an account and gives a Verified order", async () => {
    const o = await order("delivered", { deliveredAt: new Date() });
    await run(3.1);
    const token = /\/review\/([A-Za-z0-9_-]+)\?rating=5/.exec(sent[0].html)![1];
    expect(token).toBe(o.reviewToken);
    await submit({ token, rating: 5 });
    expect(await prisma.review.findFirstOrThrow()).toMatchObject({ verified: true, orderId: o.id });
  });

  it("days and on/off come from Settings, Email", async () => {
    await order("delivered", { deliveredAt: new Date() });
    await setStore({ reviews: { requestEmail: true, requestDays: 7 } });
    expect(await run(5)).toBe(0);
    await setStore({ reviews: { requestEmail: false, requestDays: 7 } });
    expect(await run(8)).toBe(0);
    await setStore({ reviews: { requestEmail: true, requestDays: 7 } });
    expect(await run(8)).toBe(1);
  });

  it("local orders: X days after picked up / delivered", async () => {
    await order("picked_up", { fulfillment: "pickup", deliveredAt: new Date() });
    expect(await run(2)).toBe(0);
    expect(await run(3.5)).toBe(1);
  });

  it("shipped orders without a delivery scan: X days after shipping (a week more while tracking shows it moving)", async () => {
    await order("shipped", { shippedAt: new Date(), trackingStatus: "PRE_TRANSIT" });
    await order("shipped", { shippedAt: new Date(), trackingStatus: "TRANSIT" });
    expect(await run(3.1)).toBe(1);
    expect(await run(9)).toBe(0);
    expect(await run(10.1)).toBe(1);
  });

  it("never for canceled or refunded orders, never when the order already has a review", async () => {
    await order("canceled", { deliveredAt: new Date(), canceledAt: new Date() });
    await order("delivered", { deliveredAt: new Date(), refundedCents: 1000 });
    const reviewed = await order("delivered", { deliveredAt: new Date() });
    await submit({ token: reviewed.reviewToken! });
    expect(await run(4)).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("never for an order delivered long ago, or one that already got the old delivery email (migration)", async () => {
    await order("delivered", { deliveredAt: new Date(Date.now() - 60 * DAY) });
    await order("delivered", { deliveredAt: new Date(), reviewRequestSentAt: new Date() });
    expect(await run(4)).toBe(0);
  });
});

// ---------------------------------------------------------------- Manual review requests
describe("manual review requests: eligibility", () => {
  it("only paid, shipped / delivered / picked up orders with no review, not canceled or refunded", async () => {
    const ok = await Promise.all(["shipped", "delivered", "picked_up"].map((s) => order(s, { email: `${s}@x.test` })));
    const unpaid = await order("awaiting_payment", { email: "unpaid@x.test" });
    const notShipped = await order("paid", { email: "notshipped@x.test" });
    const canceled = await order("canceled", { email: "canceled@x.test", canceledAt: new Date() });
    const refunded = await order("delivered", { email: "refunded@x.test", refundedCents: 500 });
    const reviewed = await order("delivered", { email: "reviewed@x.test" });
    await submit({ token: reviewed.reviewToken!, email: "reviewed@x.test" });
    const list = await rv.pastCustomerCandidates();
    expect(list.map((c) => c.orderId).sort()).toEqual(ok.map((o) => o.id).sort());
    expect(list[0]).toMatchObject({ name: "Dana Reed", number: expect.any(Number), date: expect.any(String) });
    for (const [o, why] of [
      [unpaid, /paid and shipped/],
      [notShipped, /paid and shipped/],
      [canceled, /canceled/],
      [refunded, /refunded/],
      [reviewed, /already has a review/],
    ] as const) {
      await expect(rv.sendReviewRequestNow(o.id)).rejects.toThrow(why);
    }
    expect(sent).toHaveLength(0);
  });

  it("the preview skips orders already asked (automatic or manual) and lists one order per customer: the most recent", async () => {
    const older = await order("delivered", { placedAt: new Date(Date.now() - 30 * DAY) });
    const newer = await order("delivered", { placedAt: new Date(Date.now() - 3 * DAY) });
    await order("delivered", { email: "asked@x.test", reviewRequestSentAt: new Date() });
    const list = await rv.pastCustomerCandidates();
    expect(list.map((c) => c.orderId)).toEqual([newer.id]);
    expect(list.map((c) => c.orderId)).not.toContain(older.id);
  });
});

describe("manual review requests: sending", () => {
  it("same email with the manual opening line, verified links, logged as manual", async () => {
    const o = await order("delivered");
    const r = await rv.sendReviewRequestNow(o.id);
    expect(r).toEqual({ sent: true, message: "Review request sent to dana@example.com." });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("How was your Buckshot Labs order?");
    expect(sent[0].text).toContain("We'd love to hear how your order went: shipping speed, packaging and service.");
    expect(sent[0].html).toContain(`https://shop.test/review/${o.reviewToken}?rating=5`);
    const events = await prisma.orderEvent.findMany({ where: { orderId: o.id } });
    expect(events.map((e) => e.message)).toContain("Review request sent (manual)");
    await submit({ token: o.reviewToken!, rating: 5 });
    expect(await prisma.review.findFirstOrThrow()).toMatchObject({ verified: true, orderId: o.id });
  });

  it("never twice to the same order unless resending is confirmed; the date is shown", async () => {
    const o = await order("delivered");
    await rv.sendReviewRequestNow(o.id);
    const day = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    await expect(rv.sendReviewRequestNow(o.id)).rejects.toThrow(`already sent on ${day}`);
    expect(sent).toHaveLength(1);
    await rv.sendReviewRequestNow(o.id, { resend: true });
    expect(sent).toHaveLength(2);
    // The automatic job never sends one after a manual request.
    expect(await rv.sendReviewRequests({ now: new Date(Date.now() + 20 * DAY) })).toBe(0);
    expect(sent).toHaveLength(2);
  });

  it("a double click sends one email", async () => {
    const o = await order("delivered");
    const results = await Promise.allSettled([rv.sendReviewRequestNow(o.id), rv.sendReviewRequestNow(o.id), rv.sendReviewRequestNow(o.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("bulk: one per picked order, never again on a second run, stale or duplicate picks skipped", async () => {
    const a = await order("delivered", { email: "a@x.test" });
    const b = await order("shipped", { email: "b@x.test" });
    const c = await order("delivered", { email: "c@x.test" });
    const ids = (await rv.pastCustomerCandidates()).map((x) => x.orderId);
    expect(ids.sort()).toEqual([a.id, b.id, c.id].sort());
    // c is unticked; a got a manual request after the preview opened.
    await rv.sendReviewRequestNow(a.id);
    sent.length = 0;
    expect(await rv.sendPastCustomerRequests([a.id, b.id, b.id, "made-up-id"])).toEqual({ sent: 1, skipped: 2 });
    expect(sent.map((e) => e.to[0])).toEqual(["b@x.test"]);
    expect(await rv.sendPastCustomerRequests([a.id, b.id])).toEqual({ sent: 0, skipped: 2 });
    expect(sent).toHaveLength(1);
    expect((await prisma.orderEvent.findMany({ where: { orderId: b.id } })).map((e) => e.message)).toContain("Review request sent (manual)");
    expect((await rv.pastCustomerCandidates()).map((x) => x.orderId)).toEqual([c.id]);
  });

  it("bulk: a customer with several orders gets one email, for the most recent", async () => {
    await order("delivered", { placedAt: new Date(Date.now() - 20 * DAY) });
    const recent = await order("delivered", { placedAt: new Date(Date.now() - 2 * DAY) });
    const all = await prisma.order.findMany({ select: { id: true } });
    expect(await rv.sendPastCustomerRequests(all.map((x) => x.id))).toEqual({ sent: 1, skipped: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain(`order #${recent.number}`);
  });

  it("respects the review email on/off switch", async () => {
    const o = await order("delivered");
    await setStore({ reviews: { requestEmail: false, requestDays: 3 } });
    await expect(rv.sendReviewRequestNow(o.id)).rejects.toThrow(/turned off/);
    await expect(rv.sendPastCustomerRequests([o.id])).rejects.toThrow(/turned off/);
    expect(sent).toHaveLength(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).reviewRequestSentAt).toBeNull();
  });

  it("the send-review-request order action is admin-only", async () => {
    const o = await order("delivered");
    const { POST } = await import("@/app/api/orders/[id]/action/route");
    const call = async (payload: Record<string, unknown>) => {
      const { NextRequest } = await import("next/server");
      const req = new NextRequest(`http://localhost/api/orders/${o.id}/action`, { method: "POST", body: JSON.stringify(payload), headers: { "content-type": "application/json" } });
      return POST(req, { params: Promise.resolve({ id: o.id }) });
    };
    // The test admin session is not set, so prove the handler is admin-only first.
    expect((await call({ action: "send-review-request" })).status).toBe(401);
  });
});
