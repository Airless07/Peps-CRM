"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { api, useLoaded } from "@/components/store";
import { Badge, Card, Empty, PageHeader, PageSkeleton, cx } from "@/components/ui";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { orderTotals } from "@/lib/money";
import { referralSummary, referralUses, type UseStatus } from "@/lib/referral-stats";
import { STATUS_LABEL } from "@/lib/types";

const TONE: Record<UseStatus, "warn" | "pos" | "neg"> = { Pending: "warn", Available: "pos", Reversed: "neg" };

/** One code owner: every order that used their code (full buyer details, admin only), code history and ledger. */
export default function ReferralDetailPage() {
  const { id } = useParams<{ id: string }>();
  const s = useLoaded();
  const [changes, setChanges] = useState<{ id: string; oldCode: string; newCode: string; by: string; at: string }[] | null>(null);
  useEffect(() => {
    api<{ changes: NonNullable<typeof changes> }>(`/api/referrals/${id}`)
      .then((r) => setChanges(r.changes))
      .catch(() => setChanges([]));
  }, [id, s?.data.customers]);

  if (!s) return <PageSkeleton />;
  const c = s.data.customers.find((x) => x.id === id);
  if (!c) return <Empty title="Customer not found" body="They may have been merged or deleted." />;
  const sum = referralSummary(s.data, c.id);
  const uses = referralUses(s.data, c.id);
  const ledger = (s.data.creditEntries ?? []).filter((e) => e.customerId === c.id);
  const code = c.referralCodeDisplay || c.referralCode || "";

  return (
    <div data-admin-referral-detail>
      <Link href="/admin/referrals" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft size={16} /> Referrals
      </Link>
      <PageHeader
        title={c.name}
        sub={
          <>
            Code <span className="font-mono font-semibold text-ink">{code}</span>
            {c.email ? ` · ${c.email}` : ""} ·{" "}
            <Link href={`/admin/customers?open=${c.id}`} className="underline underline-offset-4">
              customer page (change code, credit)
            </Link>
          </>
        }
      />
      {sum.negative && (
        <p className="mb-4 rounded-xl bg-neg/10 px-4 py-3 text-sm font-medium text-neg" data-negative-flag>
          Negative balance ({fmtMoney(sum.balanceCents)}): referral credit was reversed after it was spent. Future credit pays it off first; they can&apos;t spend until it is positive.
        </p>
      )}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Uses", String(sum.uses)],
          ["Earned (all time)", fmtMoney(sum.earnedCents)],
          ["Pending", fmtMoney(sum.pendingCents)],
          ["Available balance", fmtMoney(sum.balanceCents)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-line bg-surface px-4 py-3">
            <div className="text-xs text-muted">{label}</div>
            <div className={cx("mt-0.5 text-lg font-semibold tabular-nums", label === "Available balance" && sum.negative && "text-neg")}>{value}</div>
          </div>
        ))}
      </div>

      <h2 className="mb-2 text-base font-semibold">Orders that used this code</h2>
      {uses.length === 0 ? (
        <p className="mb-6 text-sm text-muted">No orders yet.</p>
      ) : (
        <Card className="mb-6 divide-y divide-line overflow-hidden p-0" data-referral-uses>
          {uses.map(({ order: o, creditCents, status }) => {
            const t = orderTotals(o);
            return (
              <Link key={o.id} href={`/admin/orders/${o.id}`} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-surface2/60" data-referral-use={o.number ?? o.id}>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    #{o.number ?? "—"} · {o.customer || "Guest"}
                    {o.web?.email ? <span className="font-normal text-muted"> · {o.web.email}</span> : null}
                  </div>
                  <div className="text-xs text-muted">
                    {fmtDateTime(o.date)} · {STATUS_LABEL[o.status]} · total {fmtMoney(t.total)}
                    {o.referralCode ? ` · code used ${o.referralCode}` : ""}
                    {o.referralRatePct != null ? ` · ${o.referralRatePct}%` : ""}
                    {(o.refundedCents ?? 0) > 0 ? ` · refunded ${fmtMoney(o.refundedCents!)}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={TONE[status]}>{status}</Badge>
                  <span className="font-semibold tabular-nums">{fmtMoney(creditCents)}</span>
                </div>
              </Link>
            );
          })}
        </Card>
      )}

      <h2 className="mb-2 text-base font-semibold">Code history</h2>
      <Card className="mb-6 p-0" data-code-history>
        {changes === null ? (
          <p className="px-4 py-3 text-sm text-muted">Loading…</p>
        ) : changes.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted">Never changed. Current code {code}.</p>
        ) : (
          <ul className="divide-y divide-line">
            {changes.map((ch) => (
              <li key={ch.id} className="px-4 py-2.5 text-sm">
                <span className="font-mono">{ch.oldCode || "—"}</span> → <span className="font-mono font-semibold">{ch.newCode}</span>
                <span className="text-xs text-muted">
                  {" "}
                  · {fmtDateTime(ch.at)} · {ch.by || "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <h2 className="mb-2 text-base font-semibold">Store credit ledger</h2>
      {ledger.length === 0 ? (
        <p className="text-sm text-muted">No entries.</p>
      ) : (
        <Card className="divide-y divide-line overflow-hidden p-0" data-referral-ledger>
          {ledger.map((e) => (
            <div key={e.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">
                  {e.reason || e.kind}
                  {e.pending && (
                    <span className="ml-1.5 align-middle">
                      <Badge tone="warn">Pending</Badge>
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted">
                  {fmtDateTime(e.date)}
                  {e.orderNumber ? ` · order #${e.orderNumber}` : ""}
                  {e.by ? ` · ${e.by}` : ""} · {e.kind}
                </div>
              </div>
              <div className={cx("shrink-0 font-semibold tabular-nums", e.amountCents < 0 ? "text-neg" : "text-pos")}>{fmtMoney(e.amountCents, { sign: true })}</div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
