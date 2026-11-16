# BUILD_PLAN: Buckshot Peps store + Peps CRM admin

Living checklist. `[x]` = done and verified, `[~]` = in progress, `[ ]` = not started.
A new session: read "Architecture decisions" first, then continue at the first unchecked item.

## Architecture decisions (do not re-litigate)

- **One product list.** The existing `Product` table IS the variant (stock, cost, price, sales history, ids unchanged).
  New `Listing` table is the parent product (name, slug, website fields). `Product.listingId` links them.
  Migration creates one Listing per existing Product (single-variant). UI says "Product" (Listing) and "Variant/size" (Product).
- **One order table.** `Order` gains `number`, `source` (`inperson` | `online`), `status`
  (`completed` for in-person; `awaiting_payment` | `paid` | `label_purchased` | `shipped` | `delivered` | `canceled` online), plus shipping/contact fields.
- **Money.** `computeLedger()` stays the single pure function. `AppData.orders` only holds orders that count
  (not awaiting payment, not canceled). `AppData.pendingOrders` holds the rest (never touch stock/money).
  New inputs: `order.shippingCents` (100% to business, added after lines + tip) and `AppData.labels`
  (each label cost is subtracted from business money on its date). Existing records have 0 / none, so numbers are identical.
- **Mark paid** sets `date = now`, snapshots unit cost + cut %, `soldBy = "W"` (Website), links/creates the customer by email.
- **Routes.** Store at `/`. Admin at `/admin/*` (login `/admin/login`). Old CRM URLs redirect (next.config). Admin APIs stay at `/api/*`
  (session required by default); public APIs live under `/api/store/*`; Shippo webhook `/api/webhooks/shippo`.
- **Settings.** Store settings + site content are JSON columns on `Settings` (`storeJson`, `contentJson`) with typed defaults in `src/lib/store/config.ts`.
- **Files.** `DATA_DIR` = folder of the SQLite file (`/data` on Railway). Uploads in `DATA_DIR/uploads/public` (served at `/media/*`)
  and `DATA_DIR/uploads/private` (payment screenshots, admin only). Backups in `DATA_DIR/backups`.
- **Background jobs** (auto-cancel, daily backup) run from `src/instrumentation.ts` on an interval.
- **Accounts.** Website customers are `Customer` rows with a password. Checkout requires an account (owner update item 7).
  Mark paid links the order to that customer. Admin session and customer session are separate cookies.
- **Not used on purpose:** VALO's Shippo key (belongs to another client). Shippo/Resend are tested with mocked HTTP.

## Owner update (mid-build, replaces earlier mid-build messages). Apply all of it.

- [x] **1. Design reference**: arcticdose.com home + /product/ghk-cu screenshots at 390 and 1440; study layout, spacing, type, product page,
      catalog COA badges, specs/COA presentation, promo bar with copyable code, cart drawer, checkout layout, nav, footer.
      Structure and polish ONLY. Never copy text, images, logo, labels, mockups, branding, code.
- [x] **2. Store nav**: Shop, Collections (= product groups), Testing, About, FAQ + search, account, cart icons.
      Testing page explains testing and lists every product's testing status with COA links.
- [x] **3. Testing status per variant** (`Product.testingStatus`): `coa_available` (purity + View COA), `supplier_tested`,
      `pending` ("Third-party testing pending"), `coming_soon` ("COA coming soon"). Badge on cards + product page. COA upload allowed under any status.
- [x] **4. Buy more, save more**: store default tiers 2 = 5%, 3+ = 10% (`store.qtyDeals`); per product override (`Listing.qtyDealsJson`, empty = use default).
      Shown on product page; savings in cart. Applied as lower unit price on the order line. Codes stack on top.
- [x] **5. Promo bar**: code with Copy button + "Apply now" link that adds the code to the cart.
- [x] **6. Cart drawer** slides out after Add to cart: items, qty, size, promo code, savings, subtotal, View cart, Checkout. Plus /cart page.
- [x] **7. Customer accounts (required to check out)**: sign up / sign in inside checkout without losing cart; password reset email;
      account page (order history with status + tracking, saved addresses); admin Customers shows "Has account". In-person customers unchanged.
      Columns: `Customer.passwordHash`, `addressesJson`, `resetTokenHash`, `resetExpiresAt`. Cookie `peps_account` (signed, separate from admin).
- [x] **8. Shipping tiers**: Standard / Priority / Express (USPS Ground Advantage / Priority Mail / Priority Mail Express via Shippo).
      Live rates or flat price per tier; rename / turn off tiers. Free shipping rules apply to Standard only unless set otherwise.
