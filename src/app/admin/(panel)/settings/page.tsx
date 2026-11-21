"use client";

import { useEffect, useState } from "react";
import { BusinessSettings } from "@/components/settings/business";
import { StoreSettingsTabs, type StoreTab } from "@/components/settings/store-settings";
import { useLoaded } from "@/components/store";
import { PageHeader, PageSkeleton, cx } from "@/components/ui";

const TABS = [
  { id: "launch", label: "Launch" },
  { id: "store", label: "Store" },
  { id: "payments", label: "Payments" },
  { id: "shipping", label: "Shipping" },
  { id: "email", label: "Email" },
  { id: "referrals", label: "Referrals" },
  { id: "backups", label: "Backups" },
  { id: "business", label: "Business and account" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function SettingsPage() {
  const s = useLoaded();
  const [tab, setTab] = useState<Tab>("launch");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && TABS.some((x) => x.id === t)) setTab(t as Tab);
  }, []);
  const go = (t: string) => {
    if (!TABS.some((x) => x.id === t)) return;
    setTab(t as Tab);
    window.history.replaceState(null, "", `/admin/settings?tab=${t}`);
  };

  if (!s) return <PageSkeleton />;
  return (
    <div>
      <PageHeader title="Settings" />
      <div role="tablist" aria-label="Settings sections" className="-mx-4 mb-5 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => go(t.id)}
            className={cx("h-10 shrink-0 whitespace-nowrap rounded-xl px-3.5 text-sm font-medium transition", tab === t.id ? "bg-accent/10 text-accent" : "text-muted hover:bg-surface2 hover:text-ink")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="max-w-3xl">{tab === "business" ? <BusinessSettings /> : <StoreSettingsTabs tab={tab as StoreTab} onTab={go} />}</div>
    </div>
  );
}
