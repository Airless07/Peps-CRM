import { HttpError, route } from "@/lib/api";
import { currentAccount } from "@/lib/account";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { REVIEW_LIMITS } from "@/lib/reviews/rules";
import { submitReview } from "@/lib/reviews/ops";

export const dynamic = "force-dynamic";

const MB = 1024 * 1024;

/**
 * Leave a review (no account needed). Multipart form: rating, title, text, displayName, email, the hidden
 * "website" honeypot, orderNumber (signed in) or token (order email link), and up to 5 "photos".
 */
export const POST = route(
  async (req) => {
    // A quick burst limit in memory; the daily limits (3 per IP, 3 per email) are counted in the database.
    rateLimit(req, "review-burst", 10, 10 * 60_000);
    const length = Number(req.headers.get("content-length") ?? NaN);
    if (!Number.isFinite(length)) throw new HttpError(411, "The form has no size. Try again from the page.");
    if (length > (REVIEW_LIMITS.photos * REVIEW_LIMITS.photoMb + 2) * MB) throw new HttpError(413, `The photos are too big. Each photo can be up to ${REVIEW_LIMITS.photoMb} MB.`);
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new HttpError(400, "The review did not arrive. Check your connection and try again.");
    }
    const str = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : "";
    };
    const files = form.getAll("photos").filter((f): f is File => typeof f !== "string" && f.size > 0);
    if (files.length > REVIEW_LIMITS.photos) throw new HttpError(400, `Add up to ${REVIEW_LIMITS.photos} photos.`);
    for (const f of files) if (f.size > REVIEW_LIMITS.photoMb * MB) throw new HttpError(400, `“${f.name.slice(0, 60)}” is ${(f.size / MB).toFixed(1)} MB. Each photo can be up to ${REVIEW_LIMITS.photoMb} MB.`);
    const photos = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));
    const account = await currentAccount();
    const orderNumber = Number(str("orderNumber")) || null;
    return submitReview(
      {
        rating: Number(str("rating")),
        title: str("title"),
        text: str("text"),
        displayName: str("displayName"),
        email: str("email"),
        website: str("website"),
        orderNumber,
        token: str("token") || null,
      },
      { ip: clientIp(req), account: account && !account.mustChangePassword ? { id: account.id, email: account.email } : null, photos },
    );
  },
  { public: true },
);
