"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

interface ToastOpts {
  message: string;
  tone?: "default" | "error" | "success";
  action?: { label: string; onClick: () => void };
  duration?: number;
}
interface ToastItem extends ToastOpts {
  id: number;
}

const Ctx = createContext<{ show: (t: ToastOpts) => void } | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const n = useRef(0);
  const dismiss = useCallback((id: number) => setItems((x) => x.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (t: ToastOpts) => {
      const id = ++n.current;
      setItems((x) => [...x.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), t.duration ?? (t.action ? 5000 : 3000));
    },
    [dismiss],
  );
  const value = useMemo(() => ({ show }), [show]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 z-[70] flex flex-col items-center gap-2 px-4 bottom-[calc(env(safe-area-inset-bottom)+9.5rem)] md:bottom-6"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full max-w-sm animate-toast-in items-center gap-3 rounded-xl px-4 py-3 text-sm shadow-lg ${
              t.tone === "error" ? "bg-neg text-white" : "bg-ink text-bg"
            }`}
          >
            <span className="flex-1">{t.message}</span>
            {t.action && (
              <button
                className="-my-1 rounded-lg px-3 py-1.5 font-semibold underline-offset-2 hover:underline"
                onClick={() => {
                  t.action!.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useToast outside ToastProvider");
  return c;
}
