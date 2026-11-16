import { body, HttpError, route, type Ctx } from "@/lib/api";
import { prisma } from "@/lib/db";
import { buyLabel, cancelOrder, checkTracking, logEvent, markDelivered, markPaid, markShipped, requestOrigin } from "@/lib/order-ops";
import { orderAction } from "@/lib/store/schemas";

/** Every admin action on an order goes through here. */
export const POST = route(async (req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const input = await body(req, orderAction);
  const origin = requestOrigin(req);
  switch (input.action) {
    case "mark-paid":
      await markPaid(id, { paymentMethod: input.paymentMethod, origin, notify: input.notify });
      return { ok: true, message: "Marked paid. The customer was emailed." };
    case "cancel":
      await cancelOrder(id, input.reason ? `Canceled: ${input.reason.replace(/^canceled:\s*/i, "")}` : "Canceled by the store", { origin, notify: input.notify });
      return { ok: true, message: "Order canceled." };
    case "buy-label": {
      const label = await buyLabel(id, input.rateId, origin);
      return { ok: true, message: `Label bought: ${label.carrier} ${label.service}, $${(label.cents / 100).toFixed(2)}.`, labelUrl: label.labelUrl, trackingNumber: label.trackingNumber };
    }
    case "mark-shipped":
      await markShipped(id, { trackingNumber: input.trackingNumber, carrier: input.carrier, origin });
      return { ok: true, message: "Marked shipped." };
    case "mark-delivered":
      await markDelivered(id, { origin });
      return { ok: true, message: "Marked delivered. The customer was asked for a review." };
    case "check-tracking": {
      const r = await checkTracking(id, origin);
      return { ok: true, message: r.note, changed: r.changed };
    }
    case "archive":
    case "unarchive":
      await prisma.order.update({ where: { id }, data: { archived: input.action === "archive" } });
      return { ok: true, message: input.action === "archive" ? "Order archived. Find it in the Archived tab." : "Order moved back to the main list." };
    case "contact": {
      const o = await prisma.order.findUnique({ where: { id }, select: { source: true, labelUrl: true } });
      if (!o || o.source !== "online") throw new HttpError(400, "Only website orders have a shipping address.");
      if (o.labelUrl) throw new HttpError(409, "A label was already bought for this order, so the address can't be changed here.");
      await prisma.order.update({ where: { id }, data: { email: input.email, phone: input.phone, shipToJson: JSON.stringify(input.shipTo) } });
      await logEvent(prisma, id, "note", "Contact details or shipping address edited.");
      return { ok: true, message: "Saved." };
    }
    case "note":
      await logEvent(prisma, id, "note", input.note);
      return { ok: true, message: "Note added." };
  }
});
