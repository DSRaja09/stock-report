# Stock Report

Shows a small product business how much stock it has, how fast it sells, when to reorder, and where every supplier order is.

**Stack:** Vite + React 18 + TypeScript + Tailwind CSS. Storage is a zero-config local "database": one JSON document in `localStorage`, filled with fake sample data on first load. No backend, no outside services and no secrets. It builds to a static site, so it runs anywhere.

## Run locally

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # business-rule tests (vitest)
npm run build      # static output in dist/
```

## Deploy

- **Vercel:** import the repo. It auto-detects Vite (build `npm run build`, output `dist`). No env vars needed.
- **Netlify:** import the repo. `netlify.toml` is included.

Each visitor gets their own copy of the sample data in their browser. Untouched demo data is regenerated each store day so the forecasts stay current. **Settings → Reset demo data** restores the seed.

**Demo links:** `/?as=staff` signs in as operations staff. `/?as=s1`, `/?as=s2` and `/?as=s3` sign in as a supplier.

## Where things live

| Path | What |
|---|---|
| `src/lib/calc.ts` | All business rules: forecast, flags, order stages, chase rules, arrival matching |
| `src/lib/calc.test.ts` | Tests pinning those rules to the spec |
| `src/lib/store.tsx` | Local DB plus every action (validation, order history, stock movements, test outbox) |
| `src/lib/seed.ts` | Fake data: 6 products, 3 suppliers, 30 days of sales, orders at every stage |
| `src/lib/time.ts` | Store-day helpers (America/Denver) |
| `src/pages/*` | Stock, Orders, Arrivals, Follow-ups, History, Settings |

## Rule notes

- "Last 7 days" means today plus the 6 days before it, in store time (Denver). "Last 3" covers today back 2 days; "prior 4" covers 3 to 6 days ago.
- Suggested order is rounded **up** to whole units.
- Sells out on and Reorder by use whole days (floor).
- Days shown with 1 decimal. Days of stock is blank when adjusted burn is 0.
- Arrived units are attributed to an order's tracking numbers oldest shipment first. A tracking number with received units is locked (can't be changed, removed or marked returned).
- Low flags: under 21 days = urgent, under 45 = watch. Reorder soon = reorder-by date within the alert window (default 7 days).
- Stale-data warning: stock not synced for over 1 hour (the feed runs every 15 minutes), or sales not synced for over 24 hours.
- Email runs in test mode. Every email (reorder alerts, supplier-update notices, follow-ups, order messages) is written to **Settings → Email outbox**. Nothing is delivered.
