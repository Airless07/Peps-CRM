// Review rules that need no database: the safety filter (flagged words, links, phone numbers,
// profanity), the gibberish check, and the field limits. Pure, so the admin and tests can use it too.

/** Default flag list (editable in Admin > Reviews). A review whose text matches any of these waits for a check. */
export const DEFAULT_FLAG_WORDS = [
  "dose",
  "dosing",
  "dosage",
  "inject",
  "injecting",
  "injection",
  "pin",
  "pinning",
  "units",
  "mg per",
  "mg a week",
  "mg a day",
  "mg/week",
  "mg/day",
  "syringe",
  "weight loss",
  "lost lbs",
  "lost pounds",
  "results",
  "side effects",
  "cycle",
  "stack",
  "protocol",
];

/** Always on (not in the editable list): common profanity. */
const PROFANITY = ["fuck", "fucking", "fucked", "shit", "shitty", "bitch", "asshole", "bastard", "dick", "cunt", "motherfucker", "pussy", "slut", "whore", "fag", "faggot", "nigger", "nigga", "retard", "retarded"];

export const REVIEW_LIMITS = { textMin: 10, textMax: 1000, titleMax: 80, nameMax: 60, photos: 5, photoMb: 8, perIpPerDay: 3, perEmailPerDay: 3 } as const;

export const REVIEW_FORM_NOTE = "Tell us about your order experience: shipping, packaging, service. Please don't include dosing, usage or results. All products are for research use only.";

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One phrase -> a regex. Not inside another word ("pin" never matches "spinning"), an optional plural "s",
 * any spacing, and a number may sit between the words ("lost 12 lbs", "2 mg a week").
 */
export function phraseRegex(phrase: string): RegExp | null {
  const words = phrase
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(escRe);
  if (words.length === 0) return null;
  const body = words.join(String.raw`\s*(?:\d+(?:[.,]\d+)?\s*)?\s*`);
  return new RegExp(`(?<![a-z])${body}s?(?![a-z])`, "i");
}

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:com|net|org|io|co|us|me|info|biz|xyz|shop|store|ly|gg|app|site|online|link)\b/i;
// 10+ digits in phone-like groups: 313-555-0134, (313) 555 0134, +1 313 555 0134, 3135550134.
const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/;

export const hasLink = (s: string) => URL_RE.test(s);
export const hasPhone = (s: string) => PHONE_RE.test(s);

/** Cleans an owner-edited flag list: trimmed, lowercase, unique, max 200 entries of 40 chars. */
export function cleanFlagWords(v: unknown): string[] {
  if (!Array.isArray(v)) return [...DEFAULT_FLAG_WORDS];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const w = x.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
    if (w && !out.includes(w)) out.push(w);
    if (out.length >= 200) break;
  }
  return out;
}

/**
 * Why this review must wait for a check, or "" when it can go live now. Looks at the title, the text and
 * the display name (a name can carry a link too).
 */
export function flagReason(parts: { title?: string; text: string; displayName?: string }, flagWords: string[]): string {
  const all = [parts.title ?? "", parts.text, parts.displayName ?? ""].join("\n");
  const reasons: string[] = [];
  const hits = flagWords.filter((w) => phraseRegex(w)?.test(all));
  if (hits.length) reasons.push(`Flagged words: ${hits.slice(0, 6).join(", ")}`);
  if (PROFANITY.some((w) => phraseRegex(w)?.test(all))) reasons.push("Profanity");
  if (hasLink(all)) reasons.push("Link or web address");
  if (hasPhone(all)) reasons.push("Phone number");
  return reasons.join(" · ");
}

