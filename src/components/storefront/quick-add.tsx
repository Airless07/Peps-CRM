"use client";

// Quick add on product cards, for desktops only (a real mouse or trackpad). It sits over the bottom of
// the product photo and appears on hover or keyboard focus. Phones and tablets never see it: there,
// tapping the card opens the product page as before. It is a sibling of the card link (never inside
// it), so its buttons never trigger navigation, and the rest of the card still opens the product.
import { useEffect, useRef, useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import type { PublicProduct } from "@/lib/store/catalog";
import { useCart } from "./cart";

export function QuickAdd({ p }: { p: PublicProduct }) {
  const cart = useCart();
  const inStock = p.variants.filter((v) => v.stock !== "out");
  const [variantId, setVariantId] = useState(inStock[0]?.id ?? "");
  const [qty, setQty] = useState(1);
  /** Highest quantity the server allowed for this size (null = not known yet). Never more than 99. */
  const [cap, setCap] = useState<Record<string, number>>({});
  const [state, setState] = useState<{ kind: "idle" | "busy" | "added" | "note"; text: string }>({ kind: "idle", text: "" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  if (inStock.length === 0) {
    return (
      <div className="qa-wrap" data-quick-add={p.slug}>
        <div className="qa-bar justify-center text-[13px] font-medium text-stone" data-quick-add-soldout>
          Sold out
        </div>
      </div>
    );
  }
  const max = Math.min(99, cap[variantId] ?? 99);
  const inCart = cart.items.find((i) => i.variantId === variantId)?.quantity ?? 0;
  const room = Math.max(0, max - (cap[variantId] !== undefined ? inCart : 0));
  const show = (kind: "added" | "note", text: string) => {
    setState({ kind, text });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState({ kind: "idle", text: "" }), kind === "added" ? 1800 : 3200);
  };

  async function add() {
    if (!variantId || state.kind === "busy") return;
    setState({ kind: "busy", text: "" });
    const r = await cart.addChecked(variantId, qty);
    // The server caps at stock and says how many fit: remember it so the stepper stops there.
    const m = /Only (\d+) available|all (\d+) available/.exec(r.message);
    if (m) setCap((c) => ({ ...c, [variantId]: Number(m[1] ?? m[2]) }));
    if (r.ok) {
      setQty(1);
      show(r.message ? "note" : "added", r.message || "Added");
    } else show("note", r.message || "We couldn't add that. Try again.");
  }

  const multi = p.variants.length > 1;
  return (
    <div className="qa-wrap" data-quick-add={p.slug}>
      <div className="qa-bar" role="group" aria-label={`Quick add ${p.name}`}>
        {multi && (
          <div className="flex min-w-0 flex-wrap gap-1" role="radiogroup" aria-label={`Size for ${p.name}`}>
            {p.variants.map((v) => {
              const out = v.stock === "out";
              const on = v.id === variantId;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={out}
                  data-quick-size={v.label}
                  title={out ? `${v.label} sold out` : v.label}
                  onClick={() => (setVariantId(v.id), setQty(1))}
                  className={`h-8 rounded-full border px-2.5 text-[12px] font-medium tabular-nums transition ${on ? "border-coal bg-coal text-white" : "border-rule bg-paper text-coal hover:border-coal"} disabled:cursor-not-allowed disabled:border-rule disabled:text-stone/60 disabled:line-through`}
                >
                  {v.label || "One size"}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <div className="inline-flex h-8 items-center rounded-full border border-rule bg-paper" role="group" aria-label={`Quantity for ${p.name}`}>
            <button type="button" aria-label="Decrease quantity" className="flex h-8 w-7 items-center justify-center text-stone hover:text-coal disabled:opacity-30" disabled={qty <= 1} onClick={() => setQty((n) => Math.max(1, n - 1))}>
              <Minus size={13} />
            </button>
            <span className="w-5 text-center text-[13px] font-medium tabular-nums" aria-live="polite" data-quick-qty>
              {qty}
            </span>
            <button type="button" aria-label="Increase quantity" className="flex h-8 w-7 items-center justify-center text-stone hover:text-coal disabled:opacity-30" disabled={qty >= Math.max(1, room)} onClick={() => setQty((n) => Math.min(Math.max(1, room), n + 1))}>
              <Plus size={13} />
            </button>
          </div>
          <button
            type="button"
            data-quick-add-button
            onClick={add}
            disabled={state.kind === "busy" || room <= 0}
            className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-coal px-3 text-[13px] font-semibold text-white transition hover:bg-brand disabled:opacity-50"
          >
            {state.kind === "added" ? (
              <>
                <Check size={14} /> Added
              </>
            ) : state.kind === "busy" ? (
              "Adding…"
            ) : room <= 0 ? (
              "All in cart"
            ) : (
              "Add to cart"
            )}
          </button>
        </div>
        <p className="sr-only" role="status" aria-live="polite">
          {state.kind === "added" ? `Added ${p.name} to your cart` : state.kind === "note" ? state.text : ""}
        </p>
        {state.kind === "note" && (
          <p className="text-[12px] font-medium leading-snug text-brand" data-quick-note>
            {state.text}
          </p>
        )}
      </div>
    </div>
  );
}
