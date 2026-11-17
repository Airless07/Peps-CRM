/**
 * Local QA only: fills a COPY of the database with store demo data (open store, payment details,
 * website products, groups, promotions, a sample COA and photo) so every page can be looked at.
 *
 *   DATABASE_URL=file:/path/to/copy.db DATA_DIR=/path/to tsx scripts/qa-seed.ts
 *
 * Refuses to run against data/peps.db or in production.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { combineProducts, ensureCatalog } from "../src/lib/catalog-ops";
import { dbFile, publicUploadsDir } from "../src/lib/data-dir";
import { prisma } from "../src/lib/db";
import { DEFAULT_STORE } from "../src/lib/store/config";
import { PHOTO_WIDTHS } from "../src/lib/uploads";

if (process.env.NODE_ENV === "production" || path.resolve(dbFile()) === path.resolve(process.cwd(), "data", "peps.db")) {
  console.error("Refusing to seed: point DATABASE_URL at a copy of the database, not data/peps.db.");
  process.exit(1);
}

const vialSvg = (name: string, tint: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2000" viewBox="0 0 1600 2000">
<rect width="1600" height="2000" fill="${tint}"/><ellipse cx="800" cy="1640" rx="330" ry="40" fill="#000" opacity=".08"/>
<rect x="590" y="330" width="420" height="170" rx="30" fill="#9f1d22"/><rect x="630" y="500" width="340" height="70" fill="#c9c7c4"/>
<path d="M660 570h280v80c0 40 90 60 90 140v760c0 50-40 90-90 90H660c-50 0-90-40-90-90V790c0-80 90-100 90-140z" fill="#fff" stroke="#d9d6d2" stroke-width="10"/>
<rect x="570" y="900" width="460" height="400" fill="#fbfaf9" stroke="#e4e1dd" stroke-width="4"/><rect x="570" y="900" width="460" height="34" fill="#9f1d22"/>
<text x="800" y="1090" text-anchor="middle" font-family="Arial, sans-serif" font-size="84" font-weight="700" fill="#262220">${name}</text>
<text x="800" y="1180" text-anchor="middle" font-family="Arial, sans-serif" font-size="44" fill="#6b6562">Sample photo</text></svg>`;

async function photo(name: string, tint: string): Promise<string> {
  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  const buf = Buffer.from(vialSvg(name, tint));
  for (const w of PHOTO_WIDTHS) await sharp(buf).resize(w, Math.round(w / 0.8)).webp({ quality: 82 }).toFile(path.join(publicUploadsDir(), `${id}-${w}.webp`));
  return id;
}

async function coaFile(title: string): Promise<string> {
  const file = `${randomUUID().replace(/-/g, "").slice(0, 16)}.webp`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1550"><rect width="1200" height="1550" fill="#fff"/><rect x="60" y="60" width="1080" height="1430" fill="none" stroke="#222" stroke-width="3"/>
<text x="110" y="170" font-family="Arial" font-size="46" font-weight="700">Certificate of Analysis (sample)</text><text x="110" y="250" font-family="Arial" font-size="32">${title}</text>
<text x="110" y="330" font-family="Arial" font-size="26" fill="#555">Demo document for local testing only.</text></svg>`;
  await sharp(Buffer.from(svg)).webp({ quality: 88 }).toFile(path.join(publicUploadsDir(), file));
  return file;
}

async function main() {
  await ensureCatalog();
  const products = await prisma.product.findMany();
  const byName = (n: string) => products.find((p) => p.name.toLowerCase() === n.toLowerCase());

  // Two sizes of the same compound become one product.
  const r10 = byName("Reta 10mg");
  const r20 = byName("Reta 20mg");
  if (r10 && r20 && r10.listingId !== r20.listingId) await combineProducts({ name: "Reta", items: [{ productId: r10.id, label: "10mg" }, { productId: r20.id, label: "20mg" }] });

  const groups = [
    { id: "g-peptides", name: "Peptides" },
    { id: "g-blends", name: "Blends" },
    { id: "g-supplies", name: "Lab supplies" },
  ];
  for (const [i, g] of groups.entries()) await prisma.productGroup.upsert({ where: { id: g.id }, update: {}, create: { ...g, slug: g.name.toLowerCase().replace(/\s+/g, "-"), sortOrder: i } });

  const listings = await prisma.listing.findMany({ include: { variants: true } });
  const tints = ["#f4f1ee", "#f1efee", "#f5f2f0"];
  for (const [i, l] of listings.entries()) {
    const supplies = /water/i.test(l.name);
    const blend = /\//.test(l.name) || /klow/i.test(l.name);
    const hidden = /MT-2/i.test(l.name); // one product stays off the website
    await prisma.listing.update({
      where: { id: l.id },
      data: {
        showOnWebsite: !hidden,
        summary: supplies ? "Sterile diluent for laboratory reconstitution." : "Lyophilized research compound, supplied in a sealed vial with a lot number.",
        description: "Supplied for laboratory research. Each vial is labeled with its lot number, which matches the certificate of analysis when one is on file.\n\nStore sealed and away from light.",
        form: supplies ? "Sterile solution" : "Lyophilized powder",
        storage: supplies ? "Room temperature" : "Store at -20°C, protect from light",
        purity: supplies ? "" : "≥99%",
        casNumber: /ghk/i.test(l.name) ? "89030-95-5" : "",
        groupsJson: JSON.stringify([supplies ? "g-supplies" : blend ? "g-blends" : "g-peptides"]),
        badgesJson: JSON.stringify(i === 0 ? ["Popular"] : /nad/i.test(l.name) ? ["New"] : []),
        photosJson: JSON.stringify(i < 3 ? [{ id: await photo(l.name.replace(/&/g, "and").slice(0, 14), tints[i % 3]), alt: `${l.name} vial` }] : []),
      },
    });
    for (const [k, v] of l.variants.entries()) {
      const status = /ghk|reta/i.test(l.name) ? "coa_available" : /kpv|nad/i.test(l.name) ? "supplier_tested" : /mots/i.test(l.name) ? "pending" : "coming_soon";
      await prisma.product.update({ where: { id: v.id }, data: { testingStatus: status } });
      if ((status === "coa_available" || status === "supplier_tested") && (await prisma.coa.count({ where: { productId: v.id } })) === 0) {
        await prisma.coa.create({ data: { id: randomUUID(), productId: v.id, file: await coaFile(v.name), fileName: "coa.webp", mime: "image/webp", lot: `BP-${2400 + i * 7 + k}`, testDate: new Date(Date.now() - (20 + i) * 86400000), purity: status === "coa_available" ? "99.4%" : "", isCurrent: true } });
        if (/ghk/i.test(l.name)) await prisma.coa.create({ data: { id: randomUUID(), productId: v.id, file: await coaFile(`${v.name} (earlier lot)`), mime: "image/webp", lot: "BP-2291", testDate: new Date(Date.now() - 120 * 86400000), purity: "99.1%", isCurrent: false } });
      }
    }
  }
  // One sold-out product to see that state.
  const kpv = byName("KPV");
  if (kpv && (await prisma.stockAdjustment.count({ where: { productId: kpv.id } })) === 0) await prisma.stockAdjustment.create({ data: { id: randomUUID(), date: new Date(), productId: kpv.id, quantity: -10, reason: "correction", note: "QA: sold out state" } });

  const store = {
    ...DEFAULT_STORE,
    open: true,
    payments: { ...DEFAULT_STORE.payments, zelle: { enabled: true, details: "pay@buckshotlabs.test" }, cashapp: { enabled: true, details: "$buckshotlabs" }, card: { enabled: false, comingSoon: "show" as const } },
    shipFrom: { name: "Buckshot Labs", street1: "100 Congress Ave", street2: "", city: "Austin", state: "TX", zip: "78701", country: "US", phone: "5125550100", email: "ship@buckshotlabs.test" },
  };
  await prisma.settings.update({ where: { id: 1 }, data: { storeJson: JSON.stringify(store) } });

  const promos = [
    { id: "qa-code", kind: "code", code: "WELCOME10", discountType: "%", discountValue: 10 },
    { id: "qa-ship", kind: "free_shipping", name: "Free shipping", minSubtotalCents: 15000 },
  ];
  for (const p of promos) await prisma.promotion.upsert({ where: { id: p.id }, update: {}, create: p });
  console.log("QA data ready:", await prisma.listing.count({ where: { showOnWebsite: true } }), "products on the website.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
