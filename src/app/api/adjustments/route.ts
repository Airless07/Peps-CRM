import { body, route } from "@/lib/api";
import { createAdjustment } from "@/lib/lab-testing";
import { requestOrigin } from "@/lib/order-ops";
import { adjustmentCreate } from "@/lib/schemas";
import { withLowStockAlert } from "@/lib/stock-alerts";

/** Adjust stock (lab testing, breakage, freebie, correction). Never touches money. Alerts at the low stock level. */
export const POST = route(async (req) => {
  const data = await body(req, adjustmentCreate);
  return withLowStockAlert(() => createAdjustment(data), requestOrigin(req));
});
