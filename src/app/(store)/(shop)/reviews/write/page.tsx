import type { Metadata } from "next";
import Link from "next/link";
import { ReviewChoice, ReviewForm } from "@/components/storefront/reviews";
import { currentAccount } from "@/lib/account";
import { reviewableOrders } from "@/lib/reviews/ops";
import { shortName } from "@/lib/reviews/rules";

export const metadata: Metadata = { title: "Write a review", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Write a review. Signed in: name, email and orders prefilled. Signed out: sign in or continue as a guest first. */
export default async function WriteReviewPage({ searchParams }: { searchParams: Promise<{ guest?: string; order?: string; rating?: string }> }) {
  const q = await searchParams;
  const acct = await currentAccount();
  const account = acct && !acct.mustChangePassword ? acct : null;
  const orders = account ? await reviewableOrders(account.id, account.email) : [];
  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-16">
      <div className="mx-auto max-w-2xl">
        <Link href="/reviews" className="text-[15px] font-medium text-stone hover:text-coal">
          ← All reviews
        </Link>
        <h1 className="mt-4 text-4xl font-semibold leading-[1.05] sm:text-5xl" style={{ letterSpacing: "-0.03em" }}>
          Write a review
        </h1>
        {account ? (
          <>
            <p className="mb-8 mt-3 text-[1.0625rem] leading-relaxed text-stone">Signed in as {account.email}. Reviews of your orders show a “Verified order” badge.</p>
            <ReviewForm orders={orders} initialOrder={Number(q.order) || null} initialRating={Number(q.rating) || 0} defaultName={shortName(account.name)} defaultEmail={account.email} />
          </>
        ) : q.guest === "1" ? (
          <>
            <p className="mb-8 mt-3 text-[1.0625rem] leading-relaxed text-stone">No account needed. If your email matches a delivered order, your review shows a “Verified order” badge.</p>
            <ReviewForm initialRating={Number(q.rating) || 0} />
          </>
        ) : (
          <>
            <p className="mb-8 mt-3 text-[1.0625rem] leading-relaxed text-stone">How would you like to continue?</p>
            <ReviewChoice />
          </>
        )}
      </div>
    </div>
  );
}
