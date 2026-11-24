"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ImageIcon, Star, X } from "lucide-react";
import { api, useLoaded } from "@/components/store";
import { useToast } from "@/components/toast";
import { Badge, Button, Empty, Field, Input, PageHeader, PageSkeleton, Segmented, Sheet, Textarea, cx, useConfirm } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { DEFAULT_FLAG_WORDS, cleanFlagWords } from "@/lib/reviews/rules";
import type { PastCustomerRequest } from "@/lib/reviews/ops";
import type { ReviewPhotoRec, ReviewRec, ReviewSource } from "@/lib/types";

type Tab = "live" | "needs" | "photos" | "hidden";

const SOURCE: Record<ReviewSource, string> = { email_link: "From the order email link", account: "Signed in", guest: "Guest" };
const PHOTO_TONE = { pending: "warn", approved: "pos", rejected: "neg" } as const;
const PHOTO_LABEL = { pending: "Waiting", approved: "Approved, on the site", rejected: "Rejected, never shown" } as const;

function Stars({ n, size = 16 }: { n: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} className={i <= n ? "fill-warn text-warn" : "text-line"} />
      ))}
    </span>
  );
}

const waitingPhotos = (r: ReviewRec) => (r.status === "hidden" ? 0 : r.photos.filter((p) => p.status === "pending").length);

