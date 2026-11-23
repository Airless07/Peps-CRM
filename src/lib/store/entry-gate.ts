/** The first-visit entry gate (21+ and research use only). Shared by the server layout and the client gate. */
export const ENTRY_COOKIE = "bl_entry";
export const ENTRY_DAYS = 30;

/**
 * Paths that never show the gate: the policies it links to, and links people get by email
 * (order status, order lookup, review, password reset, account invite / claim).
 */
const EXEMPT = /^\/(terms|privacy|shipping|refunds|research-use|exit|order-lookup)(\/|$)|^\/(order|review)\/|^\/account\/(reset|invite)(\/|$)/;
export const gateExempt = (path: string) => EXEMPT.test(path);

/** The cookie holds the time it runs out (ms). Valid when it is in the future. */
export function entryCookieValid(value: string | undefined | null, now = Date.now()): boolean {
  const until = Number(value ?? 0);
  return Number.isFinite(until) && until > now;
}
