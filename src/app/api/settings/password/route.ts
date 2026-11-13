import bcrypt from "bcryptjs";
import { body, HttpError, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { checkPassword } from "@/lib/password";
import { passwordChange } from "@/lib/schemas";

export const POST = route(async (req) => {
  const { current, next } = await body(req, passwordChange);
  if (!(await checkPassword(current))) throw new HttpError(400, "Current password is wrong");
  await prisma.settings.update({ where: { id: 1 }, data: { passwordHash: await bcrypt.hash(next, 12) } });
  return { ok: true };
});
