// Customer reviews on the server: submitting one (with the spam checks and the "Verified order" rules),
// the public lists, admin moderation and the automatic review request email.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { HttpError } from "../api";
import { prisma } from "../db";
import { reviewRequestEmail, sendEmail, outcomeText } from "../email";
import { orderTotals } from "../money";
import { emailOrder, getStore, logEvent, siteUrl } from "../order-ops";
import { LINE_SIZE, toOrder } from "../serialize";
import { lineName } from "../size";
import { removeReviewPhoto, saveReviewPhoto } from "../uploads";
import type { ReviewSource, ReviewStatus } from "../types";
import { flagReason, isGibberish, REVIEW_LIMITS, VERIFIED_STATUSES } from "./rules";

const DAY = 24 * 60 * 60_000;
const norm = (email: string) => email.trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** The IP is never stored: only a salted hash, enough to count reviews per day. */
export const ipHash = (ip: string) => createHash("sha256").update(`review-ip:${process.env.SESSION_SECRET ?? ""}:${ip}`).digest("hex").slice(0, 32);

export interface ReviewSubmit {
  rating: number;
  title: string;
  text: string;
  displayName: string;
  email: string;
  /** Honeypot: a hidden field people never see. Anything in it means a bot. */
  website?: string;
  /** Signed-in customers: which of their orders the review is about. */
  orderNumber?: number | null;
  /** The secret link from the order email. */
  token?: string | null;
}

export interface SubmitResult {
  status: ReviewStatus;
  message: string;
}

export const LIVE_MESSAGE = "Thanks! Your review is live.";
export const CHECK_MESSAGE = "Thanks! Your review will appear after a quick check.";

type OrderRow = NonNullable<Awaited<ReturnType<typeof orderWithReview>>>;
const orderWithReview = (where: { id?: string; reviewToken?: string }) => prisma.order.findFirst({ where, include: { lines: LINE_SIZE, review: { select: { id: true } } } });

/** A paid order the customer has (or that is on its way), not canceled and not fully refunded. */
export function verifiableOrder(row: { source: string; status: string; paidAt: Date | null; refundedCents: number } & Parameters<typeof toOrder>[0]): boolean {
  if (row.source !== "online" || !(VERIFIED_STATUSES as readonly string[]).includes(row.status) || !row.paidAt) return false;
  if (row.refundedCents > 0 && row.refundedCents >= orderTotals({ ...toOrder(row), refundedCents: 0 }).total) return false;
  return true;
}

/** The order the review email link points at, when it can still be reviewed. */
export async function orderForToken(token: string): Promise<OrderRow | null> {
  if (!token || token.length < 16) return null;
  const row = await orderWithReview({ reviewToken: token });
  return row && verifiableOrder(row) ? row : null;
}

