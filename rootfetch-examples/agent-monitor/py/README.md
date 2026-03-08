# RootFetch Agent Monitor (Python)

Canonical Python example for consuming RootFetch immutable artifacts.

## Features

- Fetch latest run pointer.
- Verify manifest hashes via `rootfetch-sdk-py`.
- Evaluate policies:
  - regime transition
  - DVI threshold
  - top mover anomaly z-score
- Send webhook notifications with idempotency headers.
- Persist state atomically.

## Run

```bash
ROOTFETCH_BASE_URL=https://rootfetch.com \
WEBHOOK_URL=https://example.com/webhook \
python -m rootfetch_agent.monitor
```

Dry-run:

```bash
ROOTFETCH_BASE_URL=https://rootfetch.com \
python -m rootfetch_agent.monitor --dry-run
```

## Environment

- `ROOTFETCH_BASE_URL` (default: `https://rootfetch.com`)
- `WEBHOOK_URL` (optional; if missing, logs to stdout)
- `ROOTFETCH_STATE_PATH` (default: `.rootfetch-agent-state.json`)
- `ROOTFETCH_DVI_THRESHOLD` (default: `50`)
- `ROOTFETCH_TOP_MOVER_Z_THRESHOLD` (default: `2.5`)
- `ROOTFETCH_DEDUP_HOURS` (default: `168`)
- `ROOTFETCH_TIMEOUT_SECONDS` (default: `15`)

