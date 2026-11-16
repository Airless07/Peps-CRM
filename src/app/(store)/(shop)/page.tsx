import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { FaqList, ProductGrid, TestingBadge, leadVariant } from "@/components/storefront/product-card";
import { Vial } from "@/components/storefront/vial";
import type { PublicCatalog } from "@/lib/store/catalog";
import type { SiteContent } from "@/lib/store/config";
import { storeSnapshot } from "@/lib/store/server";
import type { ReviewRec } from "@/lib/types";

function Hero({ hero, catalog }: { hero: SiteContent["hero"]; catalog: PublicCatalog }) {
  const img = hero.image;
  const src = img ? `/media/${img}-1600.webp` : "";
  const srcSet = img ? `/media/${img}-480.webp 480w, /media/${img}-960.webp 960w, /media/${img}-1600.webp 1600w` : undefined;
  const text = (dark: boolean) => (
    <div className="max-w-2xl">
      {hero.eyebrow && <p className={`animate-rise-in text-sm font-medium ${dark ? "text-white/80" : "text-brand"}`}>{hero.eyebrow}</p>}
      <h1 className="mt-4 animate-rise-in text-[2.6rem] font-semibold leading-[1.03] sm:text-6xl lg:text-[4.5rem]" style={{ letterSpacing: "-0.035em", animationDelay: "80ms" }}>
        {hero.headline}
      </h1>
      {hero.subtext && (
        <p className={`mt-6 max-w-xl animate-rise-in text-lg leading-relaxed ${dark ? "text-white/85" : "text-stone"}`} style={{ animationDelay: "160ms" }}>
          {hero.subtext}
        </p>
      )}
      <div className="mt-9 flex animate-rise-in flex-wrap gap-3" style={{ animationDelay: "240ms" }}>
        {hero.buttonText && (
          <Link href={hero.buttonLink || "/shop"} className={dark ? "s-btn bg-white text-coal hover:bg-white/90" : "s-btn-primary"}>
            {hero.buttonText} <ArrowRight size={17} />
          </Link>
        )}
        <Link href="/testing" className={dark ? "s-btn border border-white/40 text-white hover:border-white" : "s-btn-line"}>
          See our testing
        </Link>
      </div>
    </div>
  );

  // Until a hero photo is uploaded: three placeholder vials stand in for it.
  const vials = catalog.products.slice(0, 3);
  const stand = (
    <div className="flex h-full items-end justify-center px-[4%]" aria-hidden>
      {[1, 0, 2].map((k, i) => (
        <div key={i} className={`shrink-0 ${i === 1 ? "z-10 -mx-[9%] w-[50%]" : "w-[38%]"}`}>
          <Vial name={vials[k]?.name ?? ""} size={vials[k]?.variants[0]?.label ?? ""} className="block h-auto w-full" />
        </div>
      ))}
    </div>
  );

  if (hero.layout === "split") {
    return (
      <section className="border-b border-rule">
        <div className="s-wrap grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:py-24">
          {text(false)}
          <div className="relative aspect-[4/3] overflow-hidden rounded-3xl bg-soft lg:aspect-[5/5]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {img ? <img src={src} srcSet={srcSet} sizes="(min-width: 1024px) 50vw, 100vw" alt="" fetchPriority="high" className="h-full w-full object-cover" /> : stand}
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="relative flex min-h-[calc(100svh-6.5rem)] items-end overflow-hidden bg-night text-white sm:min-h-[calc(100svh-7rem)]">
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} srcSet={srcSet} sizes="100vw" alt="" fetchPriority="high" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute bottom-0 right-[3%] hidden h-[86%] w-[44%] max-w-[40rem] md:block">{stand}</div>
      )}
      {/* The overlay is a flat tint so the headline stays readable on any photo. */}
      <div className="absolute inset-0 bg-night" style={{ opacity: img ? hero.overlay / 100 : 0 }} />
      <div className="s-wrap relative pb-14 pt-28 sm:pb-20">{text(true)}</div>
    </section>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5 text-brand" role="img" aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} viewBox="0 0 20 20" className={`h-4 w-4 ${i <= n ? "fill-current" : "fill-rule"}`} aria-hidden>
          <path d="M10 1.6l2.6 5.3 5.8.8-4.2 4.100 1 5.800L10 14.900l-5.200 2.700 1-5.800L1.600 7.700l5.800-.8z" />
        </svg>
      ))}
    </span>
  );
}

function SectionHead({ title, href, label }: { title: string; href?: string; label?: string }) {
  return (
    <div className="mb-9 flex items-end justify-between gap-6" data-reveal>
      <h2 className="s-h2">{title}</h2>
      {href && (
        <Link href={href} className="hidden shrink-0 items-center gap-1 text-[15px] font-medium text-coal underline decoration-rule underline-offset-[6px] transition hover:decoration-coal sm:inline-flex">
          {label} <ArrowUpRight size={16} />
        </Link>
      )}
    </div>
  );
}

