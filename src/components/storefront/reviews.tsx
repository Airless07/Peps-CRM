"use client";

// Store reviews: the review form (guest, signed in, or from the order email link), the sign in / guest
// choice, and review photos with click to enlarge.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { REVIEW_FORM_NOTE, REVIEW_LIMITS } from "@/lib/reviews/rules";
import { AuthPanel, cleanError } from "./auth-panel";

const STAR = "M10 1.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.6 7.7l5.8-.8z";

export function StarRow({ n, size = "h-4 w-4", label = true }: { n: number; size?: string; label?: boolean }) {
  return (
    <span className="inline-flex gap-0.5 text-brand" role={label ? "img" : undefined} aria-label={label ? `${n} out of 5 stars` : undefined} aria-hidden={label ? undefined : true}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} viewBox="0 0 20 20" className={`${size} ${i <= Math.round(n) ? "fill-current" : "fill-rule"}`} aria-hidden>
          <path d={STAR} />
        </svg>
      ))}
    </span>
  );
}

export function VerifiedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-tint px-2 py-0.5 text-xs font-semibold text-brand-deep" data-verified>
      <svg viewBox="0 0 16 16" className="h-3 w-3 fill-current" aria-hidden>
        <path d="M6.4 11.6 2.8 8l1.1-1.1 2.5 2.5 5.7-5.7L13.2 4.8z" />
      </svg>
      Verified order
    </span>
  );
}

