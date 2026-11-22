import { HttpError, route } from "@/lib/api";
import { localArea, zipInfo } from "@/lib/local/zips";

/** Admin: the ZIP codes (and towns) inside a radius of a home ZIP, so the owner can check the local area. */
export const GET = route(async (req) => {
  const q = new URL(req.url).searchParams;
  const zip = (q.get("zip") ?? "").trim();
  const radius = Math.min(200, Math.max(1, Number(q.get("radius")) || 15));
  const home = zipInfo(zip);
  if (!home) throw new HttpError(400, zip ? `ZIP ${zip} is not in the ZIP code data. Check it, or use a nearby ZIP.` : "Enter your home ZIP code.");
  const { list } = localArea(zip, radius);
  return { home: { zip: home.zip, town: home.town, state: home.state }, radius, zips: list.map((z) => ({ zip: z.zip, town: z.town, state: z.state, miles: z.miles })) };
});
