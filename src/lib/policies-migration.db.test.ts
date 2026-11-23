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
