"use client";

// Store chrome: promo bar, header (nav, search, account, cart), age gate, scroll reveal.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Menu, Search, ShoppingBag, User, X } from "lucide-react";
import type { PublicProduct } from "@/lib/store/catalog";
import { money, useCart } from "./cart";
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
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-white/30 px-2.5 font-semibold tracking-wider transition hover:border-white/70"
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
            className="inline-flex h-7 items-center rounded-full bg-white px-3 font-semibold text-coal transition hover:bg-white/85"
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
  { href: "/faq", label: "FAQ" },
];

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
        <Link href="/" aria-label={`${name} home`} className="mr-auto shrink-0 lg:mr-0 lg:w-56">
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
          <Link href="/account" className={`${icon} hidden sm:flex`} aria-label={signedIn ? "Your account" : "Sign in"}>
            <User size={20} strokeWidth={1.75} />
          </Link>
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

// ---------------------------------------------------------------- Age gate
const AGE_KEY = "bp-age";
const AGE_DAYS = 30;

export function AgeGate({ name }: { name: string }) {
  const path = usePathname();
  const router = useRouter();
  const [need, setNeed] = useState(false);
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Policy pages stay readable so the Terms can be read before agreeing.
  const exempt = /^\/(exit|terms|privacy|shipping|refunds|research-use)$/.test(path);

  useEffect(() => {
    try {
      const until = Number(localStorage.getItem(AGE_KEY) ?? 0);
      setNeed(!(until > Date.now()));
    } catch {
      setNeed(true);
    }
  }, []);
  useEffect(() => {
    if (need && !exempt) {
      document.body.style.overflow = "hidden";
      box.current?.focus();
      return () => void (document.body.style.overflow = "");
    }
  }, [need, exempt]);

  if (!need || exempt) return null;
  const check = (on: boolean, set: (v: boolean) => void, children: React.ReactNode) => (
    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3.5 text-left text-[15px] leading-snug transition ${on ? "border-coal bg-soft" : "border-rule"}`}>
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--s-brand)]" />
      <span>{children}</span>
    </label>
  );
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-night/60 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby="age-title" tabIndex={-1} className="w-full max-w-md animate-rise-in rounded-t-3xl bg-paper px-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-8 text-center shadow-2xl outline-none sm:rounded-3xl sm:px-9 sm:pb-9" style={{ animationDuration: ".5s" }}>
        <div className="text-sm font-extrabold uppercase tracking-[0.2em]">{name}</div>
        <h2 id="age-title" className="mt-5 text-2xl font-semibold tracking-tight">
          Please confirm before you enter
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-stone">Products on this site are sold for laboratory research use only. They are not for human consumption.</p>
        <div className="mt-6 space-y-2.5">
          {check(age, setAge, <>I am 21 years of age or older.</>)}
          {check(
            terms,
            setTerms,
            <>
              I agree to the{" "}
              <Link href="/terms" className="s-link">
                Terms
              </Link>
              .
            </>,
          )}
        </div>
        <button
          type="button"
          disabled={!age || !terms}
          className="s-btn-primary mt-5 w-full"
          onClick={() => {
            try {
              localStorage.setItem(AGE_KEY, String(Date.now() + AGE_DAYS * 86400000));
            } catch {}
            setNeed(false);
          }}
        >
          Enter site
        </button>
        <button type="button" className="mt-2 h-11 w-full text-[15px] font-medium text-stone underline decoration-rule underline-offset-4 hover:text-coal" onClick={() => router.push("/exit")}>
          No, I am under 21
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Scroll reveal
/** Fade and slide sections in as they scroll into view. Content is visible without it. */
export function RevealInit() {
  const path = usePathname();
  useEffect(() => {
    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    const els = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
    if (els.length === 0) return;
    // Anything already on screen stays put; only what is below the fold animates in.
    for (const el of els) if (el.getBoundingClientRect().top < window.innerHeight * 0.92) el.classList.add("is-in");
    root.classList.add("reveal-ready");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
    els.forEach((el) => !el.classList.contains("is-in") && io.observe(el));
    // Safety net: never leave anything hidden.
    const t = setTimeout(() => els.forEach((el) => el.classList.add("is-in")), 4000);
    return () => {
      io.disconnect();
      clearTimeout(t);
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
