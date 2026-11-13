import type { NextRequest } from "next/server";
import type { ZodType } from "zod";
import { prisma } from "./db";
import { body, route, type Ctx } from "./api";

type Model = "product" | "purchase" | "stockAdjustment" | "payout";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const delegate = (m: Model) => (prisma as any)[m];

export function collection<T extends object>(model: Model, schema: ZodType<T>) {
  return {
    POST: route(async (req: NextRequest) => {
      const data = await body(req, schema);
      return delegate(model).create({ data });
    }),
  };
}

export function item<T extends object>(model: Model, schema: ZodType<T>) {
  return {
    PATCH: route(async (req: NextRequest, ctx: Ctx<{ id: string }>) => {
      const { id } = await ctx.params;
      const data = await body(req, schema);
      return delegate(model).update({ where: { id }, data });
    }),
    DELETE: route(async (_req: NextRequest, ctx: Ctx<{ id: string }>) => {
      const { id } = await ctx.params;
      await delegate(model).delete({ where: { id } });
      return { ok: true };
    }),
  };
}
