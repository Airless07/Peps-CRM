// Transactional email through Resend. A missing key or a failed send never throws into the
// request that triggered it: the order still happened. Every send returns what happened so it
// can be written to the order timeline.
// (Pattern from the VALO project's lib/email.ts, extended with branded templates + plain text.)
import { RESEARCH_LINE, type StoreSettings } from "./store/config";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export type EmailOutcome = { sent: true; id: string } | { sent: false; skipped: true; reason: string } | { sent: false; skipped: false; error: string };

export const resendKey = () => (process.env.RESEND_API_KEY ?? "").trim();

export const outcomeText = (o: EmailOutcome) => (o.sent ? "Sent" : o.skipped ? `Not sent: ${o.reason}` : `Failed: ${o.error}`);

type Block =
  | { p: string }
  | { big: { label: string; value: string } }
  | { rows: [string, string][]; strongLast?: boolean }
  | { button: { label: string; url: string } }
  | { box: { title: string; lines: string[] } }
  | { small: string };

export interface EmailContent {
  subject: string;
  preview: string;
  heading: string;
  blocks: Block[];
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export function renderEmail(store: Pick<StoreSettings, "storeName" | "accentColor">, c: EmailContent): { html: string; text: string } {
  const accent = store.accentColor;
  const name = store.storeName;
  const html: string[] = [];
  const text: string[] = [c.heading, ""];
  for (const b of c.blocks) {
    if ("p" in b) {
      html.push(`<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1b1b1d">${esc(b.p)}</p>`);
      text.push(b.p, "");
    } else if ("big" in b) {
      html.push(
        `<table role="presentation" width="100%" style="margin:0 0 16px;border:1px solid #e6e4df;border-radius:10px"><tr><td style="padding:16px 18px"><div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6d6d72">${esc(b.big.label)}</div><div style="font-size:26px;font-weight:700;letter-spacing:-.01em;color:#1b1b1d;margin-top:4px">${esc(b.big.value)}</div></td></tr></table>`,
      );
      text.push(`${b.big.label}: ${b.big.value}`, "");
    } else if ("rows" in b) {
      const last = b.rows.length - 1;
      html.push(
        `<table role="presentation" width="100%" style="margin:0 0 16px;border-collapse:collapse;font-size:15px;color:#1b1b1d">${b.rows
          .map(([l, r], i) => {
            const strong = b.strongLast && i === last;
            return `<tr><td style="padding:7px 12px 7px 0;${strong ? "border-top:1px solid #e6e4df;font-weight:700" : "color:#3c3c40"}">${esc(l)}</td><td style="padding:7px 0;text-align:right;white-space:nowrap;${strong ? "border-top:1px solid #e6e4df;font-weight:700" : ""}">${esc(r)}</td></tr>`;
          })
          .join("")}</table>`,
      );
      for (const [l, r] of b.rows) text.push(`${l}: ${r}`);
      text.push("");
    } else if ("button" in b) {
      html.push(
        `<table role="presentation" style="margin:4px 0 20px"><tr><td style="background:${accent};border-radius:8px"><a href="${esc(b.button.url)}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${esc(b.button.label)}</a></td></tr></table>`,
      );
      text.push(`${b.button.label}: ${b.button.url}`, "");
    } else if ("box" in b) {
      html.push(
        `<table role="presentation" width="100%" style="margin:0 0 16px;background:#f7f5f1;border-radius:10px"><tr><td style="padding:16px 18px"><div style="font-size:14px;font-weight:700;color:#1b1b1d;margin-bottom:6px">${esc(b.box.title)}</div>${b.box.lines
          .map((l) => `<div style="font-size:15px;line-height:1.6;color:#1b1b1d">${esc(l)}</div>`)
          .join("")}</td></tr></table>`,
      );
      text.push(b.box.title, ...b.box.lines.map((l) => `  ${l}`), "");
    } else {
      html.push(`<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#6d6d72">${esc(b.small)}</p>`);
      text.push(b.small, "");
    }
  }
  text.push("--", name, RESEARCH_LINE);
  return {
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.subject)}</title></head>
<body style="margin:0;background:#f4f2ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(c.preview)}</div>
<table role="presentation" width="100%" style="background:#f4f2ee"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #e6e4df">
<tr><td style="padding:22px 28px;border-bottom:3px solid ${accent}"><span style="font-size:15px;font-weight:800;letter-spacing:.16em;color:#1b1b1d;text-transform:uppercase">${esc(name)}</span></td></tr>
<tr><td style="padding:28px 28px 12px"><h1 style="margin:0 0 18px;font-size:22px;line-height:1.25;letter-spacing:-.01em;color:#1b1b1d">${esc(c.heading)}</h1>${html.join("\n")}</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #e6e4df;font-size:12px;line-height:1.6;color:#8a8a8f">${esc(RESEARCH_LINE)}</td></tr>
</table></td></tr></table></body></html>`,
    text: text.join("\n"),
  };
}

export async function sendEmail(store: StoreSettings, to: string | string[], content: EmailContent): Promise<EmailOutcome> {
  const key = resendKey();
  const list = (Array.isArray(to) ? to : [to]).map((x) => x.trim()).filter(Boolean);
  if (!key) return { sent: false, skipped: true, reason: "RESEND_API_KEY is not set, so no email was sent." };
  if (list.length === 0) return { sent: false, skipped: true, reason: "There is no email address to send to." };
  const from = store.emailFromAddress.trim() || "onboarding@resend.dev";
  const { html, text } = renderEmail(store, content);
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${store.emailFromName.trim() || store.storeName} <${from}>`, to: list, subject: content.subject, html, text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!res.ok) return { sent: false, skipped: false, error: body?.message ?? `Resend answered with HTTP ${res.status}.` };
    return { sent: true, id: body?.id ?? "" };
  } catch (err) {
    return { sent: false, skipped: false, error: `Could not reach Resend: ${err instanceof Error ? err.message : "network error"}.` };
  }
}

