# RootFetch Agent Monitor (JS)

Canonical JS example for consuming RootFetch immutable artifacts.

## Features

- Fetch latest run pointer.
- Verify manifest hashes via `rootfetch-sdk-js`.
- Evaluate policies:
  - regime transition
  - DVI threshold
  - top mover anomaly z-score
- Send webhook notifications with idempotency headers.
- Persist state atomically.

## Install

```bash
npm install
```

## Run

```bash
ROOTFETCH_BASE_URL=https://rootfetch.com \
WEBHOOK_URL=https://example.com/webhook \
npm start
```

Dry-run:

```bash
ROOTFETCH_BASE_URL=https://rootfetch.com \
npm run start:dry
```

## Environment

- `ROOTFETCH_BASE_URL` (default: `https://rootfetch.com`)
- `WEBHOOK_URL` (optional; if missing, logs to stdout)
- `ROOTFETCH_STATE_PATH` (default: `.rootfetch-agent-state.json`)
- `ROOTFETCH_DVI_THRESHOLD` (default: `50`)
- `ROOTFETCH_TOP_MOVER_Z_THRESHOLD` (default: `2.5`)
- `ROOTFETCH_DEDUP_HOURS` (default: `168`)
- `ROOTFETCH_TIMEOUT_MS` (default: `15000`)

