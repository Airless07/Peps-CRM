import type { Metadata } from "next";
import Link from "next/link";
import { ReviewForm } from "@/components/storefront/forms";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Review your order", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** "Mike Johnson" -> "Mike J." */
function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export default async function ReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const order = token.length >= 16 ? await prisma.order.findUnique({ where: { reviewToken: token }, include: { review: true } }) : null;
  const valid = order && order.status === "delivered";
  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-16">
      <div className="mx-auto max-w-xl">
        {!valid ? (
          <>
            <h1 className="text-4xl font-semibold" style={{ letterSpacing: "-0.03em" }}>
              This review link is not valid
            </h1>
            <p className="mt-3 text-[1.0625rem] leading-relaxed text-stone">Use the link from your “How was your order?” email. It works once the order is delivered.</p>
            <Link href="/" className="s-btn-primary mt-6">
              Go to the store
            </Link>
          </>
        ) : order.review ? (
          <>
            <h1 className="text-4xl font-semibold" style={{ letterSpacing: "-0.03em" }}>
              You already reviewed this order
            </h1>
            <p className="mt-3 text-[1.0625rem] leading-relaxed text-stone">Thank you. One review per order.</p>
            <Link href="/shop" className="s-btn-primary mt-6">
              Back to the shop
            </Link>
          </>
        ) : (
          <>
            <h1 className="text-4xl font-semibold leading-[1.05]" style={{ letterSpacing: "-0.03em" }}>
              How was your order?
            </h1>
            <p className="mb-8 mt-3 text-[1.0625rem] leading-relaxed text-stone">Order #{order.number}. Tell us how shipping, packaging and service went.</p>
            <ReviewForm token={token} defaultName={shortName(order.customer)} orderNumber={order.number ?? 0} />
          </>
        )}
      </div>
    </div>
  );
}
