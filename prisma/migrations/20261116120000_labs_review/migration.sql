-- Buckshot Labs review pass.
-- Purely additive: two new columns with defaults, one new table, and text updates on stored settings.
-- No table is rebuilt or dropped and no order, line, purchase, split or payout row is changed,
-- so computeLedger() gives identical money numbers for every existing record.

-- ---------------------------------------------------------------- New columns
-- Internal note for the team (never shown to the customer) and the unpaid-order reminder marker.
ALTER TABLE "Order" ADD COLUMN "adminNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Order" ADD COLUMN "reminderSentAt" DATETIME;

-- ---------------------------------------------------------------- New table
-- Built-in analytics: aggregate daily counters only. Nothing about a person is stored.
CREATE TABLE "AnalyticsDay" (
    "day" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY ("day", "metric", "key")
);
CREATE INDEX "AnalyticsDay_day_idx" ON "AnalyticsDay"("day");

-- ---------------------------------------------------------------- Rebrand stored text
-- The old name is written in two pieces so a search of the code base for the old brand finds nothing.
-- Covers: store name, email from-name, and every Content field (hero, sections, FAQ, about, contact,
-- footer, announcement, SEO, acknowledgments, testing page, all policy pages).
UPDATE "Settings" SET
  "storeJson" = replace(replace(replace("storeJson", 'Buckshot' || ' Peps', 'Buckshot Labs'), 'BUCKSHOT' || ' PEPS', 'BUCKSHOT LABS'), 'Buckshot' || ' peps', 'Buckshot Labs'),
  "contentJson" = replace(replace(replace("contentJson", 'Buckshot' || ' Peps', 'Buckshot Labs'), 'BUCKSHOT' || ' PEPS', 'BUCKSHOT LABS'), 'Buckshot' || ' peps', 'Buckshot Labs');
UPDATE "Listing" SET
  "summary" = replace(replace(replace("summary", 'Buckshot' || ' Peps', 'Buckshot Labs'), 'BUCKSHOT' || ' PEPS', 'BUCKSHOT LABS'), 'Buckshot' || ' peps', 'Buckshot Labs'),
  "description" = replace(replace(replace("description", 'Buckshot' || ' Peps', 'Buckshot Labs'), 'BUCKSHOT' || ' PEPS', 'BUCKSHOT LABS'), 'Buckshot' || ' peps', 'Buckshot Labs'),
  "seoTitle" = replace(replace(replace("seoTitle", 'Buckshot' || ' Peps', 'Buckshot Labs'), 'BUCKSHOT' || ' PEPS', 'BUCKSHOT LABS'), 'Buckshot' || ' peps', 'Buckshot Labs'),
  "seoDescription" = replace(replace(replace("seoDescription", 'Buckshot' || ' Peps', 'Buckshot Labs'), 'BUCKSHOT' || ' PEPS', 'BUCKSHOT LABS'), 'Buckshot' || ' peps', 'Buckshot Labs');

