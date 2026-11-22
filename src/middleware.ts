import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/**
 * Who can reach what:
 *  - The store (everything outside /admin and /api) is public.
 *  - /admin/* needs the admin session, except the login page.
 *  - /api/* needs the admin session, except the public store API, login, and carrier webhooks.
 * CSRF: every state-changing API request must come from this site (same-origin Origin header).
 */
const PUBLIC_API = ["/api/store/", "/api/auth/login", "/api/webhooks/"];

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Pages that show one person's data (account, cart, checkout, an order): never cached anywhere. */
const PRIVATE_PAGES = ["/account", "/checkout", "/cart", "/order/", "/order-lookup", "/refer", "/review/"];
const isPrivatePage = (p: string) => PRIVATE_PAGES.some((x) => p === x || p.startsWith(x.endsWith("/") ? x : `${x}/`));
const NO_STORE = "private, no-store";

export async function middleware(req: NextRequest) {
  const res = await gate(req);
  // Admin pages and every API answer are per session too.
  const p = req.nextUrl.pathname;
  if (isPrivatePage(p) || p.startsWith("/admin") || p.startsWith("/api/")) res.headers.set("Cache-Control", NO_STORE);
  return res;
}

async function gate(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isAdminPage = pathname === "/admin" || pathname.startsWith("/admin/");

  if (isApi) {
    const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    if (mutating && !pathname.startsWith("/api/webhooks/") && !sameOrigin(req)) {
      return NextResponse.json({ error: "This request did not come from the site. Reload the page and try again." }, { status: 403 });
    }
    if (PUBLIC_API.some((p) => pathname.startsWith(p))) return NextResponse.next();
  } else if (!isAdminPage || pathname === "/admin/login") {
    return NextResponse.next();
  }

  const ok = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();
  if (isApi) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/admin/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/admin/:path*", "/api/:path*", "/account/:path*", "/account", "/checkout", "/cart", "/order/:path*", "/order-lookup", "/refer", "/review/:path*"],
};
