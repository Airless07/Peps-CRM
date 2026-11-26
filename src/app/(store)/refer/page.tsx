import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FaqList } from "@/components/storefront/product-card";
import { currentAccount } from "@/lib/account";
import { storeSnapshot } from "@/lib/store/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { data } = await storeSnapshot();
  return {
    title: "Refer & Earn",
    description: `Share your code and earn ${data.store.referrals.percent}% of your friends' orders in store credit at ${data.store.storeName}.`,
    alternates: { canonical: "/refer" },
  };
}

/** Public page that explains the referral program. Every number comes from Settings, never hardcoded. */
export default async function ReferPage() {
  const [{ data }, account] = await Promise.all([storeSnapshot(), currentAccount()]);
  const { percent, buyerDiscountPercent } = data.store.referrals;
  const name = data.store.storeName;
  const signedIn = !!account && !account.mustChangePassword;
  const steps = [
    { title: "Create a free account", body: "You get your own referral code automatically." },
    { title: "Customize your code and share it", body: "Pick a code that is easy to remember, then send it or your share link to friends." },
    { title: "Earn store credit", body: `When they order with your code, you earn ${percent}% of their order in store credit once the order is paid.` },
  ];
  const faq = [
    { q: "Can I use my own code?", a: "No. Your code is for friends. It can't be used on your own orders, by your account, your email or your shipping address." },
    { q: "When does credit show up?", a: "As pending as soon as your friend places an order with your code. It becomes usable once that order is paid." },
    { q: "What if an order is refunded?", a: "The credit from that order is removed (in part for a partial refund). If you already used it, your balance can go below $0 and new credit pays it back first." },
    { q: "Can I change my code?", a: "Yes, anytime, as long as the new code isn't taken. Your old code stops working right away, and the credit you earned stays." },
    { q: "Does my code expire?", a: "No. It works on every order a friend places with it." },
    { q: "Is this cash?", a: `No. It is store credit for ${name}, used at checkout like a discount.` },
  ];
  return (
    <div className="pb-8" data-refer-page>
      <section className="border-b border-rule bg-soft">
        <div className="s-wrap py-14 sm:py-20">
          <p className="text-sm font-medium text-brand">Refer &amp; Earn</p>
          <h1 className="mt-4 max-w-3xl text-[2.6rem] font-semibold leading-[1.03] sm:text-6xl" style={{ letterSpacing: "-0.035em" }}>
            Share your code. Earn store credit.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-stone" data-refer-numbers>
            Earn {percent}% of every order your friends place with your code, as store credit.
            {buyerDiscountPercent > 0 ? ` Your friends get ${buyerDiscountPercent}% off.` : ""}
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            {signedIn ? (
              <Link href="/account/referrals" className="s-btn-primary" data-refer-cta>
                Go to my referral dashboard <ArrowRight size={17} />
              </Link>
            ) : (
              <Link href="/account/referrals" className="s-btn-primary" data-refer-cta>
                Create an account <ArrowRight size={17} />
              </Link>
            )}
            <Link href="/shop" className="s-btn-line">
              Shop all products
            </Link>
          </div>
        </div>
      </section>

      <section className="s-wrap py-14 sm:py-20">
        <h2 className="text-3xl font-semibold" style={{ letterSpacing: "-0.02em" }}>
          How it works
        </h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-3" data-refer-steps>
          {steps.map((s, i) => (
            <li key={s.title} className="rounded-2xl border border-rule p-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-coal text-[15px] font-semibold tabular-nums">{i + 1}</span>
              <h3 className="mt-5 text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-stone">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="s-wrap grid gap-10 pb-6 lg:grid-cols-[1fr_1.7fr] lg:gap-20">
        <div>
          <h2 className="text-3xl font-semibold" style={{ letterSpacing: "-0.02em" }}>
            Questions
          </h2>
          <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-stone" data-refer-rules>
            <strong className="font-semibold text-coal">Rules.</strong> One code per order. No self-referrals. Credit is reversed on refunds or cancellations. No posting codes on coupon sites. No health or medical claims when sharing: all products are for research use only. {name} can remove codes or credit that break these rules.
          </p>
        </div>
        <FaqList items={faq} />
      </section>
    </div>
  );
}
