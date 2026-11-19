import Link from "next/link";
import { BadgeCheck, Clock3, FlaskConical } from "lucide-react";
import type { PublicProduct, PublicVariant, StockLevel } from "@/lib/store/catalog";
import { STOCK_LABEL } from "@/lib/store/catalog";
import { Vial } from "./vial";

export const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;
export const priceRange = (p: Pick<PublicProduct, "priceFromCents" | "priceToCents">) => (p.priceFromCents === p.priceToCents ? fmt(p.priceFromCents) : `${fmt(p.priceFromCents)} – ${fmt(p.priceToCents)}`);

export const photoSrcSet = (id: string) => `/media/${id}-480.webp 480w, /media/${id}-960.webp 960w, /media/${id}-1600.webp 1600w`;

/** The variant whose testing status best represents the product on a card (a real COA wins). */
export function leadVariant(p: PublicProduct): PublicVariant {
  const order = ["coa_available", "supplier_tested", "pending", "coming_soon"];
  return [...p.variants].sort((a, b) => order.indexOf(a.testing) - order.indexOf(b.testing))[0];
}

/** Testing status pill. With a COA it links straight to the file. */
export function TestingBadge({ v, link = true, short = false, className = "" }: { v: PublicVariant; link?: boolean; short?: boolean; className?: string }) {
  const base = `inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border bg-paper px-2.5 text-xs font-medium ${className}`;
  if (v.testing === "coa_available") {
    const text = v.purity ? `${v.purity.replace(/\s*purity$/i, "")} purity` : "COA available";
    const inner = (
      <>
        <BadgeCheck size={14} className="shrink-0 text-emerald-700" />
        <span className="truncate">{text}</span>
        {v.coa && link && <span className="border-l border-rule pl-1.5 font-semibold text-coal">COA</span>}
      </>
    );
    return v.coa && link ? (
      <a href={v.coa.url} target="_blank" rel="noreferrer" aria-label={`${text}. View certificate of analysis`} className={`tap ${base} border-rule text-coal transition hover:border-coal`}>
        {inner}
      </a>
    ) : (
      <span className={`${base} border-rule text-coal`}>{inner}</span>
    );
  }
  const Icon = v.testing === "supplier_tested" ? FlaskConical : Clock3;
  const shortLabel = { supplier_tested: "Supplier tested", pending: "Testing pending", coming_soon: "COA coming soon" }[v.testing];
  return (
    <span className={`${base} border-rule text-stone`} title={v.testingLabel}>
      <Icon size={13} className="shrink-0" />
      <span className="truncate">{short ? shortLabel : v.testingLabel}</span>
    </span>
  );
}

