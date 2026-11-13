"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { computeLedger, type Ledger } from "@/lib/money";
import type { AppData, Partner } from "@/lib/types";
import { useToast } from "./toast";

export async function api<T = unknown>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Not logged in");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || `Request failed (${res.status})`);
  return json as T;
}

interface Store {
  data: AppData | null;
  ledger: Ledger | null;
  error: string | null;
  refresh: () => Promise<void>;
  /**
   * Optimistic mutation: apply `update` locally right away, send `request`,
   * then re-sync with the server. On failure the server state is restored and an error shown.
   */
  mutate: (update: ((d: AppData) => AppData) | null, request: () => Promise<unknown>) => Promise<boolean>;
  name: (p: Partner) => string;
}

const Ctx = createContext<Store | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef(0);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      const d = await api<AppData>("/api/data");
      if (inflight.current === 0) setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const onFocus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, [refresh]);

  const mutate = useCallback<Store["mutate"]>(
    async (update, request) => {
      if (update) setData((d) => (d ? update(d) : d));
      inflight.current++;
      let ok = true;
      try {
        await request();
      } catch (e) {
        ok = false;
        toast.show({ message: (e as Error).message, tone: "error" });
      } finally {
        inflight.current--;
        if (inflight.current === 0) await refresh();
      }
      return ok;
    },
    [refresh, toast],
  );

  const ledger = useMemo(() => (data ? computeLedger(data) : null), [data]);
  const name = useCallback(
    (p: Partner) => (p === "A" ? data?.settings.partnerAName ?? "Partner A" : data?.settings.partnerBName ?? "Partner B"),
    [data],
  );

  const value = useMemo(() => ({ data, ledger, error, refresh, mutate, name }), [data, ledger, error, refresh, mutate, name]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside DataProvider");
  return s;
}

/** For pages that render only once data is loaded. */
export function useLoaded() {
  const s = useStore();
  return s.data && s.ledger ? { ...s, data: s.data, ledger: s.ledger } : null;
}

export function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void, boolean] {
  const [state, setState] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) setState(JSON.parse(raw));
    } catch {}
    setReady(true);
  }, [key]);
  const set = useCallback(
    (v: T | ((p: T) => T)) => {
      setState((prev) => {
        const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [key],
  );
  return [state, set, ready];
}
