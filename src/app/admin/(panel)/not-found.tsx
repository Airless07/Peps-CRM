import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";

export const metadata = { title: "Page not found" };

/** Admin-styled 404, shown inside the admin shell (sidebar, search and menu stay usable). */
export default function AdminNotFound() {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-2 text-center" data-admin-404>
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface2 text-muted">
        <Compass size={28} strokeWidth={1.7} />
      </span>
      <p className="mt-5 text-xs font-semibold uppercase tracking-wider text-muted">Error 404</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-[15px] text-muted">There is no admin page at this address. The link may be old, or the address may have a typo.</p>
      <Link
        href="/admin"
        className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-5 text-[15px] font-semibold text-accent-ink transition hover:brightness-110 active:scale-[.98]"
      >
        <ArrowLeft size={18} /> Back to the Dashboard
      </Link>
      <div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-1 text-sm">
        <Link href="/admin/orders" className="inline-flex h-11 items-center font-medium text-accent hover:underline">
          Orders
        </Link>
        <Link href="/admin/inventory" className="inline-flex h-11 items-center font-medium text-accent hover:underline">
          Inventory
        </Link>
        <Link href="/admin/settings" className="inline-flex h-11 items-center font-medium text-accent hover:underline">
          Settings
        </Link>
      </div>
    </div>
  );
}
