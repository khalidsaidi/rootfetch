# RootFetch Dashboard (GCP Cloud Run)

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

## Deployment

Use `.github/workflows/gcp_deploy.yml` (WIF + Cloud Run). Required repository
settings:

- secrets: `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT`
- vars: `GCP_PROJECT_ID`, `GCP_REGION`, `ARTIFACT_REPO`, `WEB_SERVICE`,
  `TELEMETRY_SERVICE`, `NEXT_PUBLIC_SITE_URL`

The workflow triggers on pushes that affect `apps/web/**`, `data/**`, or
`apps/mcp-telemetry-remote/**`.

## Notes

- The dashboard never reads CZDS credentials.
- Only safe aggregates and markdown digest are displayed.
