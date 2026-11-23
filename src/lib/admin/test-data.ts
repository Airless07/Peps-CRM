/**
 * Launch checklist: things that look like test data. Only flags clear signs (the word "test" in an
 * order's cancel reason or notes, example/.test email addresses, lorem ipsum), never a real customer
 * just because of a name. Deleting is a separate, confirmed step.
 */
import type { AppData } from "../types";

const TEST_WORD = /\btest(ing|ed)?\b|lorem ipsum/i;
const TEST_EMAIL = /@(example\.(com|org|net)|[a-z0-9-]+\.test)$/i;

export interface TestItem {
  kind: "order" | "customer" | "review" | "message" | "promotion";
  id: string;
  label: string;
}

export function findTestData(d: Pick<AppData, "orders" | "pendingOrders" | "customers" | "reviews" | "messages" | "promotions">): TestItem[] {
  const out: TestItem[] = [];
  for (const o of [...d.orders, ...d.pendingOrders]) {
    const words = [o.note, o.adminNote, o.web?.cancelReason ?? ""].join(" ");
    if (TEST_WORD.test(words) || TEST_EMAIL.test(o.web?.email ?? "")) out.push({ kind: "order", id: o.id, label: `Order #${o.number ?? "?"} (${o.customer || "no name"})` });
  }
  for (const c of d.customers) if (TEST_EMAIL.test(c.email ?? "")) out.push({ kind: "customer", id: c.id, label: `Customer ${c.name} <${c.email}>` });
  for (const r of d.reviews) if (TEST_WORD.test(`${r.text} ${r.displayName}`)) out.push({ kind: "review", id: r.id, label: `Review by ${r.displayName}` });
  for (const m of d.messages) if (TEST_WORD.test(m.message) || TEST_EMAIL.test(m.email)) out.push({ kind: "message", id: m.id, label: `Message from ${m.name}` });
  for (const p of d.promotions) if (/\btest/i.test(`${p.code} ${p.name}`)) out.push({ kind: "promotion", id: p.id, label: `Promotion ${p.code || p.name}` });
  return out;
}
