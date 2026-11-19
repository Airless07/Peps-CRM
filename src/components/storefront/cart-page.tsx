"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { CartLines, CartTotals, PromoField, ShippingNote, useCart } from "./cart";

export function CartPageView() {
  const cart = useCart();
  const blocked = cart.quote?.lines.some((l) => l.stock === "out");

  if (!cart.ready) return <div className="s-wrap py-24" aria-busy="true" />;
  if (cart.items.length === 0) {
    return (
      <div className="s-wrap flex min-h-[55dvh] flex-col items-center justify-center py-20 text-center">
        <ShoppingBag size={34} strokeWidth={1.4} className="text-rule" />
        <h1 className="mt-5 text-3xl font-semibold">Your cart is empty</h1>
        <p className="mt-2 text-stone">Browse the catalog and add what you need.</p>
        <Link href="/shop" className="s-btn-primary mt-7">
          Shop all products
        </Link>
      </div>
    );
  }
  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-14">
      <h1 className="text-4xl font-semibold leading-[1.05] sm:text-5xl" style={{ letterSpacing: "-0.03em" }}>
        Your cart
      </h1>
      <div className="mt-6 grid gap-x-16 gap-y-8 lg:grid-cols-[1.5fr_1fr]">
        <div className="border-t border-rule">
          <CartLines />
        </div>
        <aside className="h-fit space-y-5 rounded-2xl bg-soft p-6 lg:sticky lg:top-36">
          <h2 className="text-lg font-semibold">Summary</h2>
          {cart.quoteError ? (
            <p className="s-error" role="alert">
              {cart.quoteError}
            </p>
          ) : cart.quote ? (
            <CartTotals />
          ) : (
            <div className="h-20 animate-pulse rounded-xl bg-rule/60" />
          )}
          <PromoField />
          <ShippingNote />
          <Link href="/checkout" aria-disabled={blocked} className={`s-btn-primary w-full ${blocked ? "pointer-events-none opacity-45" : ""}`}>
            Checkout
          </Link>
          <Link href="/shop" className="block text-center text-[15px] font-medium text-stone underline decoration-rule underline-offset-4 hover:text-coal">
            Keep shopping
          </Link>
        </aside>
      </div>
    </div>
  );
}
