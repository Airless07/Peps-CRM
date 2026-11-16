// File uploads. Everything is checked by its real content (not its name), resized and compressed,
// and saved under a random id. Public files are served from /media; private files only through
// admin routes.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { HttpError } from "./api";
import { privateUploadsDir, publicUploadsDir } from "./data-dir";

export const PHOTO_WIDTHS = [480, 960, 1600] as const;
/** Product photos are cropped to this shape (width / height). */
export const PRODUCT_ASPECT = 4 / 5;
export const RECOMMENDED = {
  product: "1600 × 2000 px (4:5 portrait), JPG, PNG or WebP, up to 12 MB",
  hero: "2400 × 1350 px or larger (landscape), JPG, PNG or WebP, up to 12 MB",
  logo: "Transparent PNG or SVG-style artwork, about 600 px wide, up to 12 MB",
  share: "1200 × 630 px, JPG or PNG, up to 12 MB",
  gif: "GIF up to 10 MB. It is converted to a small looping animation.",
  coa: "PDF or image (JPG, PNG, WebP), up to 15 MB",
  screenshot: "Image (JPG, PNG, WebP or HEIC screenshot), up to 12 MB",
};

const MB = 1024 * 1024;
const IMAGE_FORMATS = new Set(["jpeg", "png", "webp", "gif", "avif", "tiff", "heif"]);
export type ImageKind = "product" | "hero" | "vial" | "logo" | "share" | "favicon";

const newId = () => randomBytes(8).toString("hex");
export const FILE_RE = /^[a-f0-9]{16}(-\d{2,4})?\.(webp|png|pdf)$/;

function tooBig(buf: Buffer, mb: number, what: string) {
  if (buf.length === 0) throw new HttpError(400, `That ${what} is empty. Pick the file again.`);
  if (buf.length > mb * MB) throw new HttpError(400, `That ${what} is ${(buf.length / MB).toFixed(1)} MB. The limit is ${mb} MB. Use a smaller file.`);
}

async function imageMeta(buf: Buffer, what: string) {
  try {
    const meta = await sharp(buf, { animated: true }).metadata();
    if (!meta.format || !IMAGE_FORMATS.has(meta.format) || !meta.width || !meta.height) throw new Error("not an image");
    if (meta.width * (meta.pageHeight ?? meta.height) > 60_000_000) throw new HttpError(400, `That ${what} has too many pixels. Use one under 8000 px wide.`);
    return meta;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, `That ${what} is not an image we can read. Use a JPG, PNG or WebP file.`);
  }
}

/** Save a photo in three widths. Returns the upload id (files are {id}-{width}.webp). */
export async function saveImage(buf: Buffer, kind: ImageKind): Promise<{ id: string; width: number; height: number }> {
  tooBig(buf, 12, "image");
  const meta = await imageMeta(buf, "image");
  const id = newId();
  const dir = publicUploadsDir();
  if (kind === "favicon") {
    await sharp(buf).rotate().resize(256, 256, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(dir, `${id}.png`));
    return { id, width: 256, height: 256 };
  }
  for (const w of PHOTO_WIDTHS) {
    let img = sharp(buf).rotate();
    if (kind === "product") img = img.resize(w, Math.round(w / PRODUCT_ASPECT), { fit: "cover", position: "attention" });
    else if (kind === "share") img = img.resize(w, Math.round((w * 630) / 1200), { fit: "cover", position: "attention" });
    else img = img.resize({ width: w, withoutEnlargement: kind === "logo" || kind === "vial" });
    await img.webp({ quality: kind === "logo" ? 90 : kind === "vial" ? 86 : 80, effort: 5, alphaQuality: 100 }).toFile(path.join(dir, `${id}-${w}.webp`));
  }
  return { id, width: meta.width!, height: meta.height! };
}

/** Hover animation: any GIF/animated image, converted to a small looping WebP. Returns the file name. */
export async function saveGif(buf: Buffer): Promise<string> {
  tooBig(buf, 10, "GIF");
  await imageMeta(buf, "GIF");
  const file = `${newId()}.webp`;
  await sharp(buf, { animated: true, pages: -1 })
    .resize(640, Math.round(640 / PRODUCT_ASPECT), { fit: "cover" })
    .webp({ quality: 70, effort: 4, loop: 0 })
    .toFile(path.join(publicUploadsDir(), file));
  return file;
}

/** COA: a PDF is kept as is, an image is compressed. Returns the file name and its type. */
export async function saveCoa(buf: Buffer): Promise<{ file: string; mime: string }> {
  tooBig(buf, 15, "file");
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") {
    const file = `${newId()}.pdf`;
    await writeFile(path.join(publicUploadsDir(), file), buf);
    return { file, mime: "application/pdf" };
  }
  try {
    await imageMeta(buf, "file");
  } catch {
    throw new HttpError(400, "A COA must be a PDF or an image (JPG, PNG, WebP). That file is neither.");
  }
  const file = `${newId()}.webp`;
  await sharp(buf).rotate().resize({ width: 2000, height: 2800, fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toFile(path.join(publicUploadsDir(), file));
  return { file, mime: "image/webp" };
}

/** Payment screenshot: private, admin only. Returns the file name. */
export async function saveScreenshot(buf: Buffer): Promise<string> {
  tooBig(buf, 12, "screenshot");
  await imageMeta(buf, "screenshot");
  const file = `${newId()}.webp`;
  await sharp(buf).rotate().resize({ width: 1600, height: 3200, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toFile(path.join(privateUploadsDir(), file));
  return file;
}

const MIME: Record<string, string> = { webp: "image/webp", png: "image/png", pdf: "application/pdf" };

export async function readUpload(file: string, scope: "public" | "private"): Promise<{ body: Buffer; mime: string } | null> {
  if (!FILE_RE.test(file)) return null;
  const full = path.join(scope === "public" ? publicUploadsDir() : privateUploadsDir(), file);
  if (!existsSync(full)) return null;
  return { body: await readFile(full), mime: MIME[file.split(".").pop()!] ?? "application/octet-stream" };
}

/** Best effort: remove a public upload (all sizes of a photo id, or a single file). */
export async function removeUpload(idOrFile: string, scope: "public" | "private" = "public") {
  const dir = scope === "public" ? publicUploadsDir() : privateUploadsDir();
  const names = /^[a-f0-9]{16}$/.test(idOrFile) ? [...PHOTO_WIDTHS.map((w) => `${idOrFile}-${w}.webp`), `${idOrFile}.png`] : FILE_RE.test(idOrFile) ? [idOrFile] : [];
  await Promise.all(names.map((n) => unlink(path.join(dir, n)).catch(() => {})));
}

/** Read one file out of a multipart form. */
export async function formFile(req: Request, field = "file"): Promise<{ buf: Buffer; form: FormData }> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "The upload did not arrive. Check your connection and try again.");
  }
  const f = form.get(field);
  if (!f || typeof f === "string") throw new HttpError(400, "No file was attached. Choose a file and try again.");
  return { buf: Buffer.from(await f.arrayBuffer()), form };
}
