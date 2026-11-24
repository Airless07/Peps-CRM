// Prices on the store. While a sale is on (an automatic percent deal shown on products), the regular
// price is crossed out in grey next to the sale price in bold. The numbers come from the catalog and
// the cart quote, which use the same pricing function as checkout, so the shown price is the charged price.
import type { PublicProduct } from "@/lib/store/catalog";

const fmt = (c: number) => `$${(c / 100).toFixed(2)}`;

/** One price. `listCents` higher than `cents` = on sale: shown crossed out before it. */
export function Price({ cents, listCents, className = "", strikeClassName = "" }: { cents: number; listCents?: number | null; className?: string; strikeClassName?: string }) {
  const sale = listCents != null && listCents > cents;
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-1.5 tabular-nums ${className}`} data-price>
      {sale && (
        <s className={`font-normal text-stone ${strikeClassName}`} data-list-price>
          <span className="sr-only">Regular price </span>
          {fmt(listCents)}
        </s>
      )}
      <span className={sale ? "font-semibold text-coal" : ""} data-sale-price={sale ? "" : undefined}>
        {sale && <span className="sr-only">Sale price </span>}
        {fmt(cents)}
      </span>
    </span>
  );
}

/**
 * A product's price or price range. On sale both ends are crossed out and both discounted:
 * ~~$50.00 – $110.00~~ $35.00 – $77.00. `from`: "From $35.00" instead of a range (search results).
 */
export function PriceRange({ p, from = false, className = "" }: { p: Pick<PublicProduct, "priceFromCents" | "priceToCents" | "listFromCents" | "listToCents">; from?: boolean; className?: string }) {
  const range = p.priceFromCents !== p.priceToCents;
  const sale = p.listFromCents > p.priceFromCents || p.listToCents > p.priceToCents;
  const text = (a: number, b: number) => (!range ? fmt(a) : from ? `From ${fmt(a)}` : `${fmt(a)} – ${fmt(b)}`);
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-1.5 tabular-nums ${className}`} data-price>
      {sale && (
        <s className="font-normal text-stone" data-list-price>
          <span className="sr-only">Regular price </span>
          {text(p.listFromCents, p.listToCents)}
        </s>
      )}
      <span className={sale ? "font-semibold text-coal" : ""} data-sale-price={sale ? "" : undefined}>
        {sale && <span className="sr-only">Sale price </span>}
        {text(p.priceFromCents, p.priceToCents)}
      </span>
    </span>
  );
}

/** "30% OFF" in the store's accent color. */
export function SaleBadge({ percent, className = "" }: { percent: number; className?: string }) {
  return (
    <span className={`rounded-full bg-brand px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white ${className}`} data-sale-badge>
      {percent}% off
    </span>
  );
}
