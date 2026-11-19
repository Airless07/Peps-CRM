"use client";

// Product page: gallery, size picker (updates price, stock and COA), buy more save more tiers,
// quantity, add to cart, compound info, current COA and batch history.
import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, Download, FileText } from "lucide-react";
import type { PublicProduct } from "@/lib/store/catalog";
import { STOCK_LABEL } from "@/lib/store/catalog";
import { testingClaim } from "@/lib/store/copy";
import { discountedUnit, qtyPercentOff } from "@/lib/store/pricing";
import { trackEvent } from "./analytics";
import { money, QtyStepper, useCart } from "./cart";
import { photoSrcSet, StockTag, TestingBadge } from "./product-card";
import { Vial } from "./vial";

const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "");

export function ProductView({ p }: { p: PublicProduct }) {
  const cart = useCart();
  const firstAvailable = p.variants.find((v) => v.stock !== "out") ?? p.variants[0];
  const [variantId, setVariantId] = useState(firstAvailable.id);
  const [qty, setQty] = useState(1);
  const [photo, setPhoto] = useState(0);
  const [added, setAdded] = useState(false);
  const v = p.variants.find((x) => x.id === variantId) ?? p.variants[0];
  const soldOut = v.stock === "out";

  // Tiers count every size of this product already in the cart.
  const inCart = useMemo(() => cart.items.filter((i) => p.variants.some((x) => x.id === i.variantId)).reduce((s, i) => s + i.quantity, 0), [cart.items, p.variants]);
  const percent = qtyPercentOff(p.qtyDeals, qty + inCart);
  const unit = discountedUnit(v.priceCents, percent);
  const tiers = [{ minQty: 1, percentOff: 0 }, ...p.qtyDeals];
  const activeTier = [...tiers].reverse().find((t) => qty + inCart >= t.minQty)!;

  function add() {
    cart.add(v.id, qty);
    trackEvent("add_to_cart", p.id);
    setAdded(true);
    setTimeout(() => setAdded(false), 1600);
    setQty(1);
  }

  const current = p.photos[photo];
  return (
    <div className="grid gap-x-14 gap-y-8 lg:grid-cols-[1.05fr_1fr]">
      {/* Gallery */}
      <div className="lg:sticky lg:top-36 lg:self-start">
        <div className="group relative aspect-[4/5] overflow-hidden rounded-3xl bg-soft">
          {current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={current.id} src={`/media/${current.id}-960.webp`} srcSet={photoSrcSet(current.id)} sizes="(min-width: 1024px) 46vw, 100vw" alt={current.alt} width={960} height={1200} fetchPriority="high" className="h-full w-full animate-fade-in object-cover transition duration-700 ease-out group-hover:scale-[1.04]" />
          ) : (
            <Vial name={p.name} size={v.label} className="h-full w-full p-[16%]" />
          )}
          {(p.badges.length > 0 || p.deals.length > 0) && (
            <div className="absolute left-4 top-4 flex flex-wrap gap-1.5">
              {[...(p.deals.length > 0 ? ["BOGO"] : []), ...p.badges].slice(0, 3).map((b) => (
                <span key={b} className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-white">
                  {b}
                </span>
              ))}
            </div>
          )}
        </div>
        {p.photos.length > 1 && (
          <div className="mt-3 flex gap-2.5 overflow-x-auto pb-1" role="group" aria-label="Product photos">
            {p.photos.map((ph, i) => (
              <button key={ph.id} type="button" onClick={() => setPhoto(i)} aria-label={`Photo ${i + 1} of ${p.photos.length}`} aria-pressed={i === photo} className={`h-20 w-16 shrink-0 overflow-hidden rounded-xl border-2 bg-soft transition ${i === photo ? "border-coal" : "border-transparent opacity-70 hover:opacity-100"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/media/${ph.id}-480.webp`} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Buy box */}
      <div className="min-w-0">
        {p.specs.find((s) => s.label === "Form") && <p className="text-sm text-stone">{p.specs.find((s) => s.label === "Form")!.value}</p>}
        <h1 className="mt-1 text-4xl font-semibold leading-[1.05] sm:text-5xl" style={{ letterSpacing: "-0.03em" }}>
          {p.name}
        </h1>
        {p.summary && <p className="mt-4 max-w-xl text-[1.0625rem] leading-relaxed text-stone">{p.summary}</p>}
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <TestingBadge v={v} className="h-8 px-3 text-[13px]" />
          <StockTag level={v.stock} />
        </div>

        {/* One size: a plain label, not a picker. */}
        {p.variants.length === 1 && v.label && (
          <div className="mt-7" data-single-size>
            <p className="s-label">Size</p>
            <span className="inline-flex h-12 items-center rounded-full border border-coal px-5 text-[15px] font-medium">
              {v.label}
              {v.volume && <span className="ml-2 font-normal text-stone">· {v.volume} vial</span>}
            </span>
          </div>
        )}
        {p.variants.length > 1 && (
          <div className="mt-7">
            <label htmlFor="size" className="s-label">
              Size
            </label>
            <div className="hidden flex-wrap gap-2 sm:flex" role="radiogroup" aria-label="Size">
              {p.variants.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="radio"
                  aria-checked={x.id === v.id}
                  onClick={() => setVariantId(x.id)}
                  className={`flex h-12 items-center gap-2 rounded-full border px-5 text-[15px] font-medium transition ${x.id === v.id ? "border-coal bg-coal text-white" : "border-rule hover:border-coal"} ${x.stock === "out" ? "opacity-60" : ""}`}
                >
                  {x.label}
                  {x.volume && <span className={`text-xs font-normal ${x.id === v.id ? "text-white/75" : "text-stone"}`}>{x.volume}</span>}
                  {x.stock === "out" && <span className="text-xs font-normal">Sold out</span>}
                </button>
              ))}
            </div>
            <select id="size" value={v.id} onChange={(e) => setVariantId(e.target.value)} className="s-input sm:hidden">
              {p.variants.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                  {x.volume ? ` (${x.volume})` : ""} · {money(x.priceCents)} · {STOCK_LABEL[x.stock]}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mt-7 flex items-baseline gap-3">
          <span className="text-4xl font-semibold tabular-nums tracking-tight">{money(unit)}</span>
          {percent > 0 && <s className="text-lg tabular-nums text-stone">{money(v.priceCents)}</s>}
          <span className="text-sm text-stone">per vial</span>
        </div>
        {p.deals.length > 0 && (
          <div data-product-deal className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-brand/10 px-4 py-3 text-[15px] font-semibold text-brand">
            <span className="rounded-full bg-brand px-2.5 py-0.5 text-xs text-white">BOGO</span>
            {p.deals.join(" · ")}
            <span className="w-full text-[13px] font-normal text-coal/70">Applied in the cart. It never stacks with buy-more savings on the same product: you get whichever saves more.</span>
          </div>
        )}

        {p.qtyDeals.length > 0 && (
          <div className="mt-6">
            <p className="s-label">Buy more, save more</p>
            <div className={`grid gap-2 ${tiers.length === 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))]"}`}>
              {tiers.map((t, i) => {
                const on = t === activeTier;
                const next = tiers[i + 1];
                const label = t.minQty === 1 ? "1 vial" : next ? (next.minQty - 1 > t.minQty ? `${t.minQty} to ${next.minQty - 1} vials` : `${t.minQty} vials`) : `${t.minQty}+ vials`;
                return (
                  <button
                    key={t.minQty}
                    type="button"
                    disabled={soldOut}
                    onClick={() => setQty(Math.max(1, t.minQty - inCart))}
                    aria-pressed={on}
                    className={`relative rounded-xl border px-3 py-3 text-left transition sm:px-3.5 ${on ? "border-coal bg-soft" : "border-rule hover:border-coal"}`}
                  >
                    {on && <Check size={14} className="absolute right-2.5 top-2.5 text-brand" />}
                    <span className="block text-[15px] font-semibold">{label}</span>
                    <span className={`block text-[13px] ${t.percentOff ? "font-medium text-brand" : "text-stone"}`}>{t.percentOff ? `${t.percentOff}% off` : "Regular price"}</span>
                    <span className="block text-[13px] tabular-nums text-stone">{money(discountedUnit(v.priceCents, t.percentOff))} each</span>
                  </button>
                );
              })}
            </div>
            {inCart > 0 && <p className="s-hint">You have {inCart} of this product in your cart. They count toward the discount.</p>}
          </div>
        )}

        <div className="mt-7 flex items-stretch gap-3">
          <QtyStepper value={qty} onChange={(n) => setQty(Math.max(1, Math.min(99, n)))} label={p.name} />
          <button type="button" onClick={add} disabled={soldOut} className="s-btn-primary h-12 flex-1 px-4 sm:h-[3.25rem]">
            {soldOut ? "Sold out" : added ? (
              <>
                <Check size={18} /> Added
              </>
            ) : (
              <>Add to cart · {money(unit * qty)}</>
            )}
          </button>
        </div>
        {soldOut && p.variants.some((x) => x.stock !== "out") && <p className="s-hint">This size is sold out. Another size is available above.</p>}

        {/* Current COA for the selected size */}
        <section aria-label="Certificate of analysis" className="mt-8 rounded-2xl border border-rule p-5">
          <div className="flex items-start gap-3.5">
            <FileText size={22} strokeWidth={1.6} className="mt-0.5 shrink-0 text-stone" />
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold !tracking-normal">Certificate of analysis{v.label ? ` · ${v.label}` : ""}</h2>
              {v.coa ? (
                <>
                  <p className="mt-1 text-sm leading-relaxed text-stone">
                    {[v.coa.lot ? `Lot ${v.coa.lot}` : "", v.coa.testDate ? `tested ${dateText(v.coa.testDate)}` : "", v.coa.purity ? `${v.coa.purity} purity` : ""].filter(Boolean).join(" · ") || "Current batch"}
                    {v.testing === "supplier_tested" ? ". Supplier certificate." : ""}
                  </p>
                  {testingClaim(v.testing).thirdPartyTested && <p className="mt-1 text-sm font-medium leading-relaxed text-coal">Third-party tested</p>}
                  <div className="mt-3.5 flex flex-wrap gap-2">
                    <a href={v.coa.url} target="_blank" rel="noreferrer" className="s-btn-dark h-10 px-4 text-sm">
                      View COA
                    </a>
                    <a href={`${v.coa.url}?download=${encodeURIComponent(`${p.slug}-coa${v.coa.lot ? `-${v.coa.lot}` : ""}${v.coa.isPdf ? ".pdf" : ".webp"}`)}`} className="s-btn-line h-10 px-4 text-sm">
                      <Download size={15} /> Download
                    </a>
                  </div>
                </>
              ) : (
                <p className="mt-1 text-sm leading-relaxed text-stone">
                  {testingClaim(v.testing).line}
                </p>
              )}
              {v.olderCoas.length > 0 && (
                <details className="s-acc mt-4 border-t border-rule pt-3">
                  <summary className="flex items-center justify-between text-sm font-medium">
                    Batch history ({v.olderCoas.length})
                    <span className="s-acc-icon relative h-3 w-3 transition-transform duration-300 before:absolute before:left-0 before:top-1/2 before:h-px before:w-3 before:bg-coal after:absolute after:left-1/2 after:top-0 after:h-3 after:w-px after:bg-coal" aria-hidden />
                  </summary>
                  <ul className="mt-2 divide-y divide-rule">
                    {v.olderCoas.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                        <span className="min-w-0 text-stone">{[c.lot ? `Lot ${c.lot}` : "Earlier batch", dateText(c.testDate), c.purity ? `${c.purity}` : ""].filter(Boolean).join(" · ")}</span>
                        <a href={c.url} target="_blank" rel="noreferrer" className="s-link shrink-0">
                          View
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>
        </section>

        {p.specs.length > 0 && (
          <section className="mt-10" aria-labelledby="compound-info">
            <h2 id="compound-info" className="text-lg font-semibold">
              Compound information
            </h2>
            <div className="mt-3 overflow-hidden rounded-2xl border border-rule">
              <table className="w-full table-fixed text-left text-[15px]">
                <tbody className="divide-y divide-rule">
                  {p.specs.map((s) => (
                    <tr key={s.label}>
                      <th scope="row" className="w-[42%] bg-soft px-4 py-3 align-top font-normal text-stone">
                        {s.label}
                      </th>
                      <td className="break-words px-4 py-3 font-medium">{s.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {p.description && (
          <section className="mt-10">
            <h2 className="text-lg font-semibold">Overview</h2>
            <div className="mt-3 space-y-4 text-[15px] leading-[1.75] text-stone">
              {p.description.split(/\n{2,}/).map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
          </section>
        )}

        <p className="mt-10 border-t border-rule pt-5 text-[13px] leading-relaxed text-stone">
          For laboratory research use only. Not for human consumption. See the{" "}
          <Link href="/research-use" className="s-link">
            research use policy
          </Link>{" "}
          and{" "}
          <Link href="/shipping" className="s-link">
            shipping policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