export default async function HomePage() {
  const { data, catalog } = await storeSnapshot();
  const { content } = data;
  const best = catalog.products.filter((p) => p.bestSeller).sort((a, b) => a.sellRank - b.sellRank).slice(0, 4);
  const reviews: ReviewRec[] = data.reviews.filter((r) => r.status === "approved").slice(0, 6);
  const tested = catalog.products.filter((p) => leadVariant(p).testing === "coa_available").slice(0, 4);

  const sections: Record<string, (title: string) => React.ReactNode> = {
    bestsellers: (title) =>
      best.length > 0 && (
        <section key="bestsellers" className="s-wrap py-16 sm:py-24">
          <SectionHead title={title} href="/shop?sort=best" label="Shop best sellers" />
          <ProductGrid products={best} priorityCount={2} />
        </section>
      ),
    groups: (title) =>
      catalog.groups.length > 0 && (
        <section key="groups" className="bg-soft py-16 sm:py-24">
          <div className="s-wrap">
            <SectionHead title={title} href="/collections" label="All collections" />
            <ul className="grid gap-px overflow-hidden rounded-2xl border border-rule bg-rule sm:grid-cols-2 lg:grid-cols-3" data-reveal>
              {catalog.groups.map((g) => (
                <li key={g.id}>
                  <Link href={`/collections/${g.slug}`} className="group flex h-full items-center justify-between gap-4 bg-paper px-6 py-7 transition hover:bg-brand-tint">
                    <span>
                      <span className="block text-xl font-semibold tracking-tight">{g.name}</span>
                      <span className="mt-0.5 block text-sm text-stone">
                        {g.count} {g.count === 1 ? "product" : "products"}
                      </span>
                    </span>
                    <ArrowRight size={20} className="shrink-0 text-stone transition duration-300 ease-out group-hover:translate-x-1 group-hover:text-brand" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ),
    products: (title) =>
      catalog.products.length > 0 && (
        <section key="products" className="s-wrap py-16 sm:py-24">
          <SectionHead title={title} href="/shop" label="Open the shop" />
          <ProductGrid products={catalog.products.slice(0, 8)} priorityCount={best.length ? 0 : 2} />
          {catalog.products.length > 8 && (
            <div className="mt-12 text-center">
              <Link href="/shop" className="s-btn-line">
                View all {catalog.products.length} products
              </Link>
            </div>
          )}
        </section>
      ),
    quality: (title) => (
      <section key="quality" className="bg-night py-16 text-white sm:py-24">
        <div className="s-wrap grid gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-20">
          <div data-reveal>
            <h2 className="s-h2">{title}</h2>
            <p className="mt-5 max-w-md text-[1.0625rem] leading-[1.75] text-white/80">{content.quality.body}</p>
            <Link href="/testing" className="s-btn mt-8 bg-white text-coal hover:bg-white/90">
              Testing status for every product <ArrowRight size={17} />
            </Link>
          </div>
          <div>
            <dl className="divide-y divide-white/15 border-y border-white/15">
              {content.quality.points
                .filter((p) => p.title.trim())
                .map((p, i) => (
                  <div key={i} className="grid gap-1 py-6 sm:grid-cols-[14rem_1fr] sm:gap-6" data-reveal style={{ ["--i" as string]: i }}>
                    <dt className="text-lg font-semibold tracking-tight">{p.title}</dt>
                    <dd className="text-[15px] leading-relaxed text-white/75">{p.text}</dd>
                  </div>
                ))}
            </dl>
            {tested.length > 0 && (
              <div className="mt-8" data-reveal>
                <p className="text-sm text-white/70">Certificates on file now</p>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {tested.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 rounded-full bg-white py-1 pl-3.5 pr-1 text-coal">
                      <Link href={`/product/${p.slug}`} className="text-sm font-medium hover:text-brand">
                        {p.name}
                      </Link>
                      <TestingBadge v={leadVariant(p)} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </section>
    ),
    reviews: (title) =>
      reviews.length > 0 && (
        <section key="reviews" className="s-wrap py-16 sm:py-24">
          <SectionHead title={title} />
          <ul className="grid gap-x-10 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
            {reviews.map((r, i) => (
              <li key={r.id} className="border-t border-coal pt-5" data-reveal style={{ ["--i" as string]: i % 3 }}>
                <Stars n={r.rating} />
                {r.text && <blockquote className="mt-3 text-[1.0625rem] leading-relaxed">{r.text}</blockquote>}
                <p className="mt-4 text-sm text-stone">
                  <span className="font-medium text-coal">{r.displayName}</span> · Verified buyer{r.edited ? " · Edited by store" : ""}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-[13px] text-stone">Reviews are about the order experience: shipping, packaging and service.</p>
        </section>
      ),
    faq: (title) =>
      content.faq.some((f) => f.q.trim()) && (
        <section key="faq" className="s-wrap py-16 sm:py-24">
          <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr] lg:gap-20">
            <div data-reveal>
              <h2 className="s-h2">{title}</h2>
              <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-stone">
                Something else?{" "}
                <Link href="/contact" className="s-link">
                  Send us a message
                </Link>
                .
              </p>
            </div>
            <div data-reveal>
              <FaqList items={content.faq.slice(0, 5)} />
              {content.faq.length > 5 && (
                <Link href="/faq" className="s-link mt-6 inline-block">
                  All questions
                </Link>
              )}
            </div>
          </div>
        </section>
      ),
  };

  return (
    <>
      <Hero hero={content.hero} catalog={catalog} />
      {catalog.products.length === 0 && (
        <section className="s-wrap py-24 text-center">
          <h2 className="s-h2">The catalog is being stocked.</h2>
          <p className="mx-auto mt-4 max-w-md text-stone">Products will appear here as soon as they are listed.</p>
        </section>
      )}
      {content.sections.filter((s) => s.show).map((s) => sections[s.id]?.(s.title))}
    </>
  );
}
