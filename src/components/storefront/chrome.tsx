"use client";

// Store chrome: promo bar, header (nav, search, account, cart), age gate, scroll reveal.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Menu, Search, ShoppingBag, User, X } from "lucide-react";
import type { PublicProduct } from "@/lib/store/catalog";
import { money, useCart } from "./cart";
import { ENTRY_COOKIE, ENTRY_DAYS, gateExempt } from "@/lib/store/entry-gate";
import { Vial } from "./vial";

export interface PromoItem {
  text: string;
  code: string;
}

// ---------------------------------------------------------------- Promo bar
export function PromoBar({ items }: { items: PromoItem[] }) {
  const cart = useCart();
  const [copied, setCopied] = useState("");
  if (items.length === 0) return null;

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {}
    setCopied(code);
    setTimeout(() => setCopied(""), 1800);
  };

  const item = (p: PromoItem, key: string | number, hidden = false) => (
    <span key={key} className="flex shrink-0 items-center gap-2.5 px-6" aria-hidden={hidden || undefined}>
      <span>{p.text}</span>
      {p.code && (
        <>
          <button
            type="button"
            tabIndex={hidden ? -1 : 0}
            onClick={() => copy(p.code)}
            aria-label={`Copy code ${p.code}`}
            className="tap inline-flex h-7 items-center gap-1.5 rounded-full border border-white/30 px-2.5 font-semibold tracking-wider transition hover:border-white/70"
          >
            {p.code}
            {copied === p.code ? <Check size={12} /> : <Copy size={12} />}
            <span className="sr-only" aria-live="polite">
              {copied === p.code ? "Copied" : ""}
            </span>
          </button>
          <button
            type="button"
            tabIndex={hidden ? -1 : 0}
            onClick={() => {
              cart.setCode(p.code);
              cart.setOpen(true);
            }}
            className="tap inline-flex h-7 items-center rounded-full bg-white px-3 font-semibold text-coal transition hover:bg-white/85"
          >
            Apply now
          </button>
        </>
      )}
    </span>
  );

  // One short message sits centered; several (or a long one) scroll as a marquee.
  const scroll = items.length > 1;
  return (
    <div className="bg-night text-[13px] font-medium text-white" role="region" aria-label="Current offers">
      {scroll ? (
        <div className="marquee flex h-10 items-center overflow-hidden">
          <div className="marquee-track flex animate-marquee">
            {[0, 1].map((dup) => (
              <div key={dup} className="flex shrink-0">
                {[...items, ...items].map((p, i) => item(p, `${dup}-${i}`, dup === 1 || i >= items.length))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-10 flex-wrap items-center justify-center gap-y-1 px-3 py-1.5 text-center">{item(items[0], 0)}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Header
const NAV = [
  { href: "/shop", label: "Shop" },
  { href: "/collections", label: "Collections" },
  { href: "/testing", label: "Testing" },
  { href: "/about", label: "About" },
  { href: "/reviews", label: "Reviews" },
  { href: "/faq", label: "FAQ" },
  { href: "/refer", label: "Refer & Earn" },
];

/** The account icon: a link when signed out; signed in, a small menu with the account pages. */
function AccountMenu({ signedIn, className }: { signedIn: boolean; className: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => (document.removeEventListener("mousedown", close), document.removeEventListener("keydown", close));
  }, [open]);
  if (!signedIn) {
    return (
      <Link href="/account" className={`${className} hidden sm:flex`} aria-label="Sign in">
        <User size={20} strokeWidth={1.75} />
      </Link>
    );
  }
  return (
    <div ref={ref} className="relative hidden sm:block">
      <button type="button" className={className} aria-label="Your account" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-account-menu>
        <User size={20} strokeWidth={1.75} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-2xl border border-rule bg-paper py-1.5 shadow-lg">
          {[
            ["/account", "Your account"],
            ["/account/referrals", "Referrals"],
            ["/refer", "Refer & Earn"],
          ].map(([href, label]) => (
            <Link key={href} href={href} role="menuitem" className="block px-4 py-2.5 text-[15px] font-medium text-coal hover:bg-soft">
              {label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function Wordmark({ name, logo, className = "" }: { name: string; logo: string; className?: string }) {
  if (logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/media/${logo}-480.webp`} alt={name} className={`h-8 w-auto max-w-[11rem] object-contain ${className}`} />;
  }
  return <span className={`whitespace-nowrap text-[15px] font-extrabold uppercase tracking-[0.2em] sm:text-base ${className}`}>{name}</span>;
}

export function Header({ name, logo, signedIn }: { name: string; logo: string; signedIn: boolean }) {
  const path = usePathname();
  const cart = useCart();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    setMenu(false);
    setSearch(false);
  }, [path]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    document.body.style.overflow = menu ? "hidden" : "";
    return () => void (document.body.style.overflow = "");
  }, [menu]);

  const icon = "relative flex h-11 w-11 items-center justify-center rounded-full text-coal transition hover:bg-soft";
  const active = (href: string) => path === href || path.startsWith(href + "/") || (href === "/shop" && path.startsWith("/product"));

  return (
    <header className={`bg-paper transition-shadow duration-300 ${scrolled ? "shadow-[0_1px_0_var(--s-line)]" : ""}`}>
      <div className="s-wrap flex h-16 items-center gap-2 sm:h-[4.5rem]">
        <Link href="/" aria-label={`${name} home`} className="tap mr-auto shrink-0 lg:mr-0 lg:w-56">
          <Wordmark name={name} logo={logo} />
        </Link>
        <nav aria-label="Main" className="hidden flex-1 items-center justify-center gap-1 lg:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} className={`rounded-full px-4 py-2 text-[15px] font-medium transition ${active(n.href) ? "text-brand" : "text-coal hover:bg-soft"}`}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center lg:w-56 lg:justify-end">
          <button type="button" className={icon} aria-label="Search products" onClick={() => setSearch(true)}>
            <Search size={20} strokeWidth={1.75} />
          </button>
          <AccountMenu signedIn={signedIn} className={icon} />
          <button type="button" className={icon} aria-label={`Cart, ${cart.count} ${cart.count === 1 ? "item" : "items"}`} onClick={() => cart.setOpen(true)}>
            <ShoppingBag size={20} strokeWidth={1.75} />
            {cart.ready && cart.count > 0 && <span className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[11px] font-semibold tabular-nums text-white">{cart.count}</span>}
          </button>
          <button type="button" className={`${icon} lg:hidden`} aria-label="Open menu" aria-expanded={menu} onClick={() => setMenu(true)}>
            <Menu size={22} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {menu && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-paper lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="s-wrap flex h-16 shrink-0 items-center justify-between">
            <Wordmark name={name} logo={logo} />
            <button type="button" className={icon} aria-label="Close menu" onClick={() => setMenu(false)}>
              <X size={22} />
            </button>
          </div>
          <nav aria-label="Mobile" className="s-wrap flex-1 overflow-y-auto pb-10 pt-4">
            {NAV.map((n, i) => (
              <Link key={n.href} href={n.href} className="block animate-rise-in border-b border-rule py-5 text-3xl font-semibold tracking-tight" style={{ animationDelay: `${i * 45}ms` }}>
                {n.label}
              </Link>
            ))}
            <div className="mt-8 grid gap-1 text-[17px] text-stone">
              <Link href="/account" className="py-2.5">
                {signedIn ? "Your account" : "Sign in or create an account"}
              </Link>
              <Link href="/account/referrals" className="py-2.5 pl-4" data-mobile-referrals>
                Referrals
              </Link>
              <Link href="/order-lookup" className="py-2.5">
                Order lookup
              </Link>
              <Link href="/contact" className="py-2.5">
                Contact
              </Link>
            </div>
          </nav>
        </div>
      )}
      {search && <SearchOverlay onClose={() => setSearch(false)} />}
    </header>
  );
}

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const { products } = useCart();
  const router = useRouter();
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  const hits = useMemo(() => searchProducts(products, q).slice(0, 6), [products, q]);

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Search products">
      <div className="absolute inset-0 bg-night/40" onClick={onClose} />
      <div className="relative animate-rise-in bg-paper shadow-xl" style={{ animationDuration: ".35s" }}>
        <form
          className="s-wrap flex h-20 items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/shop?q=${encodeURIComponent(q.trim())}`);
            onClose();
          }}
        >
          <Search size={22} className="shrink-0 text-stone" />
          <input ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products, CAS numbers, collections" aria-label="Search" className="h-12 min-w-0 flex-1 bg-transparent text-xl font-medium outline-none placeholder:text-stone/70" />
          <button type="button" aria-label="Close search" onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full text-stone hover:bg-soft">
            <X size={22} />
          </button>
        </form>
        {q.trim() && (
          <div className="s-wrap border-t border-rule pb-6 pt-2">
            {hits.length === 0 ? (
              <p className="py-6 text-[15px] text-stone">No products match “{q.trim()}”. Try a compound name or CAS number.</p>
            ) : (
              <ul>
                {hits.map((p) => (
                  <li key={p.id}>
                    <Link href={`/product/${p.slug}`} onClick={onClose} className="flex items-center gap-4 rounded-xl py-2.5 transition hover:bg-soft sm:px-3">
                      <span className="h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-soft">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {p.photos[0] ? <img src={`/media/${p.photos[0].id}-480.webp`} alt="" className="h-full w-full object-cover" /> : <Vial name={p.name} className="h-full w-full p-0.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{p.name}</span>
                        {p.summary && <span className="block truncate text-sm text-stone">{p.summary}</span>}
                      </span>
                      <span className="shrink-0 text-[15px] font-medium tabular-nums">{p.priceFromCents !== p.priceToCents ? `From ${money(p.priceFromCents)}` : money(p.priceFromCents)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Instant search over names, summaries, compound info and (optionally) group names. */
export function searchProducts(products: PublicProduct[], query: string, groupName?: (id: string) => string): PublicProduct[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return products;
  return products.filter((p) => {
    const hay = [p.name, p.summary, ...p.specs.map((s) => s.value), ...p.badges, ...p.variants.map((v) => v.label), ...(groupName ? p.groupIds.map(groupName) : [])].join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

// ---------------------------------------------------------------- Entry gate
/**
 * Full-screen gate on the first visit: 21+ (or the minimum age in Settings) and research use only.
 * The server decides whether to draw it (no cookie, not a crawler, gate on in Settings), so there is
 * no flash and no layout shift. "Yes" sets a 30-day cookie. It cannot be closed with Escape or by
 * clicking outside, and Tab stays inside it. Policy pages and email links never show it.
 */
export function EntryGate({ name, logo, minAge }: { name: string; logo: string; minAge: number }) {
  const path = usePathname();
  const [open, setOpen] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const exempt = gateExempt(path);
  const shown = open && !exempt;

  useEffect(() => {
    if (!shown) return;
    const el = box.current;
    el?.querySelector<HTMLElement>("[data-gate-yes]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!el.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [shown]);

  if (!shown) return null;
  const enter = () => {
    const until = Date.now() + ENTRY_DAYS * 86400000;
    const secure = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${ENTRY_COOKIE}=${until}; max-age=${ENTRY_DAYS * 86400}; path=/; samesite=lax${secure}`;
    setOpen(false);
  };
  return (
    <div data-entry-gate className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto overscroll-contain bg-night/70 p-4 backdrop-blur-md sm:p-6">
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gate-title"
        aria-describedby="gate-line"
        className="w-full max-w-md rounded-3xl bg-paper px-6 pb-7 pt-9 text-center shadow-2xl sm:px-9 sm:pb-9"
      >
        <div className="flex justify-center">
          <Wordmark name={name} logo={logo} />
        </div>
        <h2 id="gate-title" className="mt-6 text-[22px] font-semibold leading-snug tracking-tight sm:text-2xl">
          Are you {minAge} or older, and purchasing for laboratory research use only?
        </h2>
        <p id="gate-line" className="mt-3 text-[15px] leading-relaxed text-stone">
          All products are sold for laboratory research use only. Not for human consumption.
        </p>
        <div className="mt-7 grid gap-2.5">
          <button type="button" data-gate-yes className="s-btn-primary w-full" onClick={enter}>
            Yes, enter
          </button>
          <button type="button" className="s-btn-line w-full" onClick={() => window.location.assign("https://www.google.com")}>
            No, leave
          </button>
        </div>
        <p className="mt-4 flex items-center justify-center gap-1 text-[13px] text-stone">
          <Link href="/terms" className="s-link inline-flex min-h-11 items-center px-2">
            Terms
          </Link>
          <span aria-hidden>·</span>
          <Link href="/research-use" className="s-link inline-flex min-h-11 items-center px-2">
            Research Use Policy
          </Link>
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Scroll reveal
/**
 * Fade and slide sections in as they scroll into view. Content is visible without it.
 *
 * Elements added AFTER this runs (a client-side page change that renders after the effect, search
 * results, a new sort, a filter) are picked up by a MutationObserver. Before that existed, those
 * elements stayed at opacity 0 forever: the shop said "11 products" over an empty grid.
 * Every element also has its own safety timer, so nothing can stay hidden.
 */
export function RevealInit() {
  const path = usePathname();
  useEffect(() => {
    if (!("IntersectionObserver" in window) || !("MutationObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const show = (el: Element) => el.classList.add("is-in");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            show(e.target);
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    const seen = new WeakSet<Element>();
    const take = (el: HTMLElement) => {
      if (seen.has(el) || el.classList.contains("is-in")) return;
      seen.add(el);
      // Anything already on screen shows at once; only what is below the fold animates in.
      if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return show(el);
      io.observe(el);
      const t = setTimeout(() => (show(el), timers.delete(t)), 2500);
      timers.add(t);
    };
    const scan = (node: ParentNode) => {
      if (node instanceof HTMLElement && node.hasAttribute("data-reveal")) take(node);
      node.querySelectorAll<HTMLElement>("[data-reveal]").forEach(take);
    };
    scan(document);
    root.classList.add("reveal-ready");
    const mo = new MutationObserver((records) => {
      for (const r of records) r.addedNodes.forEach((n) => n instanceof HTMLElement && scan(n));
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      io.disconnect();
      timers.forEach(clearTimeout);
      root.classList.remove("reveal-ready");
    };
  }, [path]);
  return null;
}

/** Installed admin app opened at "/": send the owner to the admin. */
export function StandaloneRedirect({ admin }: { admin: boolean }) {
  useEffect(() => {
    if (admin && window.matchMedia("(display-mode: standalone)").matches && window.location.pathname === "/") window.location.replace("/admin");
  }, [admin]);
  return null;
}
