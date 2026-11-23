/** The required checkout box. The exact words are saved on each website order. */
export function consentText(minAge = 21): string {
  return `I confirm I am ${minAge} or older and this purchase is for laboratory research use only, not for human consumption. I agree to the Terms and Research Use Policy.`;
}
export const CONSENT_REQUIRED = "Tick the box to confirm your age and that this purchase is for laboratory research use only.";
