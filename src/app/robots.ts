import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/order-ops";
import { storeSnapshot } from "@/lib/store/server";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const { data } = await storeSnapshot();
  const base = siteUrl(data.store);
  if (!data.store.open) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/order/", "/review/", "/account", "/checkout", "/cart", "/order-lookup", "/exit"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
