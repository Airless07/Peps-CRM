import type { Metadata } from "next";
import { ShopBrowser } from "@/components/storefront/shop-browser";
import { storeSnapshot } from "@/lib/store/server";

export const metadata: Metadata = {
  title: "Shop all products",
  description: "Browse every research compound we stock, with testing status, certificates of analysis and current availability.",
  alternates: { canonical: "/shop" },
};

export default async function ShopPage() {
  const { catalog } = await storeSnapshot();
  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-14">
      <h1 className="text-4xl font-semibold leading-[1.05] sm:text-5xl" style={{ letterSpacing: "-0.03em" }}>
        Shop
      </h1>
      <p className="mb-8 mt-3 max-w-xl text-[1.0625rem] leading-relaxed text-stone">Every product shows its testing status. Open one to see the certificate for the size you pick.</p>
      <ShopBrowser products={catalog.products} groups={catalog.groups} />
    </div>
  );
}
