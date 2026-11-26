import { body, route } from "@/lib/api";
import { sendLabShipment } from "@/lib/lab-testing";
import { requestOrigin } from "@/lib/order-ops";
import { labShipmentInput } from "@/lib/schemas";
import { withLowStockAlert } from "@/lib/stock-alerts";

/** "Send samples to lab": takes several sizes out of stock in one go (lab testing). Never touches money. */
export const POST = route(async (req) => {
  const data = await body(req, labShipmentInput);
  const rows = await withLowStockAlert(() => sendLabShipment(data), requestOrigin(req));
  return { ok: true, count: Array.isArray(rows) ? rows.length : 0 };
});
