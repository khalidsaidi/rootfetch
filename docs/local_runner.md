# RootFetch Local Runner

RootFetch ingestion runs on your machine, not on Vercel and not on GitHub-hosted runners.

## Required Local Environment

Create a local `.env` (never committed):

```bash
cp .env.example .env
```

- `CZDS_USERNAME`
- `CZDS_PASSWORD`
- `CZDS_TOTP_SECRET` (only if your account uses TOTP MFA)

Optional local MCP auth file `.env.mcp` (never committed):

- `ROOTFETCH_MCP_TOKEN`
- optional `ROOTFETCH_MCP_ORIGIN` (default `https://rootfetch.vercel.app`)
- optional `ROOTFETCH_MCP_URL` (default `https://rootfetch.vercel.app/api/mcp`)

Optional hybrid overrides:

- `ROOTFETCH_ROLLING_PERIOD_DAYS`
- `ROOTFETCH_ROLLING_MIN_PER_DAY`
- `ROOTFETCH_ROLLING_MAX_PER_DAY`
- `ROOTFETCH_MAX_WORKERS`
- `ROOTFETCH_HTTP_TIMEOUT`
- `ROOTFETCH_RETRY_MAX`
- `ROOTFETCH_LOG_EVERY`

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

Full retest (includes live MCP checks if token is available, otherwise prints a skip message):

```bash
./scripts/retest_new_approvals.sh
```

The script does:

1. `rootfetch discover`
2. checks `rootfetch baseline-status --date <today>`
3. loops `rootfetch run-baseline --resume` until baseline completion (`missing_ever_count=0`)
4. after baseline completion, runs `rootfetch run-hybrid --date <today>`
5. `rootfetch compute-signals --date <run_date>`
6. `rootfetch rag build-static`
7. commit/push safe artifacts only under `data/` (including `data/state/baseline_complete.json`)

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
