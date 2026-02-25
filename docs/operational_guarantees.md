# RootFetch Operational Guarantees (v1)

## Determinism

- Identical snapshot inputs produce identical outputs under the same `model_version`.
- Model outputs (`DVI`, `regime`, confidence fields) are deterministic for a given run input set.

## Consistency

- Runtime reads anchor to one run pointer from `data/artifacts/latest.json`.
- UI/API panels resolve run-scoped artifacts from that single `run_id` per page load.

## Immutability

- Published runs are immutable under `data/artifacts/runs/<run_id>/`.
- Each run includes `manifest.json` with per-file SHA-256 and size metadata.

## Caching

- Run artifacts: `Cache-Control: public, max-age=31536000, immutable`.
- Replay index: `Cache-Control: public, max-age=60, stale-while-revalidate=600`.
- Latest pointer: `Cache-Control: public, max-age=10, stale-while-revalidate=60`.

## Alert Delivery

- Delivery semantics: at-least-once.
- Durable dedup via stable persisted dedup keys.
- Append-only delivery audit log.
- Dead-letter retention after bounded retry exhaustion.

## Replay Integrity

- Replay resolves stored artifacts by `run_id`.
- Historical runs are not recomputed in-place.