export default function ReviewsPage() {
  const s = useLoaded();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab | null>(null);
  const [edit, setEdit] = useState<ReviewRec | null>(null);
  const [words, setWords] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ list: PastCustomerRequest[]; picked: Set<string> } | null>(null);
  const [asking, setAsking] = useState(false);

  if (!s) return <PageSkeleton />;
  const { data, mutate } = s;
  const reviews = data.reviews.map((r) => ({ ...r, photos: r.photos ?? [] }));
  const lists: Record<Tab, ReviewRec[]> = {
    live: reviews.filter((r) => r.status === "approved"),
    needs: reviews.filter((r) => r.status === "pending"),
    photos: reviews.filter((r) => waitingPhotos(r) > 0),
    hidden: reviews.filter((r) => r.status === "hidden"),
  };
  const current: Tab = tab ?? (lists.needs.length ? "needs" : lists.photos.length ? "photos" : "live");
  const list = lists[current];
  const orderNumber = (id: string | null) => [...data.orders, ...data.pendingOrders].find((o) => o.id === id)?.number;

  const patch = (r: ReviewRec, p: Partial<ReviewRec>, msg: string) =>
    mutate(
      (d) => ({ ...d, reviews: d.reviews.map((x) => (x.id === r.id ? { ...x, ...p } : x)) }),
      () => api(`/api/reviews/${r.id}`, "PATCH", p),
    ).then((ok) => ok && toast.show({ message: msg, tone: "success" }));

  const photo = (r: ReviewRec, p: ReviewPhotoRec, status: ReviewPhotoRec["status"]) =>
    mutate(
      (d) => ({ ...d, reviews: d.reviews.map((x) => (x.id === r.id ? { ...x, photos: x.photos.map((y) => (y.id === p.id ? { ...y, status } : y)) } : x)) }),
      () => api(`/api/reviews/${r.id}/photos/${p.id}`, "PATCH", { status }),
    ).then(
      (ok) =>
        ok &&
        toast.show({
          message: status === "approved" ? (r.status === "approved" ? "Photo approved. It's on the site now." : "Photo approved. It shows once the review text is live.") : status === "rejected" ? "Photo rejected. It never shows." : "Photo back to waiting",
          tone: "success",
        }),
    );

  const remove = async (r: ReviewRec) => {
    const ok = await confirm({ title: "Delete this review?", body: `${r.displayName}'s ${r.rating}-star review and its ${r.photos.length} photo(s) are removed for good. To take it off the site but keep it, use Hide.`, confirmText: "Delete", danger: true });
    if (!ok) return;
    const done = await mutate((d) => ({ ...d, reviews: d.reviews.filter((x) => x.id !== r.id) }), () => api(`/api/reviews/${r.id}`, "DELETE"));
    if (done) toast.show({ message: "Review deleted", tone: "success" });
  };

  const saveWords = async () => {
    if (words === null) return;
    const flagWords = cleanFlagWords(words.split(/\n|,/));
    const store = { ...data.store, reviews: { ...data.store.reviews, flagWords } };
    const ok = await mutate((d) => ({ ...d, store }), () => api("/api/settings", "PATCH", { store }));
    if (ok) {
      toast.show({ message: `Filter saved (${flagWords.length} words and phrases)`, tone: "success" });
      setWords(null);
    }
  };

  const openAsk = async () => {
    try {
      const { orders } = await api<{ orders: PastCustomerRequest[] }>("/api/reviews/requests");
      setAsk({ list: orders, picked: new Set(orders.map((o) => o.orderId)) });
    } catch (e) {
      toast.show({ message: (e as Error).message, tone: "error" });
    }
  };
  const sendAsk = async () => {
    if (!ask || ask.picked.size === 0) return;
    setAsking(true);
    try {
      const r = await api<{ message: string }>("/api/reviews/requests", "POST", { orderIds: [...ask.picked] });
      toast.show({ message: r.message, tone: "success", duration: 6000 });
      setAsk(null);
      await s.refresh();
    } catch (e) {
      toast.show({ message: (e as Error).message, tone: "error", duration: 7000 });
    }
    setAsking(false);
  };
  const requestsOn = data.store.reviews?.requestEmail !== false;

  const empty: Record<Tab, string> = {
    live: "No live reviews",
    needs: "Nothing waiting for a check",
    photos: "No photos waiting",
    hidden: "No hidden reviews",
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Reviews"
        sub="Clean reviews go live right away. Text with flagged words waits here. Photos always wait for your approval."
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            <Button className="h-10" onClick={openAsk} disabled={!requestsOn} title={requestsOn ? undefined : "Review request emails are off in Settings, Email."} data-ask-past-button>
              Ask past customers for reviews
            </Button>
            <Button className="h-10" onClick={() => setWords((data.store.reviews?.flagWords ?? DEFAULT_FLAG_WORDS).join("\n"))}>
              Filter words
            </Button>
          </div>
        }
      />
      <div className="mb-5 overflow-x-auto">
        <Segmented
          className="min-w-[30rem]"
          value={current}
          onChange={setTab}
          options={[
            { value: "live", label: `Live (${lists.live.length})` },
            { value: "needs", label: `Needs review${lists.needs.length ? ` (${lists.needs.length})` : ""}` },
            { value: "photos", label: `Photos waiting${lists.photos.length ? ` (${lists.photos.reduce((n, r) => n + waitingPhotos(r), 0)})` : ""}` },
            { value: "hidden", label: `Hidden (${lists.hidden.length})` },
          ]}
        />
      </div>

      {reviews.length === 0 ? (
        <Empty icon={<Star size={32} />} title="No reviews yet" body="Customers can review from the Reviews page, their account, or the “How was your order?” email that goes out a few days after delivery (Settings, Email)." />
      ) : list.length === 0 ? (
        <Empty title={empty[current]} />
      ) : (
        <ul className="space-y-3">
          {list.map((r) => {
            const num = orderNumber(r.orderId);
            const shownPhotos = current === "photos" ? r.photos.filter((p) => p.status === "pending") : r.photos;
            return (
              <li key={r.id} className="rounded-2xl border border-line bg-surface p-4 sm:p-5" data-admin-review={r.status}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <Stars n={r.rating} />
                  <span className="font-semibold">{r.displayName}</span>
                  {r.verified ? <Badge tone="accent">Verified order</Badge> : <Badge>Not verified</Badge>}
                  {r.status === "approved" && <Badge tone="pos">Live</Badge>}
                  {r.status === "pending" && <Badge tone="warn">Needs review</Badge>}
                  {r.status === "hidden" && <Badge>Hidden</Badge>}
                  {r.edited && <Badge>Edited by store</Badge>}
                </div>
                {r.flagReason && r.status === "pending" && (
                  <p className="mt-2 rounded-lg bg-warn/10 px-3 py-2 text-sm font-medium text-warn" data-flag-reason>
                    Held because: {r.flagReason}
                  </p>
                )}
                {r.title && <p className="mt-2 font-semibold">{r.title}</p>}
                <p className={cx("mt-1 whitespace-pre-line text-[15px]", !r.text && "text-muted")}>{r.text || "No comment, rating only."}</p>

                {shownPhotos.length > 0 && (
                  <ul className="mt-3 space-y-3">
                    {shownPhotos.map((p) => (
                      <li key={p.id} className="overflow-hidden rounded-xl border border-line" data-admin-photo={p.status}>
                        <a href={`/api/reviews/photo/${p.file}-1600.webp`} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/reviews/photo/${p.file}-1600.webp`} alt={`Photo from ${r.displayName}`} className="max-h-[32rem] w-full bg-surface2 object-contain" />
                        </a>
                        <div className="flex flex-wrap items-center gap-2 border-t border-line p-2.5">
                          <Badge tone={PHOTO_TONE[p.status]}>{PHOTO_LABEL[p.status]}</Badge>
                          <span className="flex-1" />
                          {p.status !== "approved" && (
                            <Button variant="primary" className="h-9" onClick={() => photo(r, p, "approved")}>
                              <Check size={16} /> Approve photo
                            </Button>
                          )}
                          {p.status !== "rejected" && (
                            <Button className="h-9" onClick={() => photo(r, p, "rejected")}>
                              <X size={16} /> Reject photo
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
                  <span>{fmtDate(r.createdAt)}</span>
                  <span>·</span>
                  <span>{r.email || "no email"}</span>
                  <span>·</span>
                  <span>{SOURCE[r.source] ?? r.source}</span>
                  {num && (
                    <>
                      <span>·</span>
                      <Link href={`/admin/orders/${r.orderId}`} className="font-medium text-accent hover:underline">
                        Order #{num}
                      </Link>
                    </>
                  )}
                  {r.photos.length > 0 && current !== "photos" && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <ImageIcon size={12} /> {r.photos.length}
                      </span>
                    </>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                  {r.status !== "approved" && (
                    <Button variant="primary" className="h-10" onClick={() => patch(r, { status: "approved" }, "Review text is live")}>
                      {r.status === "pending" ? "Approve text" : "Show again"}
                    </Button>
                  )}
                  {r.status !== "hidden" && (
                    <Button className="h-10" onClick={() => patch(r, { status: "hidden" }, "Review hidden")}>
                      Hide
                    </Button>
                  )}
                  <Button className="h-10" onClick={() => setEdit({ ...r })}>
                    Edit
                  </Button>
                  <Button className="h-10 text-neg" onClick={() => remove(r)}>
                    Delete
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet
        open={!!edit}
        onClose={() => setEdit(null)}
        title="Edit review"
        footer={
          <div className="flex gap-2">
            <Button block onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button
              block
              variant="primary"
              disabled={!edit?.displayName.trim()}
              onClick={() => {
                if (!edit) return;
                const before = data.reviews.find((x) => x.id === edit.id);
                const edited = before?.edited || before?.text !== edit.text || before?.title !== edit.title;
                patch(edit, { title: edit.title, text: edit.text, displayName: edit.displayName.trim(), edited }, "Review saved");
                setEdit(null);
              }}
            >
              Save
            </Button>
          </div>
        }
      >
        {edit && (
          <div className="space-y-4">
            <p className="text-sm text-muted">Use this to remove anything about product use or results. If you change the words, the review shows “Edited by store”. The star rating can’t be changed.</p>
            <Field label="Display name">
              <Input value={edit.displayName} maxLength={60} onChange={(e) => setEdit({ ...edit, displayName: e.target.value })} />
            </Field>
            <Field label="Title">
              <Input value={edit.title} maxLength={80} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </Field>
            <Field label="Review">
              <Textarea value={edit.text} maxLength={1500} className="min-h-[140px]" onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
            </Field>
          </div>
        )}
      </Sheet>

      <Sheet
        open={ask !== null}
        onClose={() => setAsk(null)}
        title="Ask past customers for reviews"
        wide
        footer={
          <div className="flex gap-2">
            <Button block onClick={() => setAsk(null)}>
              Cancel
            </Button>
            <Button block variant="primary" disabled={!ask?.picked.size || asking} onClick={sendAsk}>
              {asking ? "Sending…" : `Send ${ask?.picked.size ?? 0} email${ask?.picked.size === 1 ? "" : "s"}`}
            </Button>
          </div>
        }
      >
        {ask && (
          <div className="space-y-4" data-ask-past>
            <p className="text-sm text-muted">
              Paid orders that were shipped, delivered or picked up, not canceled or refunded, with no review and no review request yet. One email per customer (their most recent order). The links mark the review as a Verified order.
            </p>
            {ask.list.length === 0 ? (
              <Empty title="Nobody to ask right now" body="Every eligible order already got a review request or has a review." />
            ) : (
              <>
                <label className="flex items-center gap-3 text-sm font-medium">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[var(--accent)]"
                    checked={ask.picked.size === ask.list.length}
                    onChange={(e) => setAsk({ ...ask, picked: new Set(e.target.checked ? ask.list.map((o) => o.orderId) : []) })}
                  />
                  All {ask.list.length}
                </label>
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {ask.list.map((o) => (
                    <li key={o.orderId}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm">
                        <input
                          type="checkbox"
                          className="h-5 w-5 shrink-0 accent-[var(--accent)]"
                          checked={ask.picked.has(o.orderId)}
                          onChange={(e) => {
                            const picked = new Set(ask.picked);
                            if (e.target.checked) picked.add(o.orderId);
                            else picked.delete(o.orderId);
                            setAsk({ ...ask, picked });
                          }}
                        />
                        <span className="w-14 shrink-0 font-semibold tabular-nums">#{o.number}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{o.name}</span>
                          <span className="block truncate text-muted">{o.email}</span>
                        </span>
                        <span className="shrink-0 text-muted">{fmtDate(o.date)}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </Sheet>

      <Sheet
        open={words !== null}
        onClose={() => setWords(null)}
        title="Filter words"
        footer={
          <div className="flex gap-2">
            <Button block onClick={() => setWords(DEFAULT_FLAG_WORDS.join("\n"))}>
              Reset to defaults
            </Button>
            <Button block variant="primary" onClick={saveWords}>
              Save
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            A review whose title, text or name contains one of these goes to <strong>Needs review</strong> and stays hidden until you approve it. One word or phrase per line. Plurals and a number in between match too (“lost lbs” catches “lost 12 lbs”), but never part of a longer word (“pin” doesn’t match “spinning”).
          </p>
          <p className="text-sm text-muted">Always checked as well: profanity, links / web addresses and phone numbers.</p>
          <Field label="Words and phrases">
            <Textarea value={words ?? ""} className="min-h-[320px] font-mono text-sm" onChange={(e) => setWords(e.target.value)} />
          </Field>
        </div>
      </Sheet>
    </div>
  );
}
