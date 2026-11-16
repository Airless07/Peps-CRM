"use client";

import { AppShell } from "@/components/shell";
import { CartProvider } from "@/components/cart";
import { DataProvider } from "@/components/store";
import { OrderActionsProvider } from "@/components/order-actions";
import { ToastProvider } from "@/components/toast";
import { ConfirmProvider } from "@/components/ui";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <DataProvider>
          <CartProvider>
            <OrderActionsProvider>
              <AppShell>{children}</AppShell>
            </OrderActionsProvider>
          </CartProvider>
        </DataProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
