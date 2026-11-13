"use client";

import { useEffect, useState } from "react";
import { Delete } from "lucide-react";
import { fmtMoney } from "@/lib/format";
import { Button, Sheet } from "./ui";

/** Number pad sheet for typing a price. Calls onSubmit with cents. */
export function NumpadSheet({
  open,
  onClose,
  title,
  submitLabel = "Add to order",
  initialCents,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  submitLabel?: string;
  initialCents?: number;
  onSubmit: (cents: number) => void;
}) {
  const [digits, setDigits] = useState("");
  useEffect(() => {
    if (open) setDigits(initialCents ? String(initialCents) : "");
  }, [open, initialCents]);

  const cents = Number(digits || "0");
  const press = (k: string) => {
    if (k === "back") return setDigits((d) => d.slice(0, -1));
    if (k === "00") return setDigits((d) => (d && d.length < 7 ? d + "00" : d));
    setDigits((d) => (d.length >= 8 ? d : (d + k).replace(/^0+/, "")));
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") press("back");
      else if (e.key === "Enter" && cents > 0) {
        onSubmit(cents);
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "back"];
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="py-4 text-center text-5xl font-semibold tracking-tight tabular-nums">{fmtMoney(cents)}</div>
      <div className="grid grid-cols-3 gap-2">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => press(k)}
            className="flex h-16 items-center justify-center rounded-2xl bg-surface2 text-2xl font-medium transition active:scale-95 active:bg-line"
            aria-label={k === "back" ? "Delete" : k}
          >
            {k === "back" ? <Delete size={24} /> : k}
          </button>
        ))}
      </div>
      <Button
        variant="primary"
        size="lg"
        block
        className="mt-4"
        disabled={cents <= 0}
        onClick={() => {
          onSubmit(cents);
          onClose();
        }}
      >
        {submitLabel}
      </Button>
    </Sheet>
  );
}
