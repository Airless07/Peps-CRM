import { body, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requestOrigin } from "@/lib/order-ops";
import { adjustmentCreate } from "@/lib/schemas";
import { withLowStockAlert } from "@/lib/stock-alerts";

/** Log a stock adjustment (breakage, freebie, correction). Alerts when it takes a size down to its low stock level. */
export const POST = route(async (req) => {
  const data = await body(req, adjustmentCreate);
  return withLowStockAlert(() => prisma.stockAdjustment.create({ data }), requestOrigin(req));
});
