import { route } from "@/lib/api";
import { requireOpenStore, storeSnapshot } from "@/lib/store/server";

export const dynamic = "force-dynamic";

/** Public catalog. Built by buildCatalog(), which copies only public fields: no cost, profit or stock counts. */
export const GET = route(
  async () => {
    await requireOpenStore();
    return (await storeSnapshot()).catalog;
  },
  { public: true },
);
