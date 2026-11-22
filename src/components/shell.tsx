"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BadgePercent,
  Boxes,
  ChartNoAxesColumn,
  CircleHelp,
  ExternalLink,
  HandCoins,
  LayoutDashboard,
  MapPin,
  Menu,
  PackageCheck,
  PanelsTopLeft,
  ReceiptText,
  Search,
  Settings,
  Share2,
  ShoppingBag,
  Star,
  Store,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { applyTheme, getThemePref } from "@/lib/theme";
import { adminCounts, type AdminCounts } from "@/lib/admin/counts";
import { searchAdmin, type SearchHit } from "@/lib/admin/search";
import { Sheet, cx } from "./ui";
import { useStore } from "./store";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Which counts show as badges next to the label. */
  badges?: (c: AdminCounts) => { n: number; title: string; tone?: "accent" | "warn" }[];
}

const TOP: NavItem[] = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  {
    href: "/admin/orders",
    label: "Orders",
    icon: ReceiptText,
    badges: (c) => [
      { n: c.awaitingPayment, title: "waiting for payment", tone: "warn" },
      { n: c.screenshots, title: "payment screenshots to review", tone: "accent" },
    ],
  },
  { href: "/admin/ship", label: "Ship queue", icon: PackageCheck, badges: (c) => [{ n: c.readyToShip, title: "ready to ship", tone: "accent" }] },
  { href: "/admin/local", label: "Local", icon: MapPin, badges: (c) => [{ n: c.local, title: "local orders to hand over", tone: "accent" }] },
];
const CRM: NavItem[] = [
  { href: "/admin/sell", label: "Sell", icon: ShoppingBag },
  { href: "/admin/in-person", label: "In-person orders", icon: Store },
  { href: "/admin/inventory", label: "Inventory", icon: Boxes },
  { href: "/admin/customers", label: "Customers", icon: Users },
  { href: "/admin/money", label: "Money", icon: Wallet },
  { href: "/admin/pay", label: "Pay", icon: HandCoins },
];
const STORE: NavItem[] = [
  { href: "/admin/promotions", label: "Promotions", icon: BadgePercent },
  { href: "/admin/referrals", label: "Referrals", icon: Share2 },
  { href: "/admin/reviews", label: "Reviews", icon: Star, badges: (c) => [{ n: c.reviews, title: "reviews to approve", tone: "accent" }] },
  { href: "/admin/content", label: "Content", icon: PanelsTopLeft, badges: (c) => [{ n: c.messages, title: "new messages", tone: "accent" }] },
  { href: "/admin/analytics", label: "Analytics", icon: ChartNoAxesColumn },
];
const BOTTOM: NavItem[] = [
  { href: "/admin/settings", label: "Settings", icon: Settings },
  { href: "/admin/help", label: "Help", icon: CircleHelp },
];
const MOBILE_TABS = [TOP[0], TOP[1], CRM[0], CRM[2]];

