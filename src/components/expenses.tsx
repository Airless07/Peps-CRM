"use client";

// Money > Expenses: lab testing first, plus supplies, labels, packaging, software and other costs.
// An expense lowers business money on its date (like a restock, so it can start payback mode) and comes
// out of the cash held by whoever paid. Every add, edit and delete is logged in the change history.
import { useMemo, useRef, useState } from "react";
import { FlaskConical, Paperclip, Pencil, Plus, Trash2, X } from "lucide-react";
import { api, useLoaded } from "./store";
import { useToast } from "./toast";
import { MoneyToPicker } from "./money-to";
import { Badge, Button, Card, Empty, Field, Input, MoneyInput, SectionTitle, Select, Sheet, Textarea, cx, useConfirm } from "./ui";
import { dayKey, fmtDateTime, fmtDay, fmtMoney, uid } from "@/lib/format";
import { EXPENSE_CATEGORIES, expenseCategoryLabel, type CashHolder, type ExpenseCategory, type ExpenseRec } from "@/lib/types";

const LABS = ["KMD Analytical", "Janoshik"];
/** A date picked as a day is saved at local noon, so it never slips to the day before in another time zone. */
const fromDay = (k: string) => new Date(`${k}T12:00`).toISOString();
/** "Retatrutide 10mg": the size is added only when the name does not already end with it. */
const productLabel = (p: { name: string; variantLabel: string }) =>
  !p.variantLabel || p.name.toLowerCase().endsWith(p.variantLabel.toLowerCase()) ? p.name : `${p.name} ${p.variantLabel}`;
const fileUrl = (file: string) => `/api/expenses/file/${encodeURIComponent(file)}`;

