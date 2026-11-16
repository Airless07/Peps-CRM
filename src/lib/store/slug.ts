/** "BPC-157 10mg" -> "bpc-157-10mg". Never empty. */
export function slugify(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || "product";
}

/** First free slug: "bpc-157", "bpc-157-2", ... Adds the result to `taken`. */
export function uniqueSlug(base: string, taken: Set<string>): string {
  const root = slugify(base);
  let slug = root;
  for (let i = 2; taken.has(slug); i++) slug = `${root}-${i}`;
  taken.add(slug);
  return slug;
}