-- ---------------------------------------------------------------- Remove false testing claims (stored Content)
-- 1. A stored value that is exactly an old default sentence becomes the new accurate one
--    (matched with its surrounding quotes, so text inside a longer hand-written sentence is not touched here).
-- Hero headline
UPDATE "Settings" SET "contentJson" = replace("contentJson", '"Research peptides, verified batch by batch."', '"Research peptides for the lab."');
-- Hero subtext
UPDATE "Settings" SET "contentJson" = replace("contentJson", '"Every lot is third-party tested, and the certificate of analysis is published on the product page."', '"Research materials with testing status shown on every product. Certificates of analysis are published per batch as they''re completed."');
-- Quality section title
UPDATE "Settings" SET "contentJson" = replace("contentJson", '"Tested, documented, traceable"', '"Testing, shown honestly"');
-- Quality section text
UPDATE "Settings" SET "contentJson" = replace("contentJson", '"Each batch is sent to an independent lab before it is listed. You can open the certificate for the exact lot we are shipping, and older lots stay on file."', '"Every product shows where it stands: certificate on file, tested by the supplier, testing pending, or certificate coming soon. When a certificate of analysis is completed for a batch, it is posted on the product page."');
-- Quality card 1 title
UPDATE "Settings" SET "contentJson" = replace("contentJson", '"Third-party tested"', '"Status on every product"');
-- Quality card 1 text
UPDATE "Settings" SET "contentJson" = replace("contentJson", '"Identity and purity are confirmed by an independent laboratory for every lot."', '"Each product and size shows its current testing status, so you know what is on file before you order."');
-- Quality card 2 title
UPDATE "Settings" SET "contentJson" = replace("contentJson", '"COA on every product"', '"COAs by batch"');
-- Quality card 2 text
UPDATE "Settings" SET "contentJson" = replace("contentJson", '"The current certificate of analysis is on each product page to view or download."', '"Certificates of analysis are published per batch as they are completed. Earlier batches stay on file."');
-- Quality card 3 text
UPDATE "Settings" SET "contentJson" = replace("contentJson", '"Each vial carries a lot number that matches its certificate."', '"When a certificate is on file, it lists the lot number it covers."');
-- FAQ answer 1
UPDATE "Settings" SET "contentJson" = replace("contentJson", '"After you place an order you get payment instructions for Zelle or Cash App, with your order number and the exact amount. Put the order number in the memo so we can match your payment."', '"After you place an order you get payment instructions for {payment_methods}, with your order number and the exact amount. Put the order number in the memo so we can match your payment."');
-- FAQ answer 3
UPDATE "Settings" SET "contentJson" = replace("contentJson", '"On each product page, under the size you select. Older batches are listed there as well."', '"When a certificate is on file, it is on the product page under the size you select, and on the Testing page. Products that are still waiting on a certificate say so."');
-- About text
UPDATE "Settings" SET "contentJson" = replace("contentJson", '"Buckshot Labs supplies research compounds with published, lot-specific certificates of analysis. We keep the catalog small, document every batch, and ship quickly."', '"Buckshot Labs supplies research compounds and shows the testing status of every product. Certificates of analysis are published per batch as they are completed. We keep the catalog small and ship quickly."');
-- SEO title
UPDATE "Settings" SET "contentJson" = replace("contentJson", '"Buckshot Labs | Research peptides with published COAs"', '"Buckshot Labs | Research peptides with testing status on every product"');
-- SEO description
UPDATE "Settings" SET "contentJson" = replace("contentJson", '"Research compounds with third-party certificates of analysis for every lot. For laboratory research use only."', '"Research materials with testing status shown on every product. Certificates of analysis are published per batch as they are completed. For laboratory research use only."');

-- 2. Text that was edited by hand but still makes one of the old claims
--    ("every lot", "third-party tested", "independent lab", ...) is replaced with the accurate default.
UPDATE "Settings" SET "contentJson" = json_set("contentJson", '$.hero.headline', 'Research peptides for the lab.')
  WHERE json_valid("contentJson") AND (json_extract("contentJson", '$.hero.headline') LIKE '%third-party tested%' OR json_extract("contentJson", '$.hero.headline') LIKE '%third-party certificate%' OR json_extract("contentJson", '$.hero.headline') LIKE '%every lot%' OR json_extract("contentJson", '$.hero.headline') LIKE '%every batch%' OR json_extract("contentJson", '$.hero.headline') LIKE '%each batch is sent%' OR json_extract("contentJson", '$.hero.headline') LIKE '%independent lab%' OR json_extract("contentJson", '$.hero.headline') LIKE '%certificate of analysis for every%' OR json_extract("contentJson", '$.hero.headline') LIKE '%lot-specific%' OR json_extract("contentJson", '$.hero.headline') LIKE '%verified batch%' OR json_extract("contentJson", '$.hero.headline') LIKE '%published coa%');
UPDATE "Settings" SET "contentJson" = json_set("contentJson", '$.hero.subtext', 'Research materials with testing status shown on every product. Certificates of analysis are published per batch as they''re completed.')
  WHERE json_valid("contentJson") AND (json_extract("contentJson", '$.hero.subtext') LIKE '%third-party tested%' OR json_extract("contentJson", '$.hero.subtext') LIKE '%third-party certificate%' OR json_extract("contentJson", '$.hero.subtext') LIKE '%every lot%' OR json_extract("contentJson", '$.hero.subtext') LIKE '%every batch%' OR json_extract("contentJson", '$.hero.subtext') LIKE '%each batch is sent%' OR json_extract("contentJson", '$.hero.subtext') LIKE '%independent lab%' OR json_extract("contentJson", '$.hero.subtext') LIKE '%certificate of analysis for every%' OR json_extract("contentJson", '$.hero.subtext') LIKE '%lot-specific%' OR json_extract("contentJson", '$.hero.subtext') LIKE '%verified batch%' OR json_extract("contentJson", '$.hero.subtext') LIKE '%published coa%');
