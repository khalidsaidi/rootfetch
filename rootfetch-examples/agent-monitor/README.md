# RootFetch Agent Monitor (v1)

Canonical example consumers for RootFetch immutable artifacts.

This example does four things:

1. Fetches `latest` run pointer.
2. Verifies run manifest hashes.
3. Evaluates policy rules (regime transition, DVI threshold, top mover z-score).
4. Emits webhook notifications with idempotency headers.

## Layout

```text
rootfetch-examples/agent-monitor/
  js/
  py/
```

## Policy Set (v1)

- `regime_transition`: triggers when `regime` changes from previous run.
- `dvi_threshold`: triggers when `dvi >= ROOTFETCH_DVI_THRESHOLD`.
- `top_mover_anomaly`: triggers when top mover z-score exceeds `ROOTFETCH_TOP_MOVER_Z_THRESHOLD`.

## Notification Headers

- `Idempotency-Key: <dedup_key>`
- `X-RootFetch-Dedup-Key: <dedup_key>`

## Payload Fields

- `run_id`
- `snapshot_ts_utc`
- `model_version`
- `regime`
- `dvi`
- `regime_confidence`
- `policy_id`
- `summary`
- `links.run_url`
- `links.compare_url` (when previous run exists)

## State

Durable state file stores:

- `last_seen_run_id`
- `notified_keys` map (`dedup_key -> timestamp`)

State writes are atomic (`temp -> fsync -> rename`).

