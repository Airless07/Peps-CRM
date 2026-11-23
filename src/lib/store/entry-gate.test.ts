import { describe, expect, it } from "vitest";
import { parseStore } from "./config";
import { entryCookieValid, gateExempt } from "./entry-gate";

describe("entry gate", () => {
  it("is on with age 21 by default, also for settings saved before it existed", () => {
    expect(parseStore("{}").entryGate).toEqual({ enabled: true, minAge: 21 });
    expect(parseStore(JSON.stringify({ open: true })).checkoutConsent).toBe(true);
    expect(parseStore(JSON.stringify({ entryGate: { enabled: false, minAge: 18 } })).entryGate).toEqual({ enabled: false, minAge: 18 });
    expect(parseStore(JSON.stringify({ entryGate: { minAge: 5 } })).entryGate.minAge).toBe(21);
    expect(parseStore(JSON.stringify({ checkoutConsent: false })).checkoutConsent).toBe(false);
  });

  it("cookie counts only until it runs out", () => {
    expect(entryCookieValid(undefined)).toBe(false);
    expect(entryCookieValid("junk")).toBe(false);
    expect(entryCookieValid(String(Date.now() - 1))).toBe(false);
    expect(entryCookieValid(String(Date.now() + 86400000))).toBe(true);
  });

  it("skips policy pages and email links, not the store", () => {
    for (const p of ["/terms", "/research-use", "/privacy", "/shipping", "/refunds", "/order-lookup", "/order/abc", "/review/abc", "/account/reset", "/account/invite"]) expect(gateExempt(p), p).toBe(true);
    for (const p of ["/", "/shop", "/product/retatrutide", "/checkout", "/account", "/account/referrals", "/orders", "/termsx"]) expect(gateExempt(p), p).toBe(false);
  });
});
