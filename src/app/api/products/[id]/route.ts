import { item } from "@/lib/crud";
import { productUpdate } from "@/lib/schemas";

export const { PATCH, DELETE } = item("product", productUpdate);
