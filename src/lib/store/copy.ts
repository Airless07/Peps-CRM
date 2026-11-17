// Text that is generated from the real state of the store, so it can never claim more than is true:
// which payment methods are on, and what testing each product actually has. Pure: server and client.
import type { TestingStatus } from "../types";
import { PAY_METHODS_TOKEN, type PaymentSettings } from "./config";
import { checkoutMethods, PAY_METHODS } from "./payments";

/** "Zelle", "Zelle or Venmo", "Zelle, Cash App or Venmo". */
export function joinOr(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** The payment methods a customer can actually pick at checkout right now, as words. */
export function payMethodsText(payments: PaymentSettings): string {
  const names = checkoutMethods(payments)
    .filter((m) => m.available)
    .map((m) => m.name);
  return names.length ? joinOr(names) : "the payment method you pick at checkout";
}

export function payFaqAnswer(payments: PaymentSettings): string {
  return `After you place an order you get payment instructions for ${payMethodsText(payments)}, with your order number and the exact amount. Put the order number in the memo so we can match your payment.`;
}

const PAY_QUESTION = /\bhow\s+(do|can|should)\s+i\s+pay\b/i;

/**
 * FAQ as the customer sees it. The {payment_methods} placeholder becomes the methods that are on.
 * A "How do I pay?" answer written by hand that names a method which is NOT available is replaced
 * with the generated answer, so the page never offers a payment method the checkout does not have.
 */
export function faqForDisplay(faq: { q: string; a: string }[], payments: PaymentSettings): { q: string; a: string }[] {
  const available = new Set(checkoutMethods(payments).filter((m) => m.available).map((m) => m.id));
  const unavailable = PAY_METHODS.filter((m) => !available.has(m.id)).map((m) => m.name.toLowerCase());
  return faq.map((f) => {
    if (f.a.includes(PAY_METHODS_TOKEN)) return { q: f.q, a: f.a.split(PAY_METHODS_TOKEN).join(payMethodsText(payments)) };
    if (PAY_QUESTION.test(f.q) && unavailable.some((name) => f.a.toLowerCase().includes(name))) return { q: f.q, a: payFaqAnswer(payments) };
    return f;
  });
}

/**
 * What may be said about a variant's testing. "Third-party tested" is only ever said for
 * "COA available"; every other status says plainly what is missing.
 */
export function testingClaim(status: TestingStatus): { thirdPartyTested: boolean; line: string } {
  switch (status) {
    case "coa_available":
      return { thirdPartyTested: true, line: "Third-party tested. The certificate of analysis for this batch is on file." };
    case "supplier_tested":
      return { thirdPartyTested: false, line: "Tested by the supplier. An independent certificate of analysis has not been posted for this batch." };
    case "pending":
      return { thirdPartyTested: false, line: "Third-party testing is in progress for this batch. The certificate will be posted here when it is back." };
    default:
      return { thirdPartyTested: false, line: "The certificate of analysis for this batch has not been posted yet. It will appear here when it is completed." };
  }
}

/** One honest sentence for search engines and link previews, built from the product's real statuses. */
export function productTestingSummary(name: string, statuses: TestingStatus[]): string {
  const all = statuses.length > 0 && statuses.every((s) => s === "coa_available");
  const some = statuses.some((s) => s === "coa_available");
  const testing = all ? "Third-party tested, with the certificate of analysis on file." : some ? "Certificate of analysis on file for some sizes; testing status shown for each size." : "Testing status shown on the product page.";
  return `${name}: research compound. ${testing} For laboratory research use only.`;
}
