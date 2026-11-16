import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RichText } from "@/components/storefront/product-card";
import { POLICY_IDS, type PolicyId } from "@/lib/store/config";
import { storeSnapshot } from "@/lib/store/server";

// Policy pages (/terms, /privacy, /shipping, /refunds, /research-use) live here, readable even while the
// store is closed. Any other unknown address falls through to the custom 404 page.
type Props = { params: Promise<{ slug: string[] }> };
const isPolicy = (slug: string[]): slug is [PolicyId] => slug.length === 1 && (POLICY_IDS as string[]).includes(slug[0]);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!isPolicy(slug)) return { title: "Page not found", robots: { index: false } };
  const p = (await storeSnapshot()).data.content.policies[slug[0]];
  return { title: p.title, description: p.body.replace(/[#*\-\n]+/g, " ").trim().slice(0, 155), alternates: { canonical: `/${slug[0]}` } };
}

export default async function PolicyPage({ params }: Props) {
  const { slug } = await params;
  if (!isPolicy(slug)) notFound();
  const { data } = await storeSnapshot();
  const p = data.content.policies[slug[0]];
  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-16">
      <div className="grid gap-10 lg:grid-cols-[14rem_1fr] lg:gap-20">
        <nav aria-label="Policies" className="order-2 lg:order-1">
          <ul className="flex flex-wrap gap-x-5 gap-y-1 border-t border-rule pt-5 lg:sticky lg:top-36 lg:block lg:space-y-1 lg:border-t-0 lg:pt-2">
            {POLICY_IDS.map((id) => (
              <li key={id}>
                <Link href={`/${id}`} aria-current={id === slug[0] ? "page" : undefined} className={`inline-block py-1.5 text-[15px] ${id === slug[0] ? "font-semibold text-brand" : "text-stone hover:text-coal"}`}>
                  {data.content.policies[id].title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <article className="order-1 lg:order-2">
          <h1 className="text-4xl font-semibold leading-[1.05] sm:text-5xl" style={{ letterSpacing: "-0.03em" }}>
            {p.title}
          </h1>
          <RichText text={p.body} className="s-prose mt-4" />
        </article>
      </div>
    </div>
  );
}