// ---------------------------------------------------------------- Templates
export interface EmailOrder {
  number: number;
  name: string;
  email: string;
  lines: { name: string; quantity: number; totalCents: number }[];
  subtotalCents: number;
  discountCents: number;
  /** Store credit used. Absent = 0. */
  creditCents?: number;
  shippingCents: number;
  totalCents: number;
  shippingMethod: string;
  shipTo: string[];
  statusUrl: string;
  /** Local pickup / delivery. Absent = a shipped order. */
  local?: { method: "pickup" | "delivery"; spot: { name: string; address: string; instructions: string } | null; time: string; payAtPickup: boolean };
}

export const TEXT_CONFIRM_LINE = "We'll text you to confirm the exact time.";

/** Pickup spot (pickup) or delivery address (delivery), the preferred time and the "we'll text you" line. */
function localBlocks(o: EmailOrder): Block[] {
  const l = o.local!;
  const lines =
    l.method === "pickup"
      ? [...(l.spot ? [l.spot.name, l.spot.address] : []), ...(l.spot?.instructions ? [l.spot.instructions] : [])]
      : o.shipTo;
  if (l.time) lines.push(`Preferred time: ${l.time}`);
  lines.push(TEXT_CONFIRM_LINE);
  return [{ box: { title: l.method === "pickup" ? "Local pickup" : "Local delivery to", lines } }];
}

function totalsRows(o: EmailOrder): Block {
  const rows: [string, string][] = o.lines.map((l) => [`${l.name} × ${l.quantity}`, money(l.totalCents)]);
  rows.push(["Subtotal", money(o.subtotalCents)]);
  if (o.discountCents > 0) rows.push(["Discount", `-${money(o.discountCents)}`]);
  if ((o.creditCents ?? 0) > 0) rows.push(["Store credit", `-${money(o.creditCents!)}`]);
  rows.push([o.local ? o.shippingMethod || "Local" : `Shipping${o.shippingMethod ? ` (${o.shippingMethod})` : ""}`, o.shippingCents > 0 ? money(o.shippingCents) : "Free"]);
  rows.push(["Total", money(o.totalCents)]);
  return { rows, strongLast: true };
}

