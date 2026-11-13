"use client";

import { useState } from "react";
import { Check, Search, UserPlus, X } from "lucide-react";
import { customerKey, searchCustomers } from "@/lib/customers";
import { uid } from "@/lib/format";
import type { CustomerRec } from "@/lib/types";
import { Input, cx } from "./ui";

/**
 * Search box that autocompletes existing customers, with "+ Add new customer" when nothing
 * matches. Optional: an empty box means a walk-in. A new customer is only created when the
 * order is saved.
 */
export function CustomerPicker({
  name,
  customerId,
  customers,
  onChange,
}: {
  name: string;
  customerId: string | null;
  customers: CustomerRec[];
  onChange: (v: { customer: string; customerId: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const linked = customerId ? customers.find((c) => c.id === customerId) : undefined;
  const isNew = !!customerId && !linked;
  const q = name.trim();
  const matches = q ? searchCustomers(customers, q).slice(0, 6) : [];
  const exact = customers.some((c) => customerKey(c.name) === customerKey(q));
  const showList = open && !customerId && q.length > 0;

  const pick = (c: CustomerRec) => {
    onChange({ customer: c.name, customerId: c.id });
    setOpen(false);
  };
  const addNew = () => {
    onChange({ customer: q, customerId: uid() });
    setOpen(false);
  };

  return (
    <div>
      <div className="relative">
        <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        <Input
          value={name}
          onChange={(e) => {
            onChange({ customer: e.target.value, customerId: null });
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !showList) return;
            e.preventDefault();
            if (matches[0]) pick(matches[0]);
            else addNew();
          }}
          placeholder="Search or add a customer"
          autoComplete="off"
          className={cx("pl-10", (customerId || name) && "pr-24")}
          aria-label="Customer"
        />
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {linked && (
            <span className="inline-flex items-center gap-1 rounded-md bg-pos/12 px-1.5 py-0.5 text-[11px] font-medium text-pos">
              <Check size={12} /> Saved
            </span>
          )}
          {isNew && <span className="rounded-md bg-accent/12 px-1.5 py-0.5 text-[11px] font-medium text-accent">New</span>}
          {(customerId || name) && (
            <button
              type="button"
              aria-label="Clear customer"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange({ customer: "", customerId: null })}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface2 hover:text-ink"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {showList && (
        <div className="mt-1.5 animate-fade-in overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(c)}
              className="flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-[15px] transition hover:bg-surface2"
            >
              <span className="truncate font-medium">{c.name}</span>
              {c.phone && <span className="shrink-0 text-xs tabular-nums text-muted">{c.phone}</span>}
            </button>
          ))}
          {!exact && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={addNew}
              className={cx(
                "flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[15px] font-medium text-accent transition hover:bg-surface2",
                matches.length > 0 && "border-t border-line",
              )}
            >
              <UserPlus size={16} /> Add new customer “{q}”
            </button>
          )}
        </div>
      )}
    </div>
  );
}
