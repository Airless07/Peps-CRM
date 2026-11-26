"use client";

// "Your friend's code CODE is saved." on the Coming soon page, after a referral share link (?ref=CODE).
// The middleware saved the code in a cookie for 30 days; the cart applies it at checkout once the store opens.
import { useEffect, useState } from "react";
import { REF_COOKIE, cleanRefCode } from "@/lib/store/referral-cookie";

export function readRefCookie(): string {
  try {
    const m = document.cookie.split("; ").find((c) => c.startsWith(`${REF_COOKIE}=`));
    return m ? cleanRefCode(decodeURIComponent(m.slice(REF_COOKIE.length + 1))) : "";
  } catch {
    return "";
  }
}

export function SavedReferral() {
  const [code, setCode] = useState("");
  useEffect(() => setCode(readRefCookie()), []);
  if (!code) return null;
  return (
    <p className="mt-5 max-w-xl rounded-2xl bg-brand-tint px-5 py-4 text-[15px] text-coal" data-saved-referral>
      Your friend&apos;s code <strong className="font-semibold">{code}</strong> is saved. It&apos;ll be applied when the store opens.
    </p>
  );
}
