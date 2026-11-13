import { item } from "@/lib/crud";
import { adjustmentUpdate } from "@/lib/schemas";

export const { PATCH, DELETE } = item("stockAdjustment", adjustmentUpdate);