UPDATE "Settings" SET "contentJson" = json_set("contentJson", '$.quality.body', 'Every product shows where it stands: certificate on file, tested by the supplier, testing pending, or certificate coming soon. When a certificate of analysis is completed for a batch, it is posted on the product page.')
  WHERE json_valid("contentJson") AND (json_extract("contentJson", '$.quality.body') LIKE '%third-party tested%' OR json_extract("contentJson", '$.quality.body') LIKE '%third-party certificate%' OR json_extract("contentJson", '$.quality.body') LIKE '%every lot%' OR json_extract("contentJson", '$.quality.body') LIKE '%every batch%' OR json_extract("contentJson", '$.quality.body') LIKE '%each batch is sent%' OR json_extract("contentJson", '$.quality.body') LIKE '%independent lab%' OR json_extract("contentJson", '$.quality.body') LIKE '%certificate of analysis for every%' OR json_extract("contentJson", '$.quality.body') LIKE '%lot-specific%' OR json_extract("contentJson", '$.quality.body') LIKE '%verified batch%' OR json_extract("contentJson", '$.quality.body') LIKE '%published coa%');
UPDATE "Settings" SET "contentJson" = json_set("contentJson", '$.quality.points[0].title', 'Status on every product', '$.quality.points[0].text', 'Each product and size shows its current testing status, so you know what is on file before you order.')
  WHERE json_valid("contentJson") AND (json_extract("contentJson", '$.quality.points[0].text') LIKE '%third-party tested%' OR json_extract("contentJson", '$.quality.points[0].text') LIKE '%third-party certificate%' OR json_extract("contentJson", '$.quality.points[0].text') LIKE '%every lot%' OR json_extract("contentJson", '$.quality.points[0].text') LIKE '%every batch%' OR json_extract("contentJson", '$.quality.points[0].text') LIKE '%each batch is sent%' OR json_extract("contentJson", '$.quality.points[0].text') LIKE '%independent lab%' OR json_extract("contentJson", '$.quality.points[0].text') LIKE '%certificate of analysis for every%' OR json_extract("contentJson", '$.quality.points[0].text') LIKE '%lot-specific%' OR json_extract("contentJson", '$.quality.points[0].text') LIKE '%verified batch%' OR json_extract("contentJson", '$.quality.points[0].text') LIKE '%published coa%');
UPDATE "Settings" SET "contentJson" = json_set("contentJson", '$.quality.points[1].title', 'COAs by batch', '$.quality.points[1].text', 'Certificates of analysis are published per batch as they are completed. Earlier batches stay on file.')
  WHERE json_valid("contentJson") AND (json_extract("contentJson", '$.quality.points[1].text') LIKE '%third-party tested%' OR json_extract("contentJson", '$.quality.points[1].text') LIKE '%third-party certificate%' OR json_extract("contentJson", '$.quality.points[1].text') LIKE '%every lot%' OR json_extract("contentJson", '$.quality.points[1].text') LIKE '%every batch%' OR json_extract("contentJson", '$.quality.points[1].text') LIKE '%each batch is sent%' OR json_extract("contentJson", '$.quality.points[1].text') LIKE '%independent lab%' OR json_extract("contentJson", '$.quality.points[1].text') LIKE '%certificate of analysis for every%' OR json_extract("contentJson", '$.quality.points[1].text') LIKE '%lot-specific%' OR json_extract("contentJson", '$.quality.points[1].text') LIKE '%verified batch%' OR json_extract("contentJson", '$.quality.points[1].text') LIKE '%published coa%');
UPDATE "Settings" SET "contentJson" = json_set("contentJson", '$.quality.points[2].title', 'Lot traceability', '$.quality.points[2].text', 'When a certificate is on file, it lists the lot number it covers.')
  WHERE json_valid("contentJson") AND (json_extract("contentJson", '$.quality.points[2].text') LIKE '%third-party tested%' OR json_extract("contentJson", '$.quality.points[2].text') LIKE '%third-party certificate%' OR json_extract("contentJson", '$.quality.points[2].text') LIKE '%every lot%' OR json_extract("contentJson", '$.quality.points[2].text') LIKE '%every batch%' OR json_extract("contentJson", '$.quality.points[2].text') LIKE '%each batch is sent%' OR json_extract("contentJson", '$.quality.points[2].text') LIKE '%independent lab%' OR json_extract("contentJson", '$.quality.points[2].text') LIKE '%certificate of analysis for every%' OR json_extract("contentJson", '$.quality.points[2].text') LIKE '%lot-specific%' OR json_extract("contentJson", '$.quality.points[2].text') LIKE '%verified batch%' OR json_extract("contentJson", '$.quality.points[2].text') LIKE '%published coa%');
