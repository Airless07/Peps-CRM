import { collection } from "@/lib/crud";
import { adjustmentCreate } from "@/lib/schemas";

export const { POST } = collection("stockAdjustment", adjustmentCreate);
