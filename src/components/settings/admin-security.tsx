"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/store";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Field, Input, SectionTitle, useConfirm } from "@/components/ui";

/** Two-step sign in (authenticator app codes) and "Sign out everywhere" for the admin. */
export function AdminSecurity() {
  const toast = useToast();
  const confirm = useConfirm();
  const [on, setOn] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; url: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ totpEnabled: boolean }>("/api/settings/security").then((r) => setOn(r.totpEnabled)).catch(() => {});
  }, []);

  async function run(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await api<{ message?: string; secret?: string; url?: string }>("/api/settings/security", "POST", body);
      if (r.message) toast.show({ message: r.message, tone: "success" });
      return r;
    } catch (e) {
      toast.show({ message: (e as Error).message, tone: "error" });
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SectionTitle>Sign in security</SectionTitle>
      <Card className="space-y-4 p-4" data-admin-security>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium">Two-step sign in</div>
            <p className="text-sm text-muted">After the password, the admin sign in asks for a 6-digit code from an authenticator app (Google Authenticator, 1Password, Authy). Both partners can add the same code to their phones.</p>
          </div>
          {on !== null && <Badge tone={on ? "pos" : "neutral"}>{on ? "On" : "Off"}</Badge>}
        </div>
        {on === false && !setup && (
          <Button
            disabled={busy}
            onClick={async () => {
              const r = await run({ action: "totp-start" });
              if (r?.secret && r.url) setSetup({ secret: r.secret, url: r.url });
            }}
          >
            Set up two-step sign in
          </Button>
        )}
        {on === false && setup && (
          <div className="space-y-3 rounded-xl bg-surface2 p-4 text-sm">
            <p>
              1. In your authenticator app, add an account by <b>entering a setup key</b>. Account: Buckshot Labs admin. Key:
            </p>
            <code className="block break-all rounded-lg bg-surface px-3 py-2 font-mono text-base tracking-wider" data-totp-secret>
              {setup.secret.match(/.{1,4}/g)?.join(" ")}
            </code>
            <p>
              On a phone you can also{" "}
              <a href={setup.url} className="font-medium text-accent underline">
                open this link
              </a>{" "}
              to add it.
            </p>
            <p>2. Enter the 6-digit code the app shows:</p>
            <div className="flex gap-2">
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" className="w-36" />
              <Button
                variant="primary"
                disabled={busy || code.length !== 6}
                onClick={async () => {
                  if (await run({ action: "totp-enable", code })) {
                    setOn(true);
                    setSetup(null);
                    setCode("");
                  }
                }}
              >
                Turn on
              </Button>
            </div>
            <p className="text-xs text-muted">Keep the key somewhere safe (a password manager). If both phones are lost, the key is the way back in.</p>
          </div>
        )}
        {on === true && (
          <Field label="Turn off: enter the current 6-digit code">
            <div className="flex gap-2">
              <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" className="w-36" />
              <Button
                disabled={busy || code.length !== 6}
                onClick={async () => {
                  if (await run({ action: "totp-disable", code })) {
                    setOn(false);
                    setCode("");
                  }
                }}
              >
                Turn off
              </Button>
            </div>
          </Field>
        )}
        <div className="border-t border-line pt-4">
          <div className="font-medium">Sign out everywhere</div>
          <p className="mb-3 text-sm text-muted">Ends the admin session on every other phone and computer (for a lost phone, or after sharing the password). This device stays signed in.</p>
          <Button
            disabled={busy}
            onClick={async () => {
              if (await confirm({ title: "Sign out every other device?", body: "Everyone signed in to the admin elsewhere has to sign in again.", confirmText: "Sign out everywhere", danger: true })) await run({ action: "signout-everywhere" });
            }}
          >
            Sign out everywhere
          </Button>
        </div>
      </Card>
    </>
  );
}
