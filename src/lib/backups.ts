// Database backups on disk: a full copy of the SQLite file in DATA_DIR/backups.
// One per day automatically (the last 14 are kept), plus "Back up now".
import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { backupsDir } from "./data-dir";
import { prisma } from "./db";

export const KEEP_BACKUPS = 14;
const NAME_RE = /^peps-\d{4}-\d{2}-\d{2}(-\d{6})?(-manual)?\.db$/;

export interface BackupFile {
  name: string;
  sizeBytes: number;
  createdAt: string;
  manual: boolean;
}

export function listBackups(): BackupFile[] {
  const dir = backupsDir();
  return readdirSync(dir)
    .filter((n) => NAME_RE.test(n))
    .map((name) => {
      const st = statSync(path.join(dir, name));
      return { name, sizeBytes: st.size, createdAt: st.mtime.toISOString(), manual: name.includes("-manual") };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Path of a backup by name, or null when the name is not one of ours (no path tricks). */
export function backupPath(name: string): string | null {
  if (!NAME_RE.test(name)) return null;
  const full = path.join(backupsDir(), name);
  return existsSync(full) ? full : null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const dayStamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function prune() {
  const all = listBackups();
  for (const b of all.slice(KEEP_BACKUPS)) {
    try {
      unlinkSync(path.join(backupsDir(), b.name));
    } catch {}
  }
}

/** Write a consistent copy of the database (safe while the app is running). */
export async function createBackup(manual: boolean, now = new Date()): Promise<BackupFile> {
  const name = manual ? `peps-${dayStamp(now)}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-manual.db` : `peps-${dayStamp(now)}.db`;
  const full = path.join(backupsDir(), name);
  if (existsSync(full)) unlinkSync(full);
  await prisma.$executeRawUnsafe(`VACUUM INTO '${full.replace(/\\/g, "/").replace(/'/g, "''")}'`);
  prune();
  const st = statSync(full);
  return { name, sizeBytes: st.size, createdAt: st.mtime.toISOString(), manual };
}

/** Make today's automatic backup if it doesn't exist yet. */
export async function ensureDailyBackup(now = new Date()): Promise<boolean> {
  if (existsSync(path.join(backupsDir(), `peps-${dayStamp(now)}.db`))) return false;
  await createBackup(false, now);
  return true;
}
