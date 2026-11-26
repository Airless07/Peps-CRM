"use client";

// "Money received by": Ahmad, Mo or Bank. Who holds the money of a sale (Money page > Cash held).
// Never pre-selected on a new sale: nothing is checked until someone taps one.
import type { CashHolder } from "@/lib/types";
import { Segmented, cx } from "./ui";
import { useStore } from "./store";

export function MoneyToPicker({ value, onChange, missing = false, className }: { value: CashHolder | null | undefined; onChange: (v: CashHolder) => void; missing?: boolean; className?: string }) {
  const { name } = useStore();
  return (
    <div data-money-to-picker className={className}>
      <Segmented<CashHolder | "">
        value={value ?? ""}
        onChange={(v) => v && onChange(v)}
        className={cx(missing && "ring-2 ring-neg/60")}
        options={[
          { value: "A", label: name("A") },
          { value: "B", label: name("B") },
          { value: "bank", label: "Bank" },
        ]}
      />
      {missing && (
        <p className="mt-1.5 text-sm font-medium text-neg" data-money-to-missing>
          Pick who received the money.
        </p>
      )}
    </div>
  );
}