export function orderReceivedEmail(store: StoreSettings, o: EmailOrder, pay: { name: string; sendTo: string; note: string } | null, expiresAt: Date | null): EmailContent {
  if (o.local) return localOrderReceivedEmail(o, pay, expiresAt);
  const deadline = expiresAt ? expiresAt.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "";
  const blocks: Block[] = [
    { p: `Thanks, ${o.name.split(" ")[0] || "there"}. We have your order. It ships as soon as your payment arrives.` },
    { big: { label: "Order number", value: `#${o.number}` } },
    { big: { label: "Amount to send", value: money(o.totalCents) } },
  ];
  if (pay) {
    blocks.push({
      box: {
        title: `Pay with ${pay.name}`,
        lines: [`Send exactly ${money(o.totalCents)} to: ${pay.sendTo}`, `Put your order number in the memo: ${o.number}`, ...(pay.note ? [pay.note] : [])],
      },
    });
  }
  if (deadline) blocks.push({ p: `Please pay by ${deadline}. Unpaid orders are canceled automatically after that.` });
  blocks.push({ button: { label: "View order and upload payment screenshot", url: o.statusUrl } }, totalsRows(o));
  if (o.shipTo.length) blocks.push({ box: { title: "Shipping to", lines: o.shipTo } });
  return { subject: `Order #${o.number} received: payment instructions`, preview: `Send ${money(o.totalCents)} and put ${o.number} in the memo.`, heading: "We got your order", blocks };
}

/** Order received for local pickup / delivery: where and when, and how to pay (online now, or at the handover). */
export function localOrderReceivedEmail(o: EmailOrder, pay: { name: string; sendTo: string; note: string } | null, expiresAt: Date | null): EmailContent {
  const l = o.local!;
  const what = l.method === "pickup" ? "pickup" : "delivery";
  const deadline = expiresAt ? expiresAt.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : "";
  const blocks: Block[] = [
    { p: `Thanks, ${o.name.split(" ")[0] || "there"}. We have your order for local ${what}.` },
    { big: { label: "Order number", value: `#${o.number}` } },
    ...localBlocks(o),
  ];
  if (l.payAtPickup) blocks.push({ box: { title: `Pay at ${what}`, lines: [`Bring ${money(o.totalCents)} in cash, or send it by Zelle when we meet.`] } });
  else if (pay) {
    blocks.push({ big: { label: "Amount to send", value: money(o.totalCents) } });
    blocks.push({ box: { title: `Pay with ${pay.name}`, lines: [`Send exactly ${money(o.totalCents)} to: ${pay.sendTo}`, `Put your order number in the memo: ${o.number}`, ...(pay.note ? [pay.note] : [])] } });
    if (deadline) blocks.push({ p: `Please pay by ${deadline}. Unpaid orders are canceled automatically after that.` });
  }
  blocks.push({ button: { label: "View order", url: o.statusUrl } }, totalsRows(o));
  return { subject: `Order #${o.number} received: local ${what}`, preview: `Local ${what}. ${TEXT_CONFIRM_LINE}`, heading: "We got your order", blocks };
}

/** "Your order is ready for pickup / delivery". */
export function readyEmail(_store: StoreSettings, o: EmailOrder): EmailContent {
  const what = o.local?.method === "delivery" ? "delivery" : "pickup";
  return {
    subject: `Order #${o.number} is ready for ${what}`,
    preview: `Your order is ready for ${what}. ${TEXT_CONFIRM_LINE}`,
    heading: `Your order is ready for ${what}`,
    blocks: [
      { p: `Good news: order #${o.number} is ready for ${what}.${o.local?.payAtPickup ? ` Please have ${money(o.totalCents)} ready in cash or by Zelle.` : ""}` },
      ...(o.local ? localBlocks(o) : []),
      { button: { label: "View order", url: o.statusUrl } },
    ],
  };
}

/** "about 12 hours", "about 1 hour", "less than an hour". */
export function timeLeftText(ms: number): string {
  const hours = ms / 3600_000;
  if (hours < 1) return "less than an hour";
  if (hours < 36) {
    const h = Math.round(hours);
    return `about ${h} hour${h === 1 ? "" : "s"}`;
  }
  const d = Math.round(hours / 24);
  return `about ${d} days`;
}

