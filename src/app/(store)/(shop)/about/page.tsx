import type { Metadata } from "next";
import Link from "next/link";
import { RichText } from "@/components/storefront/product-card";
import { storeSnapshot } from "@/lib/store/server";

export async function generateMetadata(): Promise<Metadata> {
  const { data } = await storeSnapshot();
  return { title: data.content.about.title || "About", description: data.content.about.body.slice(0, 155), alternates: { canonical: "/about" } };
}

export default async function AboutPage() {
  const { data } = await storeSnapshot();
  const { about, quality } = data.content;
  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-16">
      <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:gap-24">
        <div>
          <h1 className="max-w-2xl text-4xl font-semibold leading-[1.05] sm:text-6xl" style={{ letterSpacing: "-0.035em" }}>
            {about.title}
          </h1>
          <RichText text={about.body} className="s-prose mt-4 text-lg" />
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/shop" className="s-btn-primary">
              Shop all products
            </Link>
            <Link href="/testing" className="s-btn-line">
              See our testing
            </Link>
          </div>
        </div>
        <dl className="self-start divide-y divide-rule border-y border-rule lg:mt-3">
          {quality.points
            .filter((p) => p.title.trim())
            .map((p, i) => (
              <div key={i} className="py-5" data-reveal style={{ ["--i" as string]: i }}>
                <dt className="text-lg font-semibold tracking-tight">{p.title}</dt>
                <dd className="mt-1 text-[15px] leading-relaxed text-stone">{p.text}</dd>
              </div>
            ))}
        </dl>
      </div>
    </div>
  );
}