/** True for obvious keyboard mashing ("asdfghjkl", "aaaaaaa", "xqzv wrtp"). Short normal text always passes. */
export function isGibberish(text: string): boolean {
  const t = text.trim().toLowerCase();
  const letters = t.replace(/[^a-z]/g, "");
  if (letters.length < 6) return letters.length === 0;
  if (letters.length / t.replace(/\s/g, "").length < 0.5) return true; // mostly symbols / digits
  if (/(.)\1{5,}/.test(t)) return true; // the same character 6+ times
  const words = t.split(/[^a-z']+/).filter(Boolean);
  if (words.some((w) => w.length > 30)) return true;
  const vowels = (letters.match(/[aeiouy]/g) ?? []).length / letters.length;
  if (vowels < 0.18 || vowels > 0.8) return true;
  // Most words have no vowel at all ("sdfg hjkl qwrt").
  const noVowel = words.filter((w) => w.length >= 3 && !/[aeiouy]/.test(w)).length;
  if (words.length >= 2 && noVowel / words.length > 0.5) return true;
  // Rows of the keyboard typed in a row.
  if (/(?:qwert|werty|asdfg|sdfgh|dfghj|fghjk|ghjkl|zxcvb|xcvbn|cvbnm|hjkl;)/.test(letters)) return true;
  return false;
}

/** "Mike Johnson" -> "Mike J." */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** Statuses where the customer has the order in hand (or it is on its way): enough for a "Verified order". */
export const VERIFIED_STATUSES = ["shipped", "delivered", "picked_up"] as const;

// ---------------------------------------------------------------- Who can get a review request
/**
 * Why an order is not asked for a review. One rule for the "Ask past customers" preview, the per-order
 * "Send review request" action and the automatic email (server), and for showing the menu item (admin).
 */
export type ReviewSkip = "owner_order" | "owner_account" | "canceled" | "refunded" | "not_delivered" | "already_reviewed" | "already_asked" | "no_email";

export const REVIEW_SKIP_TEXT: Record<ReviewSkip, string> = {
  owner_order: "Owner order",
  owner_account: "Owner or test account",
  canceled: "Canceled",
  refunded: "Refunded",
  not_delivered: "Not delivered yet",
  already_reviewed: "Already reviewed",
  already_asked: "Already asked",
  no_email: "No email",
};

/** Plain sentence for an error when one order can't get a request. */
export const REVIEW_SKIP_SENTENCE: Record<ReviewSkip, string> = {
  owner_order: "This is an owner order. Owner orders don't get review requests.",
  owner_account: "This order belongs to an owner or test account.",
  canceled: "The order is canceled.",
  refunded: "The order was refunded.",
  not_delivered: "The order has to be paid and shipped, delivered or picked up first.",
  already_reviewed: "This order already has a review.",
  already_asked: "A review request was already sent for this order.",
  no_email: "The order has no email address, and the customer record has none either.",
};

export interface ReviewRequestFacts {
  source: string;
  status: string;
  /** Owner purchase at cost ("A" | "B"), null for a normal sale. */
  owner: string | null | undefined;
  paid: boolean;
  canceled: boolean;
  /**
   * Money given back with "Refund". A shipping difference given as store credit (or owed) after a switch
   * to local is NOT a refund: it never touches this number.
   */
  refundedCents: number;
  reviewed: boolean;
  asked: boolean;
  /** The order's email, or the linked customer's when the order has none. */
  email: string;
  /** The linked customer (or the email) is an owner or a test account. */
  staff: boolean;
}

/** The order's own email, or the linked customer's email when the order has none (in-person sales). */
export const requestEmail = (orderEmail: string | null | undefined, customerEmail: string | null | undefined) => (orderEmail?.trim() || customerEmail?.trim() || "").toLowerCase();

/** Customer has the order: a paid website order shipped / delivered / picked up, or a completed in-person sale. */
export function orderInHand(f: Pick<ReviewRequestFacts, "source" | "status" | "paid">): boolean {
  if (f.source === "online") return f.paid && (VERIFIED_STATUSES as readonly string[]).includes(f.status);
  return f.status === "completed";
}

/** Null when the order can get a review request. `ignoreAsked`: the per-order action (it can send again once confirmed). */
export function reviewSkipReason(f: ReviewRequestFacts, opts: { ignoreAsked?: boolean } = {}): ReviewSkip | null {
  if (f.owner) return "owner_order";
  if (f.staff) return "owner_account";
  if (f.canceled || f.status === "canceled") return "canceled";
  if (f.refundedCents > 0) return "refunded";
  if (!orderInHand(f)) return "not_delivered";
  if (f.reviewed) return "already_reviewed";
  if (f.asked && !opts.ignoreAsked) return "already_asked";
  if (!f.email) return "no_email";
  return null;
}

export interface StaffAccounts {
  ids: Set<string>;
  emails: Set<string>;
}

const TEST_NAME = /\(owner\)|\bowner\b|\btest\b/i;

/**
 * Owner and test accounts, never asked for reviews: customers who made an owner purchase, customers named
 * "... (owner)" or "Test ...", and the store's own alert emails.
 */
export function staffAccounts(customers: { id: string; name: string; email: string }[], orders: { customerId: string | null; owner?: string | null }[], alertEmails: string[]): StaffAccounts {
  const ids = new Set<string>(orders.filter((o) => o.owner && o.customerId).map((o) => o.customerId!));
  for (const c of customers) if (TEST_NAME.test(c.name)) ids.add(c.id);
  const emails = new Set(alertEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  for (const c of customers) {
    const e = c.email.trim().toLowerCase();
    if (!e) continue;
    if (ids.has(c.id)) emails.add(e);
    else if (emails.has(e)) ids.add(c.id);
  }
  return { ids, emails };
}

export const isStaff = (s: StaffAccounts, customerId: string | null | undefined, email: string) => (!!customerId && s.ids.has(customerId)) || (!!email && s.emails.has(email));
