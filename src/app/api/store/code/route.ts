import { z } from "zod";
import { body, route } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { codeKindOf } from "@/lib/store/referral";
import { requireOpenStore, storeSnapshot } from "@/lib/store/server";

const input = z.object({ code: z.string().trim().max(40) });

/**
 * The one code box at checkout accepts a discount code or a referral code: this says which one it is.
 * Says nothing about who owns a referral code. The cart then puts it in the right slot and the quote checks it.
 */
export const POST = route(
  async (req) => {
    rateLimit(req, "code-kind", 30, 60_000);
    await requireOpenStore();
    const { code } = await body(req, input);
    const { data } = await storeSnapshot();
    const kind = codeKindOf(data, code);
    return { kind, error: kind === "none" ? "That code was not found. Check the spelling and try again." : "" };
  },
  { public: true },
);
