"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Mail, Plus, Trash2 } from "lucide-react";
import { moved, SingleImage } from "@/components/inventory/media";
import { api, useLoaded } from "@/components/store";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, PageSkeleton, SectionTitle, Segmented, Textarea, Toggle, cx, useConfirm } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { DEFAULT_CONTENT, POLICY_IDS, type PolicyId, type SiteContent } from "@/lib/store/config";
import { RECOMMENDED_SIZES } from "@/lib/store/sizes";

const TABS = [
  { id: "home", label: "Home page" },
  { id: "pages", label: "Pages and text" },
  { id: "policies", label: "Policies" },
  { id: "seo", label: "SEO and sharing" },
  { id: "messages", label: "Messages" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const SECTION_HELP: Record<string, string> = {
  bestsellers: "Top products (automatic or manual, see Settings).",
  groups: "Your product groups as collection tiles.",
  products: "Every product on the website.",
  quality: "The testing and COA section.",
  reviews: "Published store experience reviews.",
  faq: "The first few questions from the FAQ.",
};
const POLICY_PATH: Record<PolicyId, string> = { terms: "/terms", privacy: "/privacy", shipping: "/shipping", refunds: "/refunds", "research-use": "/research-use" };

export default function ContentPage() {
  const s = useLoaded();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("home");
  const [c, setC] = useState<SiteContent | null>(null);
  const [policy, setPolicy] = useState<PolicyId>("terms");

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && TABS.some((x) => x.id === t)) setTab(t as Tab);
  }, []);
  useEffect(() => {
    if (s && !c) setC(s.data.content);
  }, [s, c]);

  if (!s || !c) return <PageSkeleton />;
  const { data, mutate } = s;
  const dirty = JSON.stringify(c) !== JSON.stringify(data.content);
  const set = <K extends keyof SiteContent>(k: K, v: SiteContent[K]) => setC({ ...c, [k]: v });
  const hero = c.hero;
  const setHero = <K extends keyof SiteContent["hero"]>(k: K, v: SiteContent["hero"][K]) => set("hero", { ...hero, [k]: v });
  const unhandled = data.messages.filter((m) => !m.handled).length;

  async function save() {
    const ok = await mutate((d) => ({ ...d, content: c! }), () => api("/api/settings", "PATCH", { content: c }));
    if (ok) toast.show({ message: "Saved. The store is updated.", tone: "success" });
  }

  const go = (t: Tab) => {
    setTab(t);
    window.history.replaceState(null, "", `/admin/content?tab=${t}`);
  };

  return (
    <div>
      <PageHeader
        title="Content"
        sub="Everything visitors read on the store. No code needed."
        actions={
          <a href="/" target="_blank" rel="noreferrer">
            <Button>View store</Button>
          </a>
        }
      />
      <div role="tablist" aria-label="Content sections" className="-mx-4 mb-5 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => go(t.id)}
            className={cx("flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3.5 text-sm font-medium transition", tab === t.id ? "bg-accent/10 text-accent" : "text-muted hover:bg-surface2 hover:text-ink")}
          >
            {t.label}
            {t.id === "messages" && unhandled > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-ink">{unhandled}</span>}
          </button>
        ))}
      </div>

      <div className="max-w-3xl pb-24">
        {tab === "home" && (
          <>
            <SectionTitle>Hero (top of the home page)</SectionTitle>
            <Card className="space-y-5 p-4">
              <Field label="Layout" hint={hero.layout === "full" ? "The photo fills the screen with the text on top of it." : "Text on one side, photo on the other."}>
                <Segmented
                  className="max-w-sm"
                  value={hero.layout}
                  onChange={(v) => setHero("layout", v)}
                  options={[
                    { value: "full", label: "Full-screen photo" },
                    { value: "split", label: "Split image / text" },
                  ]}
                />
              </Field>
              <div>
                <div className="mb-1.5 text-sm font-medium text-muted">Hero photo</div>
                <SingleImage value={hero.image} onChange={(id) => setHero("image", id)} kind="hero" hint={`${RECOMMENDED_SIZES.hero} Optional. Without a photo, the hero shows the three vials below on a light background.`} />
              </div>
              <div>
                <div className="mb-1.5 text-sm font-medium text-muted">Hero vials</div>
                <p className="mb-3 rounded-lg bg-surface2 px-3 py-2 text-sm text-muted">
                  Upload transparent PNGs (no background, vial only, standing upright). The center vial is shown larger and in front. Leave a slot empty to keep the built-in vial.
                </p>
                <div className="space-y-3">
                  {(
                    [
                      ["left", "Hero vial left"],
                      ["center", "Hero vial center"],
                      ["right", "Hero vial right"],
                    ] as const
                  ).map(([slot, label]) => (
                    <div key={slot}>
                      <div className="mb-1 text-sm font-medium">{label}</div>
                      <SingleImage value={hero.vials[slot]} onChange={(id) => setHero("vials", { ...hero.vials, [slot]: id })} kind="vial" shape="square" hint={RECOMMENDED_SIZES.vial} />
                    </div>
                  ))}
                </div>
              </div>
              {hero.layout === "full" && (
                <Field label={`Overlay strength: ${hero.overlay}%`} hint="How dark the photo is behind the text. Raise it if the text is hard to read.">
                  <input type="range" min={0} max={85} step={5} value={hero.overlay} onChange={(e) => setHero("overlay", Number(e.target.value))} className="h-10 w-full accent-[rgb(var(--accent))]" />
                </Field>
              )}
              <Field label="Small line above the headline (optional)">
                <Input value={hero.eyebrow} maxLength={60} onChange={(e) => setHero("eyebrow", e.target.value)} />
              </Field>
              <Field label="Headline">
                <Textarea value={hero.headline} maxLength={120} className="min-h-[64px]" onChange={(e) => setHero("headline", e.target.value)} />
              </Field>
              <Field label="Subtext">
                <Textarea value={hero.subtext} maxLength={260} className="min-h-[76px]" onChange={(e) => setHero("subtext", e.target.value)} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Button text">
                  <Input value={hero.buttonText} maxLength={40} onChange={(e) => setHero("buttonText", e.target.value)} />
                </Field>
                <Field label="Button link" hint="For example /shop or /collections">
                  <Input value={hero.buttonLink} maxLength={200} onChange={(e) => setHero("buttonLink", e.target.value)} />
                </Field>
              </div>
              <p className="rounded-lg bg-warn/12 px-3 py-2 text-sm font-medium text-warn">No dosing, health, or results claims.</p>
            </Card>

            <SectionTitle>Home page sections</SectionTitle>
            <Card className="divide-y divide-line">
              {c.sections.map((sec, i) => (
                <div key={sec.id} className={cx("flex items-center gap-2 px-3 py-3", !sec.show && "opacity-60")}>
                  <div className="flex shrink-0 flex-col">
                    <button aria-label="Move section up" disabled={i === 0} className="flex h-7 w-9 items-center justify-center text-muted disabled:opacity-25" onClick={() => set("sections", moved(c.sections, i, i - 1))}>
                      <ArrowUp size={16} />
                    </button>
                    <button aria-label="Move section down" disabled={i === c.sections.length - 1} className="flex h-7 w-9 items-center justify-center text-muted disabled:opacity-25" onClick={() => set("sections", moved(c.sections, i, i + 1))}>
                      <ArrowDown size={16} />
                    </button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Input value={sec.title} maxLength={60} aria-label="Section title" className="h-10" onChange={(e) => set("sections", c.sections.map((x) => (x.id === sec.id ? { ...x, title: e.target.value } : x)))} />
                    <div className="mt-1 text-xs text-muted">{SECTION_HELP[sec.id]}</div>
                  </div>
                  <label className="flex shrink-0 cursor-pointer items-center gap-2 pl-1 text-sm text-muted">
                    <input type="checkbox" checked={sec.show} onChange={(e) => set("sections", c.sections.map((x) => (x.id === sec.id ? { ...x, show: e.target.checked } : x)))} className="h-5 w-5 accent-[rgb(var(--accent))]" />
                    Show
                  </label>
                </div>
              ))}
            </Card>
            <p className="mt-2 text-xs text-muted">Use the arrows to change the order. A section with nothing in it (for example no reviews yet) hides itself.</p>

            <SectionTitle>Quality section</SectionTitle>
            <Card className="space-y-4 p-4">
              <Field label="Text">
                <Textarea value={c.quality.body} maxLength={500} onChange={(e) => set("quality", { ...c.quality, body: e.target.value })} />
              </Field>
              {c.quality.points.map((p, i) => (
                <div key={i} className="grid gap-2 rounded-xl border border-line p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_2.5rem]">
                  <Input value={p.title} maxLength={50} aria-label="Point title" onChange={(e) => set("quality", { ...c.quality, points: c.quality.points.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)) })} />
                  <Input value={p.text} maxLength={160} aria-label="Point text" onChange={(e) => set("quality", { ...c.quality, points: c.quality.points.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)) })} />
                  <button aria-label="Remove point" className="flex h-12 w-10 items-center justify-center rounded-lg text-muted hover:text-neg" onClick={() => set("quality", { ...c.quality, points: c.quality.points.filter((_, k) => k !== i) })}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              {c.quality.points.length < 4 && (
                <Button size="sm" onClick={() => set("quality", { ...c.quality, points: [...c.quality.points, { title: "", text: "" }] })}>
                  <Plus size={15} /> Add a point
                </Button>
              )}
            </Card>
          </>
        )}

        {tab === "pages" && (
          <>
            <SectionTitle>FAQ</SectionTitle>
            <div className="space-y-3">
              {c.faq.map((f, i) => (
                <Card key={i} className="space-y-2 p-3">
                  <div className="flex gap-2">
                    <Input value={f.q} maxLength={160} placeholder="Question" aria-label={`Question ${i + 1}`} onChange={(e) => set("faq", c.faq.map((x, k) => (k === i ? { ...x, q: e.target.value } : x)))} />
                    <div className="flex shrink-0">
                      <button aria-label="Move up" disabled={i === 0} className="flex h-12 w-9 items-center justify-center text-muted disabled:opacity-25" onClick={() => set("faq", moved(c.faq, i, i - 1))}>
                        <ArrowUp size={16} />
                      </button>
                      <button aria-label="Move down" disabled={i === c.faq.length - 1} className="flex h-12 w-9 items-center justify-center text-muted disabled:opacity-25" onClick={() => set("faq", moved(c.faq, i, i + 1))}>
                        <ArrowDown size={16} />
                      </button>
                      <button aria-label="Delete question" className="flex h-12 w-9 items-center justify-center text-muted hover:text-neg" onClick={() => set("faq", c.faq.filter((_, k) => k !== i))}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  <Textarea value={f.a} maxLength={1200} placeholder="Answer" aria-label={`Answer ${i + 1}`} className="min-h-[76px]" onChange={(e) => set("faq", c.faq.map((x, k) => (k === i ? { ...x, a: e.target.value } : x)))} />
                </Card>
              ))}
              <Button onClick={() => set("faq", [...c.faq, { q: "", a: "" }])}>
                <Plus size={16} /> Add a question
              </Button>
              <p className="rounded-lg bg-warn/12 px-3 py-2 text-sm font-medium text-warn">No dosing, health, or results claims.</p>
            </div>

            <SectionTitle>About page</SectionTitle>
            <Card className="space-y-4 p-4">
              <Field label="Title">
                <Input value={c.about.title} maxLength={80} onChange={(e) => set("about", { ...c.about, title: e.target.value })} />
              </Field>
              <Field label="Text" hint="Leave a blank line between paragraphs.">
                <Textarea value={c.about.body} maxLength={4000} className="min-h-[160px]" onChange={(e) => set("about", { ...c.about, body: e.target.value })} />
              </Field>
            </Card>

            <SectionTitle>Testing page</SectionTitle>
            <Card className="space-y-4 p-4">
              <Field label="Title">
                <Input value={c.testing.title} maxLength={80} onChange={(e) => set("testing", { ...c.testing, title: e.target.value })} />
              </Field>
              <Field label="Intro text" hint="The table of every product’s testing status and COA links is added automatically under it.">
                <Textarea value={c.testing.body} maxLength={2000} className="min-h-[120px]" onChange={(e) => set("testing", { ...c.testing, body: e.target.value })} />
              </Field>
            </Card>

            <SectionTitle>Contact info</SectionTitle>
            <Card className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="Public email (optional)">
                <Input type="email" value={c.contact.email} onChange={(e) => set("contact", { ...c.contact, email: e.target.value })} />
              </Field>
              <Field label="Public phone (optional)">
                <Input type="tel" value={c.contact.phone} onChange={(e) => set("contact", { ...c.contact, phone: e.target.value })} />
              </Field>
              <Field label="Hours (optional)">
                <Input value={c.contact.hours} maxLength={80} placeholder="Mon to Fri, 9am to 5pm CT" onChange={(e) => set("contact", { ...c.contact, hours: e.target.value })} />
              </Field>
              <Field label="Note on the contact page">
                <Input value={c.contact.note} maxLength={160} onChange={(e) => set("contact", { ...c.contact, note: e.target.value })} />
              </Field>
            </Card>

            <SectionTitle>Checkout acknowledgments</SectionTitle>
            <Card className="space-y-4 p-4">
              <p className="text-sm text-muted">Customers must tick both boxes to place an order.</p>
              <Field label="Research use">
                <Textarea value={c.acknowledgments.research} maxLength={400} className="min-h-[76px]" onChange={(e) => set("acknowledgments", { ...c.acknowledgments, research: e.target.value })} />
              </Field>
              <Field label="Policies" hint="The words Terms, Privacy, Shipping and Returns become links to those pages.">
                <Textarea value={c.acknowledgments.policies} maxLength={400} className="min-h-[76px]" onChange={(e) => set("acknowledgments", { ...c.acknowledgments, policies: e.target.value })} />
              </Field>
            </Card>

            <SectionTitle>Footer</SectionTitle>
            <Card className="p-4">
              <Field label="Extra footer text (optional)" hint="Shown above the research-use line, which is always there.">
                <Textarea value={c.footerText} maxLength={400} className="min-h-[64px]" onChange={(e) => set("footerText", e.target.value)} />
              </Field>
            </Card>
          </>
        )}

        {tab === "policies" && (
          <>
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
              {POLICY_IDS.map((id) => (
                <button
                  key={id}
                  onClick={() => setPolicy(id)}
                  aria-pressed={policy === id}
                  className={cx("flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium", policy === id ? "border-accent bg-accent/10 text-accent" : "border-line text-muted")}
                >
                  {c.policies[id].title || id}
                  {!c.policies[id].reviewed && <span className="h-2 w-2 rounded-full bg-warn" aria-label="draft" />}
                </button>
              ))}
            </div>
            {(() => {
              const p = c.policies[policy];
              const setP = (patch: Partial<typeof p>) => set("policies", { ...c.policies, [policy]: { ...p, ...patch } });
              return (
                <Card className="space-y-4 p-4">
                  {!p.reviewed && (
                    <div className="flex gap-2.5 rounded-xl bg-warn/12 px-4 py-3 text-sm font-medium text-warn">
                      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                      <span>Draft: have this reviewed before launch.</span>
                    </div>
                  )}
                  <Field label="Page title">
                    <Input value={p.title} maxLength={80} onChange={(e) => setP({ title: e.target.value })} />
                  </Field>
                  <Field label="Text" hint="Start a line with ## for a heading, or with - for a bullet. Leave a blank line between paragraphs.">
                    <Textarea value={p.body} maxLength={20000} className="min-h-[420px] font-mono text-sm leading-relaxed" onChange={(e) => setP({ body: e.target.value })} />
                  </Field>
                  <Toggle checked={p.reviewed} onChange={(v) => setP({ reviewed: v })} label="I had this reviewed" hint="Removes the draft warning and ticks the launch checklist." />
                  <div className="flex flex-wrap gap-3">
                    <a href={POLICY_PATH[policy]} target="_blank" rel="noreferrer" className="text-sm font-medium text-accent hover:underline">
                      View the page
                    </a>
                    <button className="text-sm font-medium text-muted hover:text-ink" onClick={() => setP({ title: DEFAULT_CONTENT.policies[policy].title, body: DEFAULT_CONTENT.policies[policy].body })}>
                      Restore the draft template
                    </button>
                  </div>
                </Card>
              );
            })()}
          </>
        )}

        {tab === "seo" && (
          <>
            <SectionTitle>Search engines and link previews</SectionTitle>
            <Card className="space-y-5 p-4">
              <Field label="Site title" hint="The home page title in search results and browser tabs. Other pages add their own name in front.">
                <Input value={c.seo.title} maxLength={70} onChange={(e) => set("seo", { ...c.seo, title: e.target.value })} />
              </Field>
              <Field label="Site description" hint={`${c.seo.description.length} / 160 characters. Shown under the title in search results.`}>
                <Textarea value={c.seo.description} maxLength={200} className="min-h-[76px]" onChange={(e) => set("seo", { ...c.seo, description: e.target.value })} />
              </Field>
              <div>
                <div className="mb-1.5 text-sm font-medium text-muted">Link preview image</div>
                <SingleImage value={c.seo.image} onChange={(id) => set("seo", { ...c.seo, image: id })} kind="share" hint={`${RECOMMENDED_SIZES.share} Shown when the site is shared in a message or on social media. Empty = a simple card with the store name.`} />
              </div>
              <p className="rounded-lg bg-warn/12 px-3 py-2 text-sm font-medium text-warn">No dosing, health, or results claims.</p>
            </Card>
          </>
        )}

        {tab === "messages" && <Messages />}
      </div>

      {dirty && tab !== "messages" && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-30 animate-toast-in px-3 md:bottom-6 md:left-64 md:px-8">
          <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-2xl border border-line bg-surface p-2 shadow-xl">
            <span className="flex-1 px-3 text-sm text-muted">Unsaved changes</span>
            <Button variant="ghost" onClick={() => setC(data.content)}>
              Discard
            </Button>
            <Button variant="primary" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Messages() {
  const s = useLoaded();
  const confirm = useConfirm();
  if (!s) return null;
  const { data, mutate } = s;
  if (data.messages.length === 0) return <Empty icon={<Mail size={32} />} title="No messages yet" body="Messages sent through the store’s contact form show up here, and are emailed to your alert addresses." />;
  return (
    <ul className="space-y-3">
      {data.messages.map((m) => (
        <li key={m.id} className={cx("rounded-2xl border bg-surface p-4 sm:p-5", m.handled ? "border-line opacity-75" : "border-accent/40")}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold">{m.name}</span>
            <a href={`mailto:${m.email}`} className="break-all text-sm text-accent hover:underline">
              {m.email}
            </a>
            {m.orderNumber && <Badge>Order #{m.orderNumber}</Badge>}
            {!m.handled && <Badge tone="accent">New</Badge>}
          </div>
          <p className="mt-2 whitespace-pre-line text-[15px]">{m.message}</p>
          <div className="mt-2 text-xs text-muted">{fmtDateTime(m.createdAt)}</div>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
            <a href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: your message to ${data.store.storeName}`)}`}>
              <Button variant="primary" className="h-10">
                Reply by email
              </Button>
            </a>
            <Button
              className="h-10"
              onClick={() =>
                mutate(
                  (d) => ({ ...d, messages: d.messages.map((x) => (x.id === m.id ? { ...x, handled: !m.handled } : x)) }),
                  () => api(`/api/messages/${m.id}`, "PATCH", { handled: !m.handled }),
                )
              }
            >
              {m.handled ? "Mark as new" : "Mark as handled"}
            </Button>
            <Button
              variant="ghost"
              className="h-10 text-neg"
              onClick={async () => {
                if (await confirm({ title: "Delete this message?", confirmText: "Delete", danger: true })) mutate((d) => ({ ...d, messages: d.messages.filter((x) => x.id !== m.id) }), () => api(`/api/messages/${m.id}`, "DELETE"));
              }}
            >
              Delete
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
