// Server-side data for the storefront. One short-lived cache so a page render and its API calls
// don't each reload the whole database. Admin changes show up on the store within a couple of seconds.
import { cookies } from "next/headers";
import { HttpError } from "../api";
import { computeLedger, type Ledger } from "../money";
import { loadAll } from "../serialize";
import { SESSION_COOKIE } from "../session";
import { isAdminToken } from "../admin-auth";
import type { AppData } from "../types";
import { buildCatalog, type PublicCatalog } from "./catalog";

interface Snapshot {
  at: number;
  data: AppData;
  ledger: Ledger;
  catalog: PublicCatalog;
}
const g = globalThis as unknown as { __storeSnap?: Snapshot; __storeLoading?: Promise<Snapshot> };
const TTL_MS = 2000;

export async function storeSnapshot(fresh = false): Promise<Snapshot> {
  const cur = g.__storeSnap;
  if (!fresh && cur && Date.now() - cur.at < TTL_MS) return cur;
  if (!fresh && g.__storeLoading) return g.__storeLoading;
  const p = (async () => {
    const data = await loadAll();
    const ledger = computeLedger(data);
    const snap = { at: Date.now(), data, ledger, catalog: buildCatalog(data, ledger) };
    g.__storeSnap = snap;
    return snap;
  })();
  g.__storeLoading = p;
  try {
    return await p;
  } finally {
    g.__storeLoading = undefined;
  }
}

export async function isAdmin(): Promise<boolean> {
  return isAdminToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** The store can be used when it is open, or by a signed-in admin previewing it. */
export async function storeAccess(): Promise<{ open: boolean; preview: boolean; allowed: boolean }> {
  const { data } = await storeSnapshot();
  const admin = data.store.open ? false : await isAdmin();
  return { open: data.store.open, preview: !data.store.open && admin, allowed: data.store.open || admin };
}

/** For public API routes: refuse while the store is closed (admins previewing are let through). */
export async function requireOpenStore() {
  const a = await storeAccess();
  if (!a.allowed) throw new HttpError(403, "The store is not open yet.");
  return a;
}
