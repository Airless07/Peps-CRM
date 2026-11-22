import { z } from "zod";
import { body, HttpError, route } from "@/lib/api";
import { currentAccount } from "@/lib/account";
import { rateLimit } from "@/lib/ratelimit";
import { addLine, capToStock, cleanItems, mergeGuestCart, readCart, writeCart, type StockOf } from "@/lib/store/cart-server";
import { storeSnapshot } from "@/lib/store/server";

export const dynamic = "force-dynamic";

const items = z.array(z.object({ variantId: z.string().min(1).max(64), quantity: z.number().int().min(1).max(999) })).max(50).default([]);
const code = z.string().max(40).default("");
const accountId = z.string().max(64).nullable().default(null);
const input = z.discriminatedUnion("action", [
  /** Replace the signed-in account's cart. */
  z.object({ action: z.literal("save"), accountId, items, code, referral: code }),
  /** Just signed in: add the guest cart to the account's cart. Codes are dropped. */
  z.object({ action: z.literal("merge"), accountId, items }),
  /** Add units of one size, capped at stock. Guests send their current cart and get it back (nothing is stored). */
  z.object({ action: z.literal("add"), accountId, variantId: z.string().min(1).max(64), quantity: z.number().int().min(1).max(99), items }),
]);

async function stockFn(): Promise<StockOf> {
  const { catalog, ledger } = await storeSnapshot();
  const sold = new Set(catalog.products.flatMap((p) => p.variants.map((v) => v.id)));
  return (id) => (sold.has(id) ? Math.max(0, ledger.stock.get(id)?.stock ?? 0) : undefined);
}

/**
 * The browser says which account it thinks is signed in. When the session cookie says otherwise (signed out,
 * or another account signed in from another tab), nothing is read or written: the browser is told who is
 * signed in now and reloads that cart. A cart can never be written into the wrong account this way.
 */
function mismatch(now: string | null) {
  return Response.json({ error: "Your account changed. Reloading your cart.", accountChanged: true, accountId: now }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
}

/** The signed-in account's cart. Guests get an empty one (their cart is in their browser). */
export const GET = route(
  async () => {
    const account = await currentAccount();
    if (!account) return { accountId: null, items: [], code: "", referral: "" };
    const cart = await readCart(account.id);
    return { accountId: account.id, ...cart, items: capToStock(cart.items, await stockFn()) };
  },
  { public: true },
);

export const POST = route(
  async (req) => {
    rateLimit(req, "cart", 240, 60_000);
    const i = await body(req, input);
    const account = await currentAccount();
    const now = account?.id ?? null;
    if (i.action !== "add" && !account) throw new HttpError(401, "Sign in to save your cart.");
    if ((i.accountId ?? null) !== now) return mismatch(now);
    const stockOf = await stockFn();
    switch (i.action) {
      case "save": {
        const saved = await writeCart(account!.id, { items: capToStock(cleanItems(i.items), stockOf), code: i.code, referral: i.referral });
        return { accountId: now, ...saved };
      }
      case "merge":
        return { accountId: now, ...(await mergeGuestCart(account!.id, i.items, stockOf)) };
      case "add": {
        // The browser's copy is the base (it may hold changes not saved yet); the account was checked above.
        const r = addLine(cleanItems(i.items), i.variantId, i.quantity, stockOf);
        if (account && r.added > 0) {
          const saved = await readCart(account.id);
          await writeCart(account.id, { ...saved, items: r.items });
        }
        return { accountId: now, ...r };
      }
    }
  },
  { public: true },
);
