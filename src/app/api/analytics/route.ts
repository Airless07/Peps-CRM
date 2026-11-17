import { route } from "@/lib/api";
import { analyticsSummary } from "@/lib/analytics";

export const dynamic = "force-dynamic";

/** Admin only: aggregate store counts for the last 7 or 30 days. */
export const GET = route(async (req) => {
  const days = Number(new URL(req.url).searchParams.get("days")) === 7 ? 7 : 30;
  return analyticsSummary(days);
});
