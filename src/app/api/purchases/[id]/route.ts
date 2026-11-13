import { item } from "@/lib/crud";
import { purchaseUpdate } from "@/lib/schemas";

export const { PATCH, DELETE } = item("purchase", purchaseUpdate);
