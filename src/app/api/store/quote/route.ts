import { body, route } from "@/lib/api";
import { currentAccount } from "@/lib/account";
import { creditAvailable } from "@/lib/credit-ops";
import { prisma } from "@/lib/db";
import { quoteCheckout } from "@/lib/order-ops";
import { rateLimit } from "@/lib/ratelimit";
import { checkoutMethods } from "@/lib/store/payments";
import { lastReferralCode, STACKING_TEXT } from "@/lib/store/referral";
import { quoteInput } from "@/lib/store/schemas";
import { requireOpenStore, storeSnapshot } from "@/lib/store/server";
import type { Address } from "@/lib/types";

/** Price a cart: lines, savings, discount and referral code results, shipping options and payment methods. */
export const POST = route(
  async (req) => {
    rateLimit(req, "quote", 90, 60_000);
    await requireOpenStore();
    const input = await body(req, quoteInput);
    const { data, catalog } = await storeSnapshot();
    const account = await currentAccount();
    const to = input.shipTo && input.shipTo.street1 && input.shipTo.zip ? ({ name: "", street2: "", city: "", state: "", country: "US", ...input.shipTo } as Address) : null;
    const buyer = { customerId: account?.id ?? null, email: account?.email ?? "", shipTo: to };
    const { pricing, shipping, liveNote, referral, referralError, conflict } = await quoteCheckout(data, {
      items: input.items,
      code: input.code,
      email: account?.email ?? "",
      shipTo: to,
      referralCode: input.referralCode,
      buyer,
    });
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
      // Signed-in customers: their store credit (balance, and what unpaid orders don't already hold).
      credit: account ? await creditAvailable(prisma, account.id).then(({ balance, available }) => ({ balanceCents: Math.max(0, balance), availableCents: available })) : null,
      // Referral code: what it does (never who owns it), why it can't be used, or the stacking choice.
      referral: referral ? { code: referral.display, discountPercent: referral.buyerDiscountPercent, cents: pricing.referralCents } : null,
      referralError,
      conflict: conflict ? { message: STACKING_TEXT, discountCode: pricing.code, referralCode: input.referralCode.trim().toUpperCase() } : null,
      // "You used CODE last time. Use it again?" (only when that code still exists and isn't theirs).
      lastReferral: account && !input.referralCode.trim() ? lastReferralCode(data, buyer) : null,
    };
  },
  { public: true },
);
