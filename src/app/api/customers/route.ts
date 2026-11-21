import { body, route } from "@/lib/api";
import { createCustomer } from "@/lib/customer-ops";
import { customerCreate } from "@/lib/schemas";

/** New customer. Returns the customer as the admin sees it: never a password hash or token. */
export const POST = route(async (req) => createCustomer(await body(req, customerCreate)));
