# REVIEW_PLAN: full review pass (store + admin), rebrand to Buckshot Labs

`[x]` = done AND verified with evidence. Evidence is listed under each item.
"The old name" below means the previous brand (the two words that used to follow "Buckshot" and precede "CRM").

How to re-run every check:

| Command | What it proves |
|---|---|
| `npm test` | 278 unit + database tests (was 92) |
| `npm run build` | Production build |
| `npm run e2e` | 30 Playwright tests on the production build: full order flow, security over real HTTP, 120 page screenshots + layout audit |
| `npm run prove-migration` | Money numbers identical before and after all migrations |
| `npm run rebrand-report -- some-backup.db` | Before/after of every stored value the migration changes |

## Ground rules (kept)
- Every database change is additive: migration `20261116120000_labs_review` adds 2 columns with defaults, 1 new table, and runs text `UPDATE`s on
  `Settings` and `Listing`. No `DROP`, no `DELETE`, no table rebuild (asserted by a test).
- `computeLedger()` was not changed. `npm run prove-migration`: "PASSED: counts and every money number are identical before and after"
  (run on the exact local copy and on a copy with sample sales, a split and payouts).
- The local database holds EMPTY stored Settings/Content, so it is not the live data. The migration was therefore written for stored text I
  cannot see, and proven on a copy seeded with the old defaults plus hand-edited text.
- Kept on purpose (technical names, not brand text; renaming would break live data or sign everyone out): database file `peps.db`, backup file
  names, cookie names, browser storage keys, the default local dev password, the GitHub repo and folder name.

## 1. Rebrand to "Buckshot Labs"
- [x] 1.1 Code: wordmark, titles, meta, Open Graph, JSON-LD, emails, admin sidebar, footer, policies, README, PWA manifest, default Content.
      The wordmark, page titles, OG image, JSON-LD brand, footer and every email read the store name from Settings (default now "Buckshot Labs").
      Admin sidebar group "Sales" replaces the old CRM label. Icons use empty alt text (decorative), so there was no alt text to rename.
      Evidence: tests "rebrand to Buckshot Labs" (4) in `src/lib/store/review.test.ts`; E2E step 1 checks the live page title and body.
- [x] 1.2 Migration updates STORED values: store name, email from-name, every Content field, policy pages, and product summary/description/SEO text.
      Evidence: `npm run rebrand-report` on a live-like copy printed 22 changed values, before and after (included in the final summary);
      DB tests "migration ... on stored values" (7) in `src/lib/store/review.db.test.ts`.
- [x] 1.3 Proof of zero remaining references.
      Repo search for the old name, the old CRM name and the old domain: one hit, the comment on line 1 of the ALREADY APPLIED migration
      `20261115120000_store` (left alone: editing an applied migration changes its checksum).
      Database: 0 rows in every text column of every table, on the migrated local copy and on the E2E database after a full order flow (216 columns searched).

