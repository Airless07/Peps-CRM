import type { MetadataRoute } from "next";

/** Private areas that are never crawled: admin, accounts, checkout, order status pages, review links and the API. */
export const ROBOTS_DISALLOW = ["/admin", "/account", "/checkout", "/order/", "/order-lookup", "/review/", "/api/"];

/** robots.txt rules for the store. Closed = block everything. Open = public pages allowed, private areas blocked. */
export function robotsFor(open: boolean, base: string): MetadataRoute.Robots {
  if (!open) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ROBOTS_DISALLOW }],
    sitemap: `${base}/sitemap.xml`,
  };
}
