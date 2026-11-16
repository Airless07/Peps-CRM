import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/storefront/product-card";
import { ProductView } from "@/components/storefront/product-view";
import { siteUrl } from "@/lib/order-ops";
import { storeSnapshot } from "@/lib/store/server";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { catalog } = await storeSnapshot();
  const p = catalog.products.find((x) => x.slug === slug);
  if (!p) return { title: "Product not found" };
  const title = p.seoTitle || p.name;
  const description = p.seoDescription || p.summary || `${p.name}: research compound with published testing status. For laboratory research use only.`;
  const image = p.photos[0] ? `/media/${p.photos[0].id}-1600.webp` : undefined;
  return {
    title,
    description,
    alternates: { canonical: `/product/${p.slug}` },
    openGraph: { title, description, type: "website", ...(image ? { images: [{ url: image, width: 1600, height: 2000, alt: p.photos[0].alt }] } : {}) },
    twitter: { card: "summary_large_image", title, description, ...(image ? { images: [image] } : {}) },
  };
}

export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const { data, catalog } = await storeSnapshot();
  const p = catalog.products.find((x) => x.slug === slug);
  if (!p) notFound();
  const base = siteUrl(data.store);
  const group = catalog.groups.find((g) => p.groupIds.includes(g.id));
  const related = catalog.products.filter((x) => x.id !== p.id && (x.groupIds.some((g) => p.groupIds.includes(g)) || p.groupIds.length === 0)).slice(0, 4);
  const reviews = data.reviews.filter((r) => r.status === "approved").slice(0, 3);

  // Structured data for search engines: public facts only.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: p.summary || undefined,
    url: `${base}/product/${p.slug}`,
    image: p.photos.map((ph) => `${base}/media/${ph.id}-1600.webp`),
    brand: { "@type": "Brand", name: data.store.storeName },
    offers: p.variants.map((v) => ({
      "@type": "Offer",
      name: v.label || p.name,
      price: (v.priceCents / 100).toFixed(2),
      priceCurrency: "USD",
      availability: v.stock === "out" ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      url: `${base}/product/${p.slug}`,
    })),
  };

  return (
    <div className="s-wrap pb-8 pt-6 sm:pt-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-stone">
        <Link href="/shop" className="hover:text-coal">
          Shop
        </Link>
        {group && (
          <>
            <span className="mx-2">/</span>
            <Link href={`/collections/${group.slug}`} className="hover:text-coal">
              {group.name}
            </Link>
          </>
        )}
        <span className="mx-2">/</span>
        <span className="text-coal">{p.name}</span>
      </nav>

      <ProductView p={p} />

      {reviews.length > 0 && (
        <section className="mt-24 border-t border-rule pt-14">
          <h2 className="s-h2">Order experience</h2>
          <p className="mt-2 text-[15px] text-stone">What verified buyers say about shipping, packaging and service.</p>
          <ul className="mt-8 grid gap-x-10 gap-y-8 md:grid-cols-3">
            {reviews.map((r) => (
              <li key={r.id} className="border-t border-coal pt-5" data-reveal>
                <span className="text-sm font-semibold text-brand" role="img" aria-label={`${r.rating} out of 5 stars`}>
                  {"★".repeat(r.rating)}
                  <span className="text-rule">{"★".repeat(5 - r.rating)}</span>
                </span>
                {r.text && <blockquote className="mt-2 text-[15px] leading-relaxed">{r.text}</blockquote>}
                <p className="mt-3 text-sm text-stone">
                  <span className="font-medium text-coal">{r.displayName}</span> · Verified buyer{r.edited ? " · Edited by store" : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {related.length > 0 && (
        <section className="mt-24">
          <h2 className="s-h2 mb-9">More from the catalog</h2>
          <ProductGrid products={related} />
        </section>
      )}
    </div>
  );
}
