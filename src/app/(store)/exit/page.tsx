import type { Metadata } from "next";

export const metadata: Metadata = { title: "Thanks for stopping by", robots: { index: false } };

export default function ExitPage() {
  return (
    <div className="s-wrap flex min-h-[60dvh] flex-col justify-center py-20">
      <h1 className="max-w-2xl text-4xl font-semibold leading-[1.05] sm:text-6xl" style={{ letterSpacing: "-0.035em" }}>
        Thanks for stopping by.
      </h1>
      <p className="mt-5 max-w-lg text-lg leading-relaxed text-stone">This store is only for adults 21 and older, so we can’t show you the catalog. You are welcome back when that changes.</p>
    </div>
  );
}
