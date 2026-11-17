// Loaded into the server process for end-to-end tests only (NODE_OPTIONS=--import ./e2e/mock-fetch.mjs).
// Replaces the two outside services with local fakes, so no email is sent and no label is bought:
//   - Resend  (https://api.resend.com)   every email is written to the log file instead
//   - Shippo  (https://api.goshippo.com) fixed rates, a fake label and tracking number
// Each call is appended to E2E_MOCK_LOG as one JSON line so the tests can read what happened.
import { appendFileSync } from "node:fs";

const LOG = process.env.E2E_MOCK_LOG;
if (!LOG) throw new Error("mock-fetch.mjs needs E2E_MOCK_LOG. It must never be loaded outside the end-to-end tests.");
if (process.env.RESEND_API_KEY !== "re_e2e_mock" || !String(process.env.SHIPPO_API_KEY).startsWith("shippo_test_")) {
  throw new Error("mock-fetch.mjs refuses to run with real API keys.");
}

const real = globalThis.fetch;
const log = (entry) => appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let n = 0;

const RATES = [
  { object_id: "rate_ground", provider: "USPS", amount: "5.25", estimated_days: 5, servicelevel: { name: "Ground Advantage", token: "usps_ground_advantage" } },
  { object_id: "rate_priority", provider: "USPS", amount: "9.10", estimated_days: 2, servicelevel: { name: "Priority Mail", token: "usps_priority" } },
  { object_id: "rate_express", provider: "USPS", amount: "31.40", estimated_days: 1, servicelevel: { name: "Priority Mail Express", token: "usps_priority_express" } },
];

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? "GET").toUpperCase();
  let body = null;
  try {
    body = init?.body ? JSON.parse(String(init.body)) : null;
  } catch {}

  if (url.startsWith("https://api.resend.com/")) {
    n++;
    log({ service: "resend", to: body?.to, from: body?.from, subject: body?.subject, text: body?.text });
    return json({ id: `mock-email-${n}` });
  }

  if (url.startsWith("https://api.goshippo.com/")) {
    const path = new URL(url).pathname;
    log({ service: "shippo", method, path, body });
    if (path === "/shipments/" && method === "POST") return json({ object_id: "shp_mock", rates: RATES, messages: [] });
    if (path === "/transactions/" && method === "POST") {
      const rate = RATES.find((r) => r.object_id === body?.rate);
      if (!rate) return json({ status: "ERROR", messages: [{ text: "Unknown rate" }] });
      return json({ object_id: "tx_mock_1", status: "SUCCESS", tracking_number: "9400111899560000000001", label_url: "https://deliver.goshippo.com/mock-label.pdf", messages: [] });
    }
    if (path === "/tracks/" && method === "POST") return json({ tracking_status: { status: "PRE_TRANSIT" } });
    if (path.startsWith("/tracks/")) return json({ tracking_status: { status: "PRE_TRANSIT", status_details: "Label created", status_date: new Date().toISOString() }, tracking_history: [] });
    if (path.startsWith("/carrier_accounts")) return json({ results: [{ carrier: "usps", active: true }] });
    if (path === "/addresses/") return json({ validation_results: { is_valid: true, messages: [] } });
    return json({ detail: "not mocked" }, 404);
  }

  return real(input, init);
};