/** Sent once, when an order is still unpaid halfway to auto-cancel. */
export function paymentReminderEmail(_store: StoreSettings, o: EmailOrder, pay: { name: string; sendTo: string; note: string } | null, expiresAt: Date, now = new Date()): EmailContent {
  const left = timeLeftText(expiresAt.getTime() - now.getTime());
  const deadline = expiresAt.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  const blocks: Block[] = [
    { p: `Hi ${o.name.split(" ")[0] || "there"}, order #${o.number} is still waiting for payment. You have ${left} left: it is canceled automatically on ${deadline} if we have not received it.` },
    { big: { label: "Amount to send", value: money(o.totalCents) } },
  ];
  if (pay) {
    blocks.push({
      box: {
        title: `Pay with ${pay.name}`,
        lines: [`Send exactly ${money(o.totalCents)} to: ${pay.sendTo}`, `Put your order number in the memo: ${o.number}`, ...(pay.note ? [pay.note] : [])],
      },
    });
  }
  blocks.push({ button: { label: "View order and upload payment screenshot", url: o.statusUrl } }, totalsRows(o), { small: "Already paid? Thank you. You can ignore this email, or upload a screenshot of the payment on the order page so we can confirm it faster." });
  return { subject: `Reminder: order #${o.number} is waiting for payment`, preview: `${left} left to send ${money(o.totalCents)}.`, heading: "Your order is waiting for payment", blocks };
}

export function lowStockEmail(_store: StoreSettings, items: { name: string; stock: number; lowAt: number }[], adminUrl: string): EmailContent {
  const one = items.length === 1;
  return {
    subject: one ? `Low stock: ${items[0].name} (${items[0].stock} left)` : `Low stock: ${items.length} products`,
    preview: items.map((i) => `${i.name}: ${i.stock} left`).join(", ").slice(0, 110),
    heading: one ? "A product is running low" : "Products are running low",
    blocks: [
      { p: one ? "This size just dropped to its low stock warning level:" : "These sizes just dropped to their low stock warning level:" },
      { rows: items.map((i): [string, string] => [i.name, i.stock <= 0 ? "Out of stock" : `${i.stock} left (warning at ${i.lowAt})`]) },
      { button: { label: "Open inventory", url: adminUrl } },
      { small: "You get this once when a size reaches its warning level, not on every sale after that. Turn it off in Settings, Email." },
    ],
  };
}

export function paymentConfirmedEmail(_store: StoreSettings, o: EmailOrder): EmailContent {
  return {
    subject: `Payment confirmed for order #${o.number}`,
    preview: "Your payment arrived. We are packing your order.",
    heading: "Payment confirmed",
    blocks: [
      {
        p: o.local
          ? `We received your payment of ${money(o.totalCents)} for order #${o.number}. We will email you when it is ready for ${o.local.method === "pickup" ? "pickup" : "delivery"}. ${TEXT_CONFIRM_LINE}`
          : `We received your payment of ${money(o.totalCents)} for order #${o.number}. Your order is being packed, and you will get another email with tracking when it ships.`,
      },
      totalsRows(o),
      { button: { label: "View order status", url: o.statusUrl } },
    ],
  };
}

export function shippedEmail(_store: StoreSettings, o: EmailOrder, t: { number: string; carrier: string; url: string | null }): EmailContent {
  const blocks: Block[] = [{ p: `Order #${o.number} is on its way.` }];
  if (t.number) {
    blocks.push({ big: { label: `${t.carrier || "Tracking"} tracking number`, value: t.number } });
    if (t.url) blocks.push({ button: { label: "Track your package", url: t.url } });
    blocks.push({ small: "Tracking can take up to 24 hours to show movement after the label is created." });
  } else blocks.push({ p: "This shipment has no tracking number." });
  blocks.push({ button: { label: "View order status", url: o.statusUrl } });
  return { subject: `Order #${o.number} has shipped`, preview: t.number ? `Tracking number ${t.number}` : "Your order is on its way.", heading: "Your order has shipped", blocks };
}

export function deliveredEmail(_store: StoreSettings, o: EmailOrder, reviewUrl: string): EmailContent {
  return {
    subject: `How was your order #${o.number}?`,
    preview: "Your order was delivered. Tell us how it went.",
    heading: "How was your order?",
    blocks: [
      { p: `Order #${o.number} was delivered. We would like to hear how the experience was: shipping speed, packaging and service.` },
      { button: { label: "Rate your order experience", url: reviewUrl } },
      { small: "Please review your order experience only. Reviews about product use or results will not be published." },
    ],
  };
}

