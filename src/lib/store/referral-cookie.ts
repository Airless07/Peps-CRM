// A friend's referral share link (?ref=CODE) saves the code for 30 days. While the store is closed the
// "Coming soon" page shows it; once open, the cart picks it up for checkout (and it can still be removed).
// Edge-safe (used by the middleware): no Node imports.
export const REF_COOKIE = "bl_ref";
export const REF_COOKIE_DAYS = 30;

/** The code as typed in a link, cleaned: letters, digits, - and _, upper case. "" if it can't be a code. */
export function cleanRefCode(raw: string | null | undefined): string {
  const c = (raw ?? "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 30);
  return c.length >= 2 ? c : "";
}

/**
 * Which referral code the cart should carry when it loads. A code in the link wins; else, once the store is
 * open, the saved one fills an empty cart. The saved cookie is cleared once the store is open (so a code the
 * customer removes stays removed). While closed nothing changes and the cookie is kept.
 */
export function referralOnLoad(current: string, fromLink: string, saved: string, storeOpen: boolean): { referral: string; clearSaved: boolean } {
  if (fromLink) return { referral: fromLink, clearSaved: storeOpen && !!saved };
  if (!storeOpen || !saved) return { referral: current, clearSaved: false };
  return { referral: current || saved, clearSaved: true };
}
