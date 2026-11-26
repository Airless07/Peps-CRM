// Expenses: add, edit, delete. Every change writes an ExpenseEvent (the history stays after a delete).
// Money: an expense lowers business money on its date like a restock (see computeLedger) and comes out of
// the cash held by whoever paid (see cashPosition). Nothing is stored as a balance, so edit and delete
// reverse exactly.
import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { HttpError } from "./api";
import { prisma } from "./db";
import { fmtMoney } from "./format";
import type { expenseInput } from "./schemas";
import { toExpense } from "./serialize";
import { expenseCategoryLabel, type CashHolder, type ExpenseRec } from "./types";
import { removeUpload } from "./uploads";

export type ExpenseInput = z.output<typeof expenseInput>;

async function names() {
  const s = await prisma.settings.findUnique({ where: { id: 1 }, select: { partnerAName: true, partnerBName: true } });
  return (h: CashHolder) => (h === "bank" ? "Bank" : h === "A" ? s?.partnerAName || "Partner A" : s?.partnerBName || "Partner B");
}

/** Only products that exist, once each. */
async function cleanProducts(ids: string[]): Promise<string[]> {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return [];
  const found = await prisma.product.findMany({ where: { id: { in: uniq } }, select: { id: true } });
  const ok = new Set(found.map((p) => p.id));
  return uniq.filter((id) => ok.has(id));
}

function row(x: ExpenseInput, productIds: string[]) {
  return {
    date: x.date,
    category: x.category,
    vendor: x.vendor,
    amountCents: x.amountCents,
    paidBy: x.paidBy,
    productIds: JSON.stringify(productIds),
    lots: x.lots,
    notes: x.notes,
    file: x.file,
    fileName: x.file ? x.fileName : "",
    mime: x.file ? x.mime : "",
  };
}

const summary = (x: Pick<ExpenseRec, "category" | "vendor" | "amountCents" | "paidBy">, name: (h: CashHolder) => string) =>
  [expenseCategoryLabel(x.category), x.vendor || null, fmtMoney(x.amountCents), `paid by ${name(x.paidBy)}`].filter(Boolean).join(" · ");

const day = (iso: string) => iso.slice(0, 10);

/** What changed between two versions, in words ("amount $250.00 → $300.00; paid by Ahmad → Bank"). */
function diff(a: ExpenseRec, b: ExpenseRec, name: (h: CashHolder) => string): string[] {
  const out: string[] = [];
  if (day(a.date) !== day(b.date)) out.push(`date ${day(a.date)} → ${day(b.date)}`);
  if (a.category !== b.category) out.push(`category ${expenseCategoryLabel(a.category)} → ${expenseCategoryLabel(b.category)}`);
  if (a.vendor !== b.vendor) out.push(`vendor "${a.vendor}" → "${b.vendor}"`);
  if (a.amountCents !== b.amountCents) out.push(`amount ${fmtMoney(a.amountCents)} → ${fmtMoney(b.amountCents)}`);
  if (a.paidBy !== b.paidBy) out.push(`paid by ${name(a.paidBy)} → ${name(b.paidBy)}`);
  if (a.productIds.join(",") !== b.productIds.join(",")) out.push("products tested");
  if (a.lots !== b.lots) out.push(`lots "${a.lots}" → "${b.lots}"`);
  if (a.notes !== b.notes) out.push("notes");
  if (a.file !== b.file) out.push(b.file ? (a.file ? "attachment replaced" : "attachment added") : "attachment removed");
  return out;
}

const log = (tx: Pick<typeof prisma, "expenseEvent">, expenseId: string, action: "created" | "edited" | "deleted", message: string, snap: ExpenseRec) =>
  tx.expenseEvent.create({ data: { id: randomUUID(), expenseId, action, message, detail: JSON.stringify(snap) } });

export async function createExpense(id: string, input: ExpenseInput): Promise<ExpenseRec> {
  const name = await names();
  const productIds = await cleanProducts(input.productIds);
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const rec = toExpense(await tx.expense.create({ data: { id, ...row(input, productIds), createdAt: now, updatedAt: now } }));
    await log(tx, id, "created", `Added: ${summary(rec, name)}.`, rec);
    return rec;
  });
}

export async function updateExpense(id: string, input: ExpenseInput): Promise<{ expense: ExpenseRec; changed: string[] }> {
  const name = await names();
  const productIds = await cleanProducts(input.productIds);
  const { before, after, changed } = await prisma.$transaction(async (tx) => {
    const old = await tx.expense.findUnique({ where: { id } });
    if (!old) throw new HttpError(404, "That expense no longer exists. Reload the page.");
    const before = toExpense(old);
    const after = toExpense(await tx.expense.update({ where: { id }, data: { ...row(input, productIds), updatedAt: new Date() } }));
    const changed = diff(before, after, name);
    if (changed.length) await log(tx, id, "edited", `Edited ${summary(after, name)}: ${changed.join("; ")}.`, after);
    return { before, after, changed };
  });
  if (before.file && before.file !== after.file) await removeUpload(before.file, "private");
  return { expense: after, changed };
}

export async function deleteExpense(id: string): Promise<void> {
  const name = await names();
  const gone = await prisma.$transaction(async (tx) => {
    const old = await tx.expense.findUnique({ where: { id } });
    if (!old) throw new HttpError(404, "That expense no longer exists. Reload the page.");
    const rec = toExpense(old);
    await tx.expense.delete({ where: { id } });
    await log(tx, id, "deleted", `Deleted: ${summary(rec, name)} (${day(rec.date)}).`, rec);
    return rec;
  });
  if (gone.file) await removeUpload(gone.file, "private");
}
