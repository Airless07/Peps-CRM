"use client";

import { useEffect, useState } from "react";
import { HandCoins, Plus, Undo2 } from "lucide-react";
import { List, ListRow } from "@/components/list";
import { OrderEditSheet } from "@/components/order-edit";
import { api, useLoaded } from "@/components/store";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Empty, Field, Input, Money, MoneyInput, PageHeader, PageSkeleton, Row, SectionTitle, Segmented, Sheet, useConfirm } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtMoney, fromLocalInput, toLocalDateInput, uid } from "@/lib/format";
import type { Partner, PayoutRec } from "@/lib/types";

export default function PayPage() {
  const s = useLoaded();
  const [payout, setPayout] = useState<PayoutRec | null>(null);
  const [splitId, setSplitId] = useState<string | null>(null);
  if (!s) return <PageSkeleton />;
  const { data, ledger, name } = s;
  const splits = [...data.splits].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

  const newPayout = (person: Partner) =>
    setPayout({ id: "", date: new Date().toISOString(), person, amountCents: 0, note: "", splitId: null, createdAt: "" });

  return (
    <div>
      <PageHeader
        title="Pay"
        actions={
          <Button variant="primary" onClick={() => newPayout("A")}>
            <Plus size={18} /> Payout
          </Button>
        }
      />

      <div className="grid gap-3 md:grid-cols-2">
        {(["A", "B"] as const).map((p) => {
          const earned = p === "A" ? ledger.earnedA : ledger.earnedB;
          const paid = p === "A" ? ledger.paidA : ledger.paidB;
          const pending = p === "A" ? ledger.pendingA : ledger.pendingB;
          const log = data.payouts.filter((x) => x.person === p).sort((a, b) => b.date.localeCompare(a.date));
          return (
            <div key={p}>
              <Card className="p-5">
                <div className="flex items-center justify-between">
                  <div className="text-lg font-semibold">{name(p)}</div>
                  <Button size="sm" variant="soft" onClick={() => newPayout(p)}>
                    <Plus size={16} /> Payout
                  </Button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-muted">Total earned</div>
                    <div className="text-2xl font-semibold tabular-nums">{fmtMoney(earned)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted">Total paid out</div>
                    <div className="text-2xl font-semibold tabular-nums">{fmtMoney(paid)}</div>
                  </div>
                </div>
                <div className="mt-3 rounded-xl bg-surface2/70 px-3 py-2">
                  <Row label="Earned − paid">
                    <Money cents={earned - paid} colored="neg" />
                  </Row>
                  <Row label="Waiting in next split">
                    <Money cents={pending} colored="neg" />
                  </Row>
                </div>
              </Card>
              <div className="mt-3">
                {log.length === 0 ? (
                  <p className="px-1 py-3 text-sm text-muted">No payouts yet.</p>
                ) : (
                  <List>
                    {log.map((x) => (
                      <ListRow
                        key={x.id}
                        onClick={() => setPayout({ ...x })}
                        title={<Money cents={x.amountCents} colored="neg" />}
                        sub={`${fmtDate(x.date)}${x.note ? ` · ${x.note}` : ""}`}
                        right={x.splitId ? <Badge>Split</Badge> : <Badge tone="accent">Manual</Badge>}
                      />
                    ))}
                  </List>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <SectionTitle>Split history</SectionTitle>
      {splits.length === 0 ? (
        <Empty icon={<HandCoins size={28} />} title="No splits yet" body="When there’s money pending, tap Split on the Money screen." />
      ) : (
        <List>
          {splits.map((sp, i) => (
            <ListRow
              key={sp.id}
              onClick={() => setSplitId(sp.id)}
              title={fmtDateTime(sp.date)}
              sub={`${sp.items.length} ${sp.items.length === 1 ? "order" : "orders"}${i === 0 ? " · most recent" : ""}`}
              right={
                <div className="text-right text-sm tabular-nums">
                  <div>
                    {name("A")} {fmtMoney(sp.partnerACents)}
                  </div>
                  <div>
                    {name("B")} {fmtMoney(sp.partnerBCents)}
                  </div>
                </div>
              }
            />
          ))}
        </List>
      )}

      <PayoutSheet value={payout} onClose={() => setPayout(null)} />
      <SplitDetailSheet splitId={splitId} isLatest={splits[0]?.id === splitId} onClose={() => setSplitId(null)} />
    </div>
  );
}

function PayoutSheet({ value, onClose }: { value: PayoutRec | null; onClose: () => void }) {
  const s = useLoaded();
  const confirm = useConfirm();
  const [p, setP] = useState<PayoutRec | null>(value);
  useEffect(() => setP(value), [value]);
  if (!s) return null;
  const isNew = !value?.id;

  async function save() {
    if (!p || p.amountCents === 0) return;
    const rec = { ...p, id: p.id || uid(), createdAt: p.createdAt || new Date().toISOString() };
    const body = { date: rec.date, person: rec.person, amountCents: rec.amountCents, note: rec.note };
    onClose();
    await s!.mutate(
      (d) => ({ ...d, payouts: isNew ? [rec, ...d.payouts] : d.payouts.map((x) => (x.id === rec.id ? rec : x)) }),
      () => (isNew ? api("/api/payouts", "POST", { id: rec.id, ...body }) : api(`/api/payouts/${rec.id}`, "PATCH", body)),
    );
  }
  async function remove() {
    if (!p || !(await confirm({ title: "Delete this payout?", confirmText: "Delete", danger: true }))) return;
    onClose();
    await s!.mutate((d) => ({ ...d, payouts: d.payouts.filter((x) => x.id !== p.id) }), () => api(`/api/payouts/${p.id}`, "DELETE"));
  }

  return (
    <Sheet
      open={!!value}
      onClose={onClose}
      title={isNew ? "Add payout" : "Edit payout"}
      footer={
        <div className="flex gap-2">
          {!isNew && (
            <Button variant="ghost" className="text-neg" onClick={remove}>
              Delete
            </Button>
          )}
          <Button block onClick={onClose}>
            Cancel
          </Button>
          <Button block variant="primary" onClick={save} disabled={!p || p.amountCents === 0}>
            Save
          </Button>
        </div>
      }
    >
      {p && (
        <div className="space-y-4">
          <Field label="Person">
            <Segmented
              value={p.person}
              onChange={(v) => setP({ ...p, person: v })}
              options={[
                { value: "A", label: s.name("A") },
                { value: "B", label: s.name("B") },
              ]}
            />
          </Field>
          <Field label="Amount" hint="Use a negative amount for money given back to the business.">
            <MoneyInput allowNegative autoFocus={isNew} value={p.amountCents} onChange={(c) => setP({ ...p, amountCents: c ?? 0 })} />
          </Field>
          <Field label="Date">
            <Input type="date" value={toLocalDateInput(p.date)} onChange={(e) => e.target.value && setP({ ...p, date: fromLocalInput(e.target.value) })} />
          </Field>
          <Field label="Note (optional)">
            <Input value={p.note} onChange={(e) => setP({ ...p, note: e.target.value })} placeholder="Cash handoff, advance…" />
          </Field>
          {p.splitId ? (
            <p className="text-xs text-muted">Created by a split. Editing it changes the paid-out total only; the split already moved this money out of the business.</p>
          ) : (
            <p className="text-xs text-muted">Manual payouts come out of business money.</p>
          )}
        </div>
      )}
    </Sheet>
  );
}

function SplitDetailSheet({ splitId, isLatest, onClose }: { splitId: string | null; isLatest: boolean; onClose: () => void }) {
  const s = useLoaded();
  const confirm = useConfirm();
  const toast = useToast();
  const [viewOrder, setViewOrder] = useState<string | null>(null);
  if (!s) return null;
  const sp = s.data.splits.find((x) => x.id === splitId) ?? null;
  const { name, data, ledger } = s;

  async function undo() {
    if (!sp) return;
    const ok = await confirm({
      title: "Undo this split?",
      body: "Its amounts go back to pending, and the payouts it created are removed.",
      confirmText: "Undo split",
      danger: true,
    });
    if (!ok) return;
    onClose();
    const done = await s!.mutate(
      (d) => ({ ...d, splits: d.splits.filter((x) => x.id !== sp.id), payouts: d.payouts.filter((x) => x.splitId !== sp.id) }),
      () => api(`/api/splits/${sp.id}`, "DELETE"),
    );
    if (done) toast.show({ message: "Split undone" });
  }

  return (
    <>
      <Sheet
        open={!!sp}
        onClose={onClose}
        title="Split details"
        footer={
          isLatest ? (
            <Button block variant="danger" onClick={undo}>
              <Undo2 size={18} /> Undo this split
            </Button>
          ) : undefined
        }
      >
        {sp && (
          <div>
            <div className="text-sm text-muted">{fmtDateTime(sp.date)}</div>
            <div className="mt-3 rounded-2xl bg-surface2/70 px-4 py-3">
              <Row label={`To ${name("A")}`}>{fmtMoney(sp.partnerACents)}</Row>
              <Row label={`To ${name("B")}`}>{fmtMoney(sp.partnerBCents)}</Row>
              <Row label="Kept by the business">{fmtMoney(sp.businessCents)}</Row>
            </div>
            <div className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-muted">Orders covered</div>
            <div className="divide-y divide-line rounded-2xl border border-line">
              {sp.items.map((it) => {
                const o = it.orderId ? data.orders.find((x) => x.id === it.orderId) : null;
                return (
                  <button
                    key={it.id}
                    type="button"
                    disabled={!o}
                    onClick={() => o && setViewOrder(o.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm enabled:hover:bg-surface2/60"
                  >
                    <div>
                      <div className="font-medium">{o ? o.customer || "Walk-in" : "Deleted order"}</div>
                      <div className="text-xs text-muted">{o ? `${fmtDateTime(o.date)} · ${fmtMoney(ledger.orders.get(o.id)?.total ?? 0)}` : "—"}</div>
                    </div>
                    <div className="text-right text-xs tabular-nums">
                      <div>
                        {name("A")} <Money cents={it.partnerACents} colored="neg" />
                      </div>
                      <div>
                        {name("B")} <Money cents={it.partnerBCents} colored="neg" />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {!isLatest && <p className="mt-4 text-xs text-muted">Only the most recent split can be undone.</p>}
          </div>
        )}
      </Sheet>
      <OrderEditSheet orderId={viewOrder} onClose={() => setViewOrder(null)} />
    </>
  );
}