- [x] **9. Payment methods**: selectable cards with icons; per-method on/off (defaults Zelle ON, Cash App OFF, Venmo OFF, Pay by Bank OFF, Card OFF);
      Pay by Bank and Card are "coming soon" methods with a show-greyed / hide toggle; a method that is on but missing details is hidden at checkout
      and warned about in admin. Provider interface in `src/lib/store/payments.ts` so a real provider (webhook marks paid) can be added later.
- [x] **10. Two required acknowledgments at checkout**, text editable in Content: (a) research use only, not for human or veterinary use;
      (b) agreement to Terms, Privacy, Shipping and Returns (linked).
- [x] **11. Product images**: main mockup photo + extra photos; neutral original placeholder (never another store's label design).

## Design reference (earlier note, superseded by item 1 above)

- Reference: https://www.arcticdose.com (home) and https://www.arcticdose.com/product/ghk-cu (product page).
- Screenshot both at 390px and 1440px with Playwright and study: layout, spacing, typography, product page structure,
  how compound specs and COAs are presented, promo bar with copyable discount code, product cards, nav, footer.
- Inspiration for STRUCTURE and POLISH only, in the red/white Buckshot Peps style. Never copy their text, images, logo, branding, or code.
- Apply during the storefront build and again during visual QA.
- [x] Reference screenshots taken and studied
- [x] Promo bar shows a copyable discount code
- [x] Quantity discounts ("buy more, save more"): per product tiers (buy N+ → % off), editable in the product's Website tab,
      shown on the product page and in the cart. Stored in `Listing.qtyDealsJson`. Applied as a lower unit price on the order line,
      so the existing discount + money logic is untouched and codes stack on top. Tested.

## Checklist

### Start
- [x] BUILD_PLAN.md written
- [x] Read VALO project (Shippo rates/labels/tracking, Resend, orders table + Actions menu). Not modified.
- [x] Design skills (impeccable) loaded for storefront; Stitch optional

### Data and money
- [x] Prisma schema + additive migration `20261115120000_store` (verified: `prisma migrate diff` vs schema is empty)
- [x] Types, serialize, money engine (shipping income, label cost, pending orders). Existing 45 tests pass.
- [x] Backup v3: export/import all new data (v1/v2 still import; tested round trip)
- [x] Migration proof script `npm run prove-migration` (PASSED on exact copy and on copy + sample sales/split/payouts). Re-run before commit.

### Structure
- [x] Admin moved to `/admin` (pages in `src/app/admin/(panel)`), old URLs redirect (next.config), noindex headers
- [x] Middleware: public store, protected admin + APIs, CSRF origin check
- [x] Secure headers, login lockout, rate limits
- [x] Admin shell: new sidebar, badges, global search, mobile nav, PWA scoped to /admin (`src/components/shell.tsx`)
- [x] Store open/closed switch (default closed) + Coming soon + admin preview

### Server features
- [x] Store config + content defaults (policies drafts, FAQ, hero)
- [x] Uploads (sharp resize/crop/compress, type + size validation), public `/media`, private screenshots
- [x] Email (Resend): templates html + text, customer + admin alerts, logged per order
- [x] Shippo: rates, address validation, buy label, tracking poll, webhook
- [x] Pricing: discount codes, automatic deals, free shipping rules (pure, tested)
- [x] Public catalog (no cost fields, tested), best sellers auto/manual
- [x] Order ops: place, mark paid, cancel, auto-cancel, ship, deliver, archive, order numbers
- [x] Backups: daily to DATA_DIR/backups, keep 14, list/download/back up now

### Admin pages
- [x] Dashboard (to-do list, today/month, recent orders, low stock)
- [x] Orders (combined list, filters, main button + Actions menu, Archived tab)
- [x] Order detail (items, totals, screenshot, timeline, emails) + packing slip
- [x] Ship queue
- [x] Sell / In-person orders / Customers / Money / Pay (moved, working as before)
- [x] Inventory: products with variants, tabs "Stock and pricing" + "Website", combine / split out, COAs, photos
- [x] Promotions (codes, automatic deals, free shipping rules, announcement bar)
- [x] Reviews (approve, hide, edit)
- [x] Content (hero, sections, FAQ, about, contact, footer, policies, SEO, messages)
- [x] Settings (store, payments, shipping, emails, test buttons, launch checklist, backups, password)
- [x] Help page
- [x] Money page: online vs in-person, shipping collected vs label costs

### Storefront
- [x] Design system (deep red / white, Geist, motion, reduced-motion)
- [x] Age gate (30 days) + exit page
- [x] Layout: announcement bar, header, footer, cart drawer
- [x] Home, Shop, Product page
- [x] Checkout, confirmation / order status (secret link), order lookup
- [x] Review form (secret link)
- [x] Contact, policy pages, About, FAQ, 404
- [x] SEO: metadata, OG/Twitter, sitemap.xml, robots.txt, JSON-LD, icons

### Quality
- [x] Tests: combine/split, public API no cost, discount codes, auto deal counter, free shipping, shipping money, mark paid, auto-cancel, order numbering, existing money tests
- [x] `npm test` + `npm run build` real output shown
- [x] README (env vars, Railway steps)
- [x] Visual QA with Playwright at 390 and 1440, fixes, full test order + in-person sale
- [x] Commit + push to origin main

## RESUME HERE (nothing committed or pushed yet)
- DONE and type-clean: data layer, migration, money engine, all server libs, ALL API routes (admin + public + webhook + /media),
  ALL admin pages (dashboard, orders, order detail, ship queue, packing slip /admin/print/[id], sell, in-person, inventory with
  variants/Website tab/COAs/combine/split/groups, customers, money, pay, promotions, reviews, content, settings tabs, help).
- Tests: `npm test` = 92 passing (money, features, store pure tests, DB-backed tests in `src/lib/store/db.test.ts`).
- NOT DONE: storefront `src/app/(store)` (own root layout; there is no top-level `app/layout.tsx`; 404 via `(store)/[...catchall]`),
  sitemap/robots/OG, README + .env.example, production build, Playwright visual QA, test order click-through, commit + push.
- Store data for pages: `storeSnapshot()` / `storeAccess()` in `src/lib/store/server.ts`; accounts in `src/lib/account.ts`.

## STATUS: BUILD COMPLETE. Storefront written, built, visually reviewed at 390 + 1440, full test order + in-person sale clicked through.
(The notes below this line are the history of how it got here.)

## STOREFRONT PROGRESS (historical)
- Written: `PRODUCT.md`, `src/app/(store)/store.css`, `(store)/layout.tsx` (root layout, promo bar, header, footer, age gate, preview bar),
  `(store)/(shop)/layout.tsx` (Coming soon gate), home `(shop)/page.tsx`, `/shop`, `/collections`, `/collections/[slug]`,
  components in `src/components/storefront/`: `cart.tsx` (provider, drawer, lines, promo field, totals), `chrome.tsx`, `product-card.tsx`
  (card, grid, TestingBadge, StockTag, RichText, FaqList), `shop-browser.tsx`, `vial.tsx` (neutral placeholder). Tailwind store tokens added.
- Reference screenshots of arcticdose.com taken and studied (item 1 done for the build; redo comparison in visual QA).
- STILL TO WRITE: `/product/[slug]` (gallery, size chips, tier tiles, qty, add to cart, specs, COA, batch history, reviews, JSON-LD),
  `/testing`, `/about`, `/faq`, `/cart`, `/checkout` (account sign up/in inline, address, shipping tiers, payment cards, 2 acknowledgments),
  `/account`, `/account/reset`, `/contact`; ungated group: `/order/[token]`, `/order-lookup`, `/review/[token]`, `/exit`,
  policies + 404 via `(store)/[...slug]` and `(store)/not-found.tsx`; `sitemap.ts`, `robots.ts`, `/og` image route.
- Then: `npx tsc --noEmit`, `npm test`, `npm run build`, README + .env.example, Playwright visual QA (390 + 1440), full test order + in-person sale, commit, push.
- Owner note: Impeccable skill reports a newer version (v4.9.1, `npx impeccable update`); ask once.

## Notes / log
- Server libs DONE (not yet wired to routes): `src/lib/store/{config,pricing,catalog,payments,schemas,slug}.ts`, `src/lib/{uploads,data-dir,ratelimit,email,shippo,order-ops,account,catalog-ops,backups,jobs}.ts`, `src/instrumentation.ts`.
- NEXT: API routes (admin: orders actions, listings, groups, coas, uploads, promotions, reviews, messages, settings tests, backups; public: /api/store/*, webhook), then admin pages, then storefront.
- Patch helper used during build: scripts are written to the session scratchpad; bash heredocs with backticks break, so write script files with the Write tool.
- Local DB (`data/peps.db`): 12 products, 12 purchases, 0 orders, only the first migration applied. Snapshot copied to the session scratchpad before any change.
