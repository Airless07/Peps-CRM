import { body, HttpError, route } from "@/lib/api";
import { requireAccount, saveAddress } from "@/lib/account";
import { placeOrder, requestOrigin } from "@/lib/order-ops";
import { rateLimit } from "@/lib/ratelimit";
import { validateAddress } from "@/lib/shippo";
import { clearCart } from "@/lib/store/cart-server";
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
    // The cart on screen was built for another account (signed in as someone else in another tab): never
    // place it under this account. The browser reloads the right cart.
    if (input.accountId !== undefined && input.accountId !== account.id) {
      throw new HttpError(409, "You are signed in to a different account now. Your cart was reloaded: review it and place the order again.");
    }

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
      fulfillment: input.fulfillment,
      localTime: input.localTime,
      localNotes: input.localNotes,
      payChoice: input.payChoice,
      expectedTotalCents: input.expectedTotalCents,
      origin: requestOrigin(req),
      storeCreditCents: input.storeCreditCents,
      referralCode: input.referralCode,
    });
    // The order is placed: this account's saved cart is empty now (on every device).
    await clearCart(account.id).catch(() => {});
    if (input.saveAddress) await saveAddress(account.id, { ...input.shipTo, street2: input.shipTo.street2 ?? "" });
    return { ok: true, token: order.token, number: order.number };
  },
  { public: true },
);
