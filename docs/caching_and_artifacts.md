# RootFetch Artifact + Caching Contract (v1)

This contract defines how RootFetch publishes immutable run artifacts while keeping Vercel read-only and replay-safe.

## Goals

- Deterministic replay: historical runs never mutate.
- Atomic freshness: clients either see old `latest` or new `latest`, never mixed artifacts.
- CDN efficiency: immutable artifacts cache aggressively.
- Clear model lineage: every run is bound to a model version and snapshot hash.

## Run Identity

Each published run is addressed by a stable `run_id`:

`<snapshot_timestamp_utc>_<snapshot_hash>_<model_version>`

Example:

`2026-02-25T23-08-01Z_4f19b9a8_rootfetch_model_v1`

## Artifact Layout

Immutable run-scoped artifacts:

- `data/artifacts/runs/<run_id>/snapshot.json`
- `data/artifacts/runs/<run_id>/model.json`
- `data/artifacts/runs/<run_id>/treemap.json`
- `data/artifacts/runs/<run_id>/radar.json`
- `data/artifacts/runs/<run_id>/digest.md`
- `data/artifacts/runs/<run_id>/manifest.json`

Replay index:

- `data/artifacts/replay/index.json`

Latest pointer (atomic update target):

- `data/artifacts/latest.json`

## Latest Pointer Contract

`latest.json` is the only mutable entrypoint and must be updated atomically after all run artifacts are written.

Schema:

```json
{
  "run_id": "2026-02-25T23-08-01Z_4f19b9a8_rootfetch_model_v1",
  "snapshot_ts_utc": "2026-02-25T23:08:01Z",
  "snapshot_date_utc": "2026-02-25",
  "model_version": "rootfetch_model_v1",
  "methodology_version": "2026-03-01",
  "published_at_utc": "2026-02-25T23:09:02Z"
}
```

## Publish Sequence (must stay in order)

1. Build all aggregate artifacts locally.
2. Compute snapshot hash and `run_id`.
3. Write run-scoped files under `runs/<run_id>/`.
4. Update replay index with the new run metadata.
5. Atomically replace `latest.json`.
6. Commit and push artifacts.
7. Vercel serves committed files only.

Never publish `latest.json` before run-scoped files exist.

## Cache-Control Policy

Run-scoped immutable artifacts:

- `Cache-Control: public, max-age=31536000, immutable`

Replay index:

- `Cache-Control: public, max-age=60, stale-while-revalidate=600`

Latest pointer:

- `Cache-Control: public, max-age=10, stale-while-revalidate=60`

## Replay Rules

- Replay uses stored artifacts for a selected `run_id`.
- Replay never recomputes historical model outputs at request-time.
- Model updates create new runs with a new `model_version`.
- Old runs remain immutable and queryable.

## Runtime Boundary

- Local runner performs ingestion + heavy compute.
- Vercel is strictly read-only for committed artifacts.
- No CZDS downloads or secret-based ingestion tasks run on Vercel.

