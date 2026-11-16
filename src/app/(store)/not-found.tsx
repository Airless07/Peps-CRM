import Link from "next/link";

export default function NotFound() {
  return (
    <div className="s-wrap flex min-h-[62dvh] flex-col justify-center py-20">
      <p className="text-sm font-medium text-brand">Error 404</p>
      <h1 className="mt-3 max-w-2xl text-5xl font-semibold leading-[1.02] sm:text-7xl" style={{ letterSpacing: "-0.035em" }}>
        That page is not in the catalog.
      </h1>
      <p className="mt-5 max-w-lg text-lg leading-relaxed text-stone">The link may be old, or the product may have been removed. Everything we stock is in the shop.</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/shop" className="s-btn-primary">
          Shop all products
        </Link>
        <Link href="/order-lookup" className="s-btn-line">
          Look up an order
        </Link>
      </div>
    </div>
  );
}
