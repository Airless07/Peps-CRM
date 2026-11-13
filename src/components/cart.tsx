"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { uid } from "@/lib/format";
import type { Draft } from "@/lib/draft";
import type { Partner, ProductRec } from "@/lib/types";
import { usePersistentState, useStore } from "./store";

interface Cart {
  draft: Draft;
  ready: boolean;
  setDraft: (d: Draft | ((p: Draft) => Draft)) => void;
  addProduct: (p: ProductRec, priceCents: number) => void;
  reset: () => void;
  lastSeller: Partner | null;
  rememberSeller: (p: Partner) => void;
}

const Ctx = createContext<Cart | null>(null);

const emptyDraft = (soldBy: Partner): Draft => ({
  id: uid(),
  date: new Date().toISOString(),
  customer: "",
  note: "",
  soldBy,
  discountType: "$",
  discountValue: 0,
  tipCents: 0,
  lines: [],
});

export function CartProvider({ children }: { children: React.ReactNode }) {
  const { data, ledger } = useStore();
  const [lastSeller, setLastSeller] = usePersistentState<Partner | null>("peps-last-seller", null);
  const [draft, setDraft, ready] = usePersistentState<Draft>("peps-cart", emptyDraft("A"));

  const seller = lastSeller ?? data?.settings.defaultSoldBy ?? "A";

  const addProduct = useCallback(
    (p: ProductRec, priceCents: number) => {
      const cost = ledger?.stock.get(p.id)?.unitCost ?? 0;
      const cut = data?.settings.businessCutPercent ?? 10;
      setDraft((d) => {
        const base = d.lines.length === 0 ? { ...d, soldBy: seller } : d;
        const i = base.lines.findIndex((l) => l.productId === p.id && l.unitPriceCents === priceCents);
        if (i >= 0) {
          const lines = [...base.lines];
          lines[i] = { ...lines[i], quantity: lines[i].quantity + 1 };
          return { ...base, lines };
        }
        return {
          ...base,
          lines: [
            ...base.lines,
            {
              id: uid(),
              productId: p.id,
              productName: p.name,
              quantity: 1,
              unitPriceCents: priceCents,
              unitCostCents: cost,
              cutPercent: cut,
            },
          ],
        };
      });
    },
    [data, ledger, seller, setDraft],
  );

  const reset = useCallback(() => setDraft(emptyDraft(seller)), [seller, setDraft]);

  const value = useMemo(
    () => ({ draft, ready, setDraft, addProduct, reset, lastSeller, rememberSeller: setLastSeller }),
    [draft, ready, setDraft, addProduct, reset, lastSeller, setLastSeller],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}
