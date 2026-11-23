/**
 * The site's one public address. Safe to import from middleware (no database, no Node APIs).
 *
 * SITE_URL (for example https://buckshotlabs.com) is the setting. PUBLIC_URL is the older name and still works.
 */
const clean = (u: string) => u.trim().replace(/\/+$/, "");

/** SITE_URL from the environment, no trailing slash. Empty when not set or not a valid http(s) address. */
export function envSiteUrl(): string {
  const raw = clean(process.env.SITE_URL || process.env.PUBLIC_URL || "");
  if (!raw) return "";
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : "";
  } catch {
    return "";
  }
}

/**
 * Where a request on another host should go, or null to serve it as is.
 * Only two kinds of host move to SITE_URL: "www." + the site's host, and Railway's *.up.railway.app address.
 * Anything else (localhost, health checks, the site itself) is served normally.
 * Carrier webhooks are never moved: a redirected POST would be dropped.
 */
export function canonicalRedirect(host: string | null | undefined, pathname: string, search: string, site = envSiteUrl()): string | null {
  if (!site || !host) return null;
  if (pathname.startsWith("/api/webhooks/")) return null;
  const want = new URL(site);
  if (want.protocol !== "https:") return null;
  const h = host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (h === want.hostname) return null;
  const moves = h === `www.${want.hostname}` || h.endsWith(".up.railway.app") || (!!process.env.RAILWAY_PUBLIC_DOMAIN && h === process.env.RAILWAY_PUBLIC_DOMAIN.toLowerCase());
  return moves ? `${want.origin}${pathname}${search}` : null;
}
