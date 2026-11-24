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
