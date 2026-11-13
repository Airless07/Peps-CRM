import { collection } from "@/lib/crud";
import { payoutCreate } from "@/lib/schemas";

export const { POST } = collection("payout", payoutCreate);
