import { route } from "@/lib/api";
import { loadAll } from "@/lib/serialize";

export const dynamic = "force-dynamic";
export const GET = route(async () => loadAll());
