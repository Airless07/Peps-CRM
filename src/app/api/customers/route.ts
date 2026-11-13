import { body, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { customerCreate } from "@/lib/schemas";

export const POST = route(async (req) => {
  const data = await body(req, customerCreate);
  return prisma.customer.create({ data });
});
