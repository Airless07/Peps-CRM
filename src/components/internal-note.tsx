"use client";

import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { api, useStore } from "./store";
import { useToast } from "./toast";
import { Button, Card, Textarea } from "./ui";

/** Internal note on an order. Saved on the order only: it is in no email and on no customer page. */
export function InternalNote({ orderId, note }: { orderId: string; note: string }) {
  const { refresh } = useStore();
  const toast = useToast();
  const [text, setText] = useState(note);
  const [busy, setBusy] = useState(false);
  // Follow the saved value when it changes underneath (another device, a refresh).
  useEffect(() => setText(note), [note, orderId]);
  const dirty = text.trim() !== note.trim();

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ message: string }>(`/api/orders/${orderId}/action`, "POST", { action: "admin-note", note: text });
      await refresh();
      toast.show({ message: r.message, tone: "success" });
    } catch (e) {
      toast.show({ message: (e as Error).message, tone: "error", duration: 7000 });
    }
    setBusy(false);
  }

  return (
    <Card className="p-4 sm:p-5" data-internal-note>
      <label htmlFor="internal-note" className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <Lock size={14} className="text-muted" /> Internal note
      </label>
      <p className="mb-2 text-xs text-muted">Only the team sees this. It is never emailed to the customer and never shown on their order page.</p>
      <Textarea id="internal-note" name="internal-note" autoComplete="off" value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="For example: paid from a different name, call before shipping, repeat customer." className="min-h-[88px]" />
      <div className="mt-2 flex items-center gap-3">
        <Button variant={dirty ? "primary" : "secondary"} className="h-11" disabled={!dirty || busy} onClick={save}>
          {busy ? "Saving…" : "Save note"}
        </Button>
        {!dirty && note.trim() && <span className="text-xs text-muted">Saved</span>}
      </div>
    </Card>
  );
}
