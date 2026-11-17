import type { Metadata } from "next";
import Link from "next/link";
import { FaqList } from "@/components/storefront/product-card";
import { faqForDisplay } from "@/lib/store/copy";
import { storeSnapshot } from "@/lib/store/server";

export const metadata: Metadata = { title: "Frequently asked questions", description: "Answers about ordering, payment, shipping and certificates of analysis.", alternates: { canonical: "/faq" } };

export default async function FaqPage() {
  const { data } = await storeSnapshot();
  const items = faqForDisplay(data.content.faq, data.store.payments).filter((f) => f.q.trim());
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <div className="grid gap-10 lg:grid-cols-[1fr_1.7fr] lg:gap-20">
        <div>
          <h1 className="text-4xl font-semibold leading-[1.05] sm:text-5xl" style={{ letterSpacing: "-0.03em" }}>
            Questions
          </h1>
          <p className="mt-4 max-w-sm text-[1.0625rem] leading-relaxed text-stone">
            Not answered here?{" "}
            <Link href="/contact" className="s-link">
              Send us a message
            </Link>
            .
          </p>
        </div>
        {items.length ? <FaqList items={items} /> : <p className="text-stone">Questions and answers will be added soon.</p>}
      </div>
    </div>
  );
}
