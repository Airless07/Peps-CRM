import { collection } from "@/lib/crud";
import { purchaseCreate } from "@/lib/schemas";

export const { POST } = collection("purchase", purchaseCreate);
