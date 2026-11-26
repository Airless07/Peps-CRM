"use client";

// Everything you can do to an order, in one place: the main "next step" button, the Actions menu,
// and the sheets they open (Mark paid, Buy label, Mark shipped, Cancel, payment screenshot, edit address).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, Printer } from "lucide-react";
import { customerName, handOverLabel, isLocalOrder, labelsOpened, nextStep, orderTotal, rememberLabelOpened, STEP_LABEL, type NextStep } from "@/lib/admin/orders-view";
import { fmtMoney } from "@/lib/format";
import { switchBlocker, switchQuote } from "@/lib/local/rules";
import { orderTotals } from "@/lib/money";
import { isStaff, requestEmail, reviewSkipReason, staffAccounts } from "@/lib/reviews/rules";
import type { SwitchHandling } from "@/lib/types";
import { payMethod } from "@/lib/store/payments";
import { STATES } from "@/lib/store/schemas";
import type { Address, OrderRec } from "@/lib/types";
import { OrderEditSheet } from "./order-edit";
import { MoneyToPicker } from "./money-to";
import { moneyHolderOf } from "@/lib/cash";
import type { CashHolder } from "@/lib/types";
import type { RowMenuItem } from "./row-menu";
import { api, useStore } from "./store";
import { useToast } from "./toast";
import { Button, Field, Input, Select, Sheet, Textarea, Toggle, cx, useConfirm } from "./ui";

interface ActionResult {
  ok: boolean;
  message: string;
  labelUrl?: string;
}

interface Rate {
  rateId: string;
  carrier: string;
  service: string;
  cents: number;
  estimatedDays: number | null;
}

interface Actions {
  /** Run the main step for an order. */
  run: (step: Exclude<NextStep, null>, o: OrderRec) => void;
  /** Items for the Actions dropdown. */
  menu: (o: OrderRec) => RowMenuItem[];
  /** The main step, taking into account whether the label was opened on this device. */
  step: (o: OrderRec) => NextStep;
  busyId: string | null;
}

const Ctx = createContext<Actions | null>(null);
export const useOrderActions = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useOrderActions outside OrderActionsProvider");
  return c;
};

type SheetState =
  | { kind: "paid"; order: OrderRec }
  | { kind: "label"; order: OrderRec }
  | { kind: "shipped"; order: OrderRec }
  | { kind: "cancel"; order: OrderRec }
  | { kind: "screenshot"; order: OrderRec }
  | { kind: "contact"; order: OrderRec }
  | { kind: "switch"; order: OrderRec; to: "pickup" | "delivery" }
  | { kind: "moneyTo"; order: OrderRec }
  | null;

