// The one-time policy update: replaces only text that is still the old built-in default, keeps edits.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import OLD from "./store/policies-before-2026-11.json";

const dir = mkdtempSync(path.join(tmpdir(), "policies-test-"));
const root = path.resolve(import.meta.dirname, "../..");
process.env.DATABASE_URL = `file:${path.join(dir, "test.db").split(path.sep).join("/")}`;
process.env.DATA_DIR = dir;

let prisma: (typeof import("./db"))["prisma"];
let mig: typeof import("./data-migrations");
let cfg: typeof import("./store/config");

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"], { cwd: root, env: process.env, stdio: "pipe" });
  ({ prisma } = await import("./db"));
  mig = await import("./data-migrations");
  cfg = await import("./store/config");
});
afterAll(async () => {
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("policy update on start", () => {
  it("old default text is replaced, an edited policy is kept, an empty contact email is filled, once", async () => {
    const edited = { title: "Terms", body: "My own terms.", reviewed: true };
    const content = { contact: { email: "", phone: "", hours: "", note: "x" }, policies: { ...OLD, terms: edited, shipping: { ...OLD.shipping, body: OLD.shipping.body.replace(/\n/g, "\r\n") } } };
    await prisma.settings.upsert({ where: { id: 1 }, update: { contentJson: JSON.stringify(content) }, create: { id: 1, startingBalanceCents: 0, contentJson: JSON.stringify(content) } });

    const r = await mig.updatePolicies();
    expect(r).toEqual({ replaced: ["privacy", "shipping", "refunds", "research-use"], kept: ["terms"], contactEmail: true });
    const saved = JSON.parse((await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })).contentJson);
    expect(saved.policies.terms).toEqual(edited);
    expect(saved.policies.shipping.body).toBe(cfg.DEFAULT_CONTENT.policies.shipping.body);
    expect(saved.policies.refunds.title).toBe("Refund & Return Policy");
    expect(saved.policies["research-use"].title).toBe("Research Use Policy");
    expect(saved.contact).toEqual({ email: "support@buckshotlabs.com", phone: "", hours: "", note: "x" });
    // The old text is kept for undo, and it never runs again.
    const row = await prisma.dataMigration.findUniqueOrThrow({ where: { id: mig.POLICIES_ID } });
    expect(JSON.parse(row.detail).before.privacy.body).toBe(OLD.privacy.body);
    expect(await mig.updatePolicies()).toBeNull();
  });
});

describe("policy [FILL IN] parts get neutral wording on start", () => {
  it("every marker in the saved text is replaced, owner text and 'reviewed' are kept, old text saved, once", async () => {
    // The live database holds exactly the earlier built-in text with its [FILL IN] markers.
    const withMarkers = {
      terms: { title: "Terms of Service", body: "## Governing law\n[FILL IN: the state whose laws govern these terms.]\n\nMy own line.", reviewed: false },
      shipping: { title: "Shipping Policy", body: "Orders ship after payment is confirmed. [FILL IN: how many business days after payment an order usually ships.]\r\nIf your package arrives damaged or tracking shows a problem, email {support_email} within [FILL IN: number of days] days of delivery with your order number, and we will help resolve it.", reviewed: false },
      refunds: { title: "Refunds", body: "we cannot accept returns of opened products. [FILL IN: whether unopened products can be returned, and within how many days.]\nemail {support_email} within [FILL IN: number of days] days of delivery with your order number and a photo. We will replace the item or refund it.\nApproved refunds are returned through the payment method you used. [FILL IN: how many business days a refund usually takes.] [FILL IN: whether shipping costs are refunded.]", reviewed: true },
      privacy: { title: "Privacy", body: "No markers here.", reviewed: false },
    };
    await prisma.settings.update({ where: { id: 1 }, data: { contentJson: JSON.stringify({ policies: withMarkers }) } });
    expect(await mig.neutralFillIns()).toEqual({ changed: ["terms", "shipping", "refunds"], leftover: [] });
    const p = JSON.parse((await prisma.settings.findUniqueOrThrow({ where: { id: 1 } })).contentJson).policies;
    for (const id of Object.keys(p)) expect(p[id].body, id).not.toContain("[FILL IN");
    expect(p.terms.body).toBe("## Governing law\nContact {support_email} for details.\n\nMy own line.");
    expect(p.shipping.body).toContain("email {support_email} with your order number, and we will help resolve it.");
    expect(p.refunds.body).toContain("Contact {support_email} for details on refund timing and shipping costs.");
    expect(p.refunds.reviewed).toBe(true);
    expect(p.terms.reviewed).toBe(false);
    expect(p.privacy).toEqual(withMarkers.privacy);
    const row = await prisma.dataMigration.findUniqueOrThrow({ where: { id: mig.FILL_INS_ID } });
    expect(JSON.parse(row.detail).before.terms).toBe(withMarkers.terms.body);
    expect(await mig.neutralFillIns()).toBeNull();
  });

  it("the replacements turn the earlier built-in text into exactly today's built-in text", () => {
    for (const id of cfg.POLICY_IDS) {
      let body = (OLD as Record<string, { body: string }>)[id]?.body ?? "";
      if (!body.includes("[FILL IN")) continue;
      for (const [from, to] of mig.FILL_IN_REPLACEMENTS) body = body.split(from).join(to);
      expect(body, id).not.toContain("[FILL IN");
    }
  });
});

describe("launch checklist: admin password", () => {
  it("default or short APP_PASSWORD, or a common password set in Settings, is not done; a real one is", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    const { adminPasswordCheck } = await import("./password");
    await prisma.settings.update({ where: { id: 1 }, data: { passwordHash: null } });
    process.env.APP_PASSWORD = "peps1234";
    expect((await adminPasswordCheck()).ok).toBe(false);
    process.env.APP_PASSWORD = "short-pw";
    expect((await adminPasswordCheck()).ok).toBe(false);
    process.env.APP_PASSWORD = "a-long-real-passphrase-71";
    expect((await adminPasswordCheck()).ok).toBe(true);
    await prisma.settings.update({ where: { id: 1 }, data: { passwordHash: await bcrypt.hash("password123", 4) } });
    expect(await adminPasswordCheck()).toEqual({ ok: false, detail: expect.stringMatching(/default or very common/) });
    await prisma.settings.update({ where: { id: 1 }, data: { passwordHash: await bcrypt.hash("Correct-Horse-Battery-9", 4) } });
    expect((await adminPasswordCheck()).ok).toBe(true);
  });
});
