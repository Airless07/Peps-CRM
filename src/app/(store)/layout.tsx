import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { GeistSans } from "geist/font/sans";
import { currentAccount } from "@/lib/account";
import { AgeGate, Header, PromoBar, RevealInit, StandaloneRedirect, Wordmark, type PromoItem } from "@/components/storefront/chrome";
import { TrackVisit } from "@/components/storefront/analytics";
import { CartProvider } from "@/components/storefront/cart";
import { siteUrl } from "@/lib/order-ops";
import { DEFAULT_ACCENT, RESEARCH_LINE, TAGLINE, type SiteContent, type StoreSettings } from "@/lib/store/config";
import { promoHeadlines } from "@/lib/store/pricing";
import { isAdmin, storeSnapshot } from "@/lib/store/server";
import type { PromotionRec } from "@/lib/types";
import "./store.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { data } = await storeSnapshot();
  const { store, content } = data;
  const base = siteUrl(store);
  const image = content.seo.image ? `/media/${content.seo.image}-1600.webp` : "/og";
  return {
    metadataBase: new URL(base),
    title: { default: content.seo.title || store.storeName, template: `%s | ${store.storeName}` },
    description: content.seo.description,
    applicationName: store.storeName,
    icons: store.favicon ? { icon: `/media/${store.favicon}.png`, apple: `/media/${store.favicon}.png` } : { icon: "/icon.svg", apple: "/apple-icon" },
    openGraph: { type: "website", siteName: store.storeName, title: content.seo.title || store.storeName, description: content.seo.description, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title: content.seo.title || store.storeName, description: content.seo.description, images: [image] },
    // A closed store is not indexed.
    robots: store.open ? { index: true, follow: true } : { index: false, follow: false },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

function promoItems(content: SiteContent, promotions: PromotionRec[], now: Date, shippingTiers: StoreSettings["shippingTiers"]): PromoItem[] {
  const a = content.announcement;
  if (a.mode === "off") return [];
  if (a.mode === "custom") {
    if (!a.text.trim()) return [];
    if (a.startsAt && new Date(a.startsAt) > now) return [];
    if (a.endsAt && new Date(a.endsAt) < now) return [];
    return [{ text: a.text.trim(), code: a.code.trim() }];
  }
  return promoHeadlines(promotions, now, shippingTiers);
}

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const [{ data, catalog }, admin, account] = await Promise.all([storeSnapshot(), isAdmin(), currentAccount()]);
  const { store, content } = data;
  const live = store.open || admin;
  const promos = live ? promoItems(content, data.promotions, new Date(), data.store.shippingTiers) : [];
  const accent = /^#[0-9a-fA-F]{6}$/.test(store.accentColor) ? store.accentColor : DEFAULT_ACCENT;
  const year = new Date().getFullYear();

  return (
    <html lang="en" className={GeistSans.variable}>
      <body className="store min-h-dvh" style={{ ["--s-brand" as string]: accent }}>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-full focus:bg-coal focus:px-4 focus:py-2 focus:text-sm focus:text-white">
          Skip to content
        </a>
        <CartProvider products={live ? catalog.products : []} accountId={account?.id ?? null}>
          <StandaloneRedirect admin={admin} />
          {!store.open && admin && (
            <div className="bg-coal px-4 py-2 text-center text-[13px] text-white">
              Preview: the store is closed. Visitors see “Coming soon”.{" "}
              <Link href="/admin/settings?tab=launch" className="font-semibold underline underline-offset-4">
                Open the store
              </Link>{" "}
              ·{" "}
              <Link href="/admin" className="font-semibold underline underline-offset-4">
                Back to admin
              </Link>
            </div>
          )}
          {live ? (
            <div className="sticky top-0 z-40">
              <PromoBar items={promos} />
              <Header name={store.storeName} logo={store.logo} signedIn={!!account} />
            </div>
          ) : (
            <header className="s-wrap flex h-16 items-center">
              <Link href="/" aria-label={`${store.storeName} home`} className="tap">
                <Wordmark name={store.storeName} logo={store.logo} />
              </Link>
            </header>
          )}

          <main id="main" className="page-in">
            {children}
          </main>

          <footer className="mt-24 border-t border-rule bg-soft">
            {live && (
              <div className="s-wrap grid grid-cols-2 gap-x-8 gap-y-10 py-14 sm:grid-cols-3 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
                <div className="col-span-2 max-w-xs sm:col-span-3 lg:col-span-1">
                  <Wordmark name={store.storeName} logo={store.logo} />
                  <p className="mt-4 text-[15px] leading-relaxed text-stone">{content.footerText || TAGLINE}</p>
                  {(content.contact.email || content.contact.phone) && (
                    <p className="mt-4 text-[15px] leading-relaxed text-coal">
                      {content.contact.email && (
                        <a href={`mailto:${content.contact.email}`} className="block hover:text-brand">
                          {content.contact.email}
                        </a>
                      )}
                      {content.contact.phone && <span className="block tabular-nums">{content.contact.phone}</span>}
                    </p>
                  )}
                </div>
                <FooterCol
                  title="Shop"
                  links={[
                    ["/shop", "All products"],
                    ["/collections", "Collections"],
                    ["/testing", "Testing and COAs"],
                    ["/cart", "Cart"],
                  ]}
                />
                <FooterCol
                  title="Help"
                  links={[
                    ["/order-lookup", "Order lookup"],
                    ["/account", "Your account"],
                    ["/refer", "Refer & Earn"],
                    ["/contact", "Contact"],
                    ["/faq", "FAQ"],
                    ["/about", "About"],
                  ]}
                />
                <FooterCol
                  title="Policies"
                  links={[
                    ["/terms", "Terms"],
                    ["/privacy", "Privacy"],
                    ["/shipping", "Shipping"],
                    ["/refunds", "Refunds"],
                    ["/research-use", "Research use"],
                  ]}
                />
              </div>
            )}
            <div className={live ? "border-t border-rule" : ""}>
              <div className="s-wrap flex flex-col gap-3 py-6 text-[13px] leading-relaxed text-stone sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-2xl">{RESEARCH_LINE}</p>
                <p className="shrink-0">
                  © {year} {store.storeName}
                  {!live && (
                    <>
                      {" · "}
                      <Link href="/terms" className="underline underline-offset-4">
                        Terms
                      </Link>
                      {" · "}
                      <Link href="/privacy" className="underline underline-offset-4">
                        Privacy
                      </Link>
                    </>
                  )}
                </p>
              </div>
            </div>
          </footer>
          {live && <AgeGate name={store.storeName} />}
          <RevealInit />
          {store.open && !admin && <TrackVisit />}
        </CartProvider>
      </body>
    </html>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <nav aria-label={title}>
      <h2 className="text-sm font-semibold !tracking-normal text-coal">{title}</h2>
      <ul className="mt-2">
        {links.map(([href, label]) => (
          <li key={href}>
            <Link href={href} className="inline-flex min-h-11 items-center text-[15px] text-stone transition hover:text-brand">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
