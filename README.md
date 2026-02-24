# RootFetch

RootFetch is a daily CZDS zone-file trend engine that measures **active delegated
domains proxy counts** and publishes product-grade signals.

## What RootFetch Measures

Primary metric:

- `count_ns_sld`: unique second-level owner names with at least one `NS` record
  in a TLD zone on a given day.

This is a DNS-active delegation proxy, not a full registration count.

See full metric definitions in [docs/metrics_spec.md](docs/metrics_spec.md).

## Safety and Compliance

- Never commit credentials, tokens, MFA secrets, or `.env`.
- Never commit raw zone files.
- Treat CZDS links as sensitive; full URLs are stored only in `.ai/` (ignored).
- Commit only safe aggregates (`data/`), docs, and code.

## Setup

Python 3.11+ recommended.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

Set local environment variables (or use a local `.env`, never committed):

```bash
export CZDS_USERNAME="..."
export CZDS_PASSWORD="..."
# Optional only if your ICANN account uses TOTP MFA:
export CZDS_TOTP_SECRET="..."
```

Optional runtime variables:

- `ROOTFETCH_TLD_ALLOWLIST` (comma-separated)
- `ROOTFETCH_TLD_BLOCKLIST` (comma-separated)
- `ROOTFETCH_MAX_WORKERS` (default `4`)
- `ROOTFETCH_HTTP_TIMEOUT` (default `60`)
- `ROOTFETCH_RETRY_MAX` (default `5`)
- `ROOTFETCH_COUNT_MODE` (`ns_sld_exact` or `ns_sld_hll`)
- `ROOTFETCH_MIN_BASE_FOR_PCT` (default `1000`)
- `ROOTFETCH_SECTOR_MAP_PATH` (default `rootfetch/resources/tld_sectors.yml`)

Safe-start behavior:

- If allowlist is empty and blocklist unset, default blocklist is `com,net,org`.

## CLI Commands

```bash
rootfetch auth-check
rootfetch discover
rootfetch run-daily
rootfetch compute-signals --date YYYY-MM-DD
rootfetch rag build
rootfetch rag search "query" --k 8
rootfetch mcp serve --transport stdio
```

## Data Outputs

- `data/daily_counts/<YYYY-MM-DD>.csv`
- `data/growth_trends.csv`
- `data/approved_tlds/<YYYY-MM-DD>.json` (sanitized)
- `data/signals/*`
- `data/digests/*`

Signal definitions: [docs/signal_spec.md](docs/signal_spec.md)

## GitHub Actions

Workflow: `.github/workflows/rootfetch_daily.yml`

- Scheduled daily run (`02:30 UTC`)
- Manual run via `workflow_dispatch`
- Commits only safe aggregates and docs/code changes

Required repository secrets:

- `CZDS_USERNAME`
- `CZDS_PASSWORD`
- optional `CZDS_TOTP_SECRET`

## MCP and RAG

- MCP docs: [docs/mcp_server.md](docs/mcp_server.md)
- RAG docs: [docs/rag.md](docs/rag.md)

MCP server is read-only and serves only committed artifacts.
