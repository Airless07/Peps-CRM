import { body, HttpError, route } from "@/lib/api";
import { requireAccount, saveAddress } from "@/lib/account";
import { placeOrder, requestOrigin } from "@/lib/order-ops";
import { rateLimit } from "@/lib/ratelimit";
import { validateAddress } from "@/lib/shippo";
import { checkoutInput } from "@/lib/store/schemas";
import { requireOpenStore } from "@/lib/store/server";

/** Place the order. No approval step: the customer goes straight to the payment instructions. */
export const POST = route(
  async (req) => {
    rateLimit(req, "checkout", 8, 10 * 60_000);
    const access = await requireOpenStore();
    if (access.preview) throw new HttpError(403, "The store is closed, so orders can't be placed yet. Open the store in Settings to test a real order.");
    const account = await requireAccount();
    const input = await body(req, checkoutInput);

    // Carrier check when Shippo is connected. A skipped check never blocks an order.
    const check = await validateAddress(input.shipTo);
    if (check.result === "invalid") {
      throw new HttpError(400, `We couldn't confirm that address with the carrier. ${check.reason} Check the street, city, state and ZIP, then try again.`);
    }

    const order = await placeOrder({
      customerId: account.id,
      name: input.shipTo.name,
      email: account.email,
      phone: input.phone,
      shipTo: { ...input.shipTo, street2: input.shipTo.street2 ?? "" },
      items: input.items,
      code: input.code,
      tier: input.tier,
      payChoice: input.payChoice,
      expectedTotalCents: input.expectedTotalCents,
      origin: requestOrigin(req),
    });
    if (input.saveAddress) await saveAddress(account.id, { ...input.shipTo, street2: input.shipTo.street2 ?? "" });
    return { ok: true, token: order.token, number: order.number };
  },
  { public: true },
);
