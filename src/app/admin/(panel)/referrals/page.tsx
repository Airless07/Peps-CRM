"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, Share2 } from "lucide-react";
import { useLoaded } from "@/components/store";
import { Empty, Input, PageHeader, PageSkeleton, Segmented, cx } from "@/components/ui";
import { fmtMoney, plural } from "@/lib/format";
import { referralSummary } from "@/lib/referral-stats";

type Sort = "uses" | "earned" | "pending" | "available" | "name";

/** Every code owner with their numbers. Search by name, email or code; sort by any number. */
export default function ReferralsPage() {
  const s = useLoaded();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("uses");
  const [onlyActive, setOnlyActive] = useState<"used" | "all">("used");

  const rows = useMemo(() => {
    if (!s) return [];
    return s.data.customers
      .filter((c) => c.referralCode)
      .map((c) => ({ c, code: c.referralCodeDisplay || c.referralCode || "", ...referralSummary(s.data, c.id) }));
  }, [s]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const found = rows.filter((r) => {
      if (onlyActive === "used" && r.uses === 0 && !r.negative && r.pendingCents === 0 && r.earnedCents === 0) return false;
      if (!needle) return true;
      return [r.c.name, r.c.email, r.code].some((x) => (x ?? "").toLowerCase().includes(needle));
    });
    const by: Record<Sort, (a: (typeof rows)[number], b: (typeof rows)[number]) => number> = {
      uses: (a, b) => b.uses - a.uses || b.earnedCents - a.earnedCents,
      earned: (a, b) => b.earnedCents - a.earnedCents,
      pending: (a, b) => b.pendingCents - a.pendingCents,
      available: (a, b) => b.balanceCents - a.balanceCents,
      name: (a, b) => a.c.name.localeCompare(b.c.name),
    };
    return found.sort((a, b) => by[sort](a, b) || a.c.name.localeCompare(b.c.name));
  }, [rows, q, sort, onlyActive]);

  if (!s) return <PageSkeleton />;
  const r = s.data.store.referrals;
  const negatives = rows.filter((x) => x.negative).length;
  const totals = rows.reduce((t, x) => ({ uses: t.uses + x.uses, earned: t.earned + x.earnedCents, pending: t.pending + x.pendingCents }), { uses: 0, earned: 0, pending: 0 });

  return (
    <div data-admin-referrals>
      <PageHeader
        title="Referrals"
        sub={
          <>
            Owners earn {r.percent}% · buyers get {r.buyerDiscountPercent}% off · stacking {r.allowStacking ? "on" : "off"} ·{" "}
            <Link href="/admin/settings?tab=referrals" className="underline underline-offset-4">
              change
            </Link>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Uses", String(totals.uses)],
          ["Credit earned", fmtMoney(totals.earned)],
          ["Pending", fmtMoney(totals.pending)],
          ["Negative balances", String(negatives)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-line bg-surface px-4 py-3">
            <div className="text-xs text-muted">{label}</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </div>
      <div className="relative mb-3">
        <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or code" className="pl-10" data-referral-search />
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Segmented
          size="sm"
          value={sort}
          onChange={setSort}
          options={[
            { value: "uses", label: "Uses" },
            { value: "earned", label: "Earned" },
            { value: "pending", label: "Pending" },
            { value: "available", label: "Available" },
            { value: "name", label: "Name" },
          ]}
        />
        <Segmented
          size="sm"
          value={onlyActive}
          onChange={setOnlyActive}
          options={[
            { value: "used", label: "With activity" },
            { value: "all", label: "All codes" },
          ]}
        />
      </div>
      {list.length === 0 ? (
        <Empty icon={<Share2 size={32} />} title={rows.length ? "Nothing matches" : "No referral codes yet"} body={onlyActive === "used" ? "Nobody has used a referral code yet. Switch to All codes to see every customer's code." : "Try a different search."} />
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="hidden grid-cols-[1.6fr_1fr_0.6fr_0.9fr_0.9fr_0.9fr] gap-3 px-4 py-2.5 text-xs font-medium text-muted md:grid">
            <span>Customer</span>
            <span>Code</span>
            <span className="text-right">Uses</span>
            <span className="text-right">Earned</span>
            <span className="text-right">Pending</span>
            <span className="text-right">Available</span>
          </div>
          {list.map((x) => (
            <Link key={x.c.id} href={`/admin/referrals/${x.c.id}`} data-referral-row={x.code} className="block px-4 py-3.5 transition hover:bg-surface2/60 md:grid md:grid-cols-[1.6fr_1fr_0.6fr_0.9fr_0.9fr_0.9fr] md:items-center md:gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{x.c.name}</span>
                {x.negative && <span className="shrink-0 rounded-md bg-neg/12 px-1.5 py-0.5 text-[11px] font-medium text-neg" data-negative-flag>Negative balance</span>}
              </div>
              <div className="font-mono text-sm font-semibold tracking-wide">{x.code}</div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted md:contents">
                <span className="tabular-nums md:text-right md:text-ink">
                  <span className="md:hidden">Uses </span>
                  {x.uses}
                </span>
                <span className="tabular-nums md:text-right md:text-ink">
                  <span className="md:hidden">Earned </span>
                  {fmtMoney(x.earnedCents)}
                </span>
                <span className="tabular-nums md:text-right md:text-ink">
                  <span className="md:hidden">Pending </span>
                  {fmtMoney(x.pendingCents)}
                </span>
                <span className={cx("tabular-nums md:text-right", x.negative ? "font-semibold text-neg" : "md:text-ink")}>
                  <span className="md:hidden">Available </span>
                  {fmtMoney(x.balanceCents)}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-muted">{plural(list.length, "code owner")} shown.</p>
    </div>
  );
}
