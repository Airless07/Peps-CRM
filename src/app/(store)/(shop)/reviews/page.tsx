import type { Metadata } from "next";
import Link from "next/link";
import { ReviewPhotos, StarRow, VerifiedBadge } from "@/components/storefront/reviews";
import { listPublicReviews, reviewSummary, type PublicReview, type ReviewSort } from "@/lib/reviews/ops";

export const metadata: Metadata = {
  title: "Customer reviews",
  description: "What customers say about ordering from us: shipping, packaging and service.",
  alternates: { canonical: "/reviews" },
};
export const dynamic = "force-dynamic";

const SORTS: { id: ReviewSort; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "highest", label: "Highest" },
  { id: "lowest", label: "Lowest" },
];

type Q = { sort?: string; photos?: string; verified?: string; page?: string };

function href(q: Q, change: Partial<Q>) {
  const next = { ...q, ...change };
  const p = new URLSearchParams();
  if (next.sort && next.sort !== "newest") p.set("sort", next.sort);
  if (next.photos === "1") p.set("photos", "1");
  if (next.verified === "1") p.set("verified", "1");
  if (next.page && next.page !== "1") p.set("page", next.page);
  const s = p.toString();
  return s ? `/reviews?${s}` : "/reviews";
}

const date = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

function Card({ r }: { r: PublicReview }) {
  return (
    <li className="border-t border-rule py-7" data-review-card>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StarRow n={r.rating} />
        {r.verified && <VerifiedBadge />}
      </div>
      {r.title && <h3 className="mt-3 text-lg font-semibold leading-snug">{r.title}</h3>}
      <p className={`${r.title ? "mt-1.5" : "mt-3"} whitespace-pre-line text-[1.0625rem] leading-relaxed`}>{r.text}</p>
      <ReviewPhotos photos={r.photos} />
      <p className="mt-4 text-sm text-stone">
        <span className="font-medium text-coal">{r.displayName}</span> · {date(r.createdAt)}
        {r.edited ? " · Edited by store" : ""}
      </p>
    </li>
  );
}

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const sort: ReviewSort = SORTS.some((s) => s.id === q.sort) ? (q.sort as ReviewSort) : "newest";
  const [summary, list] = await Promise.all([reviewSummary(), listPublicReviews({ sort, withPhotos: q.photos === "1", verifiedOnly: q.verified === "1", page: Number(q.page) || 1, perPage: 10 })]);
  const chip = (on: boolean) => `inline-flex h-10 items-center rounded-full border px-4 text-[15px] font-medium transition ${on ? "border-coal bg-coal text-white" : "border-rule text-coal hover:border-coal"}`;

  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-16">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,22rem)_1fr] lg:gap-20">
        <aside>
          <h1 className="text-4xl font-semibold leading-[1.05] sm:text-5xl" style={{ letterSpacing: "-0.03em" }}>
            Customer reviews
          </h1>
          {summary.count > 0 ? (
            <div className="mt-6" data-review-summary>
              <div className="flex items-end gap-3">
                <span className="text-6xl font-semibold tabular-nums leading-none" style={{ letterSpacing: "-0.04em" }} data-review-average>
                  {summary.average.toFixed(1)}
                </span>
                <div className="pb-1">
                  <StarRow n={summary.average} size="h-5 w-5" />
                  <p className="mt-1 text-sm text-stone" data-review-count>
                    {summary.count} {summary.count === 1 ? "review" : "reviews"}
                  </p>
                </div>
              </div>
              <ul className="mt-6 space-y-2" aria-label="Star breakdown">
                {summary.breakdown.map((b) => (
                  <li key={b.stars} className="flex items-center gap-3 text-sm">
                    <span className="w-12 shrink-0 tabular-nums text-stone">{b.stars} star</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-soft">
                      <span className="block h-full rounded-full bg-brand" style={{ width: `${summary.count ? (b.count / summary.count) * 100 : 0}%` }} />
                    </span>
                    <span className="w-8 shrink-0 text-right tabular-nums text-stone">{b.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-5 text-[1.0625rem] leading-relaxed text-stone">No reviews yet. Be the first to tell us how your order went.</p>
          )}
          <Link href="/reviews/write" className="s-btn-primary mt-8" data-write-review>
            Write a review
          </Link>
          <p className="mt-6 text-[13px] leading-relaxed text-stone">Reviews are about the order experience: shipping, packaging and service. They are not claims about any product. All products are for research use only.</p>
        </aside>

        <section aria-label="Reviews">
          <div className="flex flex-wrap items-center gap-2" data-review-controls>
            <span className="mr-1 text-sm font-medium text-stone">Sort</span>
            {SORTS.map((s) => (
              <Link key={s.id} href={href(q, { sort: s.id, page: "1" })} className={chip(sort === s.id)} aria-current={sort === s.id ? "true" : undefined}>
                {s.label}
              </Link>
            ))}
            <span className="mx-1 hidden h-6 w-px bg-rule sm:block" />
            <Link href={href(q, { photos: q.photos === "1" ? "" : "1", page: "1" })} className={chip(q.photos === "1")} aria-pressed={q.photos === "1"}>
              With photos
            </Link>
            <Link href={href(q, { verified: q.verified === "1" ? "" : "1", page: "1" })} className={chip(q.verified === "1")} aria-pressed={q.verified === "1"}>
              Verified only
            </Link>
          </div>

          {list.reviews.length === 0 ? (
            <div className="mt-8 rounded-2xl border border-dashed border-rule px-6 py-14 text-center">
              <p className="font-semibold">{summary.count ? "No reviews match these filters" : "No reviews yet"}</p>
              {summary.count > 0 && (
                <Link href="/reviews" className="s-link mt-2 inline-block text-[15px]">
                  Show all reviews
                </Link>
              )}
            </div>
          ) : (
            <ul className="mt-6 border-b border-rule">
              {list.reviews.map((r) => (
                <Card key={r.id} r={r} />
              ))}
            </ul>
          )}

          {list.pages > 1 && (
            <nav aria-label="Pages" className="mt-8 flex flex-wrap items-center gap-2" data-review-pages>
              {list.page > 1 && (
                <Link href={href(q, { page: String(list.page - 1) })} className={chip(false)}>
                  Previous
                </Link>
              )}
              {Array.from({ length: list.pages }, (_, i) => i + 1)
                .filter((n) => n === 1 || n === list.pages || Math.abs(n - list.page) <= 1)
                .map((n, i, arr) => (
                  <span key={n} className="flex items-center gap-2">
                    {i > 0 && n - arr[i - 1] > 1 && <span className="text-stone">…</span>}
                    <Link href={href(q, { page: String(n) })} className={`${chip(n === list.page)} w-10 justify-center px-0 tabular-nums`} aria-current={n === list.page ? "page" : undefined}>
                      {n}
                    </Link>
                  </span>
                ))}
              {list.page < list.pages && (
                <Link href={href(q, { page: String(list.page + 1) })} className={chip(false)}>
                  Next
                </Link>
              )}
            </nav>
          )}
        </section>
      </div>
    </div>
  );
}
