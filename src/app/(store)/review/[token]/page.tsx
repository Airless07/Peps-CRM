import type { Metadata } from "next";
import Link from "next/link";
import { ReviewForm } from "@/components/storefront/reviews";
import { orderForToken } from "@/lib/reviews/ops";
import { shortName } from "@/lib/reviews/rules";

export const metadata: Metadata = { title: "Review your order", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The review link from the order email. It already identifies the order, so there is no sign in / guest
 * choice: straight to the form, rating preselected from the star that was tapped (?rating=4).
 */
export default async function ReviewPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ rating?: string }> }) {
  const { token } = await params;
  const { rating } = await searchParams;
  const order = await orderForToken(token);
  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-16">
      <div className="mx-auto max-w-xl">
        {!order ? (
          <>
            <h1 className="text-4xl font-semibold" style={{ letterSpacing: "-0.03em" }}>
              This review link is not valid
            </h1>
            <p className="mt-3 text-[1.0625rem] leading-relaxed text-stone">Use the link from your “How was your order?” email. You can also leave a review from the reviews page.</p>
            <Link href="/reviews" className="s-btn-primary mt-6">
              Go to reviews
            </Link>
          </>
        ) : order.review ? (
          <>
            <h1 className="text-4xl font-semibold" style={{ letterSpacing: "-0.03em" }}>
              You already reviewed this order
            </h1>
            <p className="mt-3 text-[1.0625rem] leading-relaxed text-stone">Thank you. One review per order.</p>
            <Link href="/reviews" className="s-btn-primary mt-6">
              See all reviews
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-4xl font-semibold leading-[1.05]" style={{ letterSpacing: "-0.03em" }}>
              How was your order?
            </h1>
            <p className="mb-8 mt-3 text-[1.0625rem] leading-relaxed text-stone">Thanks for ordering. Your review shows a “Verified order” badge.</p>
            <ReviewForm token={token} orderNumber={order.number ?? 0} initialRating={Number(rating) || 0} defaultName={shortName(order.customer)} defaultEmail={order.email} />
          </>
        )}
      </div>
    </div>
  );
}
