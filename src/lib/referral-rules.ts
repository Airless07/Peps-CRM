// Referral code rules. Pure: used by the server (every write), the account page (live messages) and tests.
//
// A code is 3 to 20 letters, numbers and dashes. It is not case sensitive: it is stored normalized
// (UPPERCASE) and shown the way the customer typed it. Referral codes and discount codes share one
// namespace (enforced in the database by the CodeClaim table, see the referral_program migration).

export const CODE_MIN = 3;
export const CODE_MAX = 20;

/** The stored form: trimmed, uppercase. */
export const normalizeCode = (code: string) => code.trim().toUpperCase();

/** Words no customer code may contain (they would look official). */
export const RESERVED_WORDS = ["ADMIN", "BUCKSHOT", "STAFF", "TEST", "OWNER", "SUPPORT", "OFFICIAL", "MODERATOR"];

/**
 * Profanity and slurs. Blocked when they appear ANYWHERE in the code (after removing dashes and undoing
 * common swaps like 0=O, 1=I, 3=E, $=S), e.g. "XFUCKX", "F-U-C-K", "SH1T".
 */
const BLOCK_ANYWHERE = [
  "FUCK", "FUK", "FCUK", "SHIT", "BITCH", "CUNT", "DICK", "COCK", "PUSSY", "WHORE", "SLUT", "BASTARD", "ASSHOLE",
  "DOUCHE", "WANKER", "TWAT", "PRICK", "BOLLOCK", "JIZZ", "DILDO", "PORN", "PENIS", "VAGINA", "BLOWJOB", "HANDJOB",
  "MOTHERF", "NIGGER", "NIGGA", "NIGER", "NIGG", "FAGGOT", "FAGOT", "RETARD", "CHINK", "GOOK", "KIKE",
  "WETBACK", "BEANER", "TRANNY", "DYKE", "RAGHEAD", "TOWELHEAD", "HITLER", "NAZI", "KKK",
  "RAPIST", "PEDO", "PAEDO", "MOLEST", "INCEST", "NUDE", "HOOKER", "SEXY", "CUMSHOT", "TITTIES", "BOOBS",
];
/**
 * Short words that are also common inside normal words ("CLASSIC", "CASSIE", "TITAN", "SPICE", "GRAPE"): blocked only when a whole
 * dash- or digit-separated part of the code is the word ("ASS", "MY-ASS", "ASS4U").
 */
const BLOCK_WHOLE_PART = ["ASS", "TIT", "TITS", "CUM", "FAG", "SEX", "HOE", "JAP", "WOP", "SPIC", "COON", "PAKI", "RAPE", "ANAL", "HOMO"];

const SWAPS: Record<string, string> = { "0": "O", "1": "I", "3": "E", "4": "A", "5": "S", "7": "T", "8": "B", "9": "G", "$": "S", "@": "A", "!": "I", "|": "I", "+": "T" };

/** Every reading of the code with look-alike characters swapped back to letters (1 can be I or L). */
function readings(code: string): string[] {
  const up = code.toUpperCase().replace(/[\s\-_.]/g, "");
  const base = up.replace(/./g, (ch) => SWAPS[ch] ?? ch);
  const out = new Set([base, up.replace(/1/g, "L").replace(/./g, (ch) => SWAPS[ch] ?? ch)]);
  // Repeated letters ("FUUUCK") collapse too.
  for (const r of [...out]) out.add(r.replace(/(.)\1+/g, "$1"));
  return [...out];
}

/** The parts of a code split on dashes and digits, letters only, with swaps undone ("MY-A55" -> MY, ASS). */
function parts(code: string): string[] {
  const swapped = code.toUpperCase().replace(/[0134578$@!|+]/g, (ch) => SWAPS[ch] ?? ch);
  return [...new Set([...code.toUpperCase().split(/[^A-Z]+/), ...swapped.split(/[^A-Z]+/)])].filter(Boolean);
}

/** True when the code contains a blocked word (profanity, slur) in any reading. */
export function hasBlockedWord(code: string): boolean {
  const rs = readings(code);
  if (rs.some((r) => BLOCK_ANYWHERE.some((w) => r.includes(w)))) return true;
  const ps = parts(code);
  return ps.some((p) => BLOCK_WHOLE_PART.includes(p) || BLOCK_WHOLE_PART.includes(p.replace(/(.)\1+/g, "$1")));
}

/** True when the code contains a reserved word (ADMIN, BUCKSHOT, STAFF, TEST, ...) in any reading. */
export function hasReservedWord(code: string): boolean {
  return readings(code).some((r) => RESERVED_WORDS.some((w) => r.includes(w)));
}

export type CodeProblem = "empty" | "too_short" | "too_long" | "invalid_chars" | "not_allowed";

export const CODE_PROBLEM_TEXT: Record<CodeProblem | "taken" | "same", string> = {
  empty: "Enter a code.",
  too_short: `Too short. Use at least ${CODE_MIN} characters.`,
  too_long: `Too long. Use at most ${CODE_MAX} characters.`,
  invalid_chars: "Only letters, numbers and dashes (-) are allowed.",
  not_allowed: "That code is not allowed. Please pick a different one.",
  taken: "That code is taken. Try another one.",
  same: "That is already your code.",
};

/** What is wrong with a code by the format rules (null = fine). Uniqueness is checked by the server. */
export function codeProblem(input: string): CodeProblem | null {
  const code = input.trim();
  if (!code) return "empty";
  if (!/^[A-Za-z0-9-]+$/.test(code)) return "invalid_chars";
  if (code.length < CODE_MIN) return "too_short";
  if (code.length > CODE_MAX) return "too_long";
  if (hasBlockedWord(code) || hasReservedWord(code)) return "not_allowed";
  return null;
}

/** "Sarah Kim" -> "Sarah K.", "Dana" -> "Dana", "" -> "A customer". Never more than a first name and an initial. */
export function shortName(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "A customer";
  const first = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  const last = words.length > 1 ? ` ${words[words.length - 1].charAt(0).toUpperCase()}.` : "";
  return first + last;
}

/** A shipping address reduced to what identifies the place: street line (letters and numbers) + 5 digit ZIP. */
export function addressKey(a: { street1?: string | null; zip?: string | null } | null | undefined): string {
  if (!a) return "";
  const street = (a.street1 ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const zip = (a.zip ?? "").replace(/\D/g, "").slice(0, 5);
  return street && zip ? `${street}|${zip}` : "";
}

export const SELF_REFERRAL_TEXT = "You can't use your own referral code. Share it with friends instead.";

/**
 * Is the buyer the code owner? Matches by account, by email, or by a shipping address the owner has
 * saved or shipped to before.
 */
export function isSelfReferral(
  owner: { id: string; email: string; addresses: ({ street1?: string; zip?: string } | null)[] },
  buyer: { customerId?: string | null; email?: string | null; shipTo?: { street1?: string; zip?: string } | null },
): boolean {
  if (buyer.customerId && buyer.customerId === owner.id) return true;
  const be = (buyer.email ?? "").trim().toLowerCase();
  if (be && owner.email.trim().toLowerCase() === be) return true;
  const key = addressKey(buyer.shipTo);
  if (key && owner.addresses.some((a) => addressKey(a) === key)) return true;
  return false;
}
