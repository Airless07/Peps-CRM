"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { PublicGroup, PublicProduct } from "@/lib/store/catalog";
import { searchProducts } from "./chrome";
import { ProductGrid } from "./product-card";

type Sort = "featured" | "best" | "price-asc" | "price-desc" | "newest";
const SORTS: { value: Sort; label: string }[] = [
  { value: "featured", label: "Featured" },
  { value: "best", label: "Best selling" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "newest", label: "Newest" },
];

/** Instant search, group filter and sort. Everything happens in the browser: no reloads. */
export function ShopBrowser({ products, groups, fixedGroup }: { products: PublicProduct[]; groups: PublicGroup[]; fixedGroup?: string }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState(fixedGroup ?? "all");
  const [sort, setSort] = useState<Sort>("featured");

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("q")) setQ(p.get("q")!);
    const s = p.get("sort") as Sort | null;
    if (s && SORTS.some((x) => x.value === s)) setSort(s);
    const g = p.get("group");
    if (!fixedGroup && g && groups.some((x) => x.slug === g)) setGroup(groups.find((x) => x.slug === g)!.id);
  }, [fixedGroup, groups]);

  const groupName = useMemo(() => {
    const m = new Map(groups.map((g) => [g.id, g.name]));
    return (id: string) => m.get(id) ?? "";
  }, [groups]);

  const list = useMemo(() => {
    let out = searchProducts(products, q, groupName);
    if (group !== "all") out = out.filter((p) => p.groupIds.includes(group));
    const by: Record<Sort, (a: PublicProduct, b: PublicProduct) => number> = {
      featured: () => 0,
      best: (a, b) => a.sellRank - b.sellRank,
      "price-asc": (a, b) => a.priceFromCents - b.priceFromCents,
      "price-desc": (a, b) => b.priceFromCents - a.priceFromCents,
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
    };
    return sort === "featured" ? out : [...out].sort(by[sort]);
  }, [products, q, group, sort, groupName]);

  const chip = (on: boolean) => `h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition ${on ? "border-coal bg-coal text-white" : "border-rule bg-paper text-coal hover:border-coal"}`;

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={18} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-stone" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, CAS number or collection" aria-label="Search products" className="s-input rounded-full pl-11 pr-11" />
          {q && (
            <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-stone hover:text-coal">
              <X size={17} />
            </button>
          )}
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm text-stone">
          <span className="hidden sm:inline">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort products" className="h-12 w-full rounded-full border border-rule bg-paper pl-4 pr-9 text-[15px] font-medium text-coal focus:border-coal focus:outline-none sm:w-auto">
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!fixedGroup && groups.length > 0 && (
        <div className="-mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Filter by collection">
          <button type="button" aria-pressed={group === "all"} className={chip(group === "all")} onClick={() => setGroup("all")}>
            All
          </button>
          {groups.map((g) => (
            <button key={g.id} type="button" aria-pressed={group === g.id} className={chip(group === g.id)} onClick={() => setGroup(g.id)}>
              {g.name}
            </button>
          ))}
        </div>
      )}

      <p className="mb-6 mt-7 text-sm text-stone" aria-live="polite">
        {list.length} {list.length === 1 ? "product" : "products"}
        {q.trim() ? ` for “${q.trim()}”` : ""}
      </p>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-rule px-6 py-20 text-center">
          <p className="text-lg font-semibold">{products.length === 0 ? "No products are listed yet." : "Nothing matches that."}</p>
          <p className="mt-1 text-[15px] text-stone">{products.length === 0 ? "Check back soon." : "Try a different search or clear the filters."}</p>
          {products.length > 0 && (
            <button
              type="button"
              className="s-btn-line mt-6"
              onClick={() => {
                setQ("");
                setGroup(fixedGroup ?? "all");
              }}
            >
              Clear search and filters
            </button>
          )}
        </div>
      ) : (
        <ProductGrid key={`${group}-${sort}-${q}`} products={list} priorityCount={4} />
      )}
    </div>
  );
}
