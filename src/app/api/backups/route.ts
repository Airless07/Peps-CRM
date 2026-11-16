import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { HttpError, route } from "@/lib/api";
import { backupPath, createBackup, KEEP_BACKUPS, listBackups } from "@/lib/backups";

export const dynamic = "force-dynamic";

/** List backups, or download one with ?file=name. */
export const GET = route(async (req) => {
  const name = req.nextUrl.searchParams.get("file");
  if (!name) return { backups: listBackups(), keep: KEEP_BACKUPS };
  const full = backupPath(name);
  if (!full) throw new HttpError(404, "That backup file was not found. It may have been replaced by a newer one.");
  return new NextResponse(Readable.toWeb(createReadStream(full)) as ReadableStream, {
    headers: { "Content-Type": "application/octet-stream", "Content-Length": String(statSync(full).size), "Content-Disposition": `attachment; filename="${name}"` },
  });
});

/** "Back up now". */
export const POST = route(async () => {
  try {
    return { ok: true, backup: await createBackup(true) };
  } catch (e) {
    console.error(e);
    throw new HttpError(500, "The backup could not be written. Check that the data folder (the Railway volume at /data) exists and has free space.");
  }
});
