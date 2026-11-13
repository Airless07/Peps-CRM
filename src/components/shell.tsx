"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Boxes, ReceiptText, Settings, ShoppingBag, Users, Wallet, HandCoins } from "lucide-react";
import { applyTheme, getThemePref } from "@/lib/theme";
import { cx } from "./ui";
import { useStore } from "./store";

const TABS = [
  { href: "/", label: "Sell", icon: ShoppingBag },
  { href: "/orders", label: "Orders", icon: ReceiptText },
  // Desktop sidebar only. On mobile, Customers is a toggle at the top of the Orders screen.
  { href: "/customers", label: "Customers", icon: Users, desktopOnly: true },
  { href: "/inventory", label: "Inventory", icon: Boxes },
  { href: "/money", label: "Money", icon: Wallet },
  { href: "/pay", label: "Pay", icon: HandCoins },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { error, data } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // New page starts at the top (the browser only does this for the window, not our scroll area).
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [path]);

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  // On the mobile tab bar, Orders also covers the Customers screen
  const activeMobile = (href: string) => active(href) || (href === "/orders" && path.startsWith("/customers"));

  useEffect(() => {
    applyTheme(getThemePref());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme(getThemePref());
    mq.addEventListener("change", on);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    return () => mq.removeEventListener("change", on);
  }, []);

  return (
    // Desktop: fixed-height row; the sidebar stays put and only the content column scrolls.
    // Mobile: normal document scroll (keeps iOS niceties); tab bar is position:fixed.
    <div className="min-h-dvh md:flex md:h-dvh md:min-h-0 md:overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface px-3 py-5 md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-3">
          <img src="/icon.svg" alt="" className="h-8 w-8 rounded-lg" />
          <span className="text-[17px] font-semibold tracking-tight">Peps CRM</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={cx(
                "flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition",
                active(t.href) ? "bg-accent/10 text-accent" : "text-muted hover:bg-surface2 hover:text-ink",
              )}
            >
              <t.icon size={19} strokeWidth={active(t.href) ? 2.3 : 2} />
              {t.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/settings"
          className={cx(
            "flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition",
            path.startsWith("/settings") ? "bg-accent/10 text-accent" : "text-muted hover:bg-surface2 hover:text-ink",
          )}
        >
          <Settings size={19} />
          Settings
        </Link>
      </aside>

      <div ref={scrollRef} className="min-w-0 flex-1 md:h-dvh md:min-h-0 md:overflow-y-auto md:overscroll-contain">
        {/* Top bar with settings gear (all screens) */}
        <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/85 pt-[env(safe-area-inset-top)] backdrop-blur-md md:border-none md:bg-transparent md:backdrop-blur-none">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 md:px-8">
            <div className="flex items-center gap-2 md:invisible">
              <img src="/icon.svg" alt="" className="h-7 w-7 rounded-lg" />
              <span className="font-semibold tracking-tight">Peps</span>
            </div>
            <Link
              href="/settings"
              aria-label="Settings"
              className={cx(
                "-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-xl transition hover:bg-surface2",
                path.startsWith("/settings") ? "text-accent" : "text-muted",
              )}
            >
              <Settings size={21} />
            </Link>
          </div>
        </header>

        {error && !data && (
          <div className="mx-auto mt-4 max-w-5xl px-4 md:px-8">
            <div className="rounded-xl bg-neg/10 px-4 py-3 text-sm text-neg">Couldn’t load data: {error}</div>
          </div>
        )}

        <main className="mx-auto max-w-5xl px-4 pb-[calc(env(safe-area-inset-bottom)+6.5rem)] pt-3 md:px-8 md:pb-12">
          {children}
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        <div className="mx-auto flex max-w-md">
          {TABS.filter((t) => !t.desktopOnly).map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={cx(
                "flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition active:scale-95",
                activeMobile(t.href) ? "text-accent" : "text-muted",
              )}
            >
              <t.icon size={22} strokeWidth={activeMobile(t.href) ? 2.3 : 1.9} />
              {t.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
