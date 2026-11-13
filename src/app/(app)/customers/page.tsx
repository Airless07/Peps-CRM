"use client";

import { useEffect, useMemo, useState } from "react";
import { GitMerge, Search, Trash2, UserPlus, Users } from "lucide-react";
import { OrderEditSheet } from "@/components/order-edit";
import { OrdersToggle } from "@/components/orders-toggle";
import { api, useLoaded } from "@/components/store";
import { useToast } from "@/components/toast";
import { Button, Card, Empty, Field, Input, PageHeader, PageSkeleton, Segmented, Select, Sheet, Textarea, cx, useConfirm } from "@/components/ui";
import { deleteCustomerData, mergeCustomersData, searchCustomers, updateCustomerData } from "@/lib/customers";
import { dayKey, fmtDay, fmtMoney, fmtTime, plural, uid } from "@/lib/format";
import { customerStats, daysAgo, type CustomerStats } from "@/lib/insights";
import type { CustomerRec } from "@/lib/types";

type Sort = "spent" | "recent" | "orders";

export default function CustomersPage() {
  const s = useLoaded();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("spent");
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const stats = useMemo(() => (s ? customerStats(s.data.customers, s.data.orders, s.data.products) : null), [s]);

  const list = useMemo(() => {
    if (!s || !stats) return [];
    const found = searchCustomers(s.data.customers, q).map((c) => stats.get(c.id)!);
    const t = (x: CustomerStats) => (x.lastOrder ? new Date(x.lastOrder).getTime() : 0);
    return found.sort((a, b) => {
      if (sort === "recent") return t(b) - t(a) || b.totalSpent - a.totalSpent;
      if (sort === "orders") return b.orders - a.orders || b.totalSpent - a.totalSpent;
      return b.totalSpent - a.totalSpent || t(b) - t(a);
    });
  }, [s, stats, q, sort]);

  if (!s || !stats) return <PageSkeleton />;
  const { data } = s;

  return (
    <div>
      <OrdersToggle value="customers" />
      <PageHeader
        title="Customers"
        sub={plural(data.customers.length, "customer")}
        actions={
          <Button variant="soft" onClick={() => setAdding(true)}>
            <UserPlus size={17} /> Add
          </Button>
        }
      />

      {data.customers.length === 0 ? (
        <Empty
          icon={<Users size={32} />}
          title="No customers yet"
          body="Pick or add a customer in the cart when you sell, and they show up here."
        />
      ) : (
        <>
          <div className="relative mb-3">
            <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone" className="pl-10" />
          </div>
          <Segmented
            size="sm"
            className="mb-4"
            value={sort}
            onChange={setSort}
            options={[
              { value: "spent", label: "Total spent" },
              { value: "recent", label: "Last order" },
              { value: "orders", label: "Most orders" },
            ]}
          />

          {list.length === 0 ? (
            <Empty title="No matching customers" body="Try a different name or phone number." />
          ) : (
            <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {list.map((st) => (
                <button
                  key={st.customer.id}
                  type="button"
                  onClick={() => setOpenId(st.customer.id)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-surface2/60 active:bg-surface2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{st.customer.name}</div>
                    <div className="mt-0.5 truncate text-sm text-muted">
                      {plural(st.orders, "order")}
                      {st.lastOrder ? ` · last ${fmtDay(dayKey(st.lastOrder))} · ${daysAgo(st.lastOrder)}` : " · no orders yet"}
                    </div>
                    {st.customer.phone && <div className="mt-0.5 truncate text-xs tabular-nums text-muted">{st.customer.phone}</div>}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-base font-semibold tabular-nums">{fmtMoney(st.totalSpent)}</div>
                    <div className="text-xs text-muted">spent</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <CustomerSheet id={openId} stats={openId ? stats.get(openId) ?? null : null} onClose={() => setOpenId(null)} />
      <AddCustomerSheet open={adding} onClose={() => setAdding(false)} onCreated={(id) => setOpenId(id)} />
    </div>
  );
}

function CustomerSheet({ id, stats, onClose }: { id: string | null; stats: CustomerStats | null; onClose: () => void }) {
  const s = useLoaded();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState({ name: "", phone: "", notes: "" });
  const [mergeInto, setMergeInto] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  // Keep the last customer on screen while the sheet animates closed
  const [shown, setShown] = useState<CustomerStats | null>(null);

  useEffect(() => {
    if (stats) setShown(stats);
  }, [stats]);
  useEffect(() => {
    if (!id || !stats) return;
    setForm({ name: stats.customer.name, phone: stats.customer.phone, notes: stats.customer.notes });
    setMergeInto("");
    // Only reset the form when a different customer opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!s) return null;
  const { data, mutate } = s;
  const st = stats ?? shown;
  const c = st?.customer;
  const dirty = !!c && (form.name.trim() !== c.name || form.phone.trim() !== c.phone || form.notes.trim() !== c.notes);
  const orders = c
    ? data.orders.filter((o) => o.customerId === c.id).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    : [];
  const others = c ? data.customers.filter((x) => x.id !== c.id).sort((a, b) => a.name.localeCompare(b.name)) : [];

  async function save() {
    if (!c) return;
    const patch = { name: form.name.trim(), phone: form.phone.trim(), notes: form.notes.trim() };
    if (!patch.name) return toast.show({ message: "Name is required", tone: "error" });
    const ok = await mutate(
      (d) => updateCustomerData(d, c.id, patch),
      () => api(`/api/customers/${c.id}`, "PATCH", patch),
    );
    if (ok) toast.show({ message: "Customer saved" });
  }

  async function merge() {
    if (!c || !mergeInto) return;
    const target = data.customers.find((x) => x.id === mergeInto);
    if (!target) return;
    const ok = await confirm({
      title: `Merge into ${target.name}?`,
      body: `${plural(orders.length, "order")} from “${c.name}” will move to “${target.name}”, then “${c.name}” is deleted. Orders and money are not changed.`,
      confirmText: "Merge",
      danger: true,
    });
    if (!ok) return;
    onClose();
    const done = await mutate(
      (d) => mergeCustomersData(d, c.id, target.id),
      () => api("/api/customers/merge", "POST", { fromId: c.id, intoId: target.id }),
    );
    if (done) toast.show({ message: `Merged into ${target.name}` });
  }

  async function remove() {
    if (!c) return;
    const ok = await confirm({
      title: `Delete ${c.name}?`,
      body: orders.length
        ? `Their ${plural(orders.length, "order")} stay exactly as they are, just without a linked customer.`
        : "This customer has no orders.",
      confirmText: "Delete customer",
      danger: true,
    });
    if (!ok) return;
    onClose();
    const done = await mutate(
      (d) => deleteCustomerData(d, c.id),
      () => api(`/api/customers/${c.id}`, "DELETE"),
    );
    if (done) toast.show({ message: "Customer deleted" });
  }

  return (
    <>
      <Sheet
        open={!!id && !!stats}
        onClose={onClose}
        title={c?.name ?? "Customer"}
        wide
        footer={
          dirty ? (
            <Button variant="primary" size="lg" block onClick={save} disabled={!form.name.trim()}>
              Save changes
            </Button>
          ) : undefined
        }
      >
        {st && c && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Total spent" value={fmtMoney(st.totalSpent)} />
              <Stat label="Orders" value={String(st.orders)} />
              <Stat label="Avg order" value={st.orders ? fmtMoney(st.avgOrder) : "—"} />
              <Stat label="Last order" value={st.lastOrder ? daysAgo(st.lastOrder) : "—"} />
            </div>
            <div className="rounded-2xl bg-surface2/70 px-4 py-3 text-sm">
              <span className="text-muted">Favorite product: </span>
              <span className="font-medium">
                {st.favoriteProduct ? `${st.favoriteProduct.name} (${plural(st.favoriteProduct.units, "unit")})` : "—"}
              </span>
            </div>

            <div className="space-y-4">
              <Field label="Name">
                <Input value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Phone (optional)">
                <Input type="tel" value={form.phone} maxLength={40} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone number" />
              </Field>
              <Field label="Notes (optional)">
                <Textarea value={form.notes} maxLength={2000} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Anything to remember" />
              </Field>
            </div>

            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{plural(orders.length, "order")}</div>
              {orders.length === 0 ? (
                <p className="rounded-2xl border border-line px-4 py-6 text-center text-sm text-muted">No orders yet.</p>
              ) : (
                <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
                  {orders.map((o) => {
                    const r = s.ledger.orders.get(o.id);
                    const items = o.lines.map((l) => `${l.quantity > 1 ? l.quantity + "× " : ""}${l.productName}`).join(", ");
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => setEditing(o.id)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left text-sm transition hover:bg-surface2/60 active:bg-surface2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">
                            {fmtDay(dayKey(o.date))} · {fmtTime(o.date)}
                          </div>
                          <div className="mt-0.5 truncate text-muted">{items}</div>
                          <div className="mt-0.5 text-xs text-muted">{o.paymentMethod}</div>
                        </div>
                        <div className="shrink-0 font-semibold tabular-nums">{fmtMoney(r?.total ?? 0)}</div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {others.length > 0 && (
              <div className="rounded-2xl border border-line p-4">
                <div className="flex items-center gap-2 font-medium">
                  <GitMerge size={17} /> Merge duplicate
                </div>
                <p className="mt-1 text-sm text-muted">
                  Is “{c.name}” the same person as another customer? Move all their orders there and remove this one.
                </p>
                <div className="mt-3 flex gap-2">
                  <Select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className="flex-1" aria-label="Merge into">
                    <option value="">Merge into…</option>
                    {others.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                        {x.phone ? ` · ${x.phone}` : ""}
                      </option>
                    ))}
                  </Select>
                  <Button disabled={!mergeInto} onClick={merge}>
                    Merge
                  </Button>
                </div>
              </div>
            )}

            <Button variant="ghost" className="text-neg" onClick={remove}>
              <Trash2 size={17} /> Delete customer
            </Button>
          </div>
        )}
      </Sheet>
      <OrderEditSheet orderId={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3.5">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("mt-0.5 truncate text-lg font-semibold tabular-nums")}>{value}</div>
    </Card>
  );
}

function AddCustomerSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const s = useLoaded();
  const toast = useToast();
  const [form, setForm] = useState({ name: "", phone: "", notes: "" });
  useEffect(() => {
    if (open) setForm({ name: "", phone: "", notes: "" });
  }, [open]);
  if (!s) return null;

  async function create() {
    const rec: CustomerRec = {
      id: uid(),
      name: form.name.trim(),
      phone: form.phone.trim(),
      notes: form.notes.trim(),
      createdAt: new Date().toISOString(),
    };
    if (!rec.name) return;
    onClose();
    const ok = await s!.mutate(
      (d) => ({ ...d, customers: [...d.customers, rec] }),
      () => api("/api/customers", "POST", { id: rec.id, name: rec.name, phone: rec.phone, notes: rec.notes }),
    );
    if (ok) {
      toast.show({ message: "Customer added" });
      onCreated(rec.id);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New customer"
      footer={
        <Button variant="primary" size="lg" block disabled={!form.name.trim()} onClick={create}>
          Add customer
        </Button>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input autoFocus value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" />
        </Field>
        <Field label="Phone (optional)">
          <Input type="tel" value={form.phone} maxLength={40} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone number" />
        </Field>
        <Field label="Notes (optional)">
          <Textarea value={form.notes} maxLength={2000} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>
    </Sheet>
  );
}
