"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { uid } from "@/lib/format";
import { withSize } from "@/lib/size";
import { upgradeDraft, type Draft } from "@/lib/draft";
import { applySellDeals } from "@/lib/bogo";
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
  rememberPayment: (m: string) => void;
}

const Ctx = createContext<Cart | null>(null);

const emptyDraft = (soldBy: Partner, paymentMethod: string): Draft => ({
  id: uid(),
  date: new Date().toISOString(),
  customer: "",
  customerId: null,
  paymentMethod,
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
  const [lastPayment, setLastPayment] = usePersistentState<string | null>("peps-last-payment", null);
  const [stored, setDraft, ready] = usePersistentState<Draft>("peps-cart", emptyDraft("A", ""));

  const seller = lastSeller ?? data?.settings.defaultSoldBy ?? "A";
  const methods = data?.settings.paymentMethods ?? [];
  // Last choice if it is still offered, else the first method in Settings
  const payment = lastPayment && methods.includes(lastPayment) ? lastPayment : methods[0] ?? "Cash";
  // Live in-person BOGO deals are applied to the cart as it changes (their units get their own line).
  const promotions = data?.promotions;
  const products = data?.products;
  const draft = useMemo(() => applySellDeals(upgradeDraft(stored, payment), { promotions: promotions ?? [], products: products ?? [] }), [stored, payment, promotions, products]);

  const addProduct = useCallback(
    (p: ProductRec, priceCents: number) => {
      const cost = ledger?.stock.get(p.id)?.unitCost ?? 0;
      const cut = data?.settings.businessCutPercent ?? 10;
      setDraft((d) => {
        const cur = upgradeDraft(d, payment);
        const base = cur.lines.length === 0 ? { ...cur, soldBy: seller } : cur;
        // Owner price: every item is charged its cost; the normal price is kept to show struck through.
        if (base.owner) {
          const i = base.lines.findIndex((l) => l.productId === p.id && !l.dealId);
          const lines = [...base.lines];
          if (i >= 0) lines[i] = { ...lines[i], quantity: lines[i].quantity + 1 };
          else lines.push({ id: uid(), productId: p.id, productName: withSize(p.name, p.variantLabel), quantity: 1, unitPriceCents: cost, fullPriceCents: priceCents, unitCostCents: cost, cutPercent: cut });
          return { ...base, lines };
        }
        const i = base.lines.findIndex((l) => l.productId === p.id && l.unitPriceCents === priceCents && !l.dealId);
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
              productName: withSize(p.name, p.variantLabel),
              quantity: 1,
              unitPriceCents: priceCents,
              unitCostCents: cost,
              cutPercent: cut,
            },
          ],
        };
      });
    },
    [data, ledger, seller, payment, setDraft],
  );

  const reset = useCallback(() => setDraft(emptyDraft(seller, payment)), [seller, payment, setDraft]);

  const value = useMemo(
    () => ({ draft, ready, setDraft, addProduct, reset, lastSeller, rememberSeller: setLastSeller, rememberPayment: setLastPayment }),
    [draft, ready, setDraft, addProduct, reset, lastSeller, setLastSeller, setLastPayment],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}
