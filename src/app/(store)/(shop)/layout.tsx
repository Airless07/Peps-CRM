import Link from "next/link";
import { TAGLINE } from "@/lib/store/config";
import { storeAccess, storeSnapshot } from "@/lib/store/server";

/** Everything in this group needs the store to be open (or an admin previewing it). */
export default async function ShopGate({ children }: { children: React.ReactNode }) {
  const access = await storeAccess();
  if (access.allowed) return <>{children}</>;
  const { data } = await storeSnapshot();
  return (
    <section className="s-wrap flex min-h-[68dvh] flex-col justify-center py-20">
      <p className="text-sm font-medium text-brand">Coming soon</p>
      <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-[1.02] sm:text-7xl" style={{ letterSpacing: "-0.035em" }}>
        {data.store.storeName} is getting ready to open.
      </h1>
      <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone">{TAGLINE} The store opens shortly. Check back soon.</p>
      <div className="mt-9 flex flex-wrap gap-3">
        <Link href="/order-lookup" className="s-btn-line">
          Look up an order
        </Link>
        <Link href="/research-use" className="s-btn-line">
          Research use policy
        </Link>
      </div>
    </section>
  );
}
