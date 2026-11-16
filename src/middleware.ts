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

export async function middleware(req: NextRequest) {
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
  matcher: ["/admin/:path*", "/api/:path*"],
};
