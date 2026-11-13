import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { ZodError, type ZodType } from "zod";
import { SESSION_COOKIE, verifySessionToken } from "./session";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

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
        if (!(await verifySessionToken(jar.get(SESSION_COOKIE)?.value))) {
          return NextResponse.json({ error: "Not logged in" }, { status: 401 });
        }
      }
      const out = await fn(req, ctx);
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e instanceof ZodError) {
        const msg = e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      const code = (e as { code?: string })?.code;
      if (code === "P2025") return NextResponse.json({ error: "Record not found" }, { status: 404 });
      if (code === "P2002") return NextResponse.json({ error: "That record already exists" }, { status: 409 });
      if (code === "P2003") return NextResponse.json({ error: "Linked record not found" }, { status: 400 });
      console.error(e);
      return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
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
