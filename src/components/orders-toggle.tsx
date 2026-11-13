"use client";

import { useRouter } from "next/navigation";
import { Segmented } from "./ui";

/**
 * Mobile only: switch between Orders and Customers at the top of the screen, so the
 * bottom tab bar keeps five items. Desktop has Customers in the sidebar instead.
 */
export function OrdersToggle({ value }: { value: "orders" | "customers" }) {
  const router = useRouter();
  return (
    <div className="mb-4 md:hidden">
      <Segmented
        value={value}
        onChange={(v) => router.push(v === "orders" ? "/orders" : "/customers")}
        options={[
          { value: "orders", label: "Orders" },
          { value: "customers", label: "Customers" },
        ]}
      />
    </div>
  );
}