export function canceledEmail(_store: StoreSettings, o: EmailOrder, reason: string): EmailContent {
  return {
    subject: `Order #${o.number} was canceled`,
    preview: reason,
    heading: "Your order was canceled",
    blocks: [
      { p: `Order #${o.number} was canceled. Reason: ${reason.replace(/^Canceled:\s*/i, "")}.` },
      { p: "If you already sent a payment, reply to this email and we will sort it out. You are welcome to place a new order any time." },
    ],
  };
}

export function passwordResetEmail(store: StoreSettings, url: string): EmailContent {
  return {
    subject: `Reset your ${store.storeName} password`,
    preview: "Use the link inside to choose a new password.",
    heading: "Reset your password",
    blocks: [
      { p: `Someone asked to reset the password for this email at ${store.storeName}.` },
      { button: { label: "Choose a new password", url } },
      { small: "The link works once and expires in 1 hour. If this was not you, ignore this email and nothing changes." },
    ],
  };
}

/** Invite to a store account, or the claim link sent when someone signs up with an email we already have. */
export function inviteEmail(store: StoreSettings, v: { name: string; creditCents: number; url: string; days: number; claim: boolean }): EmailContent {
  const first = v.name.trim().split(/\s+/)[0] || "there";
  return {
    subject: v.claim ? `Claim your ${store.storeName} account` : `Your ${store.storeName} account is ready`,
    preview: v.creditCents > 0 ? `You have ${money(v.creditCents)} store credit waiting.` : "Choose a password to start using it.",
    heading: v.claim ? "Claim your account" : `Welcome, ${first}`,
    blocks: [
      { p: v.claim ? `Someone tried to create an account at ${store.storeName} with this email. We already have an account for you, so nothing new was made.` : `${store.storeName} set up an account for you. Choose a password to see your orders and store credit.` },
      ...(v.creditCents > 0 ? [{ p: `You have ${money(v.creditCents)} store credit.` }] : []),
      { button: { label: v.claim ? "Claim my account" : "Choose a password", url: v.url } },
      { small: `The link works once and expires in ${v.days} day${v.days === 1 ? "" : "s"}. If this was not you, ignore this email and nothing changes.` },
    ],
  };
}

export function adminNewOrderEmail(_store: StoreSettings, o: EmailOrder, adminUrl: string): EmailContent {
  return {
    subject: `New order #${o.number}: ${money(o.totalCents)} from ${o.name}`,
    preview: "Waiting for payment.",
    heading: `New order #${o.number}`,
    blocks: [{ p: `${o.name} (${o.email}) placed an order. It is waiting for payment.` }, totalsRows(o), { button: { label: "Open the order", url: adminUrl } }],
  };
}

export function adminScreenshotEmail(_store: StoreSettings, o: EmailOrder, adminUrl: string): EmailContent {
  return {
    subject: `Payment screenshot uploaded for order #${o.number}`,
    preview: `Check for ${money(o.totalCents)} from ${o.name}.`,
    heading: "Payment screenshot to review",
    blocks: [
      { p: `${o.name} uploaded a payment screenshot for order #${o.number}. Check your payment app for ${money(o.totalCents)}, then mark the order paid.` },
      { button: { label: "Review and mark paid", url: adminUrl } },
    ],
  };
}

export function adminContactEmail(_store: StoreSettings, m: { name: string; email: string; orderNumber: string; message: string }, adminUrl: string): EmailContent {
  return {
    subject: `New message from ${m.name}`,
    preview: m.message.slice(0, 90),
    heading: "New contact message",
    blocks: [
      { rows: [["From", `${m.name} <${m.email}>`], ...(m.orderNumber ? ([["Order", `#${m.orderNumber}`]] as [string, string][]) : [])] },
      { box: { title: "Message", lines: m.message.split(/\r?\n/).slice(0, 60) } },
      { button: { label: "Open messages", url: adminUrl } },
      { small: `Reply directly to ${m.email}.` },
    ],
  };
}

export function testEmail(store: StoreSettings): EmailContent {
  return {
    subject: `${store.storeName}: test email`,
    preview: "Email is working.",
    heading: "Email is working",
    blocks: [{ p: `This is a test from the ${store.storeName} admin. If you can read it, order emails will be delivered.` }],
  };
}