export function StockTag({ level }: { level: StockLevel }) {
  const dot = level === "in" ? "bg-emerald-600" : level === "low" ? "bg-amber-500" : "bg-stone/50";
  return (
    <span className={`inline-flex items-center gap-1.5 text-[13px] ${level === "out" ? "text-stone" : "text-coal"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {STOCK_LABEL[level]}
    </span>
  );
}

export function ProductCard({ p, priority, index = 0 }: { p: PublicProduct; priority?: boolean; index?: number }) {
  const lead = leadVariant(p);
  const photo = p.photos[0];
  const sizes = p.variants.map((v) => v.label).filter(Boolean);
  // The whole card is ONE real link (image, name, price, badges), so the first tap anywhere opens the
  // product, on touch screens too. Nothing interactive is nested inside it (the COA link lives on the
  // product page), and every hover effect is hover-capable devices only (see tailwind.config.ts).
  return (
    <article data-reveal style={{ ["--i" as string]: index % 4 }} className="flex flex-col">
      <Link href={`/product/${p.slug}`} data-product-card={p.slug} className="s-card group flex flex-1 flex-col rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-4">
        <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-soft">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/media/${photo.id}-960.webp`}
              srcSet={photoSrcSet(photo.id)}
              sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
              alt={photo.alt}
              width={960}
              height={1200}
              loading={priority ? "eager" : "lazy"}
              fetchPriority={priority ? "high" : undefined}
              decoding="async"
              className={`pointer-events-none h-full w-full object-cover transition duration-700 ease-out group-hover:scale-[1.045] ${p.hoverGif ? "group-hover:opacity-0" : ""}`}
            />
          ) : (
            <Vial name={p.name} size={sizes.length === 1 ? sizes[0] : ""} className="pointer-events-none h-full w-full p-[14%] transition duration-700 ease-out group-hover:scale-[1.045]" />
          )}
          {p.hoverGif && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/media/${p.hoverGif}`} alt="" loading="lazy" className="pointer-events-none absolute inset-0 hidden h-full w-full object-cover opacity-0 transition duration-500 group-hover:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:block" />
          )}
          {(p.badges.length > 0 || p.bestSeller || p.deals.length > 0) && (
            <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
              {[...new Set([...(p.deals.length > 0 ? ["BOGO"] : []), ...(p.bestSeller ? ["Best seller"] : []), ...p.badges])].slice(0, 2).map((b) => (
                <span key={b} className="rounded-full bg-brand px-2.5 py-1 text-[11px] font-semibold text-white">
                  {b}
                </span>
              ))}
            </div>
          )}
          {p.stock === "out" && <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-coal px-2.5 py-1 text-[11px] font-semibold text-white">Sold out</span>}
        </div>
        <div className="mt-3.5 flex flex-1 flex-col">
          <div className="flex flex-col gap-x-3 gap-y-0.5 sm:flex-row sm:items-start sm:justify-between">
            <h3 className="text-[1.0625rem] font-semibold leading-snug group-hover:text-brand">{p.name}</h3>
            <span className="shrink-0 text-[15px] font-medium tabular-nums sm:pt-px">{priceRange(p)}</span>
          </div>
          {p.deals.length > 0 && (
            <p data-card-deal className="mt-1 text-[13px] font-semibold text-brand">
              {p.deals[0]}
            </p>
          )}
          {p.summary && <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-stone">{p.summary}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <TestingBadge v={lead} short link={false} />
            {p.stock !== "out" && <StockTag level={p.stock} />}
            {sizes.length > 1 ? (
              <span className="text-[13px] text-stone">{sizes.length} sizes</span>
            ) : sizes.length === 1 ? (
              <span data-size className="text-[13px] text-stone">{sizes[0]}</span>
            ) : null}
          </div>
        </div>
      </Link>
    </article>
  );
}

export function ProductGrid({ products, priorityCount = 0 }: { products: PublicProduct[]; priorityCount?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:gap-x-6 md:grid-cols-3 lg:grid-cols-4">
      {products.map((p, i) => (
        <ProductCard key={p.id} p={p} index={i} priority={i < priorityCount} />
      ))}
    </div>
  );
}

/** Simple text renderer for editable content: "## heading", "- bullet", blank line = new paragraph. */
export function RichText({ text, className = "s-prose" }: { text: string; className?: string }) {
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        const lines = b.split("\n");
        const out: React.ReactNode[] = [];
        let list: string[] = [];
        let para: string[] = [];
        const flush = (k: string) => {
          if (para.length) out.push(<p key={`p${k}`}>{para.join(" ")}</p>);
          if (list.length) out.push(<ul key={`u${k}`}>{list.map((x, n) => <li key={n}>{x}</li>)}</ul>);
          para = [];
          list = [];
        };
        lines.forEach((line, n) => {
          if (/^##\s+/.test(line)) {
            flush(`${i}-${n}`);
            out.push(<h2 key={`h${i}-${n}`}>{line.replace(/^##\s+/, "")}</h2>);
          } else if (/^[-*]\s+/.test(line)) {
            if (para.length) flush(`${i}-${n}`);
            list.push(line.replace(/^[-*]\s+/, ""));
          } else {
            if (list.length) flush(`${i}-${n}`);
            para.push(line);
          }
        });
        flush(`${i}-end`);
        return <div key={i}>{out}</div>;
      })}
    </div>
  );
}

/** FAQ list using native <details>: works without JavaScript. */
export function FaqList({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="border-t border-rule">
      {items
        .filter((f) => f.q.trim())
        .map((f, i) => (
          <details key={i} className="s-acc group border-b border-rule" open={i === 0}>
            <summary className="flex items-center justify-between gap-6 py-5 text-[1.0625rem] font-medium">
              <span>{f.q}</span>
              <span className="s-acc-icon relative h-4 w-4 shrink-0 transition-transform duration-300 before:absolute before:left-0 before:top-1/2 before:h-px before:w-4 before:bg-coal after:absolute after:left-1/2 after:top-0 after:h-4 after:w-px after:bg-coal" aria-hidden />
            </summary>
            <p className="max-w-[65ch] pb-6 pr-10 text-[15px] leading-relaxed text-stone">{f.a}</p>
          </details>
        ))}
    </div>
  );
}
