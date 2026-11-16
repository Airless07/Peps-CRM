import { body, route } from "@/lib/api";
import { currentAccount } from "@/lib/account";
import { quoteCheckout } from "@/lib/order-ops";
import { rateLimit } from "@/lib/ratelimit";
import { checkoutMethods } from "@/lib/store/payments";
import { quoteInput } from "@/lib/store/schemas";
import { requireOpenStore, storeSnapshot } from "@/lib/store/server";
import type { Address } from "@/lib/types";

/** Price a cart: lines, savings, discount code result, shipping options and payment methods. */
export const POST = route(
  async (req) => {
    rateLimit(req, "quote", 90, 60_000);
    await requireOpenStore();
    const input = await body(req, quoteInput);
    const { data, catalog } = await storeSnapshot();
    const account = await currentAccount();
    const to = input.shipTo && input.shipTo.street1 && input.shipTo.zip ? ({ name: "", street2: "", city: "", state: "", country: "US", ...input.shipTo } as Address) : null;
    const { pricing, shipping, liveNote } = await quoteCheckout(data, { items: input.items, code: input.code, email: account?.email ?? "", shipTo: to });
    const stock = new Map(catalog.products.flatMap((p) => p.variants.map((v) => [v.id, v.stock] as const)));
    return {
      ...pricing,
      lines: pricing.lines.map((l) => ({ ...l, stock: stock.get(l.variantId) ?? "out" })),
      // Items that were in the cart but can no longer be bought (removed from the website).
      missing: input.items.filter((i) => !pricing.lines.some((l) => l.variantId === i.variantId)).map((i) => i.variantId),
      shipping,
      // Only say that live rates fell back; the technical reason stays on the server.
      shippingEstimated: data.store.shippingMode === "live" && (!to || !!liveNote),
      payMethods: checkoutMethods(data.store.payments),
    };
  },
  { public: true },
);
