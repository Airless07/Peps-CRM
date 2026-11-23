import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { ZodError, type ZodType } from "zod";
import { SESSION_COOKIE } from "./session";
import { isAdminToken } from "./admin-auth";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Every API answer is about one session (account, cart, admin data): never stored by a browser, proxy or CDN. */
export const NO_STORE = "private, no-store";

export type Ctx<P = Record<string, string>> = { params: Promise<P> };

/** Wrap a route handler: checks the session, turns errors into JSON. */
export function route<P = Record<string, string>>(
  fn: (req: NextRequest, ctx: Ctx<P>) => Promise<unknown>,
  opts: { public?: boolean } = {},
) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      if (!opts.public) {
        const jar = await cookies();
        if (!(await isAdminToken(jar.get(SESSION_COOKIE)?.value))) {
          return NextResponse.json({ error: "Not logged in" }, { status: 401, headers: { "Cache-Control": NO_STORE } });
        }
      }
      const out = await fn(req, ctx);
      if (out instanceof Response) {
        try {
          if (!out.headers.has("Cache-Control")) out.headers.set("Cache-Control", NO_STORE);
        } catch {}
        return out;
      }
      return NextResponse.json(out ?? { ok: true }, { headers: { "Cache-Control": NO_STORE } });
    } catch (e) {
      const fail = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": NO_STORE } });
      if (e instanceof HttpError) return fail(e.message, e.status);
      if (e instanceof ZodError) return fail(e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "), 400);
      const code = (e as { code?: string })?.code;
      if (code === "P2025") return fail("Record not found", 404);
      if (code === "P2002") return fail("That record already exists", 409);
      if (code === "P2003") return fail("Linked record not found", 400);
      console.error(e);
      return fail("Something went wrong", 500);
    }
  };
}

export async function body<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  return schema.parse(json);
}
