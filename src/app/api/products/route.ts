import { collection } from "@/lib/crud";
import { productCreate } from "@/lib/schemas";

export const { POST } = collection("product", productCreate);
