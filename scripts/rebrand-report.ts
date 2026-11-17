/**
 * Shows what the "labs_review" migration changes in the STORED text of a database, value by value.
 *
 *   npm run rebrand-report                     (uses data/peps.db)
 *   npm run rebrand-report -- path/to/copy.db  (for example a backup downloaded from Settings, Backups)
 *
 * It never touches the file you give it: it works on a temporary copy, runs `prisma migrate deploy`
 * on that copy, and prints every stored value that is different afterwards (before and after),
 * followed by a search of the whole migrated copy for the old brand name.
 */
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(import.meta.dirname, "..");
const source = path.resolve(process.argv[2] ?? path.join(root, "data", "peps.db"));
const work = path.join(tmpdir(), `labs-report-${Date.now()}`);
mkdirSync(work, { recursive: true });
const copy = path.join(work, "copy.db");
copyFileSync(source, copy);

type Flat = Map<string, string>;
function flatten(prefix: string, v: unknown, out: Flat) {
  if (Array.isArray(v)) v.forEach((x, i) => flatten(`${prefix}[${i}]`, x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) flatten(prefix ? `${prefix}.${k}` : k, x, out);
  else out.set(prefix, String(v));
}

function snapshot(file: string): Flat {
  const db = new DatabaseSync(file, { readOnly: true });
  const out: Flat = new Map();
  const s = db.prepare(`select "storeJson", "contentJson" from "Settings" where id = 1`).get() as { storeJson: string; contentJson: string } | undefined;
  for (const [name, json] of [["Settings (store)", s?.storeJson], ["Content", s?.contentJson]] as const) {
    try {
      flatten(name, JSON.parse(json || "{}"), out);
    } catch {
      out.set(name, json ?? "");
    }
  }
  for (const l of db.prepare(`select id, name, summary, description, "seoTitle", "seoDescription" from "Listing"`).all() as Record<string, string>[]) {
    for (const c of ["summary", "description", "seoTitle", "seoDescription"]) if (l[c]) out.set(`Product "${l.name}" ${c}`, l[c]);
  }
  db.close();
  return out;
}

/** Every text cell in the database that still holds the old brand (product names are not brand text). */
function oldBrandCells(file: string): string[] {
  const db = new DatabaseSync(file, { readOnly: true });
  const old = ["Buckshot", "Peps"].join(" ").toLowerCase();
  const hits: string[] = [];
  const tables = (db.prepare(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name != '_prisma_migrations'`).all() as { name: string }[]).map((t) => t.name);
  for (const t of tables) {
    const cols = (db.prepare(`pragma table_info("${t}")`).all() as { name: string; type: string }[]).filter((c) => /TEXT|CHAR|CLOB|^$/i.test(c.type));
    for (const c of cols) {
      const rows = db.prepare(`select count(*) as n from "${t}" where lower(cast("${c.name}" as text)) like ?`).get(`%${old}%`) as { n: number };
      if (rows.n > 0) hits.push(`${t}.${c.name}: ${rows.n} row(s)`);
    }
  }
  db.close();
  return hits;
}

const before = snapshot(copy);
const brandBefore = oldBrandCells(copy);
execSync("npx prisma migrate deploy", { cwd: root, stdio: "pipe", env: { ...process.env, DATABASE_URL: `file:${copy.split(path.sep).join("/")}` } });
const after = snapshot(copy);
const brandAfter = oldBrandCells(copy);

console.log(`Database: ${source}\n(work copy: ${copy})\n`);
let changed = 0;
for (const key of new Set([...before.keys(), ...after.keys()])) {
  const a = before.get(key);
  const b = after.get(key);
  if (a === b) continue;
  changed++;
  console.log(`${key}\n  BEFORE: ${a ?? "(not stored)"}\n  AFTER:  ${b ?? "(not stored)"}\n`);
}
console.log(changed === 0 ? "No stored value changed (nothing held the old brand or the old testing claims, or the migration was already applied)." : `${changed} stored value(s) changed.`);
console.log(`\nOld brand in the database before: ${brandBefore.length ? brandBefore.join("; ") : "none"}`);
console.log(`Old brand in the database after:  ${brandAfter.length ? brandAfter.join("; ") : "none (0 rows in every text column of every table)"}`);
if (!process.env.KEEP_WORK) rmSync(work, { recursive: true, force: true });
if (brandAfter.length) process.exit(1);