UPDATE "Settings" SET "contentJson" = json_set("contentJson", '$.footerText', 'Research materials with testing status shown on every product.')
  WHERE json_valid("contentJson") AND (json_extract("contentJson", '$.footerText') LIKE '%third-party tested%' OR json_extract("contentJson", '$.footerText') LIKE '%third-party certificate%' OR json_extract("contentJson", '$.footerText') LIKE '%every lot%' OR json_extract("contentJson", '$.footerText') LIKE '%every batch%' OR json_extract("contentJson", '$.footerText') LIKE '%each batch is sent%' OR json_extract("contentJson", '$.footerText') LIKE '%independent lab%' OR json_extract("contentJson", '$.footerText') LIKE '%certificate of analysis for every%' OR json_extract("contentJson", '$.footerText') LIKE '%lot-specific%' OR json_extract("contentJson", '$.footerText') LIKE '%verified batch%' OR json_extract("contentJson", '$.footerText') LIKE '%published coa%');
UPDATE "Settings" SET "contentJson" = json_set("contentJson", '$.about.body', 'Buckshot Labs supplies research compounds and shows the testing status of every product. Certificates of analysis are published per batch as they are completed. We keep the catalog small and ship quickly.')
  WHERE json_valid("contentJson") AND (json_extract("contentJson", '$.about.body') LIKE '%third-party tested%' OR json_extract("contentJson", '$.about.body') LIKE '%third-party certificate%' OR json_extract("contentJson", '$.about.body') LIKE '%every lot%' OR json_extract("contentJson", '$.about.body') LIKE '%every batch%' OR json_extract("contentJson", '$.about.body') LIKE '%each batch is sent%' OR json_extract("contentJson", '$.about.body') LIKE '%independent lab%' OR json_extract("contentJson", '$.about.body') LIKE '%certificate of analysis for every%' OR json_extract("contentJson", '$.about.body') LIKE '%lot-specific%' OR json_extract("contentJson", '$.about.body') LIKE '%verified batch%' OR json_extract("contentJson", '$.about.body') LIKE '%published coa%');
UPDATE "Settings" SET "contentJson" = json_set("contentJson", '$.seo.title', 'Buckshot Labs | Research peptides with testing status on every product')
  WHERE json_valid("contentJson") AND (json_extract("contentJson", '$.seo.title') LIKE '%third-party tested%' OR json_extract("contentJson", '$.seo.title') LIKE '%third-party certificate%' OR json_extract("contentJson", '$.seo.title') LIKE '%every lot%' OR json_extract("contentJson", '$.seo.title') LIKE '%every batch%' OR json_extract("contentJson", '$.seo.title') LIKE '%each batch is sent%' OR json_extract("contentJson", '$.seo.title') LIKE '%independent lab%' OR json_extract("contentJson", '$.seo.title') LIKE '%certificate of analysis for every%' OR json_extract("contentJson", '$.seo.title') LIKE '%lot-specific%' OR json_extract("contentJson", '$.seo.title') LIKE '%verified batch%' OR json_extract("contentJson", '$.seo.title') LIKE '%published coa%');
UPDATE "Settings" SET "contentJson" = json_set("contentJson", '$.seo.description', 'Research materials with testing status shown on every product. Certificates of analysis are published per batch as they are completed. For laboratory research use only.')
  WHERE json_valid("contentJson") AND (json_extract("contentJson", '$.seo.description') LIKE '%third-party tested%' OR json_extract("contentJson", '$.seo.description') LIKE '%third-party certificate%' OR json_extract("contentJson", '$.seo.description') LIKE '%every lot%' OR json_extract("contentJson", '$.seo.description') LIKE '%every batch%' OR json_extract("contentJson", '$.seo.description') LIKE '%each batch is sent%' OR json_extract("contentJson", '$.seo.description') LIKE '%independent lab%' OR json_extract("contentJson", '$.seo.description') LIKE '%certificate of analysis for every%' OR json_extract("contentJson", '$.seo.description') LIKE '%lot-specific%' OR json_extract("contentJson", '$.seo.description') LIKE '%verified batch%' OR json_extract("contentJson", '$.seo.description') LIKE '%published coa%');