function CountBadge({ n, title, tone = "accent" }: { n: number; title: string; tone?: "accent" | "warn" }) {
  if (n <= 0) return null;
  return (
    <span
      title={`${n} ${title}`}
      aria-label={`${n} ${title}`}
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
        tone === "warn" ? "bg-warn/20 text-warn" : "bg-accent text-accent-ink",
      )}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { error, data } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const counts = useMemo(() => adminCounts(data), [data]);

  // New page starts at the top (the browser only does this for the window, not our scroll area).
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
    setMenuOpen(false);
  }, [path]);

  const active = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(href + "/"));

  useEffect(() => {
    applyTheme(getThemePref());
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme(getThemePref());
    mq.addEventListener("change", on);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/admin" }).catch(() => {});
    }
    return () => mq.removeEventListener("change", on);
  }, []);

  const link = (t: NavItem, big = false) => (
    <Link
      key={t.href}
      href={t.href}
      aria-current={active(t.href) ? "page" : undefined}
      className={cx(
        "flex items-center gap-3 rounded-xl px-3 font-medium transition",
        big ? "h-12 text-base" : "h-10 text-[15px]",
        active(t.href) ? "bg-accent/10 text-accent" : "text-muted hover:bg-surface2 hover:text-ink",
      )}
    >
      <t.icon size={big ? 20 : 18} strokeWidth={active(t.href) ? 2.3 : 2} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{t.label}</span>
      {t.badges?.(counts).map((b) => <CountBadge key={b.title} {...b} />)}
    </Link>
  );

  const groupLabel = (text: string) => <div className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-muted/80">{text}</div>;

  const nav = (big = false) => (
    <>
      <div className="flex flex-col gap-0.5">{TOP.map((t) => link(t, big))}</div>
      {groupLabel("Sales")}
      <div className="flex flex-col gap-0.5">{CRM.map((t) => link(t, big))}</div>
      {groupLabel("Store")}
      <div className="flex flex-col gap-0.5">{STORE.map((t) => link(t, big))}</div>
      <div className="mt-5 flex flex-col gap-0.5 border-t border-line pt-3">
        {BOTTOM.map((t) => link(t, big))}
        <a
          href="/"
          target="_blank"
          rel="noreferrer"
          className={cx("flex items-center gap-3 rounded-xl px-3 font-medium text-muted transition hover:bg-surface2 hover:text-ink", big ? "h-12 text-base" : "h-10 text-[15px]")}
        >
          <ExternalLink size={big ? 20 : 18} className="shrink-0" />
          <span className="flex-1">View store</span>
          {data && !data.store.open && <span className="rounded-md bg-surface2 px-1.5 py-0.5 text-[11px] font-medium text-muted">Closed</span>}
        </a>
      </div>
    </>
  );

  const mobileBadge = counts.awaitingPayment + counts.screenshots;

  return (
    // Desktop: fixed-height row; the sidebar stays put and only the content column scrolls.
    // Mobile: normal document scroll (keeps iOS niceties); tab bar is position:fixed.
    <div className="min-h-dvh md:flex md:h-dvh md:min-h-0 md:overflow-hidden">
      <aside className="hidden h-dvh w-64 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface px-3 py-5 md:flex">
        <Link href="/admin" className="mb-5 flex items-center gap-2.5 px-3">
          <img src="/icon.svg" alt="" className="h-8 w-8 rounded-lg" />
          <span className="text-[15px] font-semibold leading-tight tracking-tight">
            {data?.store.storeName || "Buckshot Labs"}
            <span className="block text-xs font-normal text-muted">Admin</span>
          </span>
        </Link>
        <nav aria-label="Admin" className="flex flex-1 flex-col">
          {nav()}
        </nav>
      </aside>

      <div ref={scrollRef} className="min-w-0 flex-1 md:h-dvh md:min-h-0 md:overflow-y-auto md:overscroll-contain">
        <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4 md:px-8">
            <Link href="/admin" className="flex items-center gap-2 md:hidden" aria-label="Dashboard">
              <img src="/icon.svg" alt="" className="h-8 w-8 rounded-lg" />
            </Link>
            <GlobalSearch />
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setMenuOpen(true)}
              className="relative -mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface2 md:hidden"
            >
              <Menu size={22} />
              {counts.total > 0 && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-bg" />}
            </button>
          </div>
        </header>

        {error && !data && (
          <div className="mx-auto mt-4 max-w-6xl px-4 md:px-8">
            <div className="rounded-xl bg-neg/10 px-4 py-3 text-sm text-neg">
              Couldn’t load your data: {error}. Check your connection, then reload the page.
            </div>
          </div>
        )}

        <main className="mx-auto max-w-6xl px-4 pb-[calc(env(safe-area-inset-bottom)+6.5rem)] pt-4 md:px-8 md:pb-12 md:pt-5">{children}</main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden">
        <div className="mx-auto flex max-w-md">
          {MOBILE_TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              className={cx(
                "relative flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium transition active:scale-95",
                active(t.href) ? "text-accent" : "text-muted",
              )}
            >
              <t.icon size={22} strokeWidth={active(t.href) ? 2.3 : 1.9} />
              {t.label}
              {t.href === "/admin/orders" && mobileBadge > 0 && (
                <span className="absolute right-[calc(50%-22px)] top-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-ink">
                  {mobileBadge}
                </span>
              )}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="relative flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted transition active:scale-95"
          >
            <Menu size={22} strokeWidth={1.9} />
            More
            {counts.readyToShip + counts.reviews + counts.messages > 0 && <span className="absolute right-[calc(50%-18px)] top-2.5 h-2 w-2 rounded-full bg-accent" />}
          </button>
        </div>
      </nav>

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu">
        <nav aria-label="All pages" className="flex flex-col pb-2">
          {nav(true)}
        </nav>
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------- Global search
const HIT_LABEL: Record<SearchHit["kind"], string> = { order: "Order", customer: "Customer", product: "Product" };

function GlobalSearch() {
  const { data } = useStore();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => (data && q.trim() ? searchAdmin(data, q) : []), [data, q]);

  useEffect(() => setCursor(0), [q]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? "")) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const go = (h: SearchHit) => {
    setOpen(false);
    setQ("");
    inputRef.current?.blur();
    router.push(h.href);
  };

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1 md:max-w-md">
      <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
      <input
        ref={inputRef}
        type="search"
        // Not a sign-in field: a neutral name and id plus autocomplete off, so browsers and
        // password managers stop filling an email address or username in here.
        id="admin-find"
        name="admin-find"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="search"
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        role="combobox"
        aria-expanded={open && q.trim().length > 0}
        aria-controls="global-search-results"
        aria-label="Search orders, customers and products"
        placeholder="Search order #, name, email, product"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setCursor((c) => Math.min(hits.length - 1, c + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setCursor((c) => Math.max(0, c - 1));
          } else if (e.key === "Enter" && hits[cursor]) {
            e.preventDefault();
            go(hits[cursor]);
          } else if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        className="h-10 w-full rounded-xl border border-line bg-surface pl-10 pr-9 text-[15px] placeholder:text-muted/70 transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 [&::-webkit-search-cancel-button]:hidden"
      />
      {q && (
        <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:text-ink">
          <X size={16} />
        </button>
      )}
      {open && q.trim() && (
        <div id="global-search-results" role="listbox" className="absolute inset-x-0 top-12 z-40 max-h-[70dvh] overflow-y-auto rounded-2xl border border-line bg-surface p-1.5 shadow-xl">
          {hits.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted">Nothing matches “{q.trim()}”. Try an order number, a name, an email or a product.</div>
          ) : (
            hits.map((h, i) => (
              <button
                key={h.kind + h.id}
                type="button"
                role="option"
                aria-selected={i === cursor}
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(h)}
                className={cx("flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition", i === cursor && "bg-surface2")}
              >
                <span className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted">{HIT_LABEL[h.kind]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{h.title}</span>
                  {h.sub && <span className="block truncate text-sm text-muted">{h.sub}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
