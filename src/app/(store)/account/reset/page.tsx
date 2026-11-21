import type { Metadata } from "next";
import Link from "next/link";
import { ResetForm } from "@/components/storefront/forms";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="s-wrap pb-8 pt-10 sm:pt-14">
      <div className="mx-auto max-w-md">
        <h1 className="text-4xl font-semibold" style={{ letterSpacing: "-0.03em" }}>
          Choose a new password
        </h1>
        {token ? (
          <div className="mt-7">
            <ResetForm token={token} />
          </div>
        ) : (
          <>
            <p className="mt-3 text-[1.0625rem] leading-relaxed text-stone">This page needs the link from your reset email. Ask for a new one from the sign in form.</p>
            <Link href="/account" className="s-btn-primary mt-6">
              Go to sign in
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
