import type { Metadata } from "next";
import { LookupForm } from "@/components/storefront/forms";

export const metadata: Metadata = { title: "Order lookup", description: "Check the status of your order with your order number and email.", robots: { index: false } };

export default function OrderLookupPage() {
  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-16">
      <div className="mx-auto max-w-md">
        <h1 className="text-4xl font-semibold leading-[1.05]" style={{ letterSpacing: "-0.03em" }}>
          Order lookup
        </h1>
        <p className="mb-7 mt-3 text-[1.0625rem] leading-relaxed text-stone">Enter your order number and the email you used. You will see the status, payment instructions and tracking.</p>
        <LookupForm />
      </div>
    </div>
  );
}
