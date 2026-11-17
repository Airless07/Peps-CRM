import { body, route } from "@/lib/api";
import { ensureOrderCustomer } from "@/lib/customer-ops";
import { prisma } from "@/lib/db";
import { nextOrderNumber, requestOrigin } from "@/lib/order-ops";
import { withLowStockAlert } from "@/lib/stock-alerts";
import { orderInput } from "@/lib/schemas";

/** Record an in-person sale (the Sell screen). It gets the next order number. */
export const POST = route(async (req) => {
  const { lines, ...order } = await body(req, orderInput);
  await withLowStockAlert(() => prisma.$transaction(async (tx) => {
    const customer = await ensureOrderCustomer(tx, order.customerId, order.customer);
    await tx.order.create({
      data: {
        ...order,
        customer,
        number: await nextOrderNumber(tx),
        source: "inperson",
        status: "completed",
        lines: { create: lines.map((l, i) => ({ ...l, sortOrder: i })) },
      },
    });
  }), requestOrigin(req));
  return { ok: true };
});
