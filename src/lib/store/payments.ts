// Payment methods. Today every method is "manual": the customer pays outside the site and the
// owner marks the order paid. The shape below is what a real provider plugs into later:
//   - add an entry to PAY_METHODS with kind "provider"
//   - implement PaymentProvider (createPayment + handleWebhook) and register it in PROVIDERS
//   - its webhook route calls markPaid(orderId, { method }) from src/lib/order-ops.ts
// Nothing else in checkout or admin needs to change.
import type { PayMethodId, PaymentSettings, StoreSettings } from "./config";

export interface PayMethodDef {
  id: PayMethodId;
  name: string;
  /** "manual" = pay outside the site, owner confirms. "provider" = paid through an integration. */
  kind: "manual" | "provider";
  /** What the customer sees under the name at checkout. */
  blurb: string;
  /** Label of the details field in Settings (manual methods). */
  detailsLabel?: string;
  detailsHint?: string;
  /** Name used on the saved sale (matches the CRM payment method names). */
  saleName: string;
}

export const PAY_METHODS: PayMethodDef[] = [
  { id: "zelle", name: "Zelle", kind: "manual", blurb: "Send from your bank app. No fees.", detailsLabel: "Zelle email or phone", detailsHint: "Where customers send the money.", saleName: "Zelle" },
  { id: "cashapp", name: "Cash App", kind: "manual", blurb: "Pay with your Cash App balance or card.", detailsLabel: "Cash App $cashtag", detailsHint: "For example $buckshotlabs.", saleName: "Cash App" },
  { id: "venmo", name: "Venmo", kind: "manual", blurb: "Pay from your Venmo account.", detailsLabel: "Venmo username", detailsHint: "For example @buckshotlabs.", saleName: "Venmo" },
  { id: "bank", name: "Pay by Bank", kind: "provider", blurb: "Secure transfer straight from your bank.", saleName: "Pay by Bank" },
  { id: "card", name: "Credit / Debit Card", kind: "provider", blurb: "Visa, Mastercard, American Express, Discover.", saleName: "Card" },
];

export const payMethod = (id: string): PayMethodDef | undefined => PAY_METHODS.find((m) => m.id === id);

export interface CheckoutPayMethod {
  id: PayMethodId;
  name: string;
  blurb: string;
  /** False = shown greyed out with a "Coming soon" tag, cannot be picked. */
  available: boolean;
}

const isManual = (id: PayMethodId): id is "zelle" | "cashapp" | "venmo" => id === "zelle" || id === "cashapp" || id === "venmo";

/** A real provider integration is registered here. Empty today. */
export interface PaymentProvider {
  /** Start a payment for an order; returns where to send the customer. */
  createPayment(order: { id: string; number: number; totalCents: number; email: string }): Promise<{ redirectUrl: string }>;
  /** Verify and read a provider webhook. Returns the order to mark paid, or null to ignore it. */
  handleWebhook(req: Request): Promise<{ orderId: string } | null>;
}
export const PROVIDERS: Partial<Record<PayMethodId, PaymentProvider>> = {};

/** Methods to show at checkout, in order. Enabled manual methods missing their details are hidden. */
export function checkoutMethods(p: PaymentSettings): CheckoutPayMethod[] {
  const out: CheckoutPayMethod[] = [];
  for (const m of PAY_METHODS) {
    if (isManual(m.id)) {
      const s = p[m.id];
      if (s.enabled && s.details.trim()) out.push({ id: m.id, name: m.name, blurb: m.blurb, available: true });
    } else {
      const s = p[m.id as "bank" | "card"];
      if (s.enabled && PROVIDERS[m.id]) out.push({ id: m.id, name: m.name, blurb: m.blurb, available: true });
      else if (s.comingSoon === "show") out.push({ id: m.id, name: m.name, blurb: m.blurb, available: false });
    }
  }
  return out;
}

/** Problems the owner should fix, in plain words (shown in Settings and the dashboard). */
export function paymentWarnings(p: PaymentSettings): string[] {
  const out: string[] = [];
  for (const m of PAY_METHODS) {
    if (isManual(m.id)) {
      if (p[m.id].enabled && !p[m.id].details.trim()) out.push(`${m.name} is turned on but has no payment details, so it is hidden at checkout. Add the ${m.detailsLabel?.toLowerCase()} in Settings.`);
    } else if (p[m.id as "bank" | "card"].enabled && !PROVIDERS[m.id]) {
      out.push(`${m.name} is turned on but is not connected to a payment provider yet, so customers cannot use it.`);
    }
  }
  if (!checkoutMethods(p).some((m) => m.available)) out.push("No payment method is ready. Customers cannot check out until at least one method is on and has its details.");
  return out;
}

/** Instructions shown on the order page and in the order email for a manual method. */
export function payInstructions(store: Pick<StoreSettings, "payments" | "paymentNote">, id: string): { name: string; sendTo: string; note: string } | null {
  const m = payMethod(id);
  if (!m || !isManual(m.id)) return null;
  return { name: m.name, sendTo: store.payments[m.id].details.trim(), note: store.paymentNote.trim() };
}

/**
 * Who receives a website payment made with this method (the payment method name saved on the sale, e.g. "Zelle").
 * "A" | "B" = that partner holds the money (cash held); null = the bank. Methods without a choice go to the bank.
 */
export function receiverOf(p: PaymentSettings, paymentMethod: string): "A" | "B" | null {
  const name = paymentMethod.trim().toLowerCase();
  const m = PAY_METHODS.find((x) => x.saleName.toLowerCase() === name || x.name.toLowerCase() === name || x.id === name);
  if (!m || !isManual(m.id)) return null;
  const r = p[m.id].receiver;
  return r === "A" || r === "B" ? r : null;
}
