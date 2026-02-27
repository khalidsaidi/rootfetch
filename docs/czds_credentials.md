# CZDS Credentials (Canonical Local Setup)

RootFetch ingestion requires local CZDS credentials and does not run without them.

## Canonical Credential File

Use `.env.czds` in repo root (gitignored):

```bash
cp .env.example .env.czds
chmod 600 .env.czds
```

Set:

- `CZDS_USERNAME`
- `CZDS_PASSWORD`
- optional `CZDS_TOTP_SECRET`

Validate before running automation:

```bash
rootfetch auth-check
```

## Script Load Order

`./scripts/local_run_hybrid.sh` and `./scripts/retest_new_approvals.sh` load env files in this order:

1. `.env.czds` (canonical)
2. `.env` (legacy fallback)
3. `.env.mcp` (optional MCP/runtime overrides)

If credentials are missing, scripts fail fast with setup instructions.

## Scheduler Notes

Cron/systemd inherits only what the script loads from repo files. Keep `.env.czds` present on the runner host and locked down (`chmod 600`).

## Troubleshooting

- `Missing CZDS credentials`: ensure `.env.czds` exists and has `CZDS_USERNAME`/`CZDS_PASSWORD`.
- `auth-check` fails: refresh credentials/TOTP seed and rerun `rootfetch auth-check`.
- Cron run fails but manual run works: verify cron `WorkingDirectory`/`cd` points to repo root containing `.env.czds`.
