"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Download, LogOut, Plus, Upload, X } from "lucide-react";
import { api, useLoaded } from "@/components/store";
import { useToast } from "@/components/toast";
import { Button, Card, Field, Input, MoneyInput, NumberInput, PageSkeleton, SectionTitle, Segmented, useConfirm } from "@/components/ui";
import { fromLocalInput, toLocalDateInput } from "@/lib/format";
import { getThemePref, setThemePref, type ThemePref } from "@/lib/theme";
import type { SettingsRec, TipHandling } from "@/lib/types";

const TABLES = ["customers", "products", "purchases", "adjustments", "orders", "order_lines", "labels", "splits", "split_items", "payouts", "settings"];

/** The original back office settings: money rules, partners, Sell-screen payment methods, appearance, password, exports. */
export function BusinessSettings() {
  const s = useLoaded();
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<SettingsRec | null>(null);
  const [theme, setTheme] = useState<ThemePref>("system");
  const [pw, setPw] = useState({ current: "", next: "", again: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => setTheme(getThemePref()), []);
  useEffect(() => {
    if (s && !form) setForm(s.data.settings);
  }, [s, form]);

  if (!s || !form) return <PageSkeleton />;
  const { data, mutate, refresh } = s;
  const dirty = JSON.stringify(form) !== JSON.stringify(data.settings);
  const set = <K extends keyof SettingsRec>(k: K, v: SettingsRec[K]) => setForm({ ...form, [k]: v });

  async function save() {
    const f = { ...form!, paymentMethods: form!.paymentMethods.map((m) => m.trim()) };
    const ok = await mutate((d) => ({ ...d, settings: f }), () => api("/api/settings", "PATCH", f));
    if (ok) toast.show({ message: "Settings saved" });
  }

  async function changePassword() {
    if (pw.next !== pw.again) return toast.show({ message: "New passwords don’t match", tone: "error" });
    setPwBusy(true);
    try {
      await api("/api/settings/password", "POST", { current: pw.current, next: pw.next });
      setPw({ current: "", next: "", again: "" });
      toast.show({ message: "Password changed" });
    } catch (e) {
      toast.show({ message: (e as Error).message, tone: "error" });
    }
    setPwBusy(false);
  }

  async function importFile(file: File) {
    let json: unknown;
    try {
      json = JSON.parse(await file.text());
    } catch {
      return toast.show({ message: "That file isn’t valid JSON", tone: "error" });
    }
    const ok = await confirm({
      title: "Import this backup?",
      body: "This replaces ALL current data (products, orders, customers, promotions, reviews, money, splits, payouts and settings) with the backup. Your password stays the same. Uploaded photos and COA files are not part of the file.",
      confirmText: "Replace everything",
      danger: true,
    });
    if (!ok) return;
    try {
      await api("/api/import", "POST", json);
      await refresh();
      setForm(null);
      toast.show({ message: "Backup imported" });
    } catch (e) {
      toast.show({ message: (e as Error).message, tone: "error" });
    }
  }

  async function reset() {
    const ok = await confirm({
      title: "Reset all data?",
      body: "Deletes every product, restock, adjustment, order, split and payout, and resets settings to defaults. This can’t be undone. Export a backup first.",
      confirmText: "Delete everything",
      danger: true,
      typeToConfirm: "RESET",
    });
    if (!ok) return;
    try {
      await api("/api/reset", "POST", { confirm: "RESET" });
      await refresh();
      setForm(null);
      toast.show({ message: "All data was reset" });
    } catch (e) {
      toast.show({ message: (e as Error).message, tone: "error" });
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/admin/login";
  }

  return (
    <div className="pb-20">
      <SectionTitle>Business</SectionTitle>
      <Card className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starting balance" hint="Negative = money still owed back">
            <MoneyInput allowNegative value={form.startingBalanceCents} onChange={(c) => set("startingBalanceCents", c ?? 0)} />
          </Field>
          <Field label="Start date">
            <Input type="date" value={toLocalDateInput(form.startDate)} onChange={(e) => e.target.value && set("startDate", fromLocalInput(e.target.value + "T00:00"))} />
          </Field>
        </div>
        <Field label="Business cut of profit" hint="Applies to new sales. Past sales keep the cut they were made with.">
          <NumberInput value={form.businessCutPercent} min={0} max={100} step={0.5} suffix="%" onChange={(n) => set("businessCutPercent", n ?? 0)} />
        </Field>
        <Field label="Tips">
          <Segmented<TipHandling>
            size="sm"
            value={form.tipHandling}
            onChange={(v) => set("tipHandling", v)}
            options={[
              { value: "profit", label: "Treat as profit" },
              { value: "seller", label: "To seller" },
              { value: "business", label: "To business" },
            ]}
          />
        </Field>
      </Card>

      <SectionTitle>Payment methods on the Sell screen</SectionTitle>
      <Card className="p-4">
        <PaymentMethodsEditor value={form.paymentMethods} onChange={(v) => set("paymentMethods", v)} />
      </Card>

      <SectionTitle>Partners</SectionTitle>
      <Card className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Partner 1">
            <Input value={form.partnerAName} onChange={(e) => set("partnerAName", e.target.value)} />
          </Field>
          <Field label="Partner 2">
            <Input value={form.partnerBName} onChange={(e) => set("partnerBName", e.target.value)} />
          </Field>
        </div>
        <Field label={`Split ratio: ${form.partnerAName || "Partner 1"} ${form.partnerARatio}% / ${form.partnerBName || "Partner 2"} ${100 - form.partnerARatio}%`}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={form.partnerARatio}
              onChange={(e) => set("partnerARatio", Number(e.target.value))}
              className="h-12 flex-1 accent-[rgb(var(--accent))]"
            />
            <NumberInput className="w-24" value={form.partnerARatio} min={0} max={100} step={0.5} suffix="%" onChange={(n) => set("partnerARatio", n ?? 0)} />
          </div>
        </Field>
        <Field label="Default “sold by”">
          <Segmented
            value={form.defaultSoldBy}
            onChange={(v) => set("defaultSoldBy", v)}
            options={[
              { value: "A", label: form.partnerAName || "Partner 1" },
              { value: "B", label: form.partnerBName || "Partner 2" },
            ]}
          />
        </Field>
      </Card>

      <SectionTitle>Inventory</SectionTitle>
      <Card className="p-4">
        <Field label="Default low stock warning" hint="A product shows “Low stock” at or below this number. Each size can set its own.">
          <NumberInput value={form.lowStockThreshold} min={0} onChange={(n) => set("lowStockThreshold", n ?? 0)} />
        </Field>
      </Card>

      <SectionTitle>Appearance</SectionTitle>
      <Card className="p-4">
        <Segmented<ThemePref>
          value={theme}
          onChange={(v) => {
            setTheme(v);
            setThemePref(v);
          }}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Card>

      <SectionTitle>Admin password</SectionTitle>
      <Card className="space-y-3 p-4">
        {/* Gives the browser a username to pair these passwords with, so it does not pick the search box. */}
        <input type="text" name="username" autoComplete="username" value="admin" readOnly hidden aria-hidden="true" tabIndex={-1} />
        <Field label="Current password">
          <Input type="password" name="current-password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="New password">
            <Input type="password" name="new-password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
          <Field label="Repeat new">
            <Input type="password" name="new-password-repeat" autoComplete="new-password" value={pw.again} onChange={(e) => setPw({ ...pw, again: e.target.value })} />
          </Field>
        </div>
        <Button disabled={pwBusy || !pw.current || pw.next.length < 6} onClick={changePassword}>
          Change password
        </Button>
        <p className="text-xs text-muted">At least 6 characters. After this, APP_PASSWORD no longer works.</p>
      </Card>

      <SectionTitle>Export and import</SectionTitle>
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap gap-2">
          <a href="/api/export?table=json" download>
            <Button variant="soft">
              <Download size={17} /> Download JSON backup
            </Button>
          </a>
          <Button onClick={() => fileRef.current?.click()}>
            <Upload size={17} /> Import backup
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) importFile(f);
            }}
          />
        </div>
        <div>
          <div className="mb-2 text-sm text-muted">CSV per table</div>
          <div className="flex flex-wrap gap-2">
            {TABLES.map((t) => (
              <a key={t} href={`/api/export?table=${t}`} download className="rounded-lg border border-line px-3 py-1.5 text-sm transition hover:bg-surface2">
                {t.replace("_", " ")}
              </a>
            ))}
          </div>
        </div>
      </Card>

      <SectionTitle>Danger zone</SectionTitle>
      <Card className="flex items-center justify-between gap-3 border-neg/30 p-4">
        <div>
          <div className="font-medium">Reset all data</div>
          <div className="text-sm text-muted">Delete everything and start over.</div>
        </div>
        <Button variant="danger" onClick={reset}>
          Reset
        </Button>
      </Card>

      <div className="mt-8">
        <Button variant="ghost" onClick={logout} className="text-muted">
          <LogOut size={17} /> Sign out
        </Button>
      </div>

      {dirty && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-30 animate-toast-in px-3 md:bottom-6 md:left-64 md:px-8">
          <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-2xl border border-line bg-surface p-2 shadow-xl">
            <span className="flex-1 px-3 text-sm text-muted">Unsaved changes</span>
            <Button variant="ghost" onClick={() => setForm(data.settings)}>
              Discard
            </Button>
            <Button variant="primary" onClick={save} disabled={!form.partnerAName.trim() || !form.partnerBName.trim() || !!methodsError(form.paymentMethods)}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function methodsError(list: string[]): string | null {
  const clean = list.map((m) => m.trim());
  if (clean.length === 0) return "Keep at least one payment method";
  if (clean.some((m) => !m)) return "Payment method names can’t be empty";
  if (new Set(clean.map((m) => m.toLowerCase())).size !== clean.length) return "Each payment method needs a different name";
  return null;
}

/** Add, rename, reorder and remove the methods offered at checkout. Old orders keep the name they were saved with. */
function PaymentMethodsEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [adding, setAdding] = useState("");
  const error = methodsError(value);
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const add = () => {
    const m = adding.trim();
    if (!m) return;
    if (value.some((x) => x.trim().toLowerCase() === m.toLowerCase())) return;
    onChange([...value, m]);
    setAdding("");
  };
  const iconBtn =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition hover:bg-surface2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {value.map((m, i) => (
          <div key={i} className="flex items-center gap-1">
            <Input
              value={m}
              maxLength={40}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))}
              aria-label={`Payment method ${i + 1}`}
              className="flex-1"
            />
            <button type="button" className={iconBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${m} up`}>
              <ArrowUp size={17} />
            </button>
            <button type="button" className={iconBtn} disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${m} down`}>
              <ArrowDown size={17} />
            </button>
            <button
              type="button"
              className={iconBtn}
              disabled={value.length <= 1}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              aria-label={`Remove ${m}`}
            >
              <X size={17} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={adding}
          maxLength={40}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="New payment method"
          className="flex-1"
        />
        <Button onClick={add} disabled={!adding.trim()}>
          <Plus size={17} /> Add
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-neg">{error}</p>
      ) : (
        <p className="text-xs text-muted">Shown in this order at checkout. Renaming or removing one never changes past orders.</p>
      )}
    </div>
  );
}
