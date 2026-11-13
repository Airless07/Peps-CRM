# Peps CRM

Private sales and inventory tracker for a two-person business that sells products in vials.
Mobile-first, installable as a PWA, works on phone and laptop.

**Stack:** Next.js 15 (App Router) · TypeScript · Tailwind · PostgreSQL via Prisma · Vitest

---

## How the money works

Nothing stores a running balance. Every number (business money, stock, pending split, what each
partner earned and was paid) is recomputed from the raw records, in date order, by one pure function:
`computeLedger()` in [`src/lib/money.ts`](src/lib/money.ts). If you edit or delete an old record,
everything after it is recalculated automatically.

- **Payback mode:** while business money is below $0, all revenue and tips go to the business.
  If one line crosses $0, only the part above $0 follows the normal rule (proportionally).
- **Normal mode:** business keeps the item cost plus the line's cut % of profit. The rest is split
  by the partner ratio. Zero or negative profit goes entirely to the business.
- **Tips:** "treat as profit" (cut applies, using the first line's cut), "goes to the seller", or "all to business".
- **Restocks** subtract their cost from business money unless marked *paid from starting investment*.
- **Discounts** are spread across lines in proportion to each line's subtotal (leftover cent on the largest line).
- **Rounding:** money is integer cents. Rounding cents always go to the business.
- **Splits:** confirming a split moves the pending amounts out of business money and auto-creates
  matching payout entries. Editing an order that was already split shows a warning and the
  difference (positive or negative) shows up as an adjustment in the next split.
- **Manual payouts** (not from a split) come out of business money. Use a negative amount for money
  given back to the business.

Run the tests: `npm test`

---

## Environment variables

| Variable         | Required | What it is |
| ---------------- | -------- | ---------- |
| `DATABASE_URL`   | yes      | PostgreSQL connection string. On Railway, reference the Postgres service's `DATABASE_URL`. |
| `APP_PASSWORD`   | yes      | Login password used until a new one is set in Settings. After that the hashed password stored in the database is used and `APP_PASSWORD` is ignored. |
| `SESSION_SECRET` | yes      | Long random string (32+ characters) used to sign the session cookie. Changing it logs everyone out. |
| `PORT`           | no       | Set automatically by Railway. Defaults to 3000. |

Generate a secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Sessions last 30 days (httpOnly, signed cookie). Every page and API route requires login.

---

## Deploy on Railway

1. Push this repo to GitHub.
2. In Railway: **New Project → Deploy from GitHub repo** → pick `peps-crm`.
3. In the same project: **+ New → Database → PostgreSQL**.
4. Open the app service → **Variables** and add:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (use the variable reference picker)
   - `APP_PASSWORD` = your login password
   - `SESSION_SECRET` = a long random string
5. Railway detects Node and runs:
   - build: `npm run build` (runs `prisma generate` then `next build`)
   - start: `npm start` (runs `prisma migrate deploy` then `next start` on `$PORT`)
6. **Settings → Networking → Generate Domain** to get your URL.
7. Open the URL on your phone, log in, then "Add to Home Screen" to install it like an app.

Migrations run on every start, so new versions update the database schema automatically.
The seed script never runs in production.

---

## Run locally (Windows)

1. Install [Node.js](https://nodejs.org) (LTS) and have a PostgreSQL database available
   (local install, Docker, or the Railway database's public URL).
2. Double-click **`launch.bat`**. The first time it creates `.env` from `.env.example` and stops;
   fill in `DATABASE_URL`, `APP_PASSWORD` and `SESSION_SECRET`, then run it again.
3. It installs dependencies (first run only), prepares the database, starts the app and opens
   http://localhost:3000.

Manual equivalent:

```bash
npm install
npx prisma migrate deploy
npm run dev
```

Optional sample data for local testing (3 products with stock): `npm run seed`.
It is never run automatically.

## Scripts

| Script           | Does |
| ---------------- | ---- |
| `npm run dev`    | Dev server on http://localhost:3000 |
| `npm run build`  | Prisma client + production build |
| `npm start`      | Apply migrations, start production server |
| `npm test`       | Money engine unit tests |
| `npm run lint`   | Type check |
| `npm run seed`   | Add 3 sample products (local only) |

## Backups

Settings → Data: download a full JSON backup or CSV per table, and import a JSON backup
(replaces all data, keeps your password). The danger zone resets everything (type `RESET`).