/** The signed-in customer's orders that can still be reviewed (newest first). */
export async function reviewableOrders(customerId: string, email: string) {
  const rows = await prisma.order.findMany({
    where: { source: "online", OR: [{ customerId }, ...(email ? [{ email: { equals: norm(email) } }] : [])], status: { in: [...VERIFIED_STATUSES] }, review: null },
    include: { lines: LINE_SIZE },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return rows.filter(verifiableOrder).map(
    (r): ReviewableOrder => ({ number: r.number ?? 0, placedAt: (r.placedAt ?? r.date).toISOString(), items: toOrder(r).lines.map((l) => `${l.quantity > 1 ? `${l.quantity}× ` : ""}${lineName(l)}`).join(", ") }),
  );
}

export interface ReviewableOrder {
  number: number;
  placedAt: string;
  items: string;
}

/**
 * Leave a review. No account needed. Throws a plain HttpError the form shows as is.
 * Bots that fill the honeypot get the normal "thanks" answer and nothing is saved.
 */
export async function submitReview(input: ReviewSubmit, ctx: { ip: string; account: { id: string; email: string } | null; photos: Buffer[]; now?: Date }): Promise<SubmitResult> {
  const now = ctx.now ?? new Date();
  if (input.website && input.website.trim()) return { status: "approved", message: LIVE_MESSAGE };

  const rating = Math.round(Number(input.rating));
  if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, "Pick a star rating from 1 to 5.");
  const title = (input.title ?? "").trim().replace(/\s+/g, " ");
  const text = (input.text ?? "").trim();
  const displayName = (input.displayName ?? "").trim().replace(/\s+/g, " ");
  const email = norm(input.email ?? "");
  if (!displayName) throw new HttpError(400, "Enter a display name.");
  if (displayName.length > REVIEW_LIMITS.nameMax) throw new HttpError(400, `Keep the display name under ${REVIEW_LIMITS.nameMax} characters.`);
  if (!EMAIL_RE.test(email) || email.length > 200) throw new HttpError(400, "Enter a valid email address, like name@example.com.");
  if (title.length > REVIEW_LIMITS.titleMax) throw new HttpError(400, `Keep the title under ${REVIEW_LIMITS.titleMax} characters.`);
  if (text.length < REVIEW_LIMITS.textMin) throw new HttpError(400, `Write at least ${REVIEW_LIMITS.textMin} characters about your order.`);
  if (text.length > REVIEW_LIMITS.textMax) throw new HttpError(400, `Keep the review under ${REVIEW_LIMITS.textMax} characters.`);
  if (ctx.photos.length > REVIEW_LIMITS.photos) throw new HttpError(400, `Add up to ${REVIEW_LIMITS.photos} photos.`);
  if (isGibberish(text) || (title && isGibberish(title) && title.length >= 8)) throw new HttpError(400, "That doesn't look like a review. Tell us in a few words how your order went.");

  const since = new Date(now.getTime() - DAY);
  const ip = ipHash(ctx.ip);
  if ((await prisma.review.count({ where: { ipHash: ip, createdAt: { gte: since } } })) >= REVIEW_LIMITS.perIpPerDay) {
    throw new HttpError(429, "You've left the most reviews allowed for today. Please try again tomorrow.");
  }
  if ((await prisma.review.count({ where: { email, createdAt: { gte: since } } })) >= REVIEW_LIMITS.perEmailPerDay) {
    throw new HttpError(429, "This email has left the most reviews allowed for today. Please try again tomorrow.");
  }

  // Which order is it about, and does it earn the "Verified order" badge?
  let orderId: string | null = null;
  let verified = false;
  let source: ReviewSource = ctx.account ? "account" : "guest";
  if (input.token) {
    const row = await orderForToken(input.token);
    if (!row) throw new HttpError(404, "This review link is not valid. Use the link from your order email.");
    if (row.review) throw new HttpError(409, "A review was already left for this order. Thank you!");
    orderId = row.id;
    verified = true;
    source = "email_link";
  } else if (ctx.account && input.orderNumber) {
    const row = await prisma.order.findFirst({ where: { number: input.orderNumber, customerId: ctx.account.id }, include: { lines: LINE_SIZE, review: { select: { id: true } } } });
    if (!row || !verifiableOrder(row)) throw new HttpError(400, `Order #${input.orderNumber} can't be reviewed yet. Reviews open once it has shipped.`);
    if (row.review) throw new HttpError(409, `You already reviewed order #${input.orderNumber}. Thank you!`);
    orderId = row.id;
    verified = true;
  } else {
    // Guest (or signed in without picking an order): a paid, shipped / delivered order with this email.
    const rows = await prisma.order.findMany({
      where: { source: "online", status: { in: [...VERIFIED_STATUSES] }, OR: [{ email }, ...(ctx.account ? [{ customerId: ctx.account.id }] : [])] },
      include: { lines: LINE_SIZE, review: { select: { id: true } } },
      orderBy: { createdAt: "desc" },
    });
    const ok = rows.filter(verifiableOrder);
    if (ok.length) {
      const open = ok.find((r) => !r.review);
      if (!open) throw new HttpError(409, ok.length === 1 ? "You already reviewed your order. Thank you!" : "You already reviewed each of your orders. Thank you!");
      orderId = open.id;
      verified = true;
    }
  }

  const { store } = await getStore();
  const reason = flagReason({ title, text, displayName }, store.reviews.flagWords);
  const status: ReviewStatus = reason ? "pending" : "approved";

  // Photos last: only once everything else passed (a refused review leaves no files behind).
  const saved: { id: string; width: number; height: number }[] = [];
  try {
    for (const buf of ctx.photos) saved.push(await saveReviewPhoto(buf));
    const id = randomUUID();
    await prisma.review.create({
      data: {
        id,
        orderId,
        rating,
        title,
        text,
        displayName,
        email,
        status,
        flagReason: reason,
        verified,
        source,
        ipHash: ip,
        createdAt: now,
        photos: { create: saved.map((p, i) => ({ id: randomUUID(), file: p.id, width: p.width, height: p.height, status: "pending", sort: i, createdAt: now })) },
      },
    });
    if (orderId) await logEvent(prisma, orderId, "note", `Customer left a ${rating}-star review${status === "pending" ? " (waiting for a check)" : ""}.`, saved.length ? `${saved.length} photo${saved.length === 1 ? "" : "s"} waiting for approval` : "");
  } catch (e) {
    await Promise.all(saved.map((p) => removeReviewPhoto(p.id)));
    if ((e as { code?: string })?.code === "P2002") throw new HttpError(409, "A review was already left for this order. Thank you!");
    throw e;
  }
  return { status, message: status === "approved" ? LIVE_MESSAGE : CHECK_MESSAGE };
}

// ---------------------------------------------------------------- Public lists
export interface PublicReview {
  id: string;
  rating: number;
  title: string;
  text: string;
  displayName: string;
  createdAt: string;
  verified: boolean;
  edited: boolean;
  /** Approved photos only. */
  photos: { file: string; width: number; height: number }[];
}

export type ReviewSort = "newest" | "highest" | "lowest";
const LIVE = { status: "approved" } as const;

export async function reviewSummary() {
  const groups = await prisma.review.groupBy({ by: ["rating"], where: LIVE, _count: { _all: true } });
  const breakdown = [5, 4, 3, 2, 1].map((stars) => ({ stars, count: groups.find((g) => g.rating === stars)?._count._all ?? 0 }));
  const count = breakdown.reduce((s, b) => s + b.count, 0);
  const average = count ? breakdown.reduce((s, b) => s + b.stars * b.count, 0) / count : 0;
  return { count, average: Math.round(average * 10) / 10, breakdown };
}

const APPROVED_PHOTOS = { where: { status: "approved" }, orderBy: { sort: "asc" as const }, select: { file: true, width: true, height: true } };

function toPublic(r: { id: string; rating: number; title: string; text: string; displayName: string; createdAt: Date; verified: boolean; edited: boolean; photos: { file: string; width: number; height: number }[] }): PublicReview {
  return { id: r.id, rating: r.rating, title: r.title, text: r.text, displayName: r.displayName, createdAt: r.createdAt.toISOString(), verified: r.verified, edited: r.edited, photos: r.photos };
}

export async function listPublicReviews(q: { sort?: ReviewSort; withPhotos?: boolean; verifiedOnly?: boolean; page?: number; perPage?: number }) {
  const perPage = Math.min(50, Math.max(1, q.perPage ?? 10));
  const where = {
    ...LIVE,
    ...(q.verifiedOnly ? { verified: true } : {}),
    ...(q.withPhotos ? { photos: { some: { status: "approved" } } } : {}),
  };
  const orderBy =
    q.sort === "highest" ? [{ rating: "desc" as const }, { createdAt: "desc" as const }] : q.sort === "lowest" ? [{ rating: "asc" as const }, { createdAt: "desc" as const }] : [{ createdAt: "desc" as const }];
  const total = await prisma.review.count({ where });
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(pages, Math.max(1, Math.floor(q.page ?? 1)));
  const rows = await prisma.review.findMany({ where, orderBy, skip: (page - 1) * perPage, take: perPage, include: { photos: APPROVED_PHOTOS } });
  return { reviews: rows.map(toPublic), total, page, pages };
}

/** Homepage: the latest live 4 and 5 star reviews. */
export async function latestGoodReviews(take = 6) {
  const rows = await prisma.review.findMany({ where: { ...LIVE, rating: { gte: 4 } }, orderBy: { createdAt: "desc" }, take, include: { photos: APPROVED_PHOTOS } });
  return rows.map(toPublic);
}

/** A review photo file may be served publicly only when the photo is approved and its review is live. */
export async function publicPhotoAllowed(file: string): Promise<boolean> {
  const p = await prisma.reviewPhoto.findFirst({ where: { file, status: "approved", review: LIVE }, select: { id: true } });
  return !!p;
}

// ---------------------------------------------------------------- Admin
export async function setPhotoStatus(reviewId: string, photoId: string, status: "approved" | "rejected" | "pending") {
  const done = await prisma.reviewPhoto.updateMany({ where: { id: photoId, reviewId }, data: { status } });
  if (done.count !== 1) throw new HttpError(404, "That photo was not found. Reload the page.");
}

export async function deleteReview(id: string) {
  const r = await prisma.review.findUnique({ where: { id }, include: { photos: true } });
  if (!r) return;
  await prisma.review.delete({ where: { id } });
  await Promise.all(r.photos.map((p) => removeReviewPhoto(p.file)));
  if (r.orderId) await logEvent(prisma, r.orderId, "note", "Review deleted by the store.").catch(() => {});
}

// ---------------------------------------------------------------- Review request email
/** If tracking shows the parcel moving but never says delivered, ask this many days after the usual wait anyway. */
const IN_TRANSIT_GRACE_DAYS = 7;
/** Never ask about an order delivered longer ago than this (for example old orders when the feature is turned on). */
const STALE_DAYS = 30;

/**
 * When the review request for this order is due, or null when it never is.
 * Delivered / picked up: X days after that. Shipped without a delivery scan: X days after shipping; if the
 * tracking shows it is still moving, a week more before asking anyway.
 */
export function reviewRequestDueAt(o: { status: string; deliveredAt: Date | null; shippedAt: Date | null; trackingStatus: string }, days: number): Date | null {
  if (o.status === "delivered" || o.status === "picked_up") return o.deliveredAt ? new Date(o.deliveredAt.getTime() + days * DAY) : null;
  if (o.status === "shipped" && o.shippedAt) {
    const moving = ["TRANSIT", "IN_TRANSIT", "OUT_FOR_DELIVERY"].includes(o.trackingStatus.toUpperCase());
    return new Date(o.shippedAt.getTime() + (days + (moving ? IN_TRANSIT_GRACE_DAYS : 0)) * DAY);
  }
  return null;
}

export const newReviewToken = () => randomBytes(24).toString("base64url");

/**
 * Send the "How was your order?" email for every order where it is due. Once per order (the row is
 * claimed before sending), never for canceled or refunded orders, never when the order already has a review.
 */
export async function sendReviewRequests(opts: { now?: Date; origin?: string } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const { store } = await getStore();
  if (!store.reviews.requestEmail) return 0;
  const days = store.reviews.requestDays;
  const rows = await prisma.order.findMany({
    where: { source: "online", reviewRequestSentAt: null, email: { not: "" }, review: null, refundedCents: 0, canceledAt: null, status: { in: ["delivered", "picked_up", "shipped"] } },
    include: { lines: LINE_SIZE },
  });
  let sent = 0;
  for (const row of rows) {
    const due = reviewRequestDueAt(row, days);
    if (!due || due > now) continue;
    if (now.getTime() - due.getTime() > STALE_DAYS * DAY) continue;
    if (!verifiableOrder(row)) continue;
    const token = row.reviewToken ?? newReviewToken();
    // Claim it first: two runs at once (or a restart mid-send) never email twice.
    const claimed = await prisma.order.updateMany({ where: { id: row.id, reviewRequestSentAt: null }, data: { reviewRequestSentAt: now, reviewToken: token } });
    if (claimed.count !== 1) continue;
    const base = siteUrl(store, opts.origin);
    const o = toOrder({ ...row, reviewToken: token });
    const content = reviewRequestEmail(store, emailOrder(o, base), `${base}/review/${token}`);
    try {
      const out = await sendEmail(store, row.email, content);
      await logEvent(prisma, row.id, "email", out.sent ? "Review request sent" : `Review request: ${outcomeText(out)}`, content.subject);
      if (out.sent) sent++;
    } catch (e) {
      console.error("[review request]", e);
    }
  }
  return sent;
}
