// "Is this customer local?" from the bundled Census ZIP data. Server only (the data is ~1 MB).
// No network calls: straight-line (haversine) distance between ZIP centers.
import { ZIP_DATA } from "./zip-data";

export interface ZipInfo {
  zip: string;
  lat: number;
  lng: number;
  town: string;
  state: string;
}

let table: Map<string, ZipInfo> | null = null;

function zips(): Map<string, ZipInfo> {
  if (table) return table;
  const m = new Map<string, ZipInfo>();
  for (const line of ZIP_DATA.split("\n")) {
    const [zip, lat, lng, town, state] = line.split("|");
    if (zip?.length === 5) m.set(zip, { zip, lat: Number(lat), lng: Number(lng), town: town ?? "", state: state ?? "" });
  }
  table = m;
  return m;
}

/** The 5-digit ZIP from "48124" or "48124-1234". Empty when there is none. */
export const zip5 = (zip: string | null | undefined) => (zip ?? "").trim().match(/^(\d{5})(?:-\d{4})?$/)?.[1] ?? "";

export const zipInfo = (zip: string | null | undefined): ZipInfo | null => zips().get(zip5(zip)) ?? null;

/** Straight-line distance in miles between two points (haversine, Earth radius 3958.8 mi). */
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface LocalZip extends ZipInfo {
  miles: number;
}

// The local ZIP list for one home ZIP + radius. Recomputed only when either changes (a full pass over
// the ~34k ZIPs takes a few milliseconds), so checkout is a single Set lookup.
const cache = new Map<string, { list: LocalZip[]; set: Set<string> }>();

export function localArea(homeZip: string, radiusMiles: number): { list: LocalZip[]; set: Set<string> } {
  const key = `${zip5(homeZip)}|${radiusMiles}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const home = zipInfo(homeZip);
  const list: LocalZip[] = [];
  if (home && radiusMiles > 0) {
    for (const z of zips().values()) {
      const miles = milesBetween(home, z);
      if (miles <= radiusMiles) list.push({ ...z, miles: Math.round(miles * 10) / 10 });
    }
    list.sort((a, b) => a.miles - b.miles || a.zip.localeCompare(b.zip));
  }
  const area = { list, set: new Set(list.map((z) => z.zip)) };
  if (cache.size > 20) cache.clear();
  cache.set(key, area);
  return area;
}

/** True when the ZIP is within the radius of the home ZIP. Unknown ZIPs (not in the data) are never local. */
export function isLocalZip(local: { homeZip: string; radiusMiles: number }, zip: string | null | undefined): boolean {
  const z = zip5(zip);
  if (!z || !local.homeZip) return false;
  return localArea(local.homeZip, local.radiusMiles).set.has(z);
}
