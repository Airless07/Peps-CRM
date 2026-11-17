import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/order-ops";
import { robotsFor } from "@/lib/store/robots";
import { storeSnapshot } from "@/lib/store/server";

export const dynamic = "force-dynamic";

/** Follows the open/closed switch in Settings on every request: no redeploy or manual step. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const { data } = await storeSnapshot();
  return robotsFor(data.store.open, siteUrl(data.store));
}