export function OrderActionsProvider({ children }: { children: React.ReactNode }) {
  const { data, ledger, refresh } = useStore();
  const toast = useToast();
  const confirm = useConfirm();
  const [sheet, setSheet] = useState<SheetState>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  useEffect(() => setOpened(labelsOpened()), []);

  const post = useCallback(
    async (o: OrderRec, payload: Record<string, unknown>, quiet = false): Promise<ActionResult | null> => {
      setBusyId(o.id);
      try {
        const r = await api<ActionResult>(`/api/orders/${o.id}/action`, "POST", payload);
        await refresh();
        if (!quiet) toast.show({ message: r.message, tone: "success", duration: 4500 });
        return r;
      } catch (e) {
        toast.show({ message: (e as Error).message, tone: "error", duration: 7000 });
        return null;
      } finally {
        setBusyId(null);
      }
    },
    [refresh, toast],
  );

  const openLabel = useCallback((o: OrderRec) => {
    if (!o.web?.labelUrl) return;
    window.open(o.web.labelUrl, "_blank", "noopener");
    rememberLabelOpened(o.id);
    setOpened(labelsOpened());
  }, []);

  const run = useCallback<Actions["run"]>(
    async (step, o) => {
      if (step === "mark-paid") setSheet({ kind: "paid", order: o });
      else if (step === "buy-label") setSheet({ kind: "label", order: o });
      else if (step === "open-label") openLabel(o);
      else if (step === "mark-shipped") {
        if (o.web?.trackingNumber) {
          const ok = await confirm({ title: `Mark order #${o.number} shipped?`, body: `Use this once the package is handed to the carrier. Tracking ${o.web.trackingNumber} is already saved.`, confirmText: "Mark shipped" });
          if (ok) await post(o, { action: "mark-shipped" });
        } else setSheet({ kind: "shipped", order: o });
      } else if (step === "mark-delivered") {
        const ok = await confirm({
          title: `Mark order #${o.number} delivered?`,
          body: "A few days later (Settings, Email) the customer gets a “How was your order?” email asking for a review. This can’t be undone.",
          confirmText: "Mark delivered",
        });
        if (ok) await post(o, { action: "mark-delivered" });
      } else if (step === "mark-ready") {
        const what = o.fulfillment === "delivery" ? "delivery" : "pickup";
        const ok = await confirm({
          title: `Mark order #${o.number} ready for ${what}?`,
          body: `The customer gets a “Your order is ready for ${what}” email.${o.status === "awaiting_payment" ? " It stays unpaid until you mark it paid when you get the money." : ""}`,
          confirmText: "Mark ready",
        });
        if (ok) await post(o, { action: "mark-ready" });
      } else if (step === "mark-handed-over") {
        const ok = await confirm({ title: `${handOverLabel(o)}: order #${o.number}?`, body: "Use this once the customer has the order.", confirmText: handOverLabel(o) });
        if (ok) await post(o, { action: "mark-handed-over" });
      }
    },
    [confirm, openLabel, post],
  );

  /** "Send review request": asks first, and shows the date with "Send again?" when one was already sent. */
  const sendReviewRequest = useCallback(
    async (o: OrderRec) => {
      const at = o.reviewRequestSentAt ?? o.web?.reviewRequestSentAt;
      const to = requestEmail(o.web?.email, (data?.customers ?? []).find((c) => c.id === o.customerId)?.email);
      const ok = await confirm(
        at
          ? {
              title: "Send again?",
              body: `A review request for order #${o.number} was already sent on ${new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}. Send another one to ${to}?`,
              confirmText: "Send again",
            }
          : { title: `Send a review request for order #${o.number}?`, body: `${to} gets the “How was your order?” email. Its links mark the review as a Verified order.`, confirmText: "Send" },
      );
      if (ok) await post(o, { action: "send-review-request", resend: !!at });
    },
    [confirm, post, data?.customers],
  );

  const markRefundPaid = useCallback(
    async (o: OrderRec) => {
      const owed = o.localSwitch?.refundOwedCents ?? 0;
      const ok = await confirm({ title: `Refund of ${fmtMoney(owed)} paid back?`, body: `Use this once you have sent ${fmtMoney(owed)} back to ${customerName(o)} for order #${o.number}.`, confirmText: "Paid back" });
      if (ok) await post(o, { action: "switch-refund-paid", by: data ? (data.settings.defaultSoldBy === "B" ? data.settings.partnerBName : data.settings.partnerAName) : "Admin" });
    },
    [confirm, post, data],
  );

  // Owner and test accounts: never asked for reviews (same rule as the server).
  const staff = useMemo(
    () => staffAccounts(data?.customers ?? [], [...(data?.orders ?? []), ...(data?.pendingOrders ?? [])], data?.store.alertEmails ?? []),
    [data?.customers, data?.orders, data?.pendingOrders, data?.store.alertEmails],
  );

  const step = useCallback<Actions["step"]>((o) => nextStep(o, opened.has(o.id)), [opened]);

  const menu = useCallback<Actions["menu"]>(
    (o) => {
      const online = o.source === "online";
      const w = o.web;
      const counted = o.status !== "awaiting_payment" && o.status !== "canceled";
      const items: RowMenuItem[] = [];
      if (online && isLocalOrder(o)) {
        // Local pickup / delivery: no labels, no tracking.
        if (o.status === "awaiting_payment") items.push({ label: "Mark paid", onSelect: () => setSheet({ kind: "paid", order: o }) });
        if (!o.readyAt && (o.status === "paid" || (o.status === "awaiting_payment" && o.payAtPickup))) items.push({ label: "Mark ready", onSelect: () => void run("mark-ready", o) });
        if (o.status === "paid" || o.status === "ready") items.push({ label: handOverLabel(o), onSelect: () => void run("mark-handed-over", o) });
      } else if (online) {
        items.push({ label: "Check tracking", onSelect: () => void post(o, { action: "check-tracking" }), disabled: !w?.trackingNumber, disabledReason: "No tracking number yet." });
        items.push({ label: "Open label", onSelect: () => openLabel(o), disabled: !w?.labelUrl, disabledReason: "No label bought yet." });
        if (o.status === "paid" || o.status === "label_purchased") {
          items.push({ label: w?.labelUrl ? "Mark shipped" : "Mark shipped (own postage)", onSelect: () => setSheet({ kind: "shipped", order: o }) });
        }
      }
      // Shipped-type order with no label yet: can become a local order (hidden once a label exists).
      const labelCount = (data?.labels ?? []).filter((l) => l.orderId === o.id).length;
      if (online && !o.archived && !switchBlocker({ ...o, labelUrl: w?.labelUrl ?? "", labels: labelCount })) {
        items.push({ label: "Switch to local delivery", onSelect: () => setSheet({ kind: "switch", order: o, to: "delivery" }) });
        items.push({ label: "Switch to local pickup", onSelect: () => setSheet({ kind: "switch", order: o, to: "pickup" }) });
      }
      if (o.localSwitch && o.localSwitch.refundOwedCents > 0 && !o.localSwitch.refundPaidAt) {
        items.push({ label: `Mark refund paid back (${fmtMoney(o.localSwitch.refundOwedCents)})`, onSelect: () => void markRefundPaid(o) });
      }
      // Review request: the customer has the order (paid and shipped / delivered / picked up, or a completed
      // in-person sale), has an email (order or customer record), not an owner order or account, not canceled
      // or refunded, no review yet. Same rule as the server (src/lib/reviews/rules.ts).
      const reviewEmail = requestEmail(w?.email, (data?.customers ?? []).find((c) => c.id === o.customerId)?.email);
      const reviewSkip = reviewSkipReason(
        {
          source: o.source,
          status: o.status,
          owner: o.owner,
          paid: !!w?.paidAt,
          canceled: !!w?.canceledAt,
          refundedCents: o.refundedCents ?? 0,
          reviewed: (data?.reviews ?? []).some((r) => r.orderId === o.id),
          asked: !!(o.reviewRequestSentAt ?? w?.reviewRequestSentAt),
          email: reviewEmail,
          staff: isStaff(staff, o.customerId, reviewEmail),
        },
        { ignoreAsked: true },
      );
      if (!reviewSkip) {
        items.push({ label: "Send review request", onSelect: () => void sendReviewRequest(o) });
      }
      // Who received the money (Cash held). In person: any sale. Website: once paid, not canceled.
      if (!online || (w?.paidAt && o.status !== "canceled")) {
        items.push({ label: "Money received by…", onSelect: () => setSheet({ kind: "moneyTo", order: o }) });
      }
      items.push({ label: "Print packing slip", onSelect: () => void window.open(`/admin/print/${o.id}`, "_blank", "noopener") });
      if (online) {
        items.push({ label: "View payment screenshot", onSelect: () => setSheet({ kind: "screenshot", order: o }), disabled: !w?.hasScreenshot, disabledReason: "The customer has not uploaded one." });
      }
      if (counted) items.push({ label: "Edit", onSelect: () => setEditId(o.id) });
      else if (o.status === "awaiting_payment") items.push({ label: "Edit address", onSelect: () => setSheet({ kind: "contact", order: o }) });
      if (online && o.status !== "canceled") {
        items.push({ label: "Cancel order", danger: true, onSelect: () => setSheet({ kind: "cancel", order: o }), disabled: o.status === "delivered" || o.status === "picked_up", disabledReason: "Completed orders can’t be canceled." });
      }
      items.push(o.archived ? { label: "Move back to orders", onSelect: () => void post(o, { action: "unarchive" }) } : { label: "Archive", onSelect: () => void post(o, { action: "archive" }) });
      return items;
    },
    [openLabel, post, run, data?.labels, data?.reviews, data?.customers, staff, markRefundPaid, sendReviewRequest],
  );

  const value = useMemo(() => ({ run, menu, step, busyId }), [run, menu, step, busyId]);
  const close = () => setSheet(null);
  // Always show the freshest copy of the order the sheet is about.
  const live = (o: OrderRec) => [...(data?.orders ?? []), ...(data?.pendingOrders ?? [])].find((x) => x.id === o.id) ?? o;

  return (
    <Ctx.Provider value={value}>
      {children}
      {data && ledger && (
        <>
          <MarkPaidSheet order={sheet?.kind === "paid" ? live(sheet.order) : null} total={sheet?.kind === "paid" ? orderTotal(sheet.order, ledger) : 0} methods={data.settings.paymentMethods} onClose={close} post={post} />
          <LabelSheet order={sheet?.kind === "label" ? live(sheet.order) : null} onClose={close} post={post} onOpenLabel={openLabel} />
          <ShippedSheet order={sheet?.kind === "shipped" ? live(sheet.order) : null} onClose={close} post={post} />
          <CancelSheet order={sheet?.kind === "cancel" ? live(sheet.order) : null} onClose={close} post={post} />
          <ContactSheet order={sheet?.kind === "contact" ? live(sheet.order) : null} onClose={close} post={post} />
          <MoneyToSheet order={sheet?.kind === "moneyTo" ? live(sheet.order) : null} onClose={close} post={post} />
          <SwitchLocalSheet
            order={sheet?.kind === "switch" ? live(sheet.order) : null}
            to={sheet?.kind === "switch" ? sheet.to : "delivery"}
            local={data.store.local}
            partners={[data.settings.partnerAName, data.settings.partnerBName]}
            defaultBy={data.settings.defaultSoldBy === "B" ? data.settings.partnerBName : data.settings.partnerAName}
            onClose={close}
            post={post}
          />
          <Sheet open={sheet?.kind === "screenshot"} onClose={close} title={sheet ? `Payment screenshot · #${sheet.order.number}` : ""} wide>
            {sheet?.kind === "screenshot" && (
              <div className="space-y-4">
                <p className="text-sm text-muted">
                  Match it against your payment app: <strong className="text-ink">{fmtMoney(orderTotal(sheet.order, ledger))}</strong> from {customerName(sheet.order)}, memo {sheet.order.number}.
                </p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/orders/${sheet.order.id}/screenshot`} alt={`Payment screenshot for order ${sheet.order.number}`} className="mx-auto max-h-[70dvh] rounded-xl border border-line" />
                {sheet.order.status === "awaiting_payment" && (
                  <Button variant="primary" block size="lg" onClick={() => setSheet({ kind: "paid", order: sheet.order })}>
                    Mark paid
                  </Button>
                )}
              </div>
            )}
          </Sheet>
          <OrderEditSheet orderId={editId} onClose={() => setEditId(null)} />
        </>
      )}
    </Ctx.Provider>
  );
}

type Post = (o: OrderRec, payload: Record<string, unknown>, quiet?: boolean) => Promise<ActionResult | null>;

/** The main button for a row or page. Renders nothing when there is no next step. */
export function StepButton({ order, size = "sm", block, className }: { order: OrderRec; size?: "sm" | "md" | "lg"; block?: boolean; className?: string }) {
  const { run, step, busyId } = useOrderActions();
  const s = step(order);
  if (!s) return null;
  return (
    <Button
      variant="primary"
      size={size}
      block={block}
      className={className}
      disabled={busyId === order.id}
      onClick={(e) => {
        e.stopPropagation();
        run(s, order);
      }}
    >
      {s === "open-label" && <ExternalLink size={15} />}
      {busyId === order.id ? "Working…" : s === "mark-handed-over" ? handOverLabel(order) : STEP_LABEL[s]}
    </Button>
  );
}

// ---------------------------------------------------------------- Mark paid
function MarkPaidSheet({ order, total, methods, onClose, post }: { order: OrderRec | null; total: number; methods: string[]; onClose: () => void; post: Post }) {
  const [method, setMethod] = useState("");
  const [notify, setNotify] = useState(true);
  const [short, setShort] = useState<{ name: string; need: number; have: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const picked = order ? payMethod(order.web?.payChoice ?? "")?.saleName ?? order.paymentMethod : "";
  const options = useMemo(() => [...new Set([picked, ...methods].filter((m) => m && m !== "Unknown"))], [picked, methods]);

  useEffect(() => {
    if (!order) return;
    setMethod(picked && picked !== "Unknown" ? picked : methods[0] ?? "Zelle");
    setNotify(true);
    setShort([]);
    api<{ shortfalls: typeof short }>(`/api/orders/${order.id}/detail`)
      .then((d) => setShort(d.shortfalls))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  return (
    <Sheet
      open={!!order}
      onClose={onClose}
      title="Mark paid"
      footer={
        <div className="flex gap-2">
          <Button block onClick={onClose}>
            Not yet
          </Button>
          <Button
            block
            variant="primary"
            disabled={busy}
            onClick={async () => {
              if (!order) return;
              setBusy(true);
              const r = await post(order, { action: "mark-paid", paymentMethod: method, notify });
              setBusy(false);
              if (r) onClose();
            }}
          >
            {busy ? "Saving…" : "Payment received"}
          </Button>
        </div>
      }
    >
      {order && (
        <div className="space-y-5">
          <p className="text-sm text-muted">Check your payment app for this exact payment, then confirm.</p>
          <div className="rounded-2xl border border-line bg-bg px-5 py-5 text-center">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted">Order</div>
            <div className="text-4xl font-bold tabular-nums tracking-tight">#{order.number}</div>
            <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted">From</div>
            <div className="text-xl font-semibold">{customerName(order)}</div>
            <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted">Exact amount</div>
            <div className="text-5xl font-bold tabular-nums tracking-tight text-accent">{fmtMoney(total)}</div>
            <div className="mt-3 text-sm text-muted">The memo should say {order.number}.</div>
          </div>
          {short.length > 0 && (
            <div className="flex gap-3 rounded-xl bg-warn/12 px-4 py-3 text-sm text-warn">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div>
                <strong>Not enough stock.</strong>{" "}
                {short.map((s) => `${s.name}: order needs ${s.need}, you have ${s.have}`).join(". ")}. You can still mark it paid: stock will go below zero until you restock.
              </div>
            </div>
          )}
          <Field label="Paid with" hint="Saved on the sale, like on the Sell screen.">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {options.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Toggle checked={notify} onChange={setNotify} label="Email the customer" hint="Sends “Payment confirmed”. Turn off only if you already told them." />
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- Buy label
function LabelSheet({ order, onClose, post, onOpenLabel }: { order: OrderRec | null; onClose: () => void; post: Post; onOpenLabel: (o: OrderRec) => void }) {
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [info, setInfo] = useState<{ paidShippingCents: number; shippingMethod: string; parcel: { weightOz: number; lengthIn: number; widthIn: number; heightIn: number } } | null>(null);
  const [rateId, setRateId] = useState<string>("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [bought, setBought] = useState<ActionResult | null>(null);

  const load = useCallback(async (o: OrderRec) => {
    setRates(null);
    setError("");
    setBought(null);
    try {
      const r = await api<{ rates: Rate[]; suggestedRateId: string | null } & NonNullable<typeof info>>(`/api/orders/${o.id}/rates`);
      setRates(r.rates);
      setInfo(r);
      setRateId(r.suggestedRateId ?? r.rates[0]?.rateId ?? "");
    } catch (e) {
      setError((e as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (order) load(order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  const chosen = rates?.find((r) => r.rateId === rateId);
  return (
    <Sheet
      open={!!order}
      onClose={onClose}
      title={order ? `Buy shipping label · #${order.number}` : ""}
      footer={
        bought ? (
          <div className="flex gap-2">
            <Button block onClick={onClose}>
              Done
            </Button>
            <Button block variant="primary" onClick={() => order && onOpenLabel({ ...order, web: order.web ? { ...order.web, labelUrl: bought.labelUrl ?? order.web.labelUrl } : order.web })}>
              <Printer size={17} /> Open label to print
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button block onClick={onClose}>
              Cancel
            </Button>
            <Button
              block
              variant="primary"
              disabled={!chosen || busy}
              onClick={async () => {
                if (!order || !chosen) return;
                setBusy(true);
                const r = await post(order, { action: "buy-label", rateId: chosen.rateId }, true);
                setBusy(false);
                if (r) setBought(r);
              }}
            >
              {busy ? "Buying…" : chosen ? `Buy label · ${fmtMoney(chosen.cents)}` : "Buy label"}
            </Button>
          </div>
        )
      }
    >
      {order && (
        <div className="space-y-4">
          {bought ? (
            <div className="rounded-2xl bg-pos/10 px-4 py-4 text-[15px]">
              <div className="font-semibold text-pos">Label bought</div>
              <p className="mt-1 text-muted">{bought.message} Tracking was saved and emailed to the customer. The cost was recorded as a shipping expense.</p>
            </div>
          ) : error ? (
            <div className="rounded-2xl bg-neg/10 px-4 py-4 text-[15px] text-neg">
              <div className="font-semibold">Couldn’t load label prices</div>
              <p className="mt-1">{error}</p>
              <p className="mt-2 text-muted">Shipping with your own postage? Close this and use Actions, then “Mark shipped (own postage)” to enter the tracking number.</p>
              <Button className="mt-3" size="sm" onClick={() => load(order)}>
                Try again
              </Button>
            </div>
          ) : !rates ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-shimmer rounded-xl bg-surface2" />
              ))}
              <p className="text-sm text-muted">Getting live prices from Shippo…</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted">
                Customer chose <strong className="text-ink">{info?.shippingMethod || "shipping"}</strong> and paid <strong className="text-ink">{info && info.paidShippingCents > 0 ? fmtMoney(info.paidShippingCents) : "nothing (free shipping)"}</strong>. Parcel: {info?.parcel.weightOz} oz,{" "}
                {info?.parcel.lengthIn} × {info?.parcel.widthIn} × {info?.parcel.heightIn} in.
              </p>
              <div role="radiogroup" aria-label="Label price" className="space-y-2">
                {rates.map((r) => (
                  <button
                    key={r.rateId}
                    type="button"
                    role="radio"
                    aria-checked={rateId === r.rateId}
                    onClick={() => setRateId(r.rateId)}
                    className={cx("flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition", rateId === r.rateId ? "border-accent bg-accent/8 ring-1 ring-accent" : "border-line hover:bg-surface2")}
                  >
                    <span className={cx("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2", rateId === r.rateId ? "border-accent" : "border-line")}>
                      {rateId === r.rateId && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {r.carrier} {r.service}
                      </span>
                      {r.estimatedDays && <span className="block text-sm text-muted">About {r.estimatedDays} business day{r.estimatedDays === 1 ? "" : "s"}</span>}
                    </span>
                    <span className="font-semibold tabular-nums">{fmtMoney(r.cents)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

// ---------------------------------------------------------------- Mark shipped (own postage)
function ShippedSheet({ order, onClose, post }: { order: OrderRec | null; onClose: () => void; post: Post }) {
  const [tracking, setTracking] = useState("");
  const [carrier, setCarrier] = useState("USPS");
  useEffect(() => {
    setTracking(order?.web?.trackingNumber ?? "");
    setCarrier(order?.web?.trackingCarrier || "USPS");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);
  return (
    <Sheet
      open={!!order}
      onClose={onClose}
      title={order ? `Mark shipped · #${order.number}` : ""}
      footer={
        <div className="flex gap-2">
          <Button block onClick={onClose}>
            Cancel
          </Button>
          <Button
            block
            variant="primary"
            onClick={async () => {
              if (!order) return;
              onClose();
              await post(order, { action: "mark-shipped", trackingNumber: tracking, carrier });
            }}
          >
            Mark shipped
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Tracking number (optional)" hint="Without one, the customer gets no tracking link.">
          <Input value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="9400 1000 0000 0000 0000 00" autoCapitalize="characters" />
        </Field>
        <Field label="Carrier">
          <Select value={carrier} onChange={(e) => setCarrier(e.target.value)}>
            {["USPS", "UPS", "FedEx", "DHL", "Other"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <p className="text-sm text-muted">The customer is emailed that the order shipped{tracking ? ", with tracking" : ""}.</p>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Cancel
/** Change who received the money: Ahmad, Mo or Bank. Moves Cash held only. */
function MoneyToSheet({ order, onClose, post }: { order: OrderRec | null; onClose: () => void; post: Post }) {
  const [to, setTo] = useState<CashHolder | null>(null);
  useEffect(() => {
    // Starts on what the order has now (an older in-person sale with nothing recorded: nothing picked).
    setTo(order ? (order.source === "inperson" ? order.cashTo ?? null : moneyHolderOf(order)) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);
  return (
    <Sheet
      open={!!order}
      onClose={onClose}
      title={order ? `Money received by · #${order.number}` : ""}
      footer={
        <Button
          variant="primary"
          size="lg"
          block
          disabled={!to}
          data-money-to-save
          onClick={async () => {
            if (!order || !to) return;
            onClose();
            await post(order, { action: "money-to", to });
          }}
        >
          Save
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-[15px] text-muted">Who has this money now. Only changes Cash held on the Money page: business money, payback, profit and the split stay the same. The change is saved in the order history.</p>
        <MoneyToPicker value={to} onChange={setTo} />
      </div>
    </Sheet>
  );
}

function CancelSheet({ order, onClose, post }: { order: OrderRec | null; onClose: () => void; post: Post }) {
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  useEffect(() => {
    setReason("");
    setNotify(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);
  const paid = order && order.status !== "awaiting_payment";
  return (
    <Sheet
      open={!!order}
      onClose={onClose}
      title={order ? `Cancel order #${order.number}?` : ""}
      footer={
        <div className="flex gap-2">
          <Button block onClick={onClose}>
            Keep order
          </Button>
          <Button
            block
            variant="danger"
            onClick={async () => {
              if (!order) return;
              onClose();
              await post(order, { action: "cancel", reason, notify });
            }}
          >
            Cancel order
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-[15px] text-muted">
          {paid
            ? "This order was already paid. Canceling takes it out of sales: stock is returned and the money math no longer counts it. Refund the customer yourself in your payment app."
            : "The order was never paid, so stock and money are not affected."}{" "}
          The order stays in the list as Canceled.
        </p>
        <Field label="Reason (the customer sees this)">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: out of stock" maxLength={200} />
        </Field>
        <Toggle checked={notify} onChange={setNotify} label="Email the customer" hint="Tells them the order was canceled and why." />
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Edit contact + address
function ContactSheet({ order, onClose, post }: { order: OrderRec | null; onClose: () => void; post: Post }) {
  const blank: Address = { name: "", street1: "", street2: "", city: "", state: "", zip: "", country: "US" };
  const [a, setA] = useState<Address>(blank);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  useEffect(() => {
    setA(order?.web?.shipTo ?? blank);
    setEmail(order?.web?.email ?? "");
    setPhone(order?.web?.phone ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);
  const set = (k: keyof Address, v: string) => setA((x) => ({ ...x, [k]: v }));
  return (
    <Sheet
      open={!!order}
      onClose={onClose}
      title={order ? `Edit address · #${order.number}` : ""}
      footer={
        <div className="flex gap-2">
          <Button block onClick={onClose}>
            Cancel
          </Button>
          <Button
            block
            variant="primary"
            onClick={async () => {
              if (!order) return;
              const r = await post(order, { action: "contact", email, phone, shipTo: a });
              if (r) onClose();
            }}
          >
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Phone (optional)">
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <Field label="Full name">
          <Input value={a.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Street address">
          <Input value={a.street1} onChange={(e) => set("street1", e.target.value)} />
        </Field>
        <Field label="Apartment, suite (optional)">
          <Input value={a.street2} onChange={(e) => set("street2", e.target.value)} />
        </Field>
        <div className="grid grid-cols-[1fr_5.5rem_6.5rem] gap-3">
          <Field label="City">
            <Input value={a.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="State">
            <Select value={a.state} onChange={(e) => set("state", e.target.value)}>
              <option value="">–</option>
              {STATES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
          <Field label="ZIP">
            <Input inputMode="numeric" value={a.zip} onChange={(e) => set("zip", e.target.value)} />
          </Field>
        </div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Switch to local pickup / delivery
const PAID_HANDLING: { id: SwitchHandling; label: string; hint: string }[] = [
  { id: "credit", label: "Refund difference as store credit", hint: "Added to the customer’s store credit now. The order keeps what was paid." },
  { id: "refund_owed", label: "Mark refund owed (I’ll pay it back myself)", hint: "The order’s charge drops to the local fee. Mark it paid back from Actions once sent." },
  { id: "keep", label: "Keep it", hint: "Nothing is given back. The order keeps the shipping charged." },
];

interface SwitchLocalProps {
  order: OrderRec | null;
  to: "pickup" | "delivery";
  local: { pickup: { name: string; street1: string; city: string; state: string; zip: string; instructions: string }; delivery: { enabled: boolean; feeCents: number; freeOverCents: number | null }; windows: string[] };
  partners: string[];
  defaultBy: string;
  onClose: () => void;
  post: Post;
}

function SwitchLocalSheet({ order, to, local, partners, defaultBy, onClose, post }: SwitchLocalProps) {
  const blank: Address = { name: "", street1: "", street2: "", city: "", state: "", zip: "", country: "US" };
  const [a, setA] = useState<Address>(blank);
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [handling, setHandling] = useState<SwitchHandling>("credit");
  const [notify, setNotify] = useState(true);
  const [by, setBy] = useState(defaultBy);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!order) return;
    setA(order.web?.shipTo ?? blank);
    setTime(order.localTime ?? "");
    setNote("");
    setNotify(true);
    setBy(defaultBy);
    setHandling(order.status === "awaiting_payment" ? "lower" : order.customerId ? "credit" : "refund_owed");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, to]);

  const what = to === "pickup" ? "local pickup" : "local delivery";
  const t = order ? orderTotals(order) : null;
  const charged = order?.shippingCents ?? 0;
  const q = switchQuote(local, { shippingCents: charged, merchandiseCents: t ? t.subtotal - t.discount : 0 }, to);
  const unpaid = order?.status === "awaiting_payment";
  const spotReady = !!(local.pickup.name.trim() && local.pickup.street1.trim() && local.pickup.city.trim());
  const set = (k: keyof Address, v: string) => setA((x) => ({ ...x, [k]: v }));
  const options = unpaid
    ? [
        { id: "lower" as const, label: "Lower the total to pay", hint: `Not paid yet: the customer pays ${fmtMoney((t?.total ?? 0) - q.diffCents)} instead of ${fmtMoney(t?.total ?? 0)}.` },
        { id: "keep" as const, label: "Keep it", hint: "The total to pay stays the same." },
      ]
    : PAID_HANDLING.filter((x) => x.id !== "credit" || !!order?.customerId);

  return (
    <Sheet
      open={!!order}
      onClose={onClose}
      title={order ? `Switch #${order.number} to ${what}` : ""}
      footer={
        <div className="flex gap-2">
          <Button block onClick={onClose}>
            Cancel
          </Button>
          <Button
            block
            variant="primary"
            disabled={busy || (to === "pickup" && !spotReady)}
            onClick={async () => {
              if (!order) return;
              setBusy(true);
              const r = await post(order, {
                action: "switch-local",
                to,
                ...(to === "delivery" ? { address: a } : {}),
                localTime: time,
                note,
                handling: q.diffCents > 0 ? handling : "keep",
                notify,
                by,
                expectedShippingCents: charged,
              });
              setBusy(false);
              if (r) onClose();
            }}
          >
            {busy ? "Saving…" : `Switch to ${what}`}
          </Button>
        </div>
      }
    >
      {order && (
        <div className="space-y-4" data-switch-local>
          <p className="text-sm text-muted">The order leaves the ship queue, never offers Buy label, and shows in the Local tab.</p>
          {to === "delivery" ? (
            <>
              <Field label="Deliver to">
                <Input value={a.street1} onChange={(e) => set("street1", e.target.value)} placeholder="Street address" />
              </Field>
              <Field label="Apartment, suite (optional)">
                <Input value={a.street2} onChange={(e) => set("street2", e.target.value)} />
              </Field>
              <div className="grid grid-cols-[1fr_5.5rem_6.5rem] gap-3">
                <Field label="City">
                  <Input value={a.city} onChange={(e) => set("city", e.target.value)} />
                </Field>
                <Field label="State">
                  <Select value={a.state} onChange={(e) => set("state", e.target.value)}>
                    <option value="">–</option>
                    {STATES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="ZIP">
                  <Input inputMode="numeric" value={a.zip} onChange={(e) => set("zip", e.target.value)} />
                </Field>
              </div>
            </>
          ) : spotReady ? (
            <div className="rounded-xl bg-surface2/70 px-4 py-3 text-sm">
              <div className="font-medium">Pickup spot</div>
              <div>{local.pickup.name}</div>
              <div className="text-muted">{[local.pickup.street1, `${local.pickup.city}, ${local.pickup.state} ${local.pickup.zip}`].join(", ")}</div>
              {local.pickup.instructions && <div className="mt-1 text-muted">{local.pickup.instructions}</div>}
            </div>
          ) : (
            <div className="flex gap-3 rounded-xl bg-warn/12 px-4 py-3 text-sm text-warn">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" />
              <div>Add the pickup spot (name, street and city) in Settings, Local orders first.</div>
            </div>
          )}
          <Field label="Preferred time (optional)">
            {local.windows.length ? (
              <Select value={time} onChange={(e) => setTime(e.target.value)}>
                <option value="">Not set</option>
                {[...new Set([...(time && !local.windows.includes(time) ? [time] : []), ...local.windows])].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
            ) : (
              <Input value={time} maxLength={60} onChange={(e) => setTime(e.target.value)} placeholder="e.g. Tuesday evening" />
            )}
          </Field>
          <Field label="Note for the customer (optional)" hint="Shown in the email.">
            <Textarea value={note} maxLength={500} rows={2} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="rounded-xl border border-line px-4 py-3 text-sm tabular-nums" data-switch-amounts>
            <div className="flex justify-between gap-3">
              <span>Shipping charged{order.web?.shippingMethod ? ` (${order.web.shippingMethod})` : ""}</span>
              <span>{fmtMoney(charged)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>{to === "pickup" ? "Local pickup" : "Local delivery fee"}</span>
              <span>{q.feeCents > 0 ? fmtMoney(q.feeCents) : "Free"}</span>
            </div>
            <div className="mt-1 flex justify-between gap-3 border-t border-line pt-1 font-semibold">
              <span>Difference</span>
              <span>{fmtMoney(q.diffCents)}</span>
            </div>
          </div>
          {q.diffCents > 0 && (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">What to do with the {fmtMoney(q.diffCents)}</legend>
              {options.map((x) => (
                <label key={x.id} className={cx("flex cursor-pointer gap-3 rounded-xl border px-4 py-3", handling === x.id ? "border-accent bg-accent/5" : "border-line")}>
                  <input type="radio" name="switch-handling" className="mt-1" checked={handling === x.id} onChange={() => setHandling(x.id)} />
                  <span>
                    <span className="block text-sm font-medium">{x.label}</span>
                    <span className="block text-xs text-muted">{x.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <Field label="Changed by">
            <Select value={by} onChange={(e) => setBy(e.target.value)}>
              {[...new Set(partners.filter(Boolean))].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </Field>
          <Toggle checked={notify} onChange={setNotify} label="Email the customer about the change" hint={`Sends “Your order #${order.number} ${to === "pickup" ? "is set for local pickup" : "will be delivered locally"}”.`} />
        </div>
      )}
    </Sheet>
  );
}
