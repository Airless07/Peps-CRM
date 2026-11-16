"use client";

import { useState } from "react";
import Link from "next/link";
import { Star } from "lucide-react";
import { api, useLoaded } from "@/components/store";
import { useToast } from "@/components/toast";
import { Badge, Button, Empty, Field, Input, PageHeader, PageSkeleton, Segmented, Sheet, Textarea, cx } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import type { ReviewRec, ReviewStatus } from "@/lib/types";

const TONE: Record<ReviewStatus, "warn" | "pos" | "neutral"> = { pending: "warn", approved: "pos", hidden: "neutral" };
const LABEL: Record<ReviewStatus, string> = { pending: "Waiting for approval", approved: "Published", hidden: "Hidden" };

function Stars({ n, size = 16 }: { n: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={size} className={i <= n ? "fill-warn text-warn" : "text-line"} />
      ))}
    </span>
  );
}

export default function ReviewsPage() {
  const s = useLoaded();
  const toast = useToast();
  const [filter, setFilter] = useState<"pending" | "approved" | "hidden" | "all">("pending");
  const [edit, setEdit] = useState<ReviewRec | null>(null);

  if (!s) return <PageSkeleton />;
  const { data, mutate } = s;
  const counts = { pending: 0, approved: 0, hidden: 0 };
  for (const r of data.reviews) counts[r.status]++;
  const list = data.reviews.filter((r) => filter === "all" || r.status === filter);
  const orderNumber = (id: string | null) => [...data.orders, ...data.pendingOrders].find((o) => o.id === id)?.number;

  const patch = (r: ReviewRec, p: Partial<ReviewRec>, msg: string) =>
    mutate(
      (d) => ({ ...d, reviews: d.reviews.map((x) => (x.id === r.id ? { ...x, ...p } : x)) }),
      () => api(`/api/reviews/${r.id}`, "PATCH", p),
    ).then((ok) => ok && toast.show({ message: msg, tone: "success" }));

  return (
    <div className="max-w-3xl">
      <PageHeader title="Reviews" sub="Store experience reviews from delivered orders. Only published ones appear on the store." />
      <Segmented
        className="mb-5"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "pending", label: `To approve${counts.pending ? ` (${counts.pending})` : ""}` },
          { value: "approved", label: `Published (${counts.approved})` },
          { value: "hidden", label: `Hidden (${counts.hidden})` },
          { value: "all", label: "All" },
        ]}
      />

      {data.reviews.length === 0 ? (
        <Empty icon={<Star size={32} />} title="No reviews yet" body="When you mark an order delivered, the customer gets an email asking how it went. Their review shows up here for approval. Reviews can’t be created from the admin." />
      ) : list.length === 0 ? (
        <Empty title={filter === "pending" ? "Nothing waiting for approval" : "No reviews here"} />
      ) : (
        <ul className="space-y-3">
          {list.map((r) => {
            const num = orderNumber(r.orderId);
            return (
              <li key={r.id} className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Stars n={r.rating} />
                  <span className="font-semibold">{r.displayName}</span>
                  <Badge tone="accent">Verified buyer</Badge>
                  <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
                  {r.edited && <Badge>Edited by store</Badge>}
                </div>
                <p className={cx("mt-2 whitespace-pre-line text-[15px]", !r.text && "text-muted")}>{r.text || "No comment, rating only."}</p>
                <div className="mt-2 text-xs text-muted">
                  {fmtDate(r.createdAt)}
                  {num && (
                    <>
                      {" · "}
                      <Link href={`/admin/orders/${r.orderId}`} className="font-medium text-accent hover:underline">
                        Order #{num}
                      </Link>
                    </>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                  {r.status !== "approved" && (
                    <Button variant="primary" className="h-10" onClick={() => patch(r, { status: "approved" }, "Review published on the store")}>
                      Approve
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
                const edited = before?.edited || before?.text !== edit.text;
                patch(edit, { text: edit.text, displayName: edit.displayName.trim(), edited }, "Review saved");
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
            <Field label="Review">
              <Textarea value={edit.text} maxLength={1500} className="min-h-[140px]" onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
            </Field>
          </div>
        )}
      </Sheet>
    </div>
  );
}
