import type { Metadata } from "next";
import { CartPageView } from "@/components/storefront/cart-page";

export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

export default function CartPage() {
  return <CartPageView />;
}
