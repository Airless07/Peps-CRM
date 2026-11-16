import { mkdirSync } from "node:fs";
import path from "node:path";

/**
 * Where files live next to the database: /data on Railway (the Volume), <project>/data locally.
 * DATA_DIR overrides it; otherwise it is the folder of the SQLite file in DATABASE_URL
 * (relative paths are resolved from the prisma/ folder, like Prisma does).
 */
export function dataDir(): string {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  const url = process.env.DATABASE_URL ?? "file:../data/peps.db";
  const file = url.replace(/^file:/, "").split("?")[0];
  const abs = path.isAbsolute(file) ? file : path.resolve(process.cwd(), "prisma", file);
  return path.dirname(abs);
}

export function dbFile(): string {
  const url = process.env.DATABASE_URL ?? "file:../data/peps.db";
  const file = url.replace(/^file:/, "").split("?")[0];
  return path.isAbsolute(file) ? file : path.resolve(process.cwd(), "prisma", file);
}

function ensure(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const publicUploadsDir = () => ensure(path.join(dataDir(), "uploads", "public"));
export const privateUploadsDir = () => ensure(path.join(dataDir(), "uploads", "private"));
export const backupsDir = () => ensure(path.join(dataDir(), "backups"));
