import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";
import { canonicalRedirect, envSiteUrl } from "@/lib/site";
import { REF_COOKIE, REF_COOKIE_DAYS, cleanRefCode } from "@/lib/store/referral-cookie";

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
    const from = new URL(origin).host;
    const site = envSiteUrl();
    return from === host || (!!site && from === new URL(site).host);
  } catch {
    return false;
  }
}

/** Pages that show one person's data (account, cart, checkout, an order): never cached anywhere. */
const PRIVATE_PAGES = ["/account", "/checkout", "/cart", "/order/", "/order-lookup", "/refer", "/review/", "/reviews/write"];
const isPrivatePage = (p: string) => PRIVATE_PAGES.some((x) => p === x || p.startsWith(x.endsWith("/") ? x : `${x}/`));
const NO_STORE = "private, no-store";

/** Pages and APIs the gate below looks at. Every other path only gets the domain redirect. */
const GATED = /^\/(admin|api|account|checkout|cart|order|order-lookup|refer|review|reviews\/write)(\/|$)/;

export async function middleware(req: NextRequest) {
  // www.buckshotlabs.com and the railway.app address move to SITE_URL for good (301), keeping the path and query.
  const to = canonicalRedirect(req.headers.get("x-forwarded-host") ?? req.headers.get("host"), req.nextUrl.pathname, req.nextUrl.search);
  if (to) return NextResponse.redirect(to, 301);
  const res = GATED.test(req.nextUrl.pathname) ? await gate(req) : NextResponse.next();
  // A friend's share link (?ref=CODE, on a store page): keep the code 30 days, open or closed.
  const ref = req.nextUrl.pathname.startsWith("/api/") || req.nextUrl.pathname.startsWith("/admin") ? "" : cleanRefCode(req.nextUrl.searchParams.get("ref"));
  if (ref)
    res.cookies.set(REF_COOKIE, ref, { maxAge: REF_COOKIE_DAYS * 86_400, path: "/", sameSite: "lax", secure: (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")) === "https" });
  if (!GATED.test(req.nextUrl.pathname)) return res;
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
  // Every path except Next's build files, so the domain redirect covers the whole site.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
