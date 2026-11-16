"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, ImageUp } from "lucide-react";
import type { PublicOrder } from "@/lib/store/order-view";
import { cleanError } from "./auth-panel";
import { money } from "./cart";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

function Countdown({ until, onDone }: { until: string; onDone: () => void }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => {
      const ms = new Date(until).getTime() - Date.now();
      setLeft(ms);
      if (ms <= 0) onDone();
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [until]);
  if (left === null) return <span className="tabular-nums">…</span>;
  if (left <= 0) return <span>Time is up</span>;
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return (
    <span className="tabular-nums" role="timer" aria-label={`${h} hours ${m} minutes left`}>
      {h}h {String(m).padStart(2, "0")}m {String(s).padStart(2, "0")}s
    </span>
  );
}

function CopyRow({ label, value, big }: { label: string; value: string; big?: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="min-w-0">
        <div className="text-sm text-stone">{label}</div>
        <div className={`break-all font-semibold tabular-nums ${big ? "text-3xl tracking-tight" : "text-xl"}`}>{value}</div>
      </div>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value.replace(/^[#$]/, ""));
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          } catch {}
        }}
        className="s-btn-line h-10 shrink-0 px-4 text-sm"
        aria-label={`Copy ${label.toLowerCase()}`}
      >
        {done ? <Check size={15} /> : <Copy size={15} />} {done ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function OrderStatus({ order: o, placed, reviewToken, statusText }: { order: PublicOrder; placed: boolean; reviewToken: string | null; statusText: string }) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploaded, setUploaded] = useState(o.hasScreenshot);
  const awaiting = o.status === "awaiting_payment";

  // Keep the page fresh while waiting (payment confirmed, shipped...).
  useEffect(() => {
    if (o.status === "delivered" || o.status === "canceled") return;
    const t = setInterval(() => document.visibilityState === "visible" && router.refresh(), 45000);
    return () => clearInterval(t);
  }, [o.status, router]);

  async function upload(f: File) {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", f);
      const res = await fetch(`/api/store/order/${o.token}/screenshot`, { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(cleanError(json.error) || "The upload failed. Try again.");
      setUploaded(true);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
    if (file.current) file.current.value = "";
  }

  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-14">
      <p className="text-sm font-medium text-brand">{placed && awaiting ? "Order received" : statusText}</p>
      <h1 className="mt-2 text-4xl font-semibold leading-[1.05] sm:text-5xl" style={{ letterSpacing: "-0.03em" }}>
        {placed && awaiting ? "Thank you. One step left: send your payment." : `Order #${o.number}`}
      </h1>
      <p className="mt-3 text-[15px] text-stone">
        {placed && awaiting ? `Order #${o.number} · ` : ""}Placed {when(o.placedAt)} · Updates go to {o.email}
      </p>

      <div className="mt-10 grid gap-x-16 gap-y-10 lg:grid-cols-[1.35fr_1fr]">
        <div className="min-w-0 space-y-10">
          {o.status === "canceled" && (
            <section className="rounded-2xl bg-soft p-6">
              <h2 className="text-xl font-semibold">This order was canceled</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-stone">{o.cancelReason.replace(/^Canceled:\s*/i, "Reason: ") || "It is no longer active."} If you already sent a payment, contact us and we will sort it out.</p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/shop" className="s-btn-primary">
                  Place a new order
                </Link>
                <Link href="/contact" className="s-btn-line">
                  Contact us
                </Link>
              </div>
            </section>
          )}

          {awaiting && (
            <section aria-labelledby="pay-title" className="rounded-2xl border border-coal p-5 sm:p-7">
              <h2 id="pay-title" className="text-2xl font-semibold">
                Pay with {o.pay?.name ?? o.payMethodName}
              </h2>
              <div className="mt-3 divide-y divide-rule border-y border-rule">
                <CopyRow label="Send exactly" value={money(o.totalCents)} big />
                {o.pay?.sendTo && <CopyRow label={`${o.pay.name} to`} value={o.pay.sendTo} />}
                <CopyRow label="Put your order number in the memo" value={String(o.number)} />
              </div>
              {o.pay?.note && <p className="mt-4 text-[15px] leading-relaxed">{o.pay.note}</p>}
              {o.expiresAt && (
                <p className="mt-4 text-[15px] leading-relaxed text-stone">
                  Time left to pay: <strong className="font-semibold text-coal"><Countdown until={o.expiresAt} onDone={() => router.refresh()} /></strong>. Unpaid orders are canceled automatically after that.
                </p>
              )}

              <div className="mt-6 rounded-xl bg-soft p-4">
                <div className="flex items-start gap-3">
                  <ImageUp size={22} strokeWidth={1.6} className="mt-0.5 shrink-0 text-stone" />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold !tracking-normal">{uploaded ? "Payment screenshot received" : "Upload a payment screenshot (optional)"}</h3>
                    <p className="mt-0.5 text-sm leading-relaxed text-stone">{uploaded ? "Thanks. We will confirm your payment shortly. You can replace it if you sent the wrong image." : "It helps us match your payment faster. Only our team can see it."}</p>
                    <input ref={file} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                    <button type="button" className="s-btn-dark mt-3 h-10 px-4 text-sm" disabled={busy} onClick={() => file.current?.click()}>
                      {busy ? "Uploading…" : uploaded ? "Replace screenshot" : "Choose image"}
                    </button>
                    {error && (
                      <p className="s-error" role="alert">
                        {error}
                      </p>
                    )}
                  </div>
                </div>
              </div>
              <p className="mt-4 text-sm text-stone">These instructions were also emailed to you with a link back to this page.</p>
            </section>
          )}

          {o.tracking && o.status !== "canceled" && (
            <section className="rounded-2xl bg-soft p-6">
              <h2 className="text-xl font-semibold">Tracking</h2>
              <p className="mt-1 text-sm text-stone">{o.tracking.carrier || "Carrier"} tracking number</p>
              <p className="break-all text-2xl font-semibold tabular-nums tracking-tight">{o.tracking.number}</p>
              {o.tracking.url && (
                <a href={o.tracking.url} target="_blank" rel="noreferrer" className="s-btn-primary mt-4">
                  Track your package
                </a>
              )}
              <p className="mt-3 text-[13px] text-stone">Tracking can take up to 24 hours to show movement after the label is created.</p>
            </section>
          )}

          {reviewToken && (
            <section className="rounded-2xl border border-rule p-6">
              <h2 className="text-xl font-semibold">How was your order?</h2>
              <p className="mt-1 text-[15px] text-stone">Tell us about shipping speed, packaging and service.</p>
              <Link href={`/review/${reviewToken}`} className="s-btn-dark mt-4">
                Leave a review
              </Link>
            </section>
          )}

          {o.status !== "canceled" && (
            <section aria-label="Order progress">
              <h2 className="text-xl font-semibold">Progress</h2>
              <ol className="mt-5">
                {o.steps.map((s, i) => (
                  <li key={s.key} className="relative flex gap-4 pb-7 last:pb-0">
                    {i < o.steps.length - 1 && <span className={`absolute left-[11px] top-6 h-full w-px ${o.steps[i + 1].done ? "bg-coal" : "bg-rule"}`} aria-hidden />}
                    <span className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${s.done ? "bg-coal text-white" : s.current ? "border-2 border-brand bg-paper" : "border border-rule bg-paper"}`}>
                      {s.done ? <Check size={13} /> : s.current ? <span className="h-2 w-2 rounded-full bg-brand" /> : null}
                    </span>
                    <div className="-mt-0.5">
                      <div className={`text-[1.0625rem] ${s.done || s.current ? "font-semibold" : "text-stone"}`}>{s.label}</div>
                      <div className="text-sm text-stone">{s.done ? when(s.at) : s.current ? (s.key === "paid" ? "Waiting for your payment" : s.key === "shipped" ? "Being packed" : "On its way") : ""}</div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <aside className="h-fit rounded-2xl bg-soft p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Order #{o.number}</h2>
          <ul className="mt-4 divide-y divide-rule border-y border-rule">
            {o.lines.map((l, i) => (
              <li key={i} className="flex items-start justify-between gap-4 py-3 text-[15px]">
                <span className="min-w-0">
                  <span className="block font-medium">{l.name}</span>
                  <span className="block text-[13px] tabular-nums text-stone">
                    {l.quantity} × {money(l.unitCents)}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums">{money(l.totalCents)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-2 text-[15px]">
            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{money(o.subtotalCents)}</dd>
            </div>
            {o.discountCents > 0 && (
              <div className="flex justify-between gap-4 text-brand">
                <dt className="min-w-0 truncate">Discount{o.discountLabels.length ? ` (${o.discountLabels.join(", ")})` : ""}</dt>
                <dd className="shrink-0 tabular-nums">-{money(o.discountCents)}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="min-w-0 truncate">Shipping{o.shippingMethod ? ` (${o.shippingMethod})` : ""}</dt>
              <dd className="shrink-0 tabular-nums">{o.shippingCents > 0 ? money(o.shippingCents) : "Free"}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-rule pt-3 font-semibold">
              <dt>Total</dt>
              <dd className="text-xl tabular-nums">{money(o.totalCents)}</dd>
            </div>
          </dl>
          {o.shipTo.length > 0 && (
            <div className="mt-5 border-t border-rule pt-4 text-[15px]">
              <div className="text-sm text-stone">Shipping to</div>
              <address className="mt-1 not-italic leading-relaxed">
                {o.shipTo.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </address>
            </div>
          )}
          <p className="mt-5 border-t border-rule pt-4 text-sm text-stone">
            Need help with this order?{" "}
            <Link href="/contact" className="s-link">
              Contact us
            </Link>
            .
          </p>
        </aside>
      </div>
    </div>
  );
}
