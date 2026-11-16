import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShopBrowser } from "@/components/storefront/shop-browser";
import { storeSnapshot } from "@/lib/store/server";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const g = (await storeSnapshot()).catalog.groups.find((x) => x.slug === slug);
  if (!g) return { title: "Collection not found" };
  return { title: g.name, description: `${g.name}: ${g.count} research ${g.count === 1 ? "compound" : "compounds"} with testing status and certificates of analysis.`, alternates: { canonical: `/collections/${g.slug}` } };
}

export default async function CollectionPage({ params }: Props) {
  const { slug } = await params;
  const { catalog } = await storeSnapshot();
  const g = catalog.groups.find((x) => x.slug === slug);
  if (!g) notFound();
  return (
    <div className="s-wrap pb-8 pt-8 sm:pt-12">
      <nav aria-label="Breadcrumb" className="text-sm text-stone">
        <Link href="/collections" className="hover:text-coal">
          Collections
        </Link>
        <span className="mx-2">/</span>
        <span className="text-coal">{g.name}</span>
      </nav>
      <h1 className="mb-8 mt-4 text-4xl font-semibold leading-[1.05] sm:text-5xl" style={{ letterSpacing: "-0.03em" }}>
        {g.name}
      </h1>
      <ShopBrowser products={catalog.products.filter((p) => p.groupIds.includes(g.id))} groups={catalog.groups} fixedGroup={g.id} />
    </div>
  );
}
