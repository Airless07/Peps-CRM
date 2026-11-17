import type { Metadata } from "next";
import Link from "next/link";
import { RichText, TestingBadge } from "@/components/storefront/product-card";
import { storeSnapshot } from "@/lib/store/server";

export const metadata: Metadata = {
  title: "Testing and certificates of analysis",
  description: "The testing status of every product and size, with links to the certificates of analysis that are on file.",
  alternates: { canonical: "/testing" },
};

const dateText = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "");

export default async function TestingPage() {
  const { data, catalog } = await storeSnapshot();
  const { testing, quality } = data.content;
  const rows = catalog.products.flatMap((p) => p.variants.map((v) => ({ p, v })));
  const withCoa = rows.filter((r) => r.v.coa).length;

  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-14">
      <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-20">
        <div>
          <h1 className="text-4xl font-semibold leading-[1.05] sm:text-5xl" style={{ letterSpacing: "-0.03em" }}>
            {testing.title}
          </h1>
          <RichText text={testing.body} className="s-prose mt-2" />
        </div>
        <dl className="self-end divide-y divide-rule border-y border-rule">
          {quality.points
            .filter((p) => p.title.trim())
            .map((p, i) => (
              <div key={i} className="py-4">
                <dt className="font-semibold">{p.title}</dt>
                <dd className="mt-0.5 text-[15px] leading-relaxed text-stone">{p.text}</dd>
              </div>
            ))}
        </dl>
      </div>

      <section className="mt-16">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <h2 className="s-h2">Status by product</h2>
          <p className="text-sm text-stone">
            {withCoa} of {rows.length} {rows.length === 1 ? "size has" : "sizes have"} a certificate on file
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-rule px-6 py-16 text-center text-stone">No products are listed yet.</p>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-hidden rounded-2xl border border-rule md:block">
              <table className="w-full text-left text-[15px]">
                <thead className="bg-soft text-sm text-stone">
                  <tr>
                    <th scope="col" className="px-5 py-3.5 font-medium">Product</th>
                    <th scope="col" className="px-4 py-3.5 font-medium">Size</th>
                    <th scope="col" className="px-4 py-3.5 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3.5 font-medium">Lot</th>
                    <th scope="col" className="px-4 py-3.5 font-medium">Tested</th>
                    <th scope="col" className="px-5 py-3.5 text-right font-medium">Certificate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {rows.map(({ p, v }) => (
                    <tr key={v.id}>
                      <th scope="row" className="px-5 py-4 font-semibold">
                        <Link href={`/product/${p.slug}`} className="hover:text-brand">
                          {p.name}
                        </Link>
                      </th>
                      <td className="px-4 py-4 text-stone">{v.label || "—"}</td>
                      <td className="px-4 py-4">
                        <TestingBadge v={v} link={false} />
                      </td>
                      <td className="px-4 py-4 tabular-nums text-stone">{v.coa?.lot || "—"}</td>
                      <td className="px-4 py-4 tabular-nums text-stone">{dateText(v.coa?.testDate ?? null) || "—"}</td>
                      <td className="px-5 py-4 text-right">
                        {v.coa ? (
                          <a href={v.coa.url} target="_blank" rel="noreferrer" className="s-link" aria-label={`View COA for ${p.name} ${v.label}`}>
                            View COA
                          </a>
                        ) : (
                          <span className="text-stone">Not posted yet</span>
                        )}
                        {v.olderCoas.length > 0 && <span className="ml-2 text-[13px] text-stone">+{v.olderCoas.length} earlier</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Phone list */}
            <ul className="divide-y divide-rule border-y border-rule md:hidden">
              {rows.map(({ p, v }) => (
                <li key={v.id} className="py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link href={`/product/${p.slug}`} className="font-semibold">
                      {p.name}
                      {v.label && <span className="ml-2 font-normal text-stone">{v.label}</span>}
                    </Link>
                    {v.coa ? (
                      <a href={v.coa.url} target="_blank" rel="noreferrer" className="s-link shrink-0 text-[15px]">
                        View COA
                      </a>
                    ) : null}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <TestingBadge v={v} link={false} />
                    {v.coa && <span className="text-[13px] tabular-nums text-stone">{[v.coa.lot ? `Lot ${v.coa.lot}` : "", dateText(v.coa.testDate)].filter(Boolean).join(" · ")}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
