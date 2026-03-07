# RootFetch Local Runner

RootFetch ingestion runs on your machine, not on Vercel and not on GitHub-hosted runners.

## Required Local Environment

Create a local credential file `.env.czds` (never committed):

```bash
cp .env.example .env.czds
chmod 600 .env.czds
rootfetch auth-check
```

- `CZDS_USERNAME`
- `CZDS_PASSWORD`
- `CZDS_TOTP_SECRET` (only if your account uses TOTP MFA)

Legacy fallback: `.env` is still loaded if present. Canonical path is `.env.czds`.
See [CZDS Credentials (Canonical Local Setup)](./czds_credentials.md) for troubleshooting and scheduler notes.

Optional local MCP settings file `.env.mcp` (never committed):

- optional `ROOTFETCH_MCP_URL` (default `https://rootfetch.com/mcp`)

Optional hybrid overrides:

- `ROOTFETCH_ROLLING_PERIOD_DAYS`
- `ROOTFETCH_ROLLING_MIN_PER_DAY`
- `ROOTFETCH_ROLLING_MAX_PER_DAY`
- `ROOTFETCH_MAX_WORKERS`
- `ROOTFETCH_HTTP_TIMEOUT`
- `ROOTFETCH_RETRY_MAX`
- `ROOTFETCH_LOG_EVERY`
- `ROOTFETCH_REPLAY_INDEX_MAX_RUNS` (default `365`)

Optional local alerting and delivery-reliability overrides:

- `ROOTFETCH_SLACK_WEBHOOK_URL`
- `ROOTFETCH_DISCORD_WEBHOOK_URL`
- `ROOTFETCH_ALERT_MOVER_ABS_THRESHOLD`
- `ROOTFETCH_ALERT_MOVER_PCT_THRESHOLD`
- `ROOTFETCH_ALERT_ANOMALY_Z_THRESHOLD`
- `ROOTFETCH_ALERT_FAILURE_THRESHOLD`
- `ROOTFETCH_ALERT_RETRY_MAX`
- `ROOTFETCH_ALERT_RETRY_BASE_SECONDS`
- `ROOTFETCH_ALERT_RETRY_MAX_SECONDS`
- `ROOTFETCH_ALERT_RETRY_JITTER_PCT`
- `ROOTFETCH_ALERT_LOCK_TIMEOUT_SECONDS`
- `ROOTFETCH_ALERT_DEDUP_HOURS`
- `ROOTFETCH_ALERT_RECOVER_CORRUPT_STATE` (default `false`; requires explicit opt-in)

## Daily Local Command

Run:

```bash
./scripts/local_run_hybrid.sh
```

Full retest (includes live MCP checks when MCP URL is configured):

```bash
./scripts/retest_new_approvals.sh
```

Both scripts load local env files in this order: `.env.czds` -> `.env` -> `.env.mcp`.

The script does:

1. `rootfetch discover`
2. checks `rootfetch baseline-status --date <today>`
3. loops `rootfetch run-baseline --resume` until baseline completion (`missing_ever_count=0`)
4. after baseline completion, runs `rootfetch run-hybrid --date <today>`
5. `rootfetch compute-signals --date <run_date>`
6. `rootfetch rag build-static`
7. `rootfetch publish prepare --date <run_date> --out-dir .ai/publish/latest ...`
8. `rootfetch publish run --source-dir .ai/publish/latest --artifacts-root data/artifacts ...`
9. commit/push safe artifacts only under `data/` (including `data/state/baseline_complete.json` and `data/artifacts/*`)

Alert delivery is local-only and persistent:

- queue state is stored at `.ai/alerts/state.json`
- delivery attempts are append-logged at `.ai/alerts/delivery_log.jsonl`
- failed notifications are retried with exponential backoff
- exhausted retries are retained in `dead_letters` for operator review
- dedup keys are bucketed by snapshot UTC date (`YYYY-MM-DD`), not wall-clock runtime
- if `state.json` is corrupt, it is quarantined to `.ai/alerts/state.corrupt.<run_id>.<timestamp>.json`
- by default, runner halts on corrupt state and requires explicit recovery:
  - CLI: `rootfetch alerts run --date <YYYY-MM-DD> --recover-corrupt-state`
  - env: `ROOTFETCH_ALERT_RECOVER_CORRUPT_STATE=true`

## Scheduling

### Option 1: cron

```bash
mkdir -p /path/to/rootfetch/.ai/logs
```

Add this entry to crontab:

```bash
CRON_TZ=UTC
30 2 * * * /bin/bash -lc "cd /path/to/rootfetch && ./scripts/local_run_hybrid.sh >> .ai/logs/cron.log 2>&1"
```

### Option 2: systemd timer (recommended)

Service (`/etc/systemd/system/rootfetch-hybrid.service`):

```ini
[Unit]
Description=RootFetch Hybrid Daily Run

[Service]
Type=oneshot
WorkingDirectory=/path/to/rootfetch
ExecStart=/bin/bash -lc './scripts/local_run_hybrid.sh'
```

Timer (`/etc/systemd/system/rootfetch-hybrid.timer`):

```ini
[Unit]
Description=Run RootFetch Hybrid Daily at 02:30 UTC

[Timer]
OnCalendar=*-*-* 02:30:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
```

Enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rootfetch-hybrid.timer
```
