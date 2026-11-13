import { body, route } from "@/lib/api";
import { mergeCustomers } from "@/lib/customer-ops";
import { customerMerge } from "@/lib/schemas";

export const POST = route(async (req) => {
  const { fromId, intoId } = await body(req, customerMerge);
  return mergeCustomers(fromId, intoId);
});
