"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, ExternalLink, PackageCheck, Printer } from "lucide-react";
import { useOrderActions } from "@/components/order-actions";
import { api, useLoaded } from "@/components/store";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Empty, Input, PageHeader, PageSkeleton, Segmented, Sheet, cx } from "@/components/ui";
import { isReadyToShip } from "@/lib/admin/counts";
import { orderTotal, shipToLines } from "@/lib/admin/orders-view";
import { fmtMoney, plural } from "@/lib/format";
import { lineName } from "@/lib/size";
import type { OrderRec } from "@/lib/types";

/**
 * Paid, unshipped website orders. "List": tick orders and buy labels, print all labels / packing slips as one
 * PDF, or mark them shipped in one go. "One at a time": buy label, print label, print packing slip, mark shipped, next.
 */
export default function ShipQueuePage() {
  const s = useLoaded();
  const actions = useOrderActions();
  const [mode, setMode] = useState<"list" | "one">("list");
  const [index, setIndex] = useState(0);
  const [printed, setPrinted] = useState<Record<string, { label?: boolean; slip?: boolean }>>({});

  // Oldest paid order first.
  const queue = useMemo(
    () => (s ? s.data.orders.filter(isReadyToShip).sort((a, b) => new Date(a.web?.paidAt ?? a.date).getTime() - new Date(b.web?.paidAt ?? b.date).getTime()) : []),
    [s],
  );
  useEffect(() => {
    if (index > 0 && index >= queue.length) setIndex(Math.max(0, queue.length - 1));
  }, [index, queue.length]);

  if (!s) return <PageSkeleton />;
  const order = queue[index];
  const modeSwitch = (
    <Segmented<"list" | "one">
      size="sm"
      value={mode}
      onChange={setMode}
      options={[
        { value: "list", label: "List" },
        { value: "one", label: "One at a time" },
      ]}
    />
  );

  // List mode stays mounted even when the queue becomes empty, so the bulk result list stays on screen.
  if (mode === "list") {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Ship queue" sub={`${plural(queue.length, "order")} paid and waiting, oldest first`} actions={modeSwitch} />
        <BulkList queue={queue} onOpen={(i) => (setIndex(Math.max(0, i)), setMode("one"))} />
      </div>
    );
  }

  if (!order) {
    return (
      <div>
        <PageHeader title="Ship queue" />
        <Empty
          icon={<PackageCheck size={36} />}
          title="Nothing to ship"
          body="Paid website orders show up here, oldest first, as soon as you mark them paid."
          action={
            <Link href="/admin/orders">
              <Button variant="primary">Go to orders</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const hasLabel = !!order.web?.labelUrl;
  const p = printed[order.id] ?? {};
  const mark = (k: "label" | "slip") => setPrinted((x) => ({ ...x, [order.id]: { ...x[order.id], [k]: true } }));
  const ship = shipToLines(order);

  const step = (n: number, title: string, done: boolean, body: React.ReactNode) => (
    <li className={cx("flex gap-4 rounded-2xl border p-4 sm:p-5", done ? "border-line bg-surface2/50" : "border-line bg-surface")}>
      <span className={cx("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold", done ? "bg-pos/15 text-pos" : "bg-accent/10 text-accent")}>
        {done ? <Check size={18} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-3 text-base font-semibold">{title}</div>
        {body}
      </div>
    </li>
  );

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Ship queue" sub={`Order ${index + 1} of ${queue.length} · ${plural(queue.length, "order")} paid and waiting`} actions={modeSwitch} />

      <Card className="mb-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/admin/orders/${order.id}`} className="text-2xl font-semibold tabular-nums tracking-tight hover:text-accent">
              #{order.number}
            </Link>
            <address className="mt-1 text-[15px] not-italic leading-relaxed">
              {ship.map((l, i) => (
                <div key={i} className={i === 0 ? "font-medium" : "text-muted"}>
                  {l}
                </div>
              ))}
            </address>
          </div>
          <div className="shrink-0 text-right text-sm text-muted">
            <div className="text-base font-semibold tabular-nums text-ink">{fmtMoney(orderTotal(order, s.ledger))}</div>
            <div>{order.web?.shippingMethod}</div>
          </div>
        </div>
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {order.lines.map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-2.5 text-[15px]">
              <span className="flex h-8 min-w-8 items-center justify-center rounded-lg bg-surface2 px-2 font-semibold tabular-nums">{l.quantity}×</span>
              <span className="font-medium">{lineName(l)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <ol className="space-y-3">
        {step(
          1,
          "Buy the shipping label",
          hasLabel,
          hasLabel ? (
            <p className="text-sm text-muted">
              Bought. Tracking {order.web?.trackingNumber} ({order.web?.trackingCarrier}) was emailed to the customer.
            </p>
          ) : (
            <Button variant="primary" size="lg" block onClick={() => actions.run("buy-label", order)}>
              Buy label
            </Button>
          ),
        )}
        {step(
          2,
          "Print the label",
          !!p.label,
          <Button
            variant={hasLabel && !p.label ? "primary" : "secondary"}
            size="lg"
            block
            disabled={!hasLabel}
            onClick={() => {
              actions.run("open-label", order);
              mark("label");
            }}
          >
            <ExternalLink size={18} /> {hasLabel ? "Open label to print" : "Buy the label first"}
          </Button>,
        )}
        {step(
          3,
          "Print the packing slip",
          !!p.slip,
          <Button
            variant={hasLabel && p.label && !p.slip ? "primary" : "secondary"}
            size="lg"
            block
            onClick={() => {
              window.open(`/admin/print/${order.id}`, "_blank", "noopener");
              mark("slip");
            }}
          >
            <Printer size={18} /> Print packing slip
          </Button>,
        )}
        {step(
          4,
          "Hand it to the carrier",
          false,
          <>
            <Button variant={p.label && p.slip ? "primary" : "secondary"} size="lg" block disabled={actions.busyId === order.id} onClick={() => actions.run("mark-shipped", order)}>
              Mark shipped
            </Button>
            <p className="mt-2 text-sm text-muted">Marking it shipped takes it off this queue. If Shippo tracking updates are set up, this also happens on its own when the carrier scans the package.</p>
          </>,
        )}
      </ol>

      <div className="mt-5 flex gap-2">
        <Button size="lg" className="flex-1" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
          <ArrowLeft size={18} /> Previous
        </Button>
        <Button size="lg" className="flex-1" disabled={index >= queue.length - 1} onClick={() => setIndex((i) => Math.min(queue.length - 1, i + 1))}>
          Next order <ArrowRight size={18} />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Bulk list
type Row = { id: string; number: number | null; ok: boolean; skipped?: boolean; message: string; cents?: number };
type Filter = "all" | "needs" | "has";

function BulkList({ queue, onOpen }: { queue: OrderRec[]; onOpen: (index: number) => void }) {
  const s = useLoaded()!;
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | { kind: "buy"; rows: (Row & { carrier: string; service: string; error: string })[]; totalCents: number; count: number } | { kind: "ship"; ids: string[] }>(null);
  const [run, setRun] = useState<null | { title: string; total: number; done: number; results: Row[]; running: boolean }>(null);
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return queue.filter((o) => {
      if (filter === "needs" && o.web?.labelUrl) return false;
      if (filter === "has" && !o.web?.labelUrl) return false;
      if (!t) return true;
      return `${o.number} ${o.web?.shipTo?.name ?? ""} ${o.customer} ${o.web?.email ?? ""}`.toLowerCase().includes(t);
    });
  }, [queue, filter, q]);
  // Selection never keeps orders that left the queue (shipped, canceled...).
  useEffect(() => {
    setSel((cur) => {
      const ids = new Set(queue.map((o) => o.id));
      const next = new Set([...cur].filter((id) => ids.has(id)));
      return next.size === cur.size ? cur : next;
    });
  }, [queue]);

  // Queue order (oldest paid first), whatever order things were ticked in.
  const picked = queue.filter((o) => sel.has(o.id));
  const allShown = shown.length > 0 && shown.every((o) => sel.has(o.id));
  const toggle = (id: string) => setSel((cur) => {
    const n = new Set(cur);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const toggleAll = () => setSel((cur) => {
    const n = new Set(cur);
    if (allShown) shown.forEach((o) => n.delete(o.id));
    else shown.forEach((o) => n.add(o.id));
    return n;
  });
  const needLabel = picked.filter((o) => !o.web?.labelUrl);
  const withLabel = picked.filter((o) => !!o.web?.labelUrl);

  async function startBuy() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await api<{ rows: (Row & { carrier: string; service: string; error: string })[]; totalCents: number; count: number }>("/api/ship/bulk", "POST", { action: "quote", ids: picked.map((o) => o.id) });
      setConfirm({ kind: "buy", ...r });
    } catch (e) {
      toast.show({ message: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  /** One request per order so progress shows; the server refuses a second label for the same order anyway. */
  async function execute(kind: "buy" | "ship", ids: string[]) {
    setConfirm(null);
    const results: Row[] = [];
    setRun({ title: kind === "buy" ? "Buying labels" : "Marking shipped", total: ids.length, done: 0, results, running: true });
    for (const id of ids) {
      try {
        const r = await api<{ results: Row[] }>("/api/ship/bulk", "POST", { action: kind, ids: [id] });
        results.push(...r.results);
      } catch (e) {
        const o = queue.find((x) => x.id === id);
        results.push({ id, number: o?.number ?? null, ok: false, message: (e as Error).message });
      }
      setRun({ title: kind === "buy" ? "Buying labels" : "Marking shipped", total: ids.length, done: results.length, results: [...results], running: true });
    }
    setRun((x) => (x ? { ...x, running: false } : x));
    // Failed ones stay selected so they can be fixed and tried again.
    setSel(new Set(results.filter((r) => !r.ok).map((r) => r.id)));
    await s.refresh();
  }

  const openPdf = (path: string, list: OrderRec[]) => window.open(`${path}?ids=${list.map((o) => o.id).join(",")}`, "_blank", "noopener");

  if (queue.length === 0 && !run) {
    return (
      <Empty
        icon={<PackageCheck size={36} />}
        title="Nothing to ship"
        body="Paid website orders show up here, oldest first, as soon as you mark them paid."
        action={
          <Link href="/admin/orders">
            <Button variant="primary">Go to orders</Button>
          </Link>
        }
      />
    );
  }
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented<Filter> value={filter} onChange={setFilter} options={[{ value: "all", label: `All (${queue.length})` }, { value: "needs", label: "Needs label" }, { value: "has", label: "Label bought" }]} />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order #, name, email" className="min-w-0 flex-1 sm:max-w-xs" aria-label="Search the ship queue" />
      </div>
      <Card className="overflow-hidden">
        <label className="flex min-h-12 cursor-pointer items-center gap-3 border-b border-line bg-surface2/50 px-4 text-sm font-medium">
          <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--accent))]" checked={allShown} onChange={toggleAll} data-select-all aria-label="Select all orders shown" />
          Select all{shown.length !== queue.length ? ` shown (${shown.length})` : ` (${shown.length})`}
          {sel.size > 0 && <span className="ml-auto text-muted">{sel.size} selected</span>}
        </label>
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No orders match.</p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((o) => {
              const units = o.lines.reduce((n, l) => n + l.quantity, 0);
              return (
                <li key={o.id} className="flex items-center gap-3 px-4 py-3" data-ship-row={o.number}>
                  <input type="checkbox" className="h-5 w-5 shrink-0 accent-[rgb(var(--accent))]" checked={sel.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Select order ${o.number}`} />
                  <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(queue.indexOf(o))}>
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-semibold tabular-nums">#{o.number}</span>
                      <span className="truncate">{o.web?.shipTo?.name || o.customer}</span>
                    </span>
                    <span className="block truncate text-sm text-muted">
                      {plural(units, "item")} · {o.web?.shippingMethod || "Shipping"}
                    </span>
                  </button>
                  {o.web?.labelUrl ? <Badge tone="pos">Label bought</Badge> : <Badge tone="warn">Needs label</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {sel.size > 0 && (
        <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-20 mt-4 rounded-2xl border border-line bg-surface p-3 shadow-lg lg:bottom-4" data-bulk-bar>
          <div className="mb-2 px-1 text-sm font-medium">{plural(picked.length, "order")} selected</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Button variant="primary" disabled={busy || needLabel.length === 0} onClick={startBuy} data-bulk="buy">
              {busy ? "Checking prices…" : `Buy labels (${needLabel.length})`}
            </Button>
            <Button disabled={withLabel.length === 0} onClick={() => openPdf("/api/ship/labels", withLabel)} data-bulk="labels">
              <Printer size={16} /> Print labels ({withLabel.length})
            </Button>
            <Button onClick={() => openPdf("/api/ship/slips", picked)} data-bulk="slips">
              <Printer size={16} /> Packing slips ({picked.length})
            </Button>
            <Button onClick={() => setConfirm({ kind: "ship", ids: picked.map((o) => o.id) })} data-bulk="ship">
              Mark shipped ({picked.length})
            </Button>
          </div>
          {picked.length > needLabel.length && needLabel.length > 0 && <p className="mt-2 px-1 text-xs text-muted">{plural(picked.length - needLabel.length, "order")} already {picked.length - needLabel.length === 1 ? "has a label and is" : "have labels and are"} skipped when buying.</p>}
        </div>
      )}

      <Sheet open={confirm?.kind === "buy"} onClose={() => setConfirm(null)} title="Buy shipping labels">
        {confirm?.kind === "buy" && (
          <div data-bulk-confirm>
            <p className="text-[15px]">
              Buy <strong>{plural(confirm.count, "label")}</strong> for <strong className="tabular-nums">{fmtMoney(confirm.totalCents)}</strong> in total. Each one is the service the customer paid for (or the cheapest when that one isn’t offered), exactly like buying them one by one.
            </p>
            <ul className="mt-4 divide-y divide-line rounded-xl border border-line text-sm">
              {confirm.rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="font-medium tabular-nums">#{r.number}</span>
                  {r.ok ? (
                    <span className="min-w-0 flex-1 truncate text-muted">{`${r.carrier} ${r.service}`.trim()}</span>
                  ) : (
                    <span className="min-w-0 flex-1 text-neg">Skipped: {r.error}</span>
                  )}
                  <span className="shrink-0 tabular-nums">{r.ok ? fmtMoney(r.cents ?? 0) : ""}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex gap-2 pb-[env(safe-area-inset-bottom)]">
              <Button block onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button block variant="primary" disabled={confirm.count === 0} data-bulk-confirm-buy onClick={() => execute("buy", confirm.rows.filter((r) => r.ok).map((r) => r.id))}>
                Buy {plural(confirm.count, "label")} · {fmtMoney(confirm.totalCents)}
              </Button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={confirm?.kind === "ship"} onClose={() => setConfirm(null)} title="Mark shipped">
        {confirm?.kind === "ship" && (
          <div>
            <p className="text-[15px]">
              Mark {plural(confirm.ids.length, "order")} shipped. They leave the ship queue, tracking is saved, and customers who haven’t had their tracking yet are emailed (same as one by one).
            </p>
            <div className="mt-6 flex gap-2 pb-[env(safe-area-inset-bottom)]">
              <Button block onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button block variant="primary" data-bulk-confirm-ship onClick={() => execute("ship", confirm.ids)}>
                Mark {plural(confirm.ids.length, "order")} shipped
              </Button>
            </div>
          </div>
        )}
      </Sheet>

      <Sheet open={!!run} onClose={() => !run?.running && setRun(null)} title={run?.title}>
        {run && (
          <div data-bulk-results>
            <div className="h-2 overflow-hidden rounded-full bg-surface2">
              <div className="h-full bg-accent transition-all" style={{ width: `${run.total ? (run.done / run.total) * 100 : 0}%` }} />
            </div>
            <p className="mt-2 text-sm text-muted" aria-live="polite">
              {run.running ? `${run.done} of ${run.total} done…` : `Done: ${run.results.filter((r) => r.ok).length} worked, ${run.results.filter((r) => !r.ok).length} didn’t.`}
            </p>
            <ul className="mt-4 divide-y divide-line rounded-xl border border-line text-sm">
              {run.results.map((r) => (
                <li key={r.id} className="flex items-start gap-3 px-3 py-2.5" data-bulk-result={r.ok ? "ok" : "fail"}>
                  <span className={cx("mt-0.5 shrink-0 font-semibold", r.ok ? "text-pos" : "text-neg")}>{r.ok ? <Check size={16} /> : "!"}</span>
                  <span className="font-medium tabular-nums">#{r.number}</span>
                  <span className={cx("min-w-0 flex-1", r.ok ? "text-muted" : "text-neg")}>
                    {r.skipped ? "Skipped: " : r.ok ? "" : "Failed: "}
                    {r.message}
                  </span>
                  {r.cents !== undefined && <span className="shrink-0 tabular-nums">{fmtMoney(r.cents)}</span>}
                </li>
              ))}
            </ul>
            {!run.running && (
              <div className="mt-5 pb-[env(safe-area-inset-bottom)]">
                <Button block variant="primary" onClick={() => setRun(null)}>
                  {run.results.some((r) => !r.ok) ? "Close (failed orders stay selected)" : "Close"}
                </Button>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
