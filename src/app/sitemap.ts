import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/order-ops";
import { POLICY_IDS } from "@/lib/store/config";
import { storeSnapshot } from "@/lib/store/server";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data, catalog } = await storeSnapshot();
  const base = siteUrl(data.store);
  // A closed store lists nothing.
  if (!data.store.open) return [];
  const page = (path: string, priority: number, changeFrequency: "daily" | "weekly" | "monthly" = "weekly") => ({ url: `${base}${path}`, priority, changeFrequency });
  return [
    page("/", 1, "daily"),
    page("/shop", 0.9, "daily"),
    page("/collections", 0.7),
    page("/testing", 0.7),
    page("/about", 0.5, "monthly"),
    page("/faq", 0.5, "monthly"),
    page("/contact", 0.4, "monthly"),
    ...catalog.groups.map((g) => page(`/collections/${g.slug}`, 0.7)),
    ...catalog.products.map((p) => page(`/product/${p.slug}`, 0.8)),
    ...POLICY_IDS.map((id) => page(`/${id}`, 0.3, "monthly")),
  ];
}
