import { item } from "@/lib/crud";
import { payoutUpdate } from "@/lib/schemas";

export const { PATCH, DELETE } = item("payout", payoutUpdate);
