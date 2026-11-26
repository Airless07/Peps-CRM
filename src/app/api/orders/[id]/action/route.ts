import { body, HttpError, route, type Ctx } from "@/lib/api";
import { prisma } from "@/lib/db";
import { buyLabel, cancelOrder, checkTracking, logEvent, markDelivered, markHandedOver, markPaid, markReady, markShipped, markSwitchRefundPaid, refundOrder, setMoneyTo, requestOrigin, switchToLocal, HANDLING_TEXT } from "@/lib/order-ops";
import { sendReviewRequestNow } from "@/lib/reviews/ops";
import { withLowStockAlert } from "@/lib/stock-alerts";
import { orderAction } from "@/lib/store/schemas";

/** Every admin action on an order goes through here. */
export const POST = route(async (req, ctx: Ctx<{ id: string }>) => {
  const { id } = await ctx.params;
  const input = await body(req, orderAction);
  const origin = requestOrigin(req);
  switch (input.action) {
    case "mark-paid":
      // Marking paid is the moment a website order takes stock.
      await withLowStockAlert(() => markPaid(id, { paymentMethod: input.paymentMethod, origin, notify: input.notify }), origin);
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
      return { ok: true, message: "Marked delivered. The review request email goes out a few days from now (Settings, Email)." };
    case "send-review-request": {
      const r = await sendReviewRequestNow(id, { resend: input.resend, origin });
      if (!r.sent) throw new HttpError(502, r.message);
      return { ok: true, message: r.message };
    }
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
    case "money-to": {
      const r = await setMoneyTo(id, input.to);
      return { ok: true, message: r.message };
    }
    case "note":
      await logEvent(prisma, id, "note", input.note);
      return { ok: true, message: "Note added." };
    case "mark-ready":
      await markReady(id, { origin, notify: input.notify });
      return { ok: true, message: input.notify ? "Marked ready. The customer was emailed." : "Marked ready." };
    case "mark-handed-over":
      await markHandedOver(id, { origin });
      return { ok: true, message: "Marked handed over. See the timeline for the customer email." };
    case "switch-local": {
      const { action: _a, ...rest } = input;
      const rec = await switchToLocal(id, rest, { origin });
      const what = rec.to === "pickup" ? "local pickup" : "local delivery";
      const diff = rec.diffCents > 0 ? ` Difference $${(rec.diffCents / 100).toFixed(2)}: ${HANDLING_TEXT[rec.handling]}.` : "";
      return { ok: true, message: `Switched to ${what}.${diff} It is now in the Local tab.` };
    }
    case "switch-refund-paid":
      await markSwitchRefundPaid(id, input.by);
      return { ok: true, message: "Refund marked paid back." };
    case "refund":
      await refundOrder(id, { amountCents: input.amountCents, expectedRefundedCents: input.expectedRefundedCents, reason: input.reason });
      return { ok: true, message: `Refund of $${(input.amountCents / 100).toFixed(2)} recorded. Any referral credit was adjusted.` };
    case "admin-note":
      // Stored on the order only. It is not part of any email, the order status page or the account page.
      await prisma.order.update({ where: { id }, data: { adminNote: input.note.trim() } });
      return { ok: true, message: input.note.trim() ? "Internal note saved." : "Internal note cleared." };
  }
});