// ---------------------------------------------------------------- Photos with click to enlarge
export function ReviewPhotos({ photos }: { photos: { file: string; width: number; height: number }[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open === null) return;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : (i + 1) % photos.length));
      if (e.key === "ArrowLeft") setOpen((i) => (i === null ? i : (i - 1 + photos.length) % photos.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, photos.length]);
  if (photos.length === 0) return null;
  return (
    <>
      <ul className="mt-4 flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <li key={p.file}>
            <button type="button" onClick={() => setOpen(i)} className="block overflow-hidden rounded-lg border border-rule transition hover:border-coal" aria-label={`Open photo ${i + 1} of ${photos.length}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/store/review-photo/${p.file}-480.webp`} alt="" loading="lazy" className="h-20 w-20 object-cover sm:h-24 sm:w-24" data-review-photo />
            </button>
          </li>
        ))}
      </ul>
      {open !== null && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true" aria-label="Review photo" onClick={() => setOpen(null)}>
          <button ref={close} type="button" className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" aria-label="Close photo" onClick={() => setOpen(null)}>
            <X size={22} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/store/review-photo/${photos[open].file}-1600.webp`} alt={`Customer photo ${open + 1} of ${photos.length}`} className="max-h-[88vh] max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
          {photos.length > 1 && <p className="absolute bottom-4 left-0 right-0 text-center text-sm text-white/80">{open + 1} / {photos.length}</p>}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- Sign in / guest choice
/** Signed out and not from the email link: sign in (to get a Verified order) or continue as a guest. */
export function ReviewChoice() {
  const router = useRouter();
  const [signIn, setSignIn] = useState(false);
  if (signIn) {
    return (
      <div className="max-w-md" data-review-signin>
        <AuthPanel initial="signin" intro="Sign in and we'll fill in your name, email and your orders." onDone={() => router.refresh()} />
        <button type="button" className="s-link mt-5 text-[15px]" onClick={() => setSignIn(false)}>
          Back
        </button>
      </div>
    );
  }
  return (
    <div className="grid max-w-2xl gap-4 sm:grid-cols-2" data-review-choice>
      <button type="button" onClick={() => setSignIn(true)} className="rounded-2xl border border-rule p-6 text-left transition hover:border-coal">
        <span className="block text-lg font-semibold">Sign in</span>
        <span className="mt-1 block text-[15px] leading-relaxed text-stone">We fill in your name, email and orders, so your review can show “Verified order”.</span>
        <span className="s-btn-primary mt-5">Sign in</span>
      </button>
      <button type="button" onClick={() => router.push("/reviews/write?guest=1")} className="rounded-2xl border border-rule p-6 text-left transition hover:border-coal">
        <span className="block text-lg font-semibold">Continue as guest</span>
        <span className="mt-1 block text-[15px] leading-relaxed text-stone">No account needed. Just your name and email (your email is never shown).</span>
        <span className="s-btn-line mt-5">Continue as guest</span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Review form
export interface ReviewFormProps {
  /** From the order email link: identifies the order (Verified order). */
  token?: string;
  /** The order the email link is about. */
  orderNumber?: number;
  /** Signed in: the orders that can still be reviewed. */
  orders?: { number: number; placedAt: string; items: string }[];
  initialOrder?: number | null;
  initialRating?: number;
  defaultName?: string;
  defaultEmail?: string;
}

interface Picked {
  file: File;
  url: string;
}

const WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
const TYPES = ["image/jpeg", "image/png", "image/webp"];

export function ReviewForm({ token, orderNumber, orders = [], initialOrder = null, initialRating = 0, defaultName = "", defaultEmail = "" }: ReviewFormProps) {
  const [rating, setRating] = useState(initialRating >= 1 && initialRating <= 5 ? Math.round(initialRating) : 0);
  const [hover, setHover] = useState(0);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [order, setOrder] = useState<number | null>(initialOrder && orders.some((o) => o.number === initialOrder) ? initialOrder : (orders[0]?.number ?? null));
  const [photos, setPhotos] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ status: string; message: string } | null>(null);
  const hp = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const live = useRef<Picked[]>([]);
  live.current = photos;
  useEffect(() => () => live.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  if (done) {
    return (
      <div className="rounded-2xl bg-soft p-7" role="status" data-review-done={done.status}>
        <h2 className="text-2xl font-semibold">{done.message}</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-stone">
          {done.status === "approved" ? "Thank you for taking the time." : "We read every review before it goes up. It usually doesn't take long."}
          {photos.length > 0 ? " Your photos show once we've had a look at them." : ""}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/reviews" className="s-btn-dark">
            See all reviews
          </Link>
          <Link href="/shop" className="s-btn-line">
            Back to the shop
          </Link>
        </div>
      </div>
    );
  }

  function addFiles(list: FileList | null) {
    setError("");
    const next = [...photos];
    for (const f of Array.from(list ?? [])) {
      if (next.length >= REVIEW_LIMITS.photos) {
        setError(`Add up to ${REVIEW_LIMITS.photos} photos.`);
        break;
      }
      if (!TYPES.includes(f.type)) {
        setError(`“${f.name}” is not a JPG, PNG or WebP photo.`);
        continue;
      }
      if (f.size > REVIEW_LIMITS.photoMb * 1024 * 1024) {
        setError(`“${f.name}” is ${(f.size / 1024 / 1024).toFixed(1)} MB. Each photo can be up to ${REVIEW_LIMITS.photoMb} MB.`);
        continue;
      }
      next.push({ file: f, url: URL.createObjectURL(f) });
    }
    setPhotos(next);
    if (fileInput.current) fileInput.current.value = "";
  }

  const len = text.trim().length;
  return (
    <form
      noValidate
      className="space-y-6"
      data-review-form
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        if (rating < 1) return setError("Pick a star rating from 1 to 5.");
        if (len < REVIEW_LIMITS.textMin) return setError(`Write at least ${REVIEW_LIMITS.textMin} characters about your order.`);
        if (!name.trim()) return setError("Enter a display name.");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return setError("Enter a valid email address, like name@example.com.");
        const fd = new FormData();
        fd.set("rating", String(rating));
        fd.set("title", title);
        fd.set("text", text);
        fd.set("displayName", name);
        fd.set("email", email);
        fd.set("website", hp.current?.value ?? "");
        if (token) fd.set("token", token);
        else if (order) fd.set("orderNumber", String(order));
        for (const p of photos) fd.append("photos", p.file, p.file.name);
        setBusy(true);
        try {
          const res = await fetch("/api/store/reviews", { method: "POST", body: fd });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(cleanError(json.error) || "Something went wrong. Check your connection and try again.");
          setDone(json);
          window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (err) {
          setError((err as Error).message);
        }
        setBusy(false);
      }}
    >
      <p className="rounded-xl bg-soft px-4 py-3 text-[15px] leading-relaxed text-coal" data-review-note>
        {REVIEW_FORM_NOTE}
      </p>

      {token && orderNumber ? (
        <p className="text-[15px]" data-review-order>
          Reviewing <strong className="font-semibold">order #{orderNumber}</strong>
        </p>
      ) : orders.length > 0 ? (
        <div>
          <label className="s-label" htmlFor="rv-o">
            Which order is this about?
          </label>
          <select id="rv-o" className="s-input" value={order ?? ""} onChange={(e) => setOrder(e.target.value ? Number(e.target.value) : null)} data-review-order-select>
            {orders.map((o) => (
              <option key={o.number} value={o.number}>
                #{o.number} · {new Date(o.placedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {o.items.length > 60 ? `${o.items.slice(0, 57)}…` : o.items}
              </option>
            ))}
            <option value="">Not about a specific order</option>
          </select>
        </div>
      ) : null}

      <fieldset>
        <legend className="s-label">Your rating</legend>
        <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className="cursor-pointer p-1" onMouseEnter={() => setHover(n)}>
              <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} className="peer sr-only" />
              <svg viewBox="0 0 20 20" className={`h-10 w-10 transition peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand ${n <= (hover || rating) ? "fill-brand" : "fill-rule"}`} aria-hidden>
                <path d={STAR} />
              </svg>
              <span className="sr-only">
                {n} {n === 1 ? "star" : "stars"}
              </span>
            </label>
          ))}
          <span className="ml-3 text-[15px] font-medium" aria-live="polite">
            {WORDS[hover || rating]}
          </span>
        </div>
      </fieldset>

      <div>
        <label className="s-label" htmlFor="rv-ti">
          Title <span className="font-normal text-stone">(optional)</span>
        </label>
        <input id="rv-ti" className="s-input" maxLength={REVIEW_LIMITS.titleMax} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Fast and well packed" />
      </div>

      <div>
        <label className="s-label" htmlFor="rv-t">
          Your review
        </label>
        <textarea id="rv-t" className="s-input h-auto min-h-[140px] py-3" maxLength={REVIEW_LIMITS.textMax} value={text} onChange={(e) => setText(e.target.value)} placeholder="How were shipping, packaging and service?" />
        <span className={`s-hint tabular-nums ${len > 0 && len < REVIEW_LIMITS.textMin ? "text-brand" : ""}`}>
          {len < REVIEW_LIMITS.textMin ? `At least ${REVIEW_LIMITS.textMin} characters` : `${len} / ${REVIEW_LIMITS.textMax}`}
        </span>
      </div>

      <div>
        <span className="s-label">
          Photos <span className="font-normal text-stone">(optional, up to {REVIEW_LIMITS.photos})</span>
        </span>
        <div className="flex flex-wrap gap-2">
          {photos.map((p, i) => (
            <div key={p.url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`Photo ${i + 1}`} className="h-20 w-20 rounded-lg border border-rule object-cover" />
              <button type="button" className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-coal text-white" aria-label={`Remove photo ${i + 1}`} onClick={() => {
                  URL.revokeObjectURL(p.url);
                  setPhotos(photos.filter((x) => x !== p));
                }}>
                <X size={14} />
              </button>
            </div>
          ))}
          {photos.length < REVIEW_LIMITS.photos && (
            <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-rule text-center text-xs font-medium text-stone transition hover:border-coal hover:text-coal">
              <span className="text-2xl leading-none">+</span>
              Add photo
              <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} data-review-photos />
            </label>
          )}
        </div>
        <span className="s-hint">JPG, PNG or WebP, up to {REVIEW_LIMITS.photoMb} MB each. Location data is removed. Photos appear after a quick check.</span>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <label className="s-label" htmlFor="rv-n">
            Display name
          </label>
          <input id="rv-n" className="s-input" maxLength={REVIEW_LIMITS.nameMax} autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mike J." />
          <span className="s-hint">Shown with your review.</span>
        </div>
        <div>
          <label className="s-label" htmlFor="rv-e">
            Email
          </label>
          <input id="rv-e" type="email" className="s-input" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <span className="s-hint">Never shown publicly.</span>
        </div>
      </div>

      {/* Honeypot: hidden from people and screen readers. Bots fill every field. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label htmlFor="rv-website">Website</label>
        <input ref={hp} id="rv-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      {error && (
        <p className="rounded-xl bg-brand-tint px-4 py-3 text-[15px] font-medium text-brand-deep" role="alert">
          {error}
        </p>
      )}
      <button className="s-btn-primary" disabled={busy}>
        {busy ? "Sending…" : "Submit review"}
      </button>
    </form>
  );
}
