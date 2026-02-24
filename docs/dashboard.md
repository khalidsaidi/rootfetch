# RootFetch Dashboard (Vercel)

RootFetch includes a Next.js dashboard at `apps/web` that visualizes committed
aggregate artifacts.

## Data flow

1. RootFetch daily run updates:
   - `data/signals/latest.json`
   - `data/digests/latest.md`
2. `apps/web/scripts/sync-rootfetch-data.mjs` copies those files into
   `apps/web/public/rootfetch/` during `npm run build`.
3. The dashboard renders from copied static files and exposes `/api/latest`.

## Local run

```bash
cd apps/web
npm ci
npm run sync-data
npm run dev
```

## Vercel deployment options

## Option A: Git integration

- Connect `khalidsaidi/rootfetch` in Vercel.
- Set Root Directory to `apps/web`.
- Set production branch to `main`.

## Option B: GitHub Actions + Vercel CLI

Use `.github/workflows/vercel_deploy.yml` and add repository secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

The workflow triggers on pushes that affect `apps/web/**` or `data/**`.

## Notes

- The dashboard never reads CZDS credentials.
- Only safe aggregates and markdown digest are displayed.