export function ExpensesTab() {
  const s = useLoaded();
  const confirm = useConfirm();
  const toast = useToast();
  const [cat, setCat] = useState<ExpenseCategory | "all">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [editing, setEditing] = useState<ExpenseRec | "new" | null>(null);

  const list = useMemo(() => {
    const all = s?.data.expenses ?? [];
    const [a, b] = from && to && from > to ? [to, from] : [from, to];
    return all
      .filter((x) => (cat === "all" || x.category === cat) && (!a || dayKey(x.date) >= a) && (!b || dayKey(x.date) <= b))
      .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : x.createdAt < y.createdAt ? 1 : -1));
  }, [s, cat, from, to]);

  if (!s) return null;
  const { data, ledger, name, mutate } = s;
  const products = new Map(data.products.map((p) => [p.id, p]));
  const productName = (id: string) => {
    const p = products.get(id);
    return p ? productLabel(p) : "Deleted product";
  };
  const total = list.reduce((x, e) => x + e.amountCents, 0);
  const testing = list.filter((e) => e.category === "lab_testing").reduce((x, e) => x + e.amountCents, 0);
  const history = data.expenseEvents ?? [];
  const filtered = cat !== "all" || !!from || !!to;

  async function remove(x: ExpenseRec) {
    const ok = await confirm({
      title: "Delete this expense?",
      body: `${expenseCategoryLabel(x.category)}${x.vendor ? `, ${x.vendor}` : ""}, ${fmtMoney(x.amountCents)} paid by ${name(x.paidBy)}. Business money and ${name(x.paidBy)}'s cash held go back up by ${fmtMoney(x.amountCents)}. The change stays in the history.`,
      confirmText: "Delete",
      danger: true,
    });
    if (!ok) return;
    const done = await mutate((d) => ({ ...d, expenses: (d.expenses ?? []).filter((e) => e.id !== x.id) }), () => api(`/api/expenses/${x.id}`, "DELETE"));
    if (done) toast.show({ message: `Expense deleted · ${fmtMoney(x.amountCents)} back in business money`, tone: "success" });
  }

  return (
    <div data-expenses>
      <SectionTitle
        right={
          <Button size="sm" variant="primary" className="h-10" onClick={() => setEditing("new")} data-add-expense>
            <Plus size={16} /> Add expense
          </Button>
        }
      >
        Expenses
      </SectionTitle>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Category" className="col-span-2 sm:col-span-2">
          <Select value={cat} onChange={(e) => setCat(e.target.value as ExpenseCategory | "all")} aria-label="Filter by category" data-expense-filter-category>
            <option value="all">All categories</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        </Field>
      </div>
      {filtered && (
        <button type="button" className="mt-2 text-sm font-medium text-accent" onClick={() => (setCat("all"), setFrom(""), setTo(""))}>
          Clear filters
        </button>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card className="p-4" data-expense-total>
          <div className="text-xs text-muted">{filtered ? "Total for selection" : "Total, all time"}</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">{fmtMoney(total)}</div>
          <div className="text-[11px] text-muted">
            {list.length} {list.length === 1 ? "expense" : "expenses"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted">Testing spent</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">{fmtMoney(testing)}</div>
          <div className="text-[11px] text-muted">lab testing in this selection</div>
        </Card>
        <Card className="col-span-2 p-4 sm:col-span-1">
          <div className="text-xs text-muted">Business money now</div>
          <div className={cx("mt-0.5 text-lg font-semibold tabular-nums", ledger.businessCents < 0 && "text-neg")}>{fmtMoney(ledger.businessCents)}</div>
          <div className="text-[11px] text-muted">{ledger.inPayback ? `payback mode, ${fmtMoney(ledger.leftToBreakEven)} left` : "after all expenses"}</div>
        </Card>
      </div>

      {list.length === 0 ? (
        <div className="mt-3">
          <Empty icon={<FlaskConical size={28} />} title={filtered ? "No expenses match" : "No expenses yet"} />
        </div>
      ) : (
        <Card className="mt-3 divide-y divide-line" data-expense-list>
          {list.map((x) => (
            <div key={x.id} className="flex items-start gap-3 px-4 py-3 text-sm" data-expense-row={x.id}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{x.vendor || expenseCategoryLabel(x.category)}</span>
                  <Badge tone={x.category === "lab_testing" ? "accent" : "neutral"}>{expenseCategoryLabel(x.category)}</Badge>
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {fmtDay(dayKey(x.date))} · paid by <span className="font-medium text-ink">{name(x.paidBy)}</span>
                </div>
                {(x.productIds.length > 0 || x.lots) && (
                  <div className="mt-1 text-xs text-muted">
                    {x.productIds.map(productName).join(", ")}
                    {x.productIds.length > 0 && x.lots ? " · " : ""}
                    {x.lots && <span className="font-mono">{x.lots}</span>}
                  </div>
                )}
                {x.notes && <div className="mt-1 line-clamp-2 text-xs text-muted">{x.notes}</div>}
                {x.file && (
                  <a href={fileUrl(x.file)} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-8 items-center gap-1 text-xs font-medium text-accent" data-expense-file>
                    <Paperclip size={13} /> {x.fileName || "Attachment"}
                  </a>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-semibold tabular-nums">{fmtMoney(x.amountCents)}</span>
                <div className="flex">
                  <button type="button" aria-label="Edit expense" onClick={() => setEditing(x)} className="flex h-10 w-10 items-center justify-center rounded-xl text-muted hover:bg-surface2 hover:text-ink">
                    <Pencil size={16} />
                  </button>
                  <button type="button" aria-label="Delete expense" onClick={() => remove(x)} className="flex h-10 w-10 items-center justify-center rounded-xl text-muted hover:bg-surface2 hover:text-neg" data-delete-expense>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </Card>
      )}
      <p className="mt-2 text-xs text-muted">
        Each expense lowers business money on its date, like a restock. Below $0 the store is in payback mode: every sale goes to the business, nothing to split, until it is back to $0. It also comes out of the cash held by whoever paid (Bank, or a partner who paid out of pocket).
      </p>

      {history.length > 0 && (
        <details className="mt-3 rounded-2xl border border-line bg-surface" data-expense-history>
          <summary className="flex min-h-12 cursor-pointer items-center px-4 text-sm font-medium">Change history ({history.length})</summary>
          <ul className="divide-y divide-line border-t border-line">
            {history.map((h) => (
              <li key={h.id} className="px-4 py-2.5 text-sm">
                <div>{h.message}</div>
                <div className="text-xs text-muted">{fmtDateTime(h.at)}</div>
              </li>
            ))}
          </ul>
        </details>
      )}

      <ExpenseSheet key={editing === "new" ? "new" : editing?.id ?? "none"} expense={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function ExpenseSheet({ expense, onClose }: { expense: ExpenseRec | "new" | null; onClose: () => void }) {
  const s = useLoaded();
  const toast = useToast();
  const old = expense && expense !== "new" ? expense : null;
  const [date, setDate] = useState(old ? dayKey(old.date) : dayKey(new Date()));
  const [category, setCategory] = useState<ExpenseCategory>(old?.category ?? "lab_testing");
  const [vendor, setVendor] = useState(old?.vendor ?? "");
  const [amount, setAmount] = useState(old?.amountCents ?? 0);
  const [paidBy, setPaidBy] = useState<CashHolder | null>(old?.paidBy ?? null);
  const [productIds, setProductIds] = useState<string[]>(old?.productIds ?? []);
  const [lots, setLots] = useState(old?.lots ?? "");
  const [notes, setNotes] = useState(old?.notes ?? "");
  const [file, setFile] = useState({ file: old?.file ?? "", fileName: old?.fileName ?? "", mime: old?.mime ?? "" });
  const [uploading, setUploading] = useState(false);
  const [tried, setTried] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  if (!s) return null;
  const { data, name, mutate } = s;
  const vendors = [...new Set([...LABS, ...(data.expenses ?? []).map((x) => x.vendor).filter(Boolean)])];
  const choices = data.products.filter((p) => !p.archived || productIds.includes(p.id));
  const label = (id: string) => {
    const p = data.products.find((x) => x.id === id);
    return p ? productLabel(p) : "Deleted product";
  };
  const missing = !paidBy;
  const canSave = amount > 0 && !!paidBy && !!date && !uploading;

  async function upload(f: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await fetch("/api/expenses/file", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { error?: string; file?: string; mime?: string; fileName?: string };
      if (!res.ok || !json.file) throw new Error(json.error || "Upload failed. Try again.");
      setFile({ file: json.file, fileName: json.fileName || f.name, mime: json.mime ?? "" });
    } catch (e) {
      toast.show({ message: (e as Error).message, tone: "error" });
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  async function save() {
    setTried(true);
    if (!paidBy) return toast.show({ message: "Pick who paid (Ahmad, Mo or Bank).", tone: "error" });
    if (!(amount > 0)) return toast.show({ message: "Enter the amount.", tone: "error" });
    const now = new Date().toISOString();
    const body = { date: fromDay(date), category, vendor: vendor.trim(), amountCents: amount, paidBy, productIds, lots: lots.trim(), notes: notes.trim(), ...file };
    const id = old?.id ?? uid();
    const rec: ExpenseRec = { id, ...body, createdAt: old?.createdAt ?? now, updatedAt: now };
    onClose();
    const ok = await mutate(
      (d) => ({ ...d, expenses: old ? (d.expenses ?? []).map((x) => (x.id === id ? rec : x)) : [rec, ...(d.expenses ?? [])] }),
      () => (old ? api(`/api/expenses/${id}`, "PATCH", body) : api("/api/expenses", "POST", { id, ...body })),
    );
    if (ok) toast.show({ message: `${old ? "Expense saved" : "Expense added"} · ${fmtMoney(amount)} paid by ${name(paidBy)}`, tone: "success" });
  }

  return (
    <Sheet
      open={!!expense}
      onClose={onClose}
      title={old ? "Edit expense" : "Add expense"}
      footer={
        <Button variant="primary" size="lg" block disabled={!canSave} onClick={save} title={missing ? "Pick who paid first" : undefined} data-save-expense>
          {old ? "Save changes" : "Add expense"}
        </Button>
      }
    >
      <div className="space-y-4" data-expense-sheet>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} aria-label="Category">
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={category === "lab_testing" ? "Lab" : "Vendor"}>
          <Input value={vendor} onChange={(e) => setVendor(e.target.value)} list="expense-vendors" placeholder={category === "lab_testing" ? "KMD Analytical, Janoshik…" : "Who was paid"} />
          <datalist id="expense-vendors">
            {vendors.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </Field>
        <Field label="Amount">
          <MoneyInput label="amount" value={amount} min={0} onChange={(c) => setAmount(c ?? 0)} />
        </Field>
        <Field label="Paid by">
          <MoneyToPicker value={paidBy} onChange={setPaidBy} missing={missing && (tried || amount > 0)} missingText="Pick who paid." />
        </Field>

        <Field label="Products tested (optional)">
          {productIds.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {productIds.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-surface2 py-1 pl-3 pr-1 text-sm">
                  {label(id)}
                  <button type="button" aria-label={`Remove ${label(id)}`} onClick={() => setProductIds((l) => l.filter((x) => x !== id))} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-line">
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <Select value="" onChange={(e) => e.target.value && setProductIds((l) => (l.includes(e.target.value) ? l : [...l, e.target.value]))} aria-label="Add a product">
            <option value="">Add a product…</option>
            {choices
              .filter((p) => !productIds.includes(p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {label(p.id)}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Lots tested (optional)">
          <Input value={lots} onChange={(e) => setLots(e.target.value)} placeholder="BL2611-RETA10" className="font-mono" />
        </Field>
        <Field label="Notes (optional)">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </Field>
        <Field label="Attachment (optional)" hint="Invoice PDF or screenshot. Only admins can open it.">
          {file.file ? (
            <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
              <Paperclip size={15} className="shrink-0 text-muted" />
              <a href={fileUrl(file.file)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium text-accent">
                {file.fileName || "Attachment"}
              </a>
              <button type="button" aria-label="Remove attachment" onClick={() => setFile({ file: "", fileName: "", mime: "" })} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface2 hover:text-neg">
                <X size={15} />
              </button>
            </div>
          ) : (
            <>
              <input ref={input} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              <Button variant="soft" onClick={() => input.current?.click()} disabled={uploading}>
                <Paperclip size={16} /> {uploading ? "Uploading…" : "Attach file"}
              </Button>
            </>
          )}
        </Field>
        {amount > 0 && paidBy && !old && (
          <p className="text-xs text-muted">
            Business money goes down by {fmtMoney(amount)}, and it comes out of {name(paidBy)}&apos;s cash held.
          </p>
        )}
      </div>
    </Sheet>
  );
}

