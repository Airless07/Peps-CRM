"use client";

import { useState } from "react";
import { fmtMoney } from "@/lib/format";
import { cx } from "./ui";

export interface Bucket {
  key: string;
  label: string;
  revenue: number;
  profit: number;
}

/** Paired bars (revenue, profit) per bucket. Tap a bucket to read its values. */
export function BarChart({ buckets, height = 160 }: { buckets: Bucket[]; height?: number }) {
  const [sel, setSel] = useState<string | null>(null);
  const maxPos = Math.max(1, ...buckets.map((b) => Math.max(b.revenue, b.profit, 0)));
  const maxNeg = Math.max(0, ...buckets.map((b) => Math.max(-b.profit, 0)));
  const total = maxPos + maxNeg;
  const posH = (height * maxPos) / total;
  const negH = height - posH;
  const current = buckets.find((b) => b.key === sel) ?? null;
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 7));

  return (
    <div>
      <div className="mb-3 flex min-h-[40px] flex-wrap items-end justify-between gap-x-4 gap-y-1 text-sm">
        {current ? (
          <>
            <span className="font-medium">{current.label}</span>
            <span className="flex gap-4 tabular-nums">
              <span>
                <span className="text-muted">Revenue </span>
                {fmtMoney(current.revenue)}
              </span>
              <span>
                <span className="text-muted">Profit </span>
                <span className={current.profit < 0 ? "text-neg" : undefined}>{fmtMoney(current.profit)}</span>
              </span>
            </span>
          </>
        ) : (
          <span className="flex gap-4 text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-accent" /> Revenue
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-pos" /> Profit
            </span>
            <span className="hidden sm:inline">Tap a bar for details</span>
          </span>
        )}
      </div>
      <div className="relative" style={{ height }}>
        <div className="absolute inset-x-0 border-t border-line" style={{ top: posH }} />
        <div className="absolute inset-0 flex items-stretch gap-[3px]">
          {buckets.map((b) => {
            const active = sel === b.key;
            return (
              <button
                key={b.key}
                type="button"
                aria-label={`${b.label}: revenue ${fmtMoney(b.revenue)}, profit ${fmtMoney(b.profit)}`}
                onClick={() => setSel(active ? null : b.key)}
                className={cx("relative flex min-w-0 flex-1 rounded-md transition", active ? "bg-surface2" : "hover:bg-surface2/60")}
              >
                <div className="absolute inset-x-[12%] flex items-end justify-center gap-[2px]" style={{ top: 0, height: posH }}>
                  <div className="w-1/2 max-w-3 rounded-t-[3px] bg-accent transition-all" style={{ height: `${(Math.max(b.revenue, 0) / maxPos) * 100}%` }} />
                  <div className="w-1/2 max-w-3 rounded-t-[3px] bg-pos transition-all" style={{ height: `${(Math.max(b.profit, 0) / maxPos) * 100}%` }} />
                </div>
                {maxNeg > 0 && (
                  <div className="absolute inset-x-[12%] flex items-start justify-center gap-[2px]" style={{ top: posH, height: negH }}>
                    <div className="w-1/2 max-w-3" />
                    <div className="w-1/2 max-w-3 rounded-b-[3px] bg-neg" style={{ height: `${(Math.max(-b.profit, 0) / maxNeg) * 100}%` }} />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-1.5 flex gap-[3px] text-[10px] text-muted">
        {buckets.map((b, i) => (
          <div key={b.key} className="min-w-0 flex-1 truncate text-center">
            {i % labelEvery === 0 ? b.label.replace(/^\w+, /, "") : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
