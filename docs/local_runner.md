# RootFetch Local Runner

RootFetch ingestion runs on your machine, not on Vercel and not on GitHub-hosted runners.

## Required Local Environment

Create a local `.env` (never committed):

- `CZDS_USERNAME`
- `CZDS_PASSWORD`
- `CZDS_TOTP_SECRET` (only if your account uses TOTP MFA)

Optional hybrid overrides:

- `ROOTFETCH_ROLLING_PERIOD_DAYS`
- `ROOTFETCH_ROLLING_MIN_PER_DAY`
- `ROOTFETCH_ROLLING_MAX_PER_DAY`
- `ROOTFETCH_MAX_WORKERS`
- `ROOTFETCH_HTTP_TIMEOUT`
- `ROOTFETCH_RETRY_MAX`

## Daily Local Command

Run:

```bash
./scripts/local_run_hybrid.sh
```

The script does:

1. `rootfetch discover`
2. `rootfetch run-hybrid`
3. `rootfetch compute-signals --date <today>`
4. `rootfetch rag build-static`
5. commit/push safe artifacts only under `data/`

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
