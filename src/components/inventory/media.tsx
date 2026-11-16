"use client";

// Upload helpers for the admin: product photos (with reorder + store preview), a single image
// (logo, hero, share image), and the hover animation.
import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, GripVertical, ImagePlus, Trash2 } from "lucide-react";
import { useToast } from "@/components/toast";
import { Button, Input, cx } from "@/components/ui";
import { fmtMoney } from "@/lib/format";
import type { PhotoRec } from "@/lib/types";

export const photoUrl = (id: string, w: 480 | 960 | 1600 = 480) => `/media/${id}-${w}.webp`;

export async function uploadFile(file: File, kind: string, url = "/api/uploads", extra: Record<string, string> = {}): Promise<{ id?: string; file?: string }> {
  const form = new FormData();
  form.set("file", file);
  form.set("kind", kind);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  const res = await fetch(url, { method: "POST", body: form });
  const json = (await res.json().catch(() => ({}))) as { error?: string; id?: string; file?: string };
  if (!res.ok) throw new Error(json.error || `Upload failed (${res.status}). Try again.`);
  return json;
}

/** Move item `from` to position `to`. */
export function moved<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, x);
  return next;
}

export function PhotoManager({
  photos,
  onChange,
  preview,
}: {
  photos: PhotoRec[];
  onChange: (p: PhotoRec[]) => void;
  preview: { name: string; priceCents: number };
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files].slice(0, 12 - photos.length);
    setBusy(list.length);
    const added: PhotoRec[] = [];
    for (const f of list) {
      try {
        const r = await uploadFile(f, "product");
        if (r.id) added.push({ id: r.id, alt: "" });
      } catch (e) {
        toast.show({ message: `${f.name}: ${(e as Error).message}`, tone: "error", duration: 7000 });
      }
      setBusy((n) => n - 1);
    }
    if (added.length) onChange([...photos, ...added]);
    if (input.current) input.current.value = "";
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <div>
          {photos.length === 0 ? (
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="flex w-full flex-col items-center justify-center rounded-2xl border border-dashed border-line px-4 py-10 text-center transition hover:bg-surface2/60"
            >
              <ImagePlus size={28} className="text-muted" />
              <span className="mt-2 font-medium">Add photos</span>
              <span className="mt-1 max-w-xs text-sm text-muted">The first photo is the main one on product cards. Until you add one, the store shows a neutral placeholder.</span>
            </button>
          ) : (
            <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
              {photos.map((p, i) => (
                <li
                  key={p.id}
                  draggable
                  onDragStart={() => setDrag(i)}
                  onDragEnd={() => (setDrag(null), setOver(null))}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOver(i);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (drag !== null && drag !== i) onChange(moved(photos, drag, i));
                    setDrag(null);
                    setOver(null);
                  }}
                  className={cx("group relative overflow-hidden rounded-xl border bg-surface2", over === i && drag !== null && drag !== i ? "border-accent ring-2 ring-accent/40" : "border-line", drag === i && "opacity-40")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photoUrl(p.id)} alt={p.alt || ""} className="aspect-[4/5] w-full object-cover" draggable={false} />
                  {i === 0 && <span className="absolute left-1.5 top-1.5 rounded-md bg-ink/85 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-bg">Main</span>}
                  <span className="absolute right-1.5 top-1.5 hidden cursor-grab rounded-md bg-surface/90 p-1 text-muted sm:block" title="Drag to reorder">
                    <GripVertical size={14} />
                  </span>
                  <div className="flex items-center justify-between border-t border-line bg-surface px-1 py-1">
                    <button type="button" aria-label="Move earlier" disabled={i === 0} onClick={() => onChange(moved(photos, i, i - 1))} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface2 disabled:opacity-25">
                      <ArrowLeft size={15} />
                    </button>
                    <button type="button" aria-label="Remove photo" onClick={() => onChange(photos.filter((x) => x.id !== p.id))} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-neg/10 hover:text-neg">
                      <Trash2 size={15} />
                    </button>
                    <button type="button" aria-label="Move later" disabled={i === photos.length - 1} onClick={() => onChange(moved(photos, i, i + 1))} className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface2 disabled:opacity-25">
                      <ArrowRight size={15} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden onChange={(e) => add(e.target.files)} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={() => input.current?.click()} disabled={busy > 0 || photos.length >= 12}>
              <ImagePlus size={16} /> {busy > 0 ? `Uploading ${busy}…` : "Add photos"}
            </Button>
            <span className="text-xs text-muted">Recommended: 1600 × 2000 px (4:5 portrait). Photos are cropped to that shape and compressed automatically. Drag to reorder.</span>
          </div>
          {photos.length > 0 && (
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-muted">Describe the main photo (for screen readers and search engines)</label>
              <Input value={photos[0].alt} maxLength={160} placeholder={`${preview.name} vial`} onChange={(e) => onChange(photos.map((p, i) => (i === 0 ? { ...p, alt: e.target.value } : p)))} className="h-10 text-sm" />
            </div>
          )}
        </div>

        {/* How the card looks on the store */}
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted">Preview on the store</div>
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white text-neutral-900">
            {photos[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl(photos[0].id)} alt="" className="aspect-[4/5] w-full object-cover" />
            ) : (
              <div className="flex aspect-[4/5] w-full items-center justify-center bg-[#f4f2ee] text-[11px] font-medium uppercase tracking-widest text-neutral-400">Placeholder</div>
            )}
            <div className="px-3 py-2.5">
              <div className="truncate text-[13px] font-semibold">{preview.name || "Product name"}</div>
              <div className="text-[13px] tabular-nums text-neutral-600">{fmtMoney(preview.priceCents)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One image: logo, favicon, hero, share image. Shows the recommended size. */
export function SingleImage({
  value,
  onChange,
  kind,
  hint,
  shape = "wide",
}: {
  value: string;
  onChange: (id: string) => void;
  kind: "hero" | "logo" | "share" | "favicon";
  hint: string;
  shape?: "wide" | "square";
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const src = value ? (kind === "favicon" ? `/media/${value}.png` : photoUrl(value, 960)) : "";
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className={cx("flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface2", shape === "square" ? "h-20 w-20" : "h-24 w-full sm:w-44")}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className={cx("h-full w-full", kind === "logo" || kind === "favicon" ? "object-contain p-2" : "object-cover")} />
        ) : (
          <span className="text-xs text-muted">None</span>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? "Uploading…" : value ? "Replace" : "Upload"}
          </Button>
          {value && (
            <Button size="sm" variant="ghost" className="text-neg" onClick={() => onChange("")}>
              Remove
            </Button>
          )}
        </div>
        <p className="mt-1.5 text-xs text-muted">{hint}</p>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          try {
            const r = await uploadFile(f, kind);
            if (r.id) onChange(r.id);
          } catch (err) {
            toast.show({ message: (err as Error).message, tone: "error", duration: 7000 });
          }
          setBusy(false);
          if (input.current) input.current.value = "";
        }}
      />
    </div>
  );
}