## 2. Remove false testing claims
- [x] 2.1 Code defaults reworded: hero headline + subtext, section title "Testing, shown honestly", section text, the 3 cards ("Status on every
      product", "COAs by batch", "Lot traceability"), footer tagline, About, SEO title + description, FAQ, Testing page description,
      Coming soon page, link preview image. Email templates: checked, they never made a testing claim (now guarded by a test).
      Evidence: test "default content makes none of the old claims"; test "every email ... never the old one" (also checks claims).
- [x] 2.2 Dynamic claims: `testingClaim()` / `productTestingSummary()` in `src/lib/store/copy.ts`. "Third-party tested" appears only for sizes
      with status "COA available" (product page, product meta description, home page count "N of M sizes").
      Evidence: tests "third-party tested is only ever said for COA available", "the product summary ... follows the real statuses".
- [x] 2.3 Migration updates stored Content: exact old default sentences are replaced, and hand-edited text that still makes an old claim
      ("every lot", "independent lab", "third-party tested", ...) is replaced with the accurate default. Other hand-edited text is kept.
      Evidence: DB tests "replaces every old testing claim", "hand-edited text that still makes an old claim is replaced; other ... is kept",
      "the migrated content equals the new defaults", "leaves empty settings and a second run unchanged".

## 3. Product data cleanup
- [x] 3.1 Warning in the product editor when the name contains a size, with a one-tap "Move to the size label"; "Size in name" badge in Inventory.
      Evidence: tests "finds a size inside a product name", "leaves compound names with numbers alone" (BPC-157, MT-2, 5 Amino stay clean);
      E2E screenshot `admin-30-product-editor-size-warning`.
- [x] 3.2 Website tab: compound info section and each empty field marked "Recommended"; "Website info 3/6" per product in Inventory and in the editor.
      Evidence: test "website info completeness"; E2E asserts both; screenshot `admin-31-product-editor-website-tab`.
- [x] 3.3 Product page: no compound info section when nothing is filled in; a clean bordered spec table (filled fields only) when there is.
      Evidence: E2E asserts heading count 0 on a product with no info and a table with no empty cells on one with info;
      screenshots `store-06-...` and `store-07-...`.
- [x] 3.4 Launch checklist item "Products with no website info". Evidence: E2E asserts it; screenshot `admin-19-settings-launch`.

## 4. Storefront fixes
- [x] 4.1 Best sellers: exactly 4 (best sellers, then featured, then newest), hidden with fewer than 4 products on the website.
      Evidence: 4 tests "best sellers row"; E2E step 1 counts 4 cards.
- [x] 4.2 FAQ "How do I pay?" is generated from enabled methods (`{payment_methods}` placeholder; a hand-written answer naming a method that
      is off is replaced). Evidence: 4 tests; E2E "FAQ names only the payment methods that are on" (Zelle yes, Cash App no).
- [x] 4.3 Cart drawer + cart page: Items at regular price, Buy more save more, discount code, one bold Subtotal.
      Evidence: E2E steps 2 and 3 assert the exact rows and that "Subtotal" appears once; screenshots `flow/03-cart-drawer`, `flow/03-cart-page`.
- [x] 4.4 robots.txt switches with the open/closed setting on every request. Both outputs saved to `e2e/screenshots/evidence/robots.txt`.
      Evidence: 2 unit tests; E2E closes the store, reads robots.txt + sitemap, reopens, reads again.

## 5. Admin fixes
- [x] 5.1 Global search: `autocomplete="off"`, neutral `name`/`id` ("admin-find"), password-manager ignore hints; the admin password form now has
      a hidden username field so the browser pairs the passwords with it. Password fields: current-password / new-password everywhere.
      Evidence: E2E asserts the attributes on the search box, the 3 admin password fields and the store sign-in / sign-up field.
      Not machine-checkable: Chrome's autofill heuristic itself. Please confirm on your own Chrome profile.
- [x] 5.2 Admin 404 inside the admin shell with "Back to the Dashboard". Evidence: E2E (status 404, admin nav present, store 404 text absent,
      link works; store addresses keep the store 404); screenshot `flow/admin-404`.
- [x] 5.3 Sell screen: sizes grouped under their product, store order, photo (or colored tile) on each card.
      Evidence: test "Sell screen groups"; E2E step 12 (Reta 10mg + 20mg together, order equals store order, labels not cut off).
- [x] 5.4 Inventory filter All / On website / Not on website + completeness indicator. Evidence: E2E; screenshot `admin-29-...`.
- [x] 5.5 Dashboard To-do: missing alert emails, missing from-address, missing ship-from, products missing website info.
      Evidence: E2E "dashboard to-do lists the setup gaps"; screenshot `flow/dashboard-todo-setup-gaps`.

## 6. Useful additions
- [x] 6.1 Unpaid order reminder at half time (Settings, Email; default on; once per order).
      Evidence: 6 DB tests "unpaid order reminder" (not before halfway, not while off, sent once with amount + instructions + time left,
      never twice, not for paid/canceled/expired) + 2 email tests.
- [x] 6.2 Low stock alert to the alert list when a size crosses its warning level (sale, mark paid, stock adjustment; toggle in Settings).
      Evidence: 3 pure + 5 DB tests "low stock alert".
- [x] 6.3 Internal notes on orders. Evidence: 4 DB tests (not on the order page, account page or in any email; no money change; survives
      backup/restore); E2E step 8 and step 11.
- [x] 6.4 Built-in analytics, admin page "Analytics" with 7/30 day toggle. Table `AnalyticsDay` holds only day, metric, key, count.
      Evidence: 3 pure + 3 DB tests; E2E step 13 (1 visit, 2 add to carts, 1 checkout, 1 order, 100%; admin not counted) and
      "analytics endpoint" (crawler ignored, a browser cannot count an order, cross-site refused).

## 7. Testing
- [x] 7.1 `npm test`: 7 files, 278 tests passing (92 before). New: `review.test.ts` (33), `review.db.test.ts` (30), `middleware.test.ts` (123).
- [x] 7.2 Playwright E2E `e2e/flow.spec.ts`, 13 steps, store OPEN, Zelle set, Shippo + Resend faked in the server process:
      sign up at checkout, 2 sizes, buy-more + WELCOME10, Priority shipping, payment page, screenshot upload, admin Mark paid, buy label,
      shipped, delivered, review email with working link, in-person sale from Sell. Stock, money and the Orders list are checked after each step.
- [x] 7.3 `e2e/pages.spec.ts`: 120 screenshots (30 store + 30 admin views, at 390 and 1440) in `e2e/screenshots/{390,1440}/`.
      Audit result: "120 page screenshots audited. 0 with findings." First run found tap targets under 44px on most pages; fixed with
      44px minimum sizes on phones for buttons, inputs, selects, tabs, checkbox labels, and a 44px touch area for stand-alone links and small pills.
      Also fixed: the size label cut off on the new Sell cards.
- [x] 7.4 Security: `src/middleware.test.ts` (every admin page and admin API route, each method: 401 / redirect; CSRF) and
      `e2e/security.spec.ts` over real HTTP (52 route+method pairs answer 401, 19 admin pages redirect, public APIs carry no cost/profit keys,
      wrong/near-miss/numbered tokens find nothing, order lookup is rate limited, lockout after 5 wrong passwords even with the right one).
      Evidence files in `e2e/screenshots/evidence/`.
- [x] 7.5 Lighthouse (mobile, production build): home 100/100/100/100, shop 96/99/100/100, product 94/100/100/100
      (performance / accessibility / best practices / SEO). Nothing under 90. The one accessibility note (heading order on the shop) was fixed.
- [x] 7.6 `npm run build`: "Compiled successfully".
- [x] 7.7 `npm run prove-migration`: PASSED.

## 8. Wrap up
- [x] 8.1 Fresh self-review pass. Found and fixed during it: an E2E assertion that could not fail (compound info section), test data that did
      not include a product with no info, missing E2E coverage for three dashboard to-do items.
- [x] 8.2 Summary for the owner.
- [x] 8.3 git add, commit, push to origin main.

## Things only the owner can do
- After the deploy, open the live site and check the hero, the testing section and the footer. Download a backup from before the deploy
  (Settings, Backups) and run `npm run rebrand-report -- that-file.db` to see exactly what changed in the live text.
- Rename products that still have a size in the name (Inventory shows "Size in name"; the editor has a one-tap fix).
- Fill in compound info on the Website tab of each product.
- Settings, Email: confirm the alert email list and the from-address. Decide if you want the reminder and the low stock alert on (both default on).
- Read the reworded hero headline ("Research peptides for the lab.") and change it in Content if you want different words.
- The privacy policy says no advertising trackers are used, which is still true. Consider adding one line about anonymous page counts.
- Confirm in your own Chrome that the admin search box is no longer autofilled.
- Six image files in `public/hero/` were untracked before this pass and were left untracked.
