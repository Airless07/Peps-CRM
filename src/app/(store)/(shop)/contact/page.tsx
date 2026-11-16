import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/storefront/forms";
import { currentAccount } from "@/lib/account";
import { storeSnapshot } from "@/lib/store/server";

export const metadata: Metadata = { title: "Contact", description: "Questions about an order, shipping or a certificate of analysis? Send us a message.", alternates: { canonical: "/contact" } };

export default async function ContactPage() {
  const [{ data }, account] = await Promise.all([storeSnapshot(), currentAccount()]);
  const c = data.content.contact;
  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-16">
      <div className="grid gap-12 lg:grid-cols-[1fr_1.3fr] lg:gap-24">
        <div>
          <h1 className="text-4xl font-semibold leading-[1.05] sm:text-5xl" style={{ letterSpacing: "-0.03em" }}>
            Contact
          </h1>
          {c.note && <p className="mt-4 max-w-sm text-[1.0625rem] leading-relaxed text-stone">{c.note}</p>}
          <dl className="mt-8 space-y-5 text-[15px]">
            {c.email && (
              <div>
                <dt className="text-stone">Email</dt>
                <dd>
                  <a href={`mailto:${c.email}`} className="s-link">
                    {c.email}
                  </a>
                </dd>
              </div>
            )}
            {c.phone && (
              <div>
                <dt className="text-stone">Phone</dt>
                <dd className="font-medium tabular-nums">{c.phone}</dd>
              </div>
            )}
            {c.hours && (
              <div>
                <dt className="text-stone">Hours</dt>
                <dd className="font-medium">{c.hours}</dd>
              </div>
            )}
            <div>
              <dt className="text-stone">Checking on an order?</dt>
              <dd>
                <Link href="/order-lookup" className="s-link">
                  Look it up with your order number
                </Link>
              </dd>
            </div>
          </dl>
        </div>
        <ContactForm account={account ? { name: account.name, email: account.email } : null} />
      </div>
    </div>
  );
}
