# RootFetch Web Dashboard

This Next.js app renders RootFetch aggregate outputs that are committed in the
monorepo:

- `data/signals/latest.json`
- `data/digests/latest.md`
- optional: `data/signals/sector_indices.csv`

## Local development

From `apps/web`:

```bash
npm ci
npm run sync-data
npm run dev
```

## Build behavior

`npm run build` runs `prebuild`, which copies RootFetch artifacts into
`public/rootfetch/`.

If required artifacts are missing, `sync-data` fails with a clear message.

## Deployment

Recommended: Vercel project with root directory `apps/web` and branch `main`.

Every RootFetch daily commit updates `data/`, which can trigger a dashboard
rebuild/deploy.
