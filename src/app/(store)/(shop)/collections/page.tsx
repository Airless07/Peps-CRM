import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Vial } from "@/components/storefront/vial";
import { storeSnapshot } from "@/lib/store/server";

export const metadata: Metadata = { title: "Collections", description: "Research compounds grouped by collection.", alternates: { canonical: "/collections" } };

export default async function CollectionsPage() {
  const { catalog } = await storeSnapshot();
  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-14">
      <h1 className="text-4xl font-semibold leading-[1.05] sm:text-5xl" style={{ letterSpacing: "-0.03em" }}>
        Collections
      </h1>
      <p className="mb-10 mt-3 max-w-xl text-[1.0625rem] leading-relaxed text-stone">The catalog, grouped.</p>
      {catalog.groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-rule px-6 py-20 text-center">
          <p className="text-lg font-semibold">No collections yet.</p>
          <Link href="/shop" className="s-btn-primary mt-6">
            Shop all products
          </Link>
        </div>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {catalog.groups.map((g, i) => {
            const items = catalog.products.filter((p) => p.groupIds.includes(g.id)).slice(0, 3);
            return (
              <li key={g.id} data-reveal style={{ ["--i" as string]: i % 3 }}>
                <Link href={`/collections/${g.slug}`} className="group block">
                  <div className="flex aspect-[4/3] items-end justify-center gap-[3%] overflow-hidden rounded-2xl bg-soft px-[8%] pt-[8%]">
                    {items.map((p) =>
                      p.photos[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={p.id} src={`/media/${p.photos[0].id}-480.webp`} alt="" loading="lazy" className="h-[86%] w-[30%] rounded-t-xl object-cover transition duration-700 ease-out group-hover:-translate-y-1.5" />
                      ) : (
                        <Vial key={p.id} name={p.name} className="h-auto w-[30%] transition duration-700 ease-out group-hover:-translate-y-1.5" />
                      ),
                    )}
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-xl font-semibold group-hover:text-brand">{g.name}</h2>
                      <p className="text-sm text-stone">
                        {g.count} {g.count === 1 ? "product" : "products"}
                      </p>
                    </div>
                    <ArrowRight size={20} className="text-stone transition duration-300 ease-out group-hover:translate-x-1 group-hover:text-brand" />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
