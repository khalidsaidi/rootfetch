# RootFetch SDK Contract v1

This document is the authoritative contract for the RootFetch SDKs.

## Version

- Contract version: `sdk_contract_v1`
- Model compatibility target: `rootfetch_model_v1`

## Methods

Both SDKs must expose these methods with identical behavior:

1. `latest()`
2. `run(run_id)`
3. `replay()`
4. `verifyManifest(run_id)` (Python: `verify_manifest(run_id)`)

## Endpoint Mapping

SDKs must read only artifact endpoints.

- `/rootfetch/artifacts/latest.json`
- `/rootfetch/artifacts/replay/index.json`
- `/rootfetch/artifacts/runs/<run_id>/manifest.json`
- `/rootfetch/artifacts/runs/<run_id>/coverage_latest.json`
- `/rootfetch/artifacts/runs/<run_id>/model_latest.json`
- `/rootfetch/artifacts/runs/<run_id>/treemap_latest.json`
- `/rootfetch/artifacts/runs/<run_id>/radar_latest.json`
- `/rootfetch/artifacts/runs/<run_id>/signals_latest.json`
- `/rootfetch/artifacts/runs/<run_id>/digest_latest.txt`
- `/rootfetch/artifacts/runs/<run_id>/rag/index.json`
- `/rootfetch/artifacts/runs/<run_id>/rag/chunks.jsonl`

## Response Schemas

### `LatestPointer`

```json
{
  "run_id": "20260225T235959Z_59aff28ff918_rootfetch_model_v1",
  "model_version": "rootfetch_model_v1",
  "snapshot_hash": "59aff28ff918bc42ff1d7595515ab431bd16597f142085f414458277f1de53a2",
  "snapshot_ts_utc": "2026-02-25T23:59:59Z",
  "snapshot_utc_day": "2026-02-25",
  "coverage": {
    "approved_tlds_count": 851,
    "counted_ever_count": 851,
    "missing_ever_count": 0,
    "counted_today_core_count": 3,
    "counted_today_rolling_count": 65
  }
}
```

### `ReplayIndex`

```json
{
  "runs": [
    {
      "run_id": "20260225T235959Z_59aff28ff918_rootfetch_model_v1",
      "snapshot_ts_utc": "2026-02-25T23:59:59Z",
      "snapshot_utc_day": "2026-02-25",
      "snapshot_hash": "59aff28ff918bc42ff1d7595515ab431bd16597f142085f414458277f1de53a2",
      "model_version": "rootfetch_model_v1",
      "dvi": {},
      "regime": "STABLE",
      "regime_confidence": 0.3
    }
  ]
}
```

### `Manifest`

```json
{
  "run_id": "20260225T235959Z_59aff28ff918_rootfetch_model_v1",
  "model_version": "rootfetch_model_v1",
  "snapshot_ts_utc": "2026-02-25T23:59:59Z",
  "snapshot_utc_day": "2026-02-25",
  "snapshot_hash": "59aff28ff918bc42ff1d7595515ab431bd16597f142085f414458277f1de53a2",
  "files": [
    {
      "path": "coverage_latest.json",
      "size": 42410,
      "sha256": "59aff28ff918bc42ff1d7595515ab431bd16597f142085f414458277f1de53a2"
    }
  ]
}
```

### `RunBundle`

`run(run_id)` returns:

```json
{
  "run_id": "20260225T235959Z_59aff28ff918_rootfetch_model_v1",
  "manifest": {},
  "artifacts": {
    "coverage_latest.json": {},
    "model_latest.json": {},
    "treemap_latest.json": {},
    "radar_latest.json": {},
    "signals_latest.json": {},
    "digest_latest.txt": "string",
    "rag/index.json": {},
    "rag/chunks.jsonl": "string"
  }
}
```

### `VerificationResult`

```json
{
  "run_id": "20260225T235959Z_59aff28ff918_rootfetch_model_v1",
  "valid": true,
  "expected_count": 8,
  "checked_count": 8,
  "checked_files": 8,
  "missing_files": [],
  "mismatched_files": [
    {
      "path": "coverage_latest.json",
      "expected_sha256": "abc123...",
      "actual_sha256": "def456..."
    }
  ]
}
```

## Invariants

1. No internal caching.
2. No silent retries.
3. SDK methods use artifact endpoints only.
4. SHA256 verification uses raw bytes.
5. Verification fails if a manifest file is missing.
6. Verification fails if any hash mismatches.
7. `run()` must fetch the canonical artifact set and pass artifact payloads through as-is (JSON parsed for `*.json`, UTF-8 text for `*.txt` and `*.jsonl`).
8. `run()` must not auto-verify hashes.
9. Verification result must expose:
   - `expected_count`: manifest entry count.
   - `checked_count`: number of files successfully hashed.
